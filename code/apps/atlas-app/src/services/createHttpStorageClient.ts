// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP client for the @atlasdraw/storage server. Every method is one fetch:
//
//   createMap        POST   /maps                    → map + write key
//   updateMap        PUT    /maps/:id                (write key)
//   readMap          GET    /maps/:id/blob           (write key) → bytes
//   listVersions     GET    /maps/:id/versions       (write key) → revisions
//   readVersion      GET    /maps/:id/versions/:n/blob (write key) → bytes
//   createShareToken POST   /maps/:id/share          (write key) → token
//   revokeShareToken DELETE /maps/:id/share/:token   (write key)
//   deleteMap        DELETE /maps/:id                (write key)
//   getShareBlob     GET    /share/:token/blob       → bytes | null
//
// Every save counts a revision. `updateMap` names the revision it replaces
// in If-Match; the server answers 412 when another writer got there first
// (`MapChangedError`). See docs/architecture/adr/0020-server-version-history.md.
//
// The write key goes in `Authorization: Bearer <key>`. Only the server map's
// owner holds it (state/remoteMapIdCache.ts keeps it per document); a share
// token never opens a write. See
// docs/architecture/adr/0017-maps-carry-a-write-key.md.
//
// Types mirror `code/apps/storage/src/service/maps.ts#PublicMap` by hand: the
// storage workspace is Node-only (better-sqlite3, pg) and has no `types`
// entry to import from.

/** A server map as the server shows it. */
export interface MapRecord {
  id: string;
  created_at: string;
  updated_at: string;
  byte_size: number;
  /** 1 when the map is made; one more with each save. */
  revision: number;
}

/** A map's bytes and the revision they are. */
export interface ServerBytes {
  bytes: ArrayBuffer;
  revision: number;
}

/** One revision the server keeps. */
export interface ServerVersion {
  revision: number;
  /** ISO time of the save that made it. */
  savedAt: string;
  byteSize: number;
}

/** A map's revisions, newest first; the first is `current`. */
export interface ServerVersions {
  current: number;
  versions: ServerVersion[];
}

export interface UpdateOptions {
  /** The revision this browser last saw. The server refuses another (412). */
  ifRevision?: number;
  /** Keep the bytes this save replaces as a version, whatever their age. */
  checkpoint?: boolean;
}

/** A map just created, with the write key the server shows only once. */
export interface CreatedMap {
  map: MapRecord;
  writeKey: string;
}

/**
 * A read link. `expiresAt` null: it lives until it is revoked. `revision`
 * null: it shows the latest save; a number: it is frozen on that revision.
 */
export interface ShareLinkToken {
  token: string;
  expiresAt: string | null;
  revision: number | null;
}

/** The owner's side of the storage API. */
export interface StorageClient {
  createMap(blob: Blob | Uint8Array): Promise<CreatedMap>;
  updateMap(
    id: string,
    writeKey: string,
    blob: Blob | Uint8Array,
    options?: UpdateOptions,
  ): Promise<MapRecord>;
  readMap(id: string, writeKey: string): Promise<ServerBytes>;
  listVersions(id: string, writeKey: string): Promise<ServerVersions>;
  readVersion(
    id: string,
    writeKey: string,
    revision: number,
  ): Promise<ServerBytes>;
  createShareToken(
    id: string,
    writeKey: string,
    expiresInDays: number | null,
    revision?: number | null,
  ): Promise<ShareLinkToken>;
  revokeShareToken(id: string, writeKey: string, token: string): Promise<void>;
  /** Delete the map, its links and its bytes from the server. */
  deleteMap(id: string, writeKey: string): Promise<void>;
}

/** A non-2xx answer. `status` tells a refusal (401, 403, 404) from a fault. */
export class StorageHttpError extends Error {
  constructor(op: string, readonly status: number, detail = "") {
    super(
      `[storage-http] ${op} failed: ${status}${detail ? ` — ${detail}` : ""}`,
    );
    this.name = "StorageHttpError";
  }
}

/** 412: another writer saved the map since `ifRevision`. */
export class MapChangedError extends StorageHttpError {
  constructor(readonly revision: number) {
    super("updateMap", 412, `the server has revision ${revision}`);
    this.name = "MapChangedError";
  }
}

/**
 * Thrown by `getShareBlob` on 410 Gone (the token expired, or its map is
 * gone). 404 (never existed, or revoked) is null instead, so the viewer can
 * show two messages.
 */
export class ShareExpiredError extends Error {
  constructor() {
    super("ShareExpired");
    this.name = "ShareExpiredError";
  }
}

/** `StorageClient` plus the reader's side: a share link's bytes. */
export interface HttpStorageClient extends StorageClient {
  getShareBlob(token: string): Promise<ArrayBuffer | null>;
}

export interface HttpStorageClientOptions {
  /**
   * Base URL for the storage server, e.g. `http://localhost:4000`. Empty
   * string means same-origin (production deploy behind a reverse proxy).
   */
  baseUrl: string;
  /** Override the global `fetch` (tests inject a spy). */
  fetch?: typeof fetch;
}

const OCTET_STREAM = "application/octet-stream";

function joinUrl(base: string, path: string): string {
  if (!base) {
    return path;
  }
  return `${base.replace(/\/+$/, "")}${path}`;
}

function bearer(writeKey: string): Record<string, string> {
  return { Authorization: `Bearer ${writeKey}` };
}

async function failure(res: Response, op: string): Promise<StorageHttpError> {
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* body unreadable — the status is enough */
  }
  return new StorageHttpError(op, res.status, detail);
}

/** The revision an ETag `"<n>"` names. */
function revisionOf(res: Response, op: string): number {
  const match = /^"(\d+)"$/.exec(res.headers.get("ETag") ?? "");
  if (!match) {
    throw new StorageHttpError(op, res.status, "no revision in the answer");
  }
  return Number(match[1]);
}

async function bytesOf(res: Response, op: string): Promise<ServerBytes> {
  return { revision: revisionOf(res, op), bytes: await res.arrayBuffer() };
}

async function okOrThrow(res: Response, op: string): Promise<Response> {
  if (!res.ok) {
    throw await failure(res, op);
  }
  return res;
}

export function createHttpStorageClient(
  opts: HttpStorageClientOptions,
): HttpStorageClient {
  const baseUrl = opts.baseUrl;
  // Captured once so a test's injected fetch stays stable.
  const fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
  const mapUrl = (id: string, rest = "") =>
    joinUrl(baseUrl, `/maps/${encodeURIComponent(id)}${rest}`);

  return {
    async createMap(blob) {
      const res = await okOrThrow(
        await fetchImpl(joinUrl(baseUrl, "/maps"), {
          method: "POST",
          headers: { "Content-Type": OCTET_STREAM },
          body: blob as BodyInit,
        }),
        "createMap",
      );
      const { write_key: writeKey, ...map } =
        (await res.json()) as MapRecord & {
          write_key: string;
        };
      return { map, writeKey };
    },

    async updateMap(id, writeKey, blob, options = {}) {
      const res = await fetchImpl(
        mapUrl(id, options.checkpoint ? "?checkpoint=1" : ""),
        {
          method: "PUT",
          headers: {
            "Content-Type": OCTET_STREAM,
            ...bearer(writeKey),
            ...(options.ifRevision === undefined
              ? {}
              : { "If-Match": `"${options.ifRevision}"` }),
          },
          body: blob as BodyInit,
        },
      );
      if (res.status === 412) {
        const body = (await res.json().catch(() => ({}))) as {
          revision?: unknown;
        };
        if (typeof body.revision === "number") {
          throw new MapChangedError(body.revision);
        }
      }
      await okOrThrow(res, "updateMap");
      return (await res.json()) as MapRecord;
    },

    async readMap(id, writeKey) {
      const res = await okOrThrow(
        await fetchImpl(mapUrl(id, "/blob"), {
          method: "GET",
          headers: bearer(writeKey),
        }),
        "readMap",
      );
      return bytesOf(res, "readMap");
    },

    async listVersions(id, writeKey) {
      const res = await okOrThrow(
        await fetchImpl(mapUrl(id, "/versions"), {
          method: "GET",
          headers: bearer(writeKey),
        }),
        "listVersions",
      );
      const body = (await res.json()) as {
        current: number;
        versions: Array<{
          revision: number;
          saved_at: string;
          byte_size: number;
        }>;
      };
      return {
        current: body.current,
        versions: body.versions.map((v) => ({
          revision: v.revision,
          savedAt: v.saved_at,
          byteSize: v.byte_size,
        })),
      };
    },

    async readVersion(id, writeKey, revision) {
      const res = await okOrThrow(
        await fetchImpl(mapUrl(id, `/versions/${revision}/blob`), {
          method: "GET",
          headers: bearer(writeKey),
        }),
        "readVersion",
      );
      return bytesOf(res, "readVersion");
    },

    async createShareToken(id, writeKey, expiresInDays, revision = null) {
      const asked = {
        ...(expiresInDays === null ? {} : { expires_in_days: expiresInDays }),
        ...(revision === null ? {} : { revision }),
      };
      const res = await okOrThrow(
        await fetchImpl(
          mapUrl(id, "/share"),
          Object.keys(asked).length === 0
            ? { method: "POST", headers: bearer(writeKey) }
            : {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...bearer(writeKey),
                },
                body: JSON.stringify(asked),
              },
        ),
        "createShareToken",
      );
      const body = (await res.json()) as {
        token: string;
        expires_at: string | null;
        revision?: number | null;
      };
      return {
        token: body.token,
        expiresAt: body.expires_at,
        revision: body.revision ?? null,
      };
    },

    async revokeShareToken(id, writeKey, token) {
      await okOrThrow(
        await fetchImpl(mapUrl(id, `/share/${encodeURIComponent(token)}`), {
          method: "DELETE",
          headers: bearer(writeKey),
        }),
        "revokeShareToken",
      );
    },

    async deleteMap(id, writeKey) {
      await okOrThrow(
        await fetchImpl(mapUrl(id, ""), {
          method: "DELETE",
          headers: bearer(writeKey),
        }),
        "deleteMap",
      );
    },

    async getShareBlob(token) {
      const res = await fetchImpl(
        joinUrl(baseUrl, `/share/${encodeURIComponent(token)}/blob`),
        { method: "GET" },
      );
      if (res.status === 404) {
        return null;
      }
      if (res.status === 410) {
        throw new ShareExpiredError();
      }
      await okOrThrow(res, "getShareBlob");
      return res.arrayBuffer();
    },
  };
}
