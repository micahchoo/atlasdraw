// The map service: the one owner of storage policy. Routes parse HTTP and
// call it; it calls the store.
//
// A map's write key is the only write capability
// (docs/architecture/adr/0017-maps-carry-a-write-key.md). `create` makes
// it from 32 random bytes and returns it once; the store keeps only its
// SHA-256. Every write, owner read, share and revoke compares hashes in
// constant time. A share token reads the map's latest bytes and nothing else.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  isFullError,
  isNotFoundError,
  isRevisionConflict,
} from "../lib/errors";

import { NO_VERSIONS } from "../versions";

import type {
  BlobBody,
  BlobRead,
  MapRecord,
  StorageClient,
  SweepResult,
  VersionPolicy,
} from "../types";

/** What a client may see of a map. */
export interface PublicMap {
  id: string;
  created_at: string;
  updated_at: string;
  byte_size: number;
  revision: number;
}

export type Forbidden = { kind: "forbidden" };
export type Missing = { kind: "missing" };
export type Full = { kind: "full" };
export type Bytes = { kind: "bytes"; blob: BlobRead };
/** The write named a revision the map is no longer at. */
export type Conflict = { kind: "conflict"; revision: number };

export interface WriteRequest {
  /** The revision the writer read (If-Match). Absent: no check. */
  ifRevision?: number;
  /** Keep the bytes this write replaces as a version, whatever their age. */
  checkpoint?: boolean;
}

/** One revision of a map, as its owner sees it in the history. */
export interface PublicVersion {
  revision: number;
  saved_at: string;
  byte_size: number;
}

export interface MapService {
  create(
    body: BlobBody,
  ): Promise<{ kind: "created"; map: PublicMap; writeKey: string } | Full>;
  write(
    id: string,
    writeKey: string,
    body: BlobBody,
    request?: WriteRequest,
  ): Promise<
    { kind: "saved"; map: PublicMap } | Forbidden | Missing | Full | Conflict
  >;
  /** The owner's backup: the map's latest bytes. */
  read(id: string, writeKey: string): Promise<Bytes | Forbidden | Missing>;
  /** Every revision the store has, the current one first. */
  versions(
    id: string,
    writeKey: string,
  ): Promise<
    | { kind: "versions"; current: number; versions: PublicVersion[] }
    | Forbidden
    | Missing
  >;
  /** The bytes of one revision the store keeps. */
  readVersion(
    id: string,
    writeKey: string,
    revision: number,
  ): Promise<Bytes | Forbidden | Missing>;
  /** `expiresInDays` null: the token lives until it is revoked. */
  share(
    id: string,
    writeKey: string,
    expiresInDays: number | null,
  ): Promise<
    | { kind: "shared"; token: string; expiresAt: string | null }
    | Forbidden
    | Missing
  >;
  readShared(token: string): Promise<Bytes | { kind: "expired" } | Missing>;
  revoke(
    id: string,
    writeKey: string,
    token: string,
  ): Promise<{ kind: "revoked" } | Forbidden | Missing>;
  /** Delete the map, its links and its bytes. */
  remove(
    id: string,
    writeKey: string,
  ): Promise<{ kind: "deleted" } | Forbidden | Missing>;
  sweep(): Promise<SweepResult>;
}

export interface MapServiceOptions {
  /** The cap on the sum of all stored map sizes. 0: no cap. */
  maxTotalBytes: number;
  /** How long keyless maps from before write keys are kept. Default 90 days. */
  legacyGraceDays?: number;
  /** Which earlier bytes each map keeps. Default: none. */
  versions?: VersionPolicy;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Orphan blobs and size reservations older than this are left by a crash:
 * no request lives this long (REQUEST_TIMEOUT_MS is minutes).
 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

export function hashWriteKey(writeKey: string): string {
  return createHash("sha256").update(writeKey, "utf8").digest("hex");
}

function keyMatches(map: MapRecord, writeKey: string): boolean {
  if (map.write_key_hash === null) {
    return false;
  }
  const stored = Buffer.from(map.write_key_hash, "hex");
  const given = Buffer.from(hashWriteKey(writeKey), "hex");
  return stored.length === given.length && timingSafeEqual(stored, given);
}

function publicMap(map: MapRecord): PublicMap {
  return {
    id: map.id,
    created_at: map.created_at,
    updated_at: map.updated_at,
    byte_size: map.byte_size,
    revision: map.revision,
  };
}

export function createMapService(
  store: StorageClient,
  opts: MapServiceOptions,
): MapService {
  const now = opts.now ?? (() => new Date());

  // The store checks the cap in the same transaction that reserves the
  // bytes, so concurrent writes cannot pass it together.
  const cap = { maxTotalBytes: opts.maxTotalBytes };
  const versions = opts.versions ?? NO_VERSIONS;

  /** The map, if `writeKey` opens it. */
  async function owned(
    id: string,
    writeKey: string,
  ): Promise<MapRecord | Forbidden | Missing> {
    const map = await store.getMap(id);
    if (!map) {
      return { kind: "missing" };
    }
    return keyMatches(map, writeKey) ? map : { kind: "forbidden" };
  }

  function refused(
    r: MapRecord | Forbidden | Missing,
  ): r is Forbidden | Missing {
    return "kind" in r;
  }

  return {
    async create(body) {
      const writeKey = randomBytes(32).toString("base64url");
      try {
        const map = await store.createMap(body, hashWriteKey(writeKey), cap);
        return { kind: "created", map: publicMap(map), writeKey };
      } catch (err) {
        if (isFullError(err)) {
          return { kind: "full" };
        }
        throw err;
      }
    },

    async write(id, writeKey, body, request = {}) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      try {
        return {
          kind: "saved",
          map: publicMap(
            await store.updateMap(id, body, {
              ...cap,
              ifRevision: request.ifRevision,
              checkpoint: request.checkpoint,
              versions,
              at: now(),
            }),
          ),
        };
      } catch (err) {
        if (isNotFoundError(err)) {
          return { kind: "missing" };
        }
        if (isRevisionConflict(err)) {
          return { kind: "conflict", revision: err.revision };
        }
        if (isFullError(err)) {
          return { kind: "full" };
        }
        throw err;
      }
    },

    async read(id, writeKey) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      const blob = await store.getBlob(id);
      return blob ? { kind: "bytes", blob } : { kind: "missing" };
    },

    async versions(id, writeKey) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      const kept = await store.listVersions(id);
      if (kept === null) {
        return { kind: "missing" };
      }
      return {
        kind: "versions",
        current: map.revision,
        versions: [
          {
            revision: map.revision,
            saved_at: map.updated_at,
            byte_size: map.byte_size,
          },
          ...kept.map((v) => ({
            revision: v.revision,
            saved_at: v.saved_at,
            byte_size: v.byte_size,
          })),
        ],
      };
    },

    async readVersion(id, writeKey, revision) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      const blob = await store.getVersionBlob(id, revision);
      return blob ? { kind: "bytes", blob } : { kind: "missing" };
    },

    async share(id, writeKey, expiresInDays) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      const expiresAt =
        expiresInDays === null
          ? null
          : new Date(now().getTime() + expiresInDays * DAY_MS);
      try {
        const token = await store.createShareToken(id, expiresAt);
        return {
          kind: "shared",
          token: token.token,
          expiresAt: token.expires_at,
        };
      } catch (err) {
        if (isNotFoundError(err)) {
          return { kind: "missing" };
        }
        throw err;
      }
    },

    async readShared(token) {
      const share = await store.resolveToken(token);
      if (!share) {
        return { kind: "missing" };
      }
      if (
        share.expires_at !== null &&
        new Date(share.expires_at).getTime() <= now().getTime()
      ) {
        return { kind: "expired" };
      }
      // A token whose map or bytes are gone reads as expired: it worked once.
      const blob = await store.getBlob(share.map_id);
      return blob ? { kind: "bytes", blob } : { kind: "expired" };
    },

    async revoke(id, writeKey, token) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      return (await store.deleteShareToken(id, token))
        ? { kind: "revoked" }
        : { kind: "missing" };
    },

    async remove(id, writeKey) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      return (await store.deleteMap(id))
        ? { kind: "deleted" }
        : { kind: "missing" };
    },

    sweep() {
      return store.sweep(now(), {
        legacyGraceMs: (opts.legacyGraceDays ?? 90) * DAY_MS,
        orphanGraceMs: ORPHAN_GRACE_MS,
      });
    },
  };
}
