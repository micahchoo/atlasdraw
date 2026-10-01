// @atlasdraw/storage — the store contract. Both adapters implement
// `StorageClient`; only the map service (./service/maps.ts) calls it. The
// service owns the policy: write keys, expiry, the size cap. An adapter only
// stores rows and bytes.

/**
 * Selects which adapter the storage server loads at startup.
 * - `postgres-minio`: full stack (Postgres for metadata, MinIO/S3 for blobs).
 * - `sqlite-fs`: minimal stack (SQLite for metadata, filesystem for blobs).
 */
export type StorageMode = "postgres-minio" | "sqlite-fs";

/**
 * A stored map. `blob_ref` is where the adapter keeps the bytes (an S3 key
 * or a path under DATA_DIR). `write_key_hash` is the hex SHA-256 of the
 * map's write key, or null for a map stored before write keys: nobody can
 * write that map. Neither field ever leaves the server.
 */
export interface MapRecord {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
  write_key_hash: string | null;
}

/**
 * A read-only share token for one map. `expires_at` null means the token
 * lives until its owner revokes it.
 */
export interface ShareToken {
  token: string;
  map_id: string;
  mode: "read";
  expires_at: string | null;
  created_at: string;
}

/** What one sweep removed. */
export interface SweepResult {
  tokens: number;
  maps: number;
}

export interface StorageClient {
  createMap(blob: Buffer, writeKeyHash: string | null): Promise<MapRecord>;
  getMap(id: string): Promise<MapRecord | null>;
  /** Replaces the bytes. Rejects with `not found:` for an unknown id. */
  updateMap(id: string, blob: Buffer): Promise<MapRecord>;
  /** Rejects with `not found:` for an unknown map. */
  createShareToken(mapId: string, expiresAt: Date | null): Promise<ShareToken>;
  resolveToken(token: string): Promise<ShareToken | null>;
  /** Deletes the token if it belongs to `mapId`. True if a row went. */
  deleteShareToken(mapId: string, token: string): Promise<boolean>;
  /**
   * The bytes of a map. Null for a malformed id, a missing row, or a row
   * whose blob is gone.
   */
  getBlob(id: string): Promise<Buffer | null>;
  /**
   * Deletes the map, its share tokens and its bytes. False when no map has
   * the id.
   */
  deleteMap(id: string): Promise<boolean>;
  /** The sum of `byte_size` over every stored map. */
  totalBytes(): Promise<number>;
  /**
   * Deletes every share token that expired at or before `now`, then every
   * map that has no write key and no remaining token, with its bytes. Such a
   * map can never be read or written again.
   */
  sweep(now: Date): Promise<SweepResult>;

  /**
   * Resolves when the adapter's dependencies answer right now: the database,
   * and for postgres-minio the blob store. The `/health` route calls it.
   */
  ping(): Promise<void>;

  /** Gracefully close underlying connections (DB pools, blob clients). */
  close(): Promise<void>;
}
