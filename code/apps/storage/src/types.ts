// @atlasdraw/storage — the store contract. Both adapters implement
// `StorageClient`; only the map service (./service/maps.ts) calls it. The
// service owns the policy: write keys, expiry, the size cap. An adapter only
// stores rows and bytes.

import type { Readable } from "node:stream";
import type { MapVersion, VersionPolicy } from "./versions";

export type { MapVersion, VersionPolicy } from "./versions";

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
  /** 1 when the map is made; one more with each write. */
  revision: number;
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
  /** Blobs that no row pointed to. */
  orphans: number;
}

export interface SweepOptions {
  /**
   * A map stored before write keys (no key) is kept until this long after
   * the upgrade that added keys (migration 003), then swept once no live
   * token reads it. LEGACY_MAP_GRACE_DAYS.
   */
  legacyGraceMs: number;
  /**
   * A blob no row points to, and a size reservation, older than this are
   * work that a crash cut off: the sweep removes them. Longer than any
   * request may take.
   */
  orphanGraceMs: number;
}

export interface WriteOptions {
  /**
   * The cap on stored bytes plus the bytes of writes in flight. A write
   * that would pass it rejects with `storage full` and stores nothing.
   * 0 or absent: no cap.
   */
  maxTotalBytes?: number;
}

export interface UpdateOptions extends WriteOptions {
  /**
   * The revision the writer read. When the map is at another revision, the
   * write rejects with `revisionConflict` (lib/errors.ts) and stores
   * nothing. Checked again in the transaction that swaps the bytes, so of
   * two writes from one revision only the first to finish lands. Absent:
   * no check.
   */
  ifRevision?: number;
  /** Which replaced bytes stay as versions (versions.ts). Default: none. */
  versions?: VersionPolicy;
  /** Keep the replaced bytes as a version whatever the policy says. */
  checkpoint?: boolean;
  /** The time of the write. Default: now. */
  at?: Date;
}

/**
 * Bytes on their way into the store: a stream and its announced length. The
 * adapter stores exactly `size` bytes or nothing: a stream that ends early or
 * runs long rejects with `BodySizeError` (lib/body.ts).
 */
export interface BlobBody {
  stream: Readable;
  size: number;
}

/** Bytes on their way out: a stream to pipe to the client, and its length. */
export interface BlobRead {
  stream: Readable;
  size: number;
  /** The revision these bytes are. */
  revision: number;
}

/**
 * Writes and the size cap. Every write streams the bytes to a NEW blob, then
 * swaps the row's pointer in one checked transaction, then deletes the old
 * blob. The bytes are reserved against the cap before the first one is
 * written, and the reservation and the row change commit together. So a
 * crash at any point leaves the old map whole, the count exact, and at most
 * an orphan blob and a stale reservation that the sweep removes.
 */
export interface StorageClient {
  createMap(
    body: BlobBody,
    writeKeyHash: string | null,
    opts?: WriteOptions,
  ): Promise<MapRecord>;
  getMap(id: string): Promise<MapRecord | null>;
  /**
   * Replaces the bytes and counts one more revision. Rejects with `not
   * found:` for an unknown id, also when the map is deleted while the bytes
   * arrive, and with `revisionConflict` when `ifRevision` does not match;
   * the new blob is removed.
   */
  updateMap(
    id: string,
    body: BlobBody,
    opts?: UpdateOptions,
  ): Promise<MapRecord>;
  /** Rejects with `not found:` for an unknown map. */
  createShareToken(mapId: string, expiresAt: Date | null): Promise<ShareToken>;
  resolveToken(token: string): Promise<ShareToken | null>;
  /** Deletes the token if it belongs to `mapId`. True if a row went. */
  deleteShareToken(mapId: string, token: string): Promise<boolean>;
  /**
   * The bytes of a map, as a stream. Null for a malformed id, a missing row,
   * or a row whose blob is gone. The caller must consume or destroy it.
   */
  getBlob(id: string): Promise<BlobRead | null>;
  /** The map's kept versions, newest first; null for an unknown map. */
  listVersions(id: string): Promise<MapVersion[] | null>;
  /**
   * The bytes of one revision: a kept version, or the map's own bytes when
   * `revision` is its current one. Null when the store has neither.
   */
  getVersionBlob(id: string, revision: number): Promise<BlobRead | null>;
  /**
   * Deletes the map, its share tokens, its versions and all their bytes.
   * False when no map has the id.
   */
  deleteMap(id: string): Promise<boolean>;
  /** The sum of `byte_size` over every stored map (a counter, not a scan). */
  totalBytes(): Promise<number>;
  /**
   * Deletes every share token that expired at or before `now`; then, once
   * the legacy grace has passed, every map that has no write key and no
   * remaining token, with its bytes; then blobs no row points to and stale
   * reservations, both older than the orphan grace.
   */
  sweep(now: Date, opts: SweepOptions): Promise<SweepResult>;

  /**
   * Resolves when the adapter's dependencies answer right now: the database,
   * and for postgres-minio the blob store. The `/health` route calls it.
   */
  ping(): Promise<void>;

  /** Gracefully close underlying connections (DB pools, blob clients). */
  close(): Promise<void>;
}
