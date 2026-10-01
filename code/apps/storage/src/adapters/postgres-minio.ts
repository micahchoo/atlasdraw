// @atlasdraw/storage — postgres-minio adapter.
//
// Full stack: Postgres for metadata, a MinIO/S3-compatible store for the
// blobs. Same semantics as sqlite-fs. The bucket is made on first use. An S3
// PUT replaces an object whole, so a write is atomic without a temp object.

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import { ID_RE } from "../constants";
import { migratePostgres } from "../db/migrate";
import { logger } from "../logger";

import type {
  MapRecord,
  ShareToken,
  StorageClient,
  SweepResult,
} from "../types";

const BUCKET = "atlasdraw-maps";

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
}): StorageClient {
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
    region: "us-east-1",
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

  async function ensureBucket(): Promise<void> {
    if (bucketReady) {
      return;
    }
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? "";
      // Ignore "already exists" variants from MinIO/S3.
      if (
        name !== "BucketAlreadyOwnedByYou" &&
        name !== "BucketAlreadyExists"
      ) {
        // Surface any other error (e.g. credentials).
        throw err;
      }
    }
    bucketReady = true;
  }

  async function putBlob(key: string, blob: Buffer): Promise<void> {
    await ensureBucket();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: blob,
        ContentType: "application/octet-stream",
      }),
    );
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
    async createMap(blob, writeKeyHash) {
      await ensureSchema();
      const id = nanoid(21);
      const blobRef = `maps/${id}.atlasdraw`;
      await putBlob(blobRef, blob);
      const now = new Date();
      try {
        await pool.query(
          `INSERT INTO maps (${MAP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, now, now, blobRef, blob.byteLength, writeKeyHash],
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
        byte_size: blob.byteLength,
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

    async updateMap(id, blob) {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      await ensureSchema();
      const row = await selectMap(id);
      if (!row) {
        throw new Error(`not found: ${id}`);
      }
      await putBlob(row.blob_ref, blob);
      const now = new Date();
      await pool.query(
        `UPDATE maps SET updated_at = $1, byte_size = $2 WHERE id = $3`,
        [now, blob.byteLength, id],
      );
      return {
        ...rowToMap(row),
        updated_at: now.toISOString(),
        byte_size: blob.byteLength,
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
        const body = (res as { Body?: unknown }).Body as
          | {
              transformToByteArray?: () => Promise<Uint8Array>;
            }
          | undefined;
        if (!body || typeof body.transformToByteArray !== "function") {
          return null;
        }
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes);
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
