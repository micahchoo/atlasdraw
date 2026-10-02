// @atlasdraw/storage — postgres-minio adapter.
//
// Full stack: Postgres for metadata, an S3-compatible store (MinIO, AWS S3)
// for the blobs. Same semantics as sqlite-fs: every write streams to a NEW
// object (`maps/<id>.<random>.atlasdraw`), one transaction checks the row
// still exists, points it at the new object and counts the size change, and
// only then is the old object deleted. Bodies stream in and out with a known
// length; no blob is held whole in memory. The size cap: see types.ts.
//
// The bucket is BLOB_BUCKET in BLOB_REGION. If it does not exist, the adapter
// makes it; a bucket that another account owns is an error.

import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import { ID_RE } from "../constants";
import { migratePostgres } from "../db/migrate";
import { WRITE_KEYS_MIGRATION } from "../db/migrations";
import { measured } from "../lib/body";
import { RevisionConflictError, storageFull } from "../lib/errors";
import { logger } from "../logger";

import type { PoolClient } from "pg";
import type {
  BlobBody,
  MapRecord,
  ShareToken,
  StorageClient,
  SweepResult,
} from "../types";

export const DEFAULT_BUCKET = "atlasdraw-maps";
const BLOB_PREFIX = "maps/";

function newBlobRef(id: string): string {
  return `${BLOB_PREFIX}${id}.${randomBytes(6).toString("hex")}.atlasdraw`;
}

type Queryable = Pick<PoolClient, "query">;
export const DEFAULT_REGION = "us-east-1";

interface MapRow {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  blob_ref: string;
  byte_size: number | string;
  write_key_hash: string | null;
  revision: number | string;
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
    revision: Number(row.revision),
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
  /** Path-style addressing; see BLOB_FORCE_PATH_STYLE in config.ts. */
  blobForcePathStyle?: boolean;
}): StorageClient {
  const BUCKET = opts.blobBucket ?? DEFAULT_BUCKET;
  const pool = new Pool({ connectionString: opts.databaseUrl });
  // node-postgres requirement, not optional: an idle client that the server
  // drops (restart, `terminating connection due to administrator command`,
  // network blip) emits an 'error' event on the Pool. Node's default
  // behavior for an unhandled 'error' event is to throw and crash the
  // process: stopping the postgres container mid-session crashes the whole
  // storage process, not just one request. The pool itself already
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
    forcePathStyle: opts.blobForcePathStyle ?? true,
  });

  // One setup at a time: concurrent first writes must not each send
  // CreateBucket. Some servers (SeaweedFS) answer the second one with
  // BucketAlreadyExists, which reads as "another account owns it". A setup
  // that fails is forgotten, so the next call tries again.
  let bucketReady: Promise<void> | null = null;

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

  // HeadBucket first: a key that may not create buckets (the recommended
  // key, limited to one bucket) still works with a bucket made for it. A bucket that
  // exists but is not ours is an error: on AWS, BucketAlreadyExists means
  // another account owns the name.
  async function headOrCreateBucket(): Promise<void> {
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
  }

  function ensureBucket(): Promise<void> {
    if (!bucketReady) {
      bucketReady = headOrCreateBucket().catch((err: unknown) => {
        bucketReady = null;
        throw err;
      });
    }
    return bucketReady;
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
    "id, created_at, updated_at, blob_ref, byte_size, write_key_hash, revision";

  async function selectMap(id: string): Promise<MapRow | undefined> {
    const res = await pool.query<MapRow>(
      `SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1`,
      [id],
    );
    return res.rows[0];
  }

  /** Runs `fn` in one transaction on one pooled connection. */
  async function inTransaction<T>(
    fn: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // Every write transaction takes the usage row first, so they queue in
      // one order and cannot deadlock.
      await db.query(`SELECT 1 FROM storage_usage WHERE id = 1 FOR UPDATE`);
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (err) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      db.release();
    }
  }

  async function usage(db: Queryable): Promise<{
    counted: number;
    inFlight: number;
  }> {
    const res = await db.query<{ counted: string; in_flight: string }>(
      `SELECT (SELECT total_bytes FROM storage_usage WHERE id = 1) AS counted,
              (SELECT COALESCE(SUM(bytes), 0) FROM storage_reservations) AS in_flight`,
    );
    return {
      counted: Number(res.rows[0]?.counted ?? 0),
      inFlight: Number(res.rows[0]?.in_flight ?? 0),
    };
  }

  /** A reservation id, or null when `bytes` would pass `cap`. */
  function reserve(bytes: number, cap: number): Promise<string | null> {
    return inTransaction(async (db) => {
      if (cap > 0) {
        const { counted, inFlight } = await usage(db);
        if (counted + inFlight + bytes > cap) {
          return null;
        }
      }
      const id = randomBytes(9).toString("base64url");
      await db.query(
        `INSERT INTO storage_reservations (id, bytes, created_at) VALUES ($1, $2, now())`,
        [id, bytes],
      );
      return id;
    });
  }

  async function release(reservation: string): Promise<void> {
    await pool
      .query(`DELETE FROM storage_reservations WHERE id = $1`, [reservation])
      .catch((err: unknown) =>
        // The sweep removes it later; the cap is only stricter until then.
        logger.warn({ err }, "could not release a size reservation"),
      );
  }

  /** Streams the bytes to a new blob under a reservation; null when full. */
  async function writeReserved(
    id: string,
    body: BlobBody,
    bytes: number,
    cap: number,
  ): Promise<{ ref: string; reservation: string } | null> {
    await ensureSchema();
    const reservation = await reserve(bytes, cap);
    if (reservation === null) {
      return null;
    }
    const ref = newBlobRef(id);
    try {
      await putBlob(ref, body);
    } catch (err) {
      await release(reservation);
      // A put cut partway may still have left an object.
      await deleteBlob(ref).catch(() => undefined);
      throw err;
    }
    return { ref, reservation };
  }

  async function removeOrphans(olderThan: Date): Promise<number> {
    await ensureBucket();
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: BLOB_PREFIX,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (
          !object.Key ||
          !object.LastModified ||
          object.LastModified >= olderThan
        ) {
          continue;
        }
        const live = await pool.query(
          `SELECT 1 FROM maps WHERE blob_ref = $1`,
          [object.Key],
        );
        if (live.rowCount === 0) {
          await deleteBlob(object.Key);
          removed += 1;
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  return {
    async createMap(body, writeKeyHash, opts = {}) {
      const id = nanoid(21);
      const written = await writeReserved(
        id,
        body,
        body.size,
        opts.maxTotalBytes ?? 0,
      );
      if (!written) {
        throw storageFull();
      }
      const now = new Date();
      try {
        await inTransaction(async (db) => {
          await db.query(
            `INSERT INTO maps (${MAP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
            [id, now, now, written.ref, body.size, writeKeyHash],
          );
          await db.query(
            `UPDATE storage_usage SET total_bytes = total_bytes + $1 WHERE id = 1`,
            [body.size],
          );
          await db.query(`DELETE FROM storage_reservations WHERE id = $1`, [
            written.reservation,
          ]);
        });
      } catch (err) {
        await release(written.reservation);
        await deleteBlob(written.ref).catch(() => undefined);
        throw err;
      }
      return {
        id,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        blob_ref: written.ref,
        byte_size: body.size,
        write_key_hash: writeKeyHash,
        revision: 1,
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

    async updateMap(id, body, opts = {}) {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      await ensureSchema();
      const existing = await selectMap(id);
      if (!existing) {
        throw new Error(`not found: ${id}`);
      }
      const known = rowToMap(existing);
      // Refused before a byte is read; checked again in the swap.
      if (opts.ifRevision !== undefined && known.revision !== opts.ifRevision) {
        throw new RevisionConflictError(known.revision);
      }
      const cap = opts.maxTotalBytes ?? 0;
      const growth = Math.max(0, body.size - known.byte_size);
      const written = await writeReserved(id, body, growth, cap);
      if (!written) {
        throw storageFull();
      }
      const now = new Date();
      let swap:
        | { kind: "swapped"; old: MapRecord }
        | { kind: "missing" | "full" }
        | { kind: "conflict"; revision: number };
      try {
        swap = await inTransaction(async (db) => {
          await db.query(`DELETE FROM storage_reservations WHERE id = $1`, [
            written.reservation,
          ]);
          const res = await db.query<MapRow>(
            `SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1 FOR UPDATE`,
            [id],
          );
          const row = res.rows[0];
          if (!row) {
            return { kind: "missing" as const };
          }
          const old = rowToMap(row);
          if (
            opts.ifRevision !== undefined &&
            old.revision !== opts.ifRevision
          ) {
            return { kind: "conflict" as const, revision: old.revision };
          }
          const delta = body.size - old.byte_size;
          if (cap > 0 && delta > growth) {
            const { counted, inFlight } = await usage(db);
            if (counted + inFlight + delta > cap) {
              return { kind: "full" as const };
            }
          }
          await db.query(
            `UPDATE maps SET blob_ref = $1, byte_size = $2, updated_at = $3,
               revision = revision + 1
             WHERE id = $4`,
            [written.ref, body.size, now, id],
          );
          await db.query(
            `UPDATE storage_usage SET total_bytes = total_bytes + $1 WHERE id = 1`,
            [delta],
          );
          return { kind: "swapped" as const, old };
        });
      } catch (err) {
        await release(written.reservation);
        await deleteBlob(written.ref).catch(() => undefined);
        throw err;
      }
      if (swap.kind !== "swapped") {
        await deleteBlob(written.ref).catch(() => undefined);
        throw swap.kind === "full"
          ? storageFull()
          : swap.kind === "conflict"
          ? new RevisionConflictError(swap.revision)
          : new Error(`not found: ${id}`);
      }
      // The orphan sweep removes it if this delete fails.
      await deleteBlob(swap.old.blob_ref).catch((err: unknown) =>
        logger.warn({ err }, "could not delete a replaced blob"),
      );
      return {
        ...swap.old,
        blob_ref: written.ref,
        byte_size: body.size,
        updated_at: now.toISOString(),
        revision: swap.old.revision + 1,
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
      const blobRef = await inTransaction(async (db) => {
        await db.query(`DELETE FROM share_tokens WHERE map_id = $1`, [id]);
        const res = await db.query<{ blob_ref: string; byte_size: string }>(
          `DELETE FROM maps WHERE id = $1 RETURNING blob_ref, byte_size`,
          [id],
        );
        const row = res.rows[0];
        if (!row) {
          return null;
        }
        await db.query(
          `UPDATE storage_usage SET total_bytes = total_bytes - $1 WHERE id = 1`,
          [row.byte_size],
        );
        return row.blob_ref;
      });
      if (blobRef === null) {
        return false;
      }
      await deleteBlob(blobRef);
      return true;
    },

    async totalBytes() {
      await ensureSchema();
      const res = await pool.query<{ total: string | number }>(
        `SELECT total_bytes AS total FROM storage_usage WHERE id = 1`,
      );
      return Number(res.rows[0]?.total ?? 0);
    },

    async sweep(now, opts): Promise<SweepResult> {
      await ensureSchema();
      const stale = new Date(now.getTime() - opts.orphanGraceMs);
      const { tokens, refs } = await inTransaction(async (db) => {
        const expired = await db.query(
          `DELETE FROM share_tokens
           WHERE expires_at IS NOT NULL AND expires_at <= $1`,
          [now],
        );
        const upgrade = await db.query<{ applied_at: Date }>(
          `SELECT applied_at FROM schema_migrations WHERE name = $1`,
          [WRITE_KEYS_MIGRATION],
        );
        const upgradedAt = upgrade.rows[0]?.applied_at;
        const keyless =
          opts.legacyGraceMs === 0 ||
          !upgradedAt ||
          now.getTime() >= new Date(upgradedAt).getTime() + opts.legacyGraceMs;
        let gone: Array<{ blob_ref: string; byte_size: string }> = [];
        if (keyless) {
          const res = await db.query<{ blob_ref: string; byte_size: string }>(
            `DELETE FROM maps
             WHERE write_key_hash IS NULL
               AND NOT EXISTS (SELECT 1 FROM share_tokens WHERE map_id = maps.id)
             RETURNING blob_ref, byte_size`,
          );
          gone = res.rows;
          const freed = gone.reduce((n, r) => n + Number(r.byte_size), 0);
          await db.query(
            `UPDATE storage_usage SET total_bytes = total_bytes - $1 WHERE id = 1`,
            [freed],
          );
        }
        await db.query(
          `DELETE FROM storage_reservations WHERE created_at < $1`,
          [stale],
        );
        return {
          tokens: expired.rowCount ?? 0,
          refs: gone.map((r) => r.blob_ref),
        };
      });
      for (const ref of refs) {
        await deleteBlob(ref);
      }
      const orphans = await removeOrphans(stale);
      return { tokens, maps: refs.length, orphans };
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
        const map = rowToMap(row);
        return {
          stream: body,
          size: res.ContentLength ?? map.byte_size,
          revision: map.revision,
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
      // HeadBucket on our own bucket, every time: it checks the endpoint,
      // the credentials and the bucket, and needs only the bucket rights
      // the app user has (ListBuckets would need s3:ListAllMyBuckets).
      await pool.query("SELECT 1");
      await headOrCreateBucket();
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
