// @atlasdraw/storage — postgres-minio adapter.
//
// Full stack: Postgres for metadata, an S3-compatible store (MinIO, AWS S3)
// for the blobs. Same semantics as sqlite-fs. An S3 PUT replaces an object
// whole, so a write is atomic without a temp object. Bodies stream in and out
// with a known length; no blob is held whole in memory.
//
// The bucket is BLOB_BUCKET in BLOB_REGION. If it does not exist, the adapter
// makes it; a bucket that another account owns is an error.

import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import { ID_RE } from "../constants";
import { migratePostgres } from "../db/migrate";
import { measured } from "../lib/body";
import { logger } from "../logger";

import type {
  BlobBody,
  MapRecord,
  ShareToken,
  StorageClient,
  SweepResult,
} from "../types";

export const DEFAULT_BUCKET = "atlasdraw-maps";
export const DEFAULT_REGION = "us-east-1";

interface MapRow {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  blob_ref: string;
  byte_size: number | string;
  write_key_hash: string | null;
}

interface ShareRow {
  token: string;
  map_id: string;
  mode: string;
  expires_at: Date | string | null;
  created_at: Date | string;
}

function isoize(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rowToMap(row: MapRow): MapRecord {
  return {
    id: row.id,
    created_at: isoize(row.created_at),
    updated_at: isoize(row.updated_at),
    blob_ref: row.blob_ref,
    byte_size:
      typeof row.byte_size === "string"
        ? parseInt(row.byte_size, 10)
        : row.byte_size,
    write_key_hash: row.write_key_hash,
  };
}

function rowToShare(row: ShareRow): ShareToken {
  return {
    token: row.token,
    map_id: row.map_id,
    mode: "read",
    expires_at: row.expires_at === null ? null : isoize(row.expires_at),
    created_at: isoize(row.created_at),
  };
}

export function createPostgresMinioAdapter(opts: {
  databaseUrl: string;
  blobEndpoint: string;
  blobAccessKey: string;
  blobSecretKey: string;
  blobBucket?: string;
  blobRegion?: string;
}): StorageClient {
  const BUCKET = opts.blobBucket ?? DEFAULT_BUCKET;
  const pool = new Pool({ connectionString: opts.databaseUrl });
  // node-postgres requirement, not optional: an idle client that the server
  // drops (restart, `terminating connection due to administrator command`,
  // network blip) emits an 'error' event on the Pool. Node's default
  // behavior for an unhandled 'error' event is to throw and crash the
  // process — discovered via ISSUES.md Issue 8's forced dependency-down
  // check (stopping the postgres container mid-session crashed the whole
  // storage process, not just failed one request). The pool itself already
  // removes the broken client and reconnects on next use; this handler only
  // stops that removal from taking the process down with it.
  pool.on("error", (err) => {
    logger.warn(
      { err },
      "postgres pool idle-client error (client removed, pool continues)",
    );
  });
  const s3 = new S3Client({
    endpoint: opts.blobEndpoint,
    region: opts.blobRegion ?? DEFAULT_REGION,
    credentials: {
      accessKeyId: opts.blobAccessKey,
      secretAccessKey: opts.blobSecretKey,
    },
    forcePathStyle: true,
  });

  let bucketReady = false;

  // The schema setup runs once per process. A setup that fails (Postgres not
  // up yet at a cold start) is forgotten, so the next call tries again.
  let schemaReady: Promise<void> | null = null;
  function ensureSchema(): Promise<void> {
    if (!schemaReady) {
      schemaReady = migratePostgres(pool).catch((err: unknown) => {
        schemaReady = null;
        throw err;
      });
    }
    return schemaReady;
  }
  // Start the setup with the server instead of at the first request. A
  // failure here is only logged; the first request retries it.
  ensureSchema().catch((err: unknown) => {
    logger.warn({ err }, "postgres schema setup failed; will retry");
  });

  // HeadBucket first: an app user that may not create buckets (the compose
  // stack's MinIO user) still works with a bucket made for it. A bucket that
  // exists but is not ours is an error: on AWS, BucketAlreadyExists means
  // another account owns the name.
  async function ensureBucket(): Promise<void> {
    if (bucketReady) {
      return;
    }
    try {
      await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      if (status !== 404 && name !== "NotFound" && name !== "NoSuchBucket") {
        throw err;
      }
      try {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      } catch (createErr: unknown) {
        // Another server made it between the two calls.
        if (
          (createErr as { name?: string })?.name !== "BucketAlreadyOwnedByYou"
        ) {
          throw createErr;
        }
      }
    }
    bucketReady = true;
  }

  /** Streams `body` to `key`; exactly `body.size` bytes or a rejection. */
  async function putBlob(key: string, body: BlobBody): Promise<void> {
    await ensureBucket();
    // The SDK must never read a stream that errors: it leaves that rejection
    // unhandled. So the measured bytes reach it through `pipe`, which does
    // not pass errors on, and a wrong length aborts the request instead.
    const abort = new AbortController();
    const meter = measured(body.size);
    const toS3 = new PassThrough();
    meter.pipe(toS3);
    const pump = pipeline(body.stream, meter).catch((err: unknown) => {
      abort.abort(err);
      throw err;
    });
    const sent = s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: toS3,
        ContentLength: body.size,
        ContentType: "application/octet-stream",
      }),
      { abortSignal: abort.signal },
    );
    const [pumped, put] = await Promise.allSettled([pump, sent]);
    if (pumped.status === "rejected") {
      throw pumped.reason;
    }
    if (put.status === "rejected") {
      throw put.reason;
    }
  }

  async function deleteBlob(key: string): Promise<void> {
    await ensureBucket();
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }

  const MAP_COLUMNS =
    "id, created_at, updated_at, blob_ref, byte_size, write_key_hash";

  async function selectMap(id: string): Promise<MapRow | undefined> {
    const res = await pool.query<MapRow>(
      `SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1`,
      [id],
    );
    return res.rows[0];
  }

  return {
    async createMap(body, writeKeyHash) {
      await ensureSchema();
      const id = nanoid(21);
      const blobRef = `maps/${id}.atlasdraw`;
      await putBlob(blobRef, body);
      const now = new Date();
      try {
        await pool.query(
          `INSERT INTO maps (${MAP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, now, now, blobRef, body.size, writeKeyHash],
        );
      } catch (err) {
        await deleteBlob(blobRef).catch(() => undefined);
        throw err;
      }
      return {
        id,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        blob_ref: blobRef,
        byte_size: body.size,
        write_key_hash: writeKeyHash,
      };
    },

    async getMap(id) {
      if (!ID_RE.test(id)) {
        return null;
      }
      await ensureSchema();
      const row = await selectMap(id);
      return row ? rowToMap(row) : null;
    },

    async updateMap(id, body) {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      await ensureSchema();
      const row = await selectMap(id);
      if (!row) {
        throw new Error(`not found: ${id}`);
      }
      await putBlob(row.blob_ref, body);
      const now = new Date();
      await pool.query(
        `UPDATE maps SET updated_at = $1, byte_size = $2 WHERE id = $3`,
        [now, body.size, id],
      );
      return {
        ...rowToMap(row),
        updated_at: now.toISOString(),
        byte_size: body.size,
      };
    },

    async createShareToken(mapId, expiresAt) {
      if (!ID_RE.test(mapId)) {
        throw new Error(`not found: ${mapId}`);
      }
      await ensureSchema();
      if (!(await selectMap(mapId))) {
        throw new Error(`not found: ${mapId}`);
      }
      const token = nanoid(21);
      const now = new Date();
      await pool.query(
        `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, mapId, "read", expiresAt, now],
      );
      return {
        token,
        map_id: mapId,
        mode: "read",
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        created_at: now.toISOString(),
      };
    },

    async resolveToken(token) {
      if (!ID_RE.test(token)) {
        return null;
      }
      await ensureSchema();
      const res = await pool.query<ShareRow>(
        `SELECT token, map_id, mode, expires_at, created_at
         FROM share_tokens WHERE token = $1`,
        [token],
      );
      return res.rows[0] ? rowToShare(res.rows[0]) : null;
    },

    async deleteShareToken(mapId, token) {
      if (!ID_RE.test(mapId) || !ID_RE.test(token)) {
        return false;
      }
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM share_tokens WHERE token = $1 AND map_id = $2`,
        [token, mapId],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async deleteMap(id) {
      if (!ID_RE.test(id)) {
        return false;
      }
      await ensureSchema();
      const client = await pool.connect();
      let blobRef: string | null = null;
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM share_tokens WHERE map_id = $1`, [id]);
        const res = await client.query<{ blob_ref: string }>(
          `DELETE FROM maps WHERE id = $1 RETURNING blob_ref`,
          [id],
        );
        await client.query("COMMIT");
        blobRef = res.rows[0]?.blob_ref ?? null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      if (blobRef === null) {
        return false;
      }
      await deleteBlob(blobRef);
      return true;
    },

    async totalBytes() {
      await ensureSchema();
      const res = await pool.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(byte_size), 0) AS total FROM maps`,
      );
      return Number(res.rows[0]?.total ?? 0);
    },

    async sweep(now): Promise<SweepResult> {
      await ensureSchema();
      const tokens = await pool.query(
        `DELETE FROM share_tokens
         WHERE expires_at IS NOT NULL AND expires_at <= $1`,
        [now],
      );
      const maps = await pool.query<{ blob_ref: string }>(
        `DELETE FROM maps
         WHERE write_key_hash IS NULL
           AND NOT EXISTS (SELECT 1 FROM share_tokens WHERE map_id = maps.id)
         RETURNING blob_ref`,
      );
      for (const row of maps.rows) {
        await deleteBlob(row.blob_ref);
      }
      return { tokens: tokens.rowCount ?? 0, maps: maps.rows.length };
    },

    async getBlob(id) {
      // Malformed id or missing object: null. Any other S3 error propagates.
      if (!ID_RE.test(id)) {
        return null;
      }
      await ensureSchema();
      const row = await selectMap(id);
      if (!row) {
        return null;
      }
      await ensureBucket();
      const key = row.blob_ref;
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        // In Node the SDK's Body is an IncomingMessage: a Readable that
        // streams from the socket.
        const body = res.Body;
        if (!(body instanceof Readable)) {
          return null;
        }
        return {
          stream: body,
          size: res.ContentLength ?? rowToMap(row).byte_size,
        };
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NoSuchKey" || name === "NotFound") {
          return null;
        }
        throw err;
      }
    },

    async ping(): Promise<void> {
      // Ping via ListBuckets, not HeadBucket on our own bucket — the bucket
      // may not exist yet (lazily created on first write) even though MinIO
      // itself is perfectly healthy. ListBuckets checks connectivity +
      // credentials without depending on our bucket's existence.
      await pool.query("SELECT 1");
      await s3.send(new ListBucketsCommand({}));
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
