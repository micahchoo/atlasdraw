// The map service: the one owner of storage policy. Routes parse HTTP and
// call it; it calls the store.
//
// A map's write key is the only write capability (ADR-0017). `create` makes
// it from 32 random bytes and returns it once; the store keeps only its
// SHA-256. Every write, owner read, share and revoke compares hashes in
// constant time. A share token reads the map's latest bytes and nothing else.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { isNotFoundError } from "../lib/errors";

import type { MapRecord, StorageClient, SweepResult } from "../types";

/** What a client may see of a map. */
export interface PublicMap {
  id: string;
  created_at: string;
  updated_at: string;
  byte_size: number;
}

export type Forbidden = { kind: "forbidden" };
export type Missing = { kind: "missing" };
export type Full = { kind: "full" };
export type Bytes = { kind: "bytes"; bytes: Buffer };

export interface MapService {
  create(
    bytes: Buffer,
  ): Promise<{ kind: "created"; map: PublicMap; writeKey: string } | Full>;
  write(
    id: string,
    writeKey: string,
    bytes: Buffer,
  ): Promise<{ kind: "saved"; map: PublicMap } | Forbidden | Missing | Full>;
  /** The owner's backup: the map's latest bytes. */
  read(id: string, writeKey: string): Promise<Bytes | Forbidden | Missing>;
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
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  };
}

export function createMapService(
  store: StorageClient,
  opts: MapServiceOptions,
): MapService {
  const now = opts.now ?? (() => new Date());

  /** True if the store can take `growth` more bytes. */
  async function fits(growth: number): Promise<boolean> {
    if (opts.maxTotalBytes <= 0 || growth <= 0) {
      return true;
    }
    return (await store.totalBytes()) + growth <= opts.maxTotalBytes;
  }

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
    async create(bytes) {
      if (!(await fits(bytes.byteLength))) {
        return { kind: "full" };
      }
      const writeKey = randomBytes(32).toString("base64url");
      const map = await store.createMap(bytes, hashWriteKey(writeKey));
      return { kind: "created", map: publicMap(map), writeKey };
    },

    async write(id, writeKey, bytes) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      if (!(await fits(bytes.byteLength - map.byte_size))) {
        return { kind: "full" };
      }
      try {
        return {
          kind: "saved",
          map: publicMap(await store.updateMap(id, bytes)),
        };
      } catch (err) {
        if (isNotFoundError(err)) {
          return { kind: "missing" };
        }
        throw err;
      }
    },

    async read(id, writeKey) {
      const map = await owned(id, writeKey);
      if (refused(map)) {
        return map;
      }
      const bytes = await store.getBlob(id);
      return bytes ? { kind: "bytes", bytes } : { kind: "missing" };
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
      const bytes = await store.getBlob(share.map_id);
      return bytes ? { kind: "bytes", bytes } : { kind: "expired" };
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
      return store.sweep(now());
    },
  };
}
