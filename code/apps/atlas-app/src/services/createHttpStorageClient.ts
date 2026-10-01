// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP client for the @atlasdraw/storage server. Every method is one fetch:
//
//   createMap        POST   /maps                    → map + write key
//   updateMap        PUT    /maps/:id                (write key)
//   readMap          GET    /maps/:id/blob           (write key) → bytes
//   createShareToken POST   /maps/:id/share          (write key) → token
//   revokeShareToken DELETE /maps/:id/share/:token   (write key)
//   deleteMap        DELETE /maps/:id                (write key)
//   getShareBlob     GET    /share/:token/blob       → bytes | null
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
}

/** A map just created, with the write key the server shows only once. */
export interface CreatedMap {
  map: MapRecord;
  writeKey: string;
}

/** A read link. `expiresAt` null: it lives until it is revoked. */
export interface ShareLinkToken {
  token: string;
  expiresAt: string | null;
}

/** The owner's side of the storage API. */
export interface StorageClient {
  createMap(blob: Blob | Uint8Array): Promise<CreatedMap>;
  updateMap(
    id: string,
    writeKey: string,
    blob: Blob | Uint8Array,
  ): Promise<MapRecord>;
  readMap(id: string, writeKey: string): Promise<ArrayBuffer>;
  createShareToken(
    id: string,
    writeKey: string,
    expiresInDays: number | null,
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

    async updateMap(id, writeKey, blob) {
      const res = await okOrThrow(
        await fetchImpl(mapUrl(id), {
          method: "PUT",
          headers: { "Content-Type": OCTET_STREAM, ...bearer(writeKey) },
          body: blob as BodyInit,
        }),
        "updateMap",
      );
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
      return res.arrayBuffer();
    },

    async createShareToken(id, writeKey, expiresInDays) {
      const res = await okOrThrow(
        await fetchImpl(
          mapUrl(id, "/share"),
          expiresInDays === null
            ? { method: "POST", headers: bearer(writeKey) }
            : {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...bearer(writeKey),
                },
                body: JSON.stringify({ expires_in_days: expiresInDays }),
              },
        ),
        "createShareToken",
      );
      const body = (await res.json()) as {
        token: string;
        expires_at: string | null;
      };
      return { token: body.token, expiresAt: body.expires_at };
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
