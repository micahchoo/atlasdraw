// @atlasdraw/storage — Phase 4 T3: postgres-minio adapter.
//
// Full stack — Postgres for metadata, MinIO/S3-compatible blob store for the
// scene blob. Mirrors sqlite-fs adapter semantics. Bucket auto-created on
// first write if absent.

import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { Pool } from "pg";
import type { MapRecord, ShareToken, StorageClient } from "../types";

const BUCKET = "atlasdraw-maps";
const ID_RE = /^[A-Za-z0-9_-]{21}$/;
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface MapRow {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  blob_ref: string;
  byte_size: number | string;
}

interface ShareRow {
  token: string;
  map_id: string;
  mode: string;
  expires_at: Date | string;
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
  };
}

function rowToShare(row: ShareRow): ShareToken {
  return {
    token: row.token,
    map_id: row.map_id,
    mode: "read",
    expires_at: isoize(row.expires_at),
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
  let initReady: Promise<void> | null = null;

  async function ensureSchema(): Promise<void> {
    if (initReady) {
      return initReady;
    }
    initReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS maps (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
          blob_ref TEXT NOT NULL,
          byte_size BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS share_tokens (
          token TEXT PRIMARY KEY,
          map_id TEXT NOT NULL REFERENCES maps(id),
          mode TEXT NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL
        );
      `);
    })();
    return initReady;
  }

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

  return {
    async createMap(blob: Buffer): Promise<MapRecord> {
      await ensureSchema();
      const id = nanoid(21);
      const blobRef = `maps/${id}.atlasdraw`;
      await putBlob(blobRef, blob);
      const now = new Date();
      await pool.query(
        `INSERT INTO maps (id, created_at, updated_at, blob_ref, byte_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, now, now, blobRef, blob.byteLength],
      );
      return {
        id,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        blob_ref: blobRef,
        byte_size: blob.byteLength,
      };
    },

    async getMap(id: string): Promise<MapRecord | null> {
      if (!ID_RE.test(id)) {
        return null;
      }
      await ensureSchema();
      const res = await pool.query<MapRow>(
        `SELECT id, created_at, updated_at, blob_ref, byte_size
         FROM maps WHERE id = $1`,
        [id],
      );
      return res.rows[0] ? rowToMap(res.rows[0]) : null;
    },

    async updateMap(id: string, blob: Buffer): Promise<MapRecord> {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      await ensureSchema();
      const existing = await pool.query<MapRow>(
        `SELECT id, created_at, updated_at, blob_ref, byte_size
         FROM maps WHERE id = $1`,
        [id],
      );
      if (!existing.rows[0]) {
        throw new Error(`not found: ${id}`);
      }
      const row = existing.rows[0];
      await putBlob(row.blob_ref, blob);
      const now = new Date();
      await pool.query(
        `UPDATE maps SET updated_at = $1, byte_size = $2 WHERE id = $3`,
        [now, blob.byteLength, id],
      );
      return {
        id,
        created_at: isoize(row.created_at),
        updated_at: now.toISOString(),
        blob_ref: row.blob_ref,
        byte_size: blob.byteLength,
      };
    },

    async createShareToken(mapId: string): Promise<ShareToken> {
      if (!ID_RE.test(mapId)) {
        throw new Error(`not found: ${mapId}`);
      }
      await ensureSchema();
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM maps WHERE id = $1`,
        [mapId],
      );
      if (!existing.rows[0]) {
        throw new Error(`not found: ${mapId}`);
      }
      const token = nanoid(21);
      const now = new Date();
      const expires = new Date(now.getTime() + SHARE_TTL_MS);
      await pool.query(
        `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, mapId, "read", expires, now],
      );
      return {
        token,
        map_id: mapId,
        mode: "read",
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
      };
    },

    async resolveToken(token: string): Promise<ShareToken | null> {
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

    async getBlob(id: string): Promise<Buffer | null> {
      // Phase 4 T8 amendment — consumed by GET /share/:token/blob. Mirrors
      // sqlite-fs semantics: malformed id → null, missing object → null,
      // unexpected SDK errors propagate.
      if (!ID_RE.test(id)) {
        return null;
      }
      await ensureBucket();
      const key = `maps/${id}.atlasdraw`;
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
  };
}

// Exposed for tests: the constant bucket name + ID validator.
export const __postgresMinioInternals = { BUCKET, ID_RE };

// Re-export the GetObjectCommand reference so the test file can assert on it
// when mocking; we don't otherwise use blob-read in T3 (atlas-app reads via
// a future T4 endpoint).
export { GetObjectCommand };
