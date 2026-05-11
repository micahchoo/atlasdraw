// @atlasdraw/storage — Phase 4 T1: storage contract types.
//
// Defined first (Wave 0) so Wave 1 implementations (T3 server, T8/T9 share
// clients, T13 atlas-app autosave wiring) can build against a stable
// interface rather than a moving target. No runtime code — types only.

/**
 * Selects which adapter the storage server loads at startup.
 * - `postgres-minio`: full stack (Postgres for metadata, MinIO/S3 for blobs).
 * - `sqlite-fs`: minimal stack (SQLite for metadata, filesystem for blobs).
 */
export type StorageMode = "postgres-minio" | "sqlite-fs";

/**
 * A persisted map document. `blob_ref` is the adapter-specific location of
 * the underlying scene+state JSON blob — an S3 key for postgres-minio, a
 * relative filesystem path for sqlite-fs.
 */
export interface MapRecord {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
}

/**
 * A read-only share token. `mode: 'read'` is the only mode in Phase 4;
 * write tokens are deferred to Phase 6.
 */
export interface ShareToken {
  token: string;
  map_id: string;
  mode: "read";
  expires_at: string;
  created_at: string;
}

/**
 * Storage adapter contract. Both `postgres-minio` and `sqlite-fs` adapters
 * implement this; atlas-app consumes it through the HTTP layer (T3) and
 * never touches an adapter directly.
 */
export interface StorageClient {
  createMap(blob: Buffer): Promise<MapRecord>;
  getMap(id: string): Promise<MapRecord | null>;
  updateMap(id: string, blob: Buffer): Promise<MapRecord>;
  createShareToken(mapId: string): Promise<ShareToken>;
  resolveToken(token: string): Promise<ShareToken | null>;
  /**
   * Retrieve the raw blob bytes for a map by id. Returns `null` if the id
   * is malformed, the map row is missing, or the underlying blob storage
   * is missing the object (orphaned row). Phase 4 T8/T9 share-via-link
   * consumes this through the `GET /share/:token/blob` route.
   */
  getBlob(id: string): Promise<Buffer | null>;
}
