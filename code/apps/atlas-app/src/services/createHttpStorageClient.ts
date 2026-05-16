// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T13 — HTTP client for the @atlasdraw/storage server.
//
// The atlas-app SPA talks to the storage HTTP API (Phase 4 T3+T4+T8) through
// this thin client. Six methods, all routed to fetch():
//   - createMap        POST /maps               body: octet-stream  → MapRecord
//   - getMap           GET  /maps/:id                                → MapRecord | null
//   - updateMap        PUT  /maps/:id           body: octet-stream  → MapRecord
//   - createShareToken POST /maps/:id/share                          → ShareToken
//   - resolveToken     GET  /share/:token                            → ShareToken | null
//   - getShareBlob     GET  /share/:token/blob                       → ArrayBuffer | null
//
// `getShareBlob` is HTTP-only — not part of the shared `StorageClient`
// contract. It hangs off the returned object so the ShareView consumer can
// fetch raw map bytes without coupling the server-side adapter contract to
// browser-only types like ArrayBuffer.
//
// Why mirror types here instead of importing `@atlasdraw/storage`: the storage
// workspace publishes types via `dist/types.d.ts` but has no `main`/`types`
// field, so module resolution from atlas-app would fail. Mirroring is cheap —
// types are 5 fields total — and avoids a cross-workspace runtime dep on a
// Node-only package (better-sqlite3, pg).

/**
 * Mirror of `@atlasdraw/storage`'s MapRecord. Keep in lock-step with
 * `code/apps/storage/src/types.ts:19`.
 */
export interface MapRecord {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
}

/**
 * Mirror of `@atlasdraw/storage`'s ShareToken. Keep in lock-step with
 * `code/apps/storage/src/types.ts:31`.
 */
export interface ShareToken {
  token: string;
  map_id: string;
  mode: "read";
  expires_at: string;
  created_at: string;
}

/**
 * Atlas-app-facing storage contract. Identical shape to
 * `@atlasdraw/storage`'s `StorageClient`. The `Blob | Uint8Array` parameter
 * on write methods reflects the browser-native types — Node's `Buffer` is
 * not available in the SPA.
 */
export interface StorageClient {
  createMap(blob: Blob | Uint8Array): Promise<MapRecord>;
  getMap(id: string): Promise<MapRecord | null>;
  updateMap(id: string, blob: Blob | Uint8Array): Promise<MapRecord>;
  createShareToken(mapId: string): Promise<ShareToken>;
  resolveToken(token: string): Promise<ShareToken | null>;
}

/**
 * Thrown by `getShareBlob` when the server returns 410 Gone (token expired
 * or orphaned). Distinguishes "missing" (404 → null) from "was-here-now-gone"
 * (410 → error) so the ShareView UI can render distinct messages.
 */
export class ShareExpiredError extends Error {
  constructor() {
    super("ShareExpired");
    this.name = "ShareExpiredError";
  }
}

/**
 * Extended HTTP client — `StorageClient` plus the share-blob retrieval
 * helper that's HTTP-only (no server-side adapter equivalent surfaced to
 * the SPA). Returned by `createHttpStorageClient`.
 */
export interface HttpStorageClient extends StorageClient {
  /**
   * Fetch raw map bytes for a share token. Returns `null` on 404 (token
   * never existed or already-cleaned-up); throws `ShareExpiredError` on
   * 410 (was-here-now-gone). Throws on any other non-2xx.
   */
  getShareBlob(token: string): Promise<ArrayBuffer | null>;
}

export interface HttpStorageClientOptions {
  /**
   * Base URL for the storage server, e.g. `http://localhost:4000`. Empty
   * string means same-origin (production deploy behind a reverse proxy).
   */
  baseUrl: string;
  /**
   * Override the global `fetch` (tests inject a spy). Defaults to the
   * runtime `fetch` at call time.
   */
  fetch?: typeof fetch;
  /**
   * Phase 6 A9: workspace context. When the function resolves to a non-null
   * id, the client attaches `X-Workspace-ID: <id>` to every request. When
   * it resolves to null, no header is attached — server treats the request
   * as default-tenant (Phase 4 self-host compat). Implemented as a function
   * so consumers can swap the active workspace at runtime without rebuilding
   * the client (Wave 3 A13a will lean on this).
   */
  getWorkspaceId?: () => string | null | undefined;
}

const OCTET_STREAM_HEADERS = {
  "Content-Type": "application/octet-stream",
};

const WORKSPACE_HEADER = "X-Workspace-ID";

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function expectJsonOrThrow<T>(res: Response, op: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* response body unreadable — surface status only */
    }
    throw new Error(
      `[storage-http] ${op} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Build an HTTP-backed `StorageClient`. All methods throw on non-2xx (the
 * caller surfaces toasts); `getMap` and `resolveToken` translate 404 → null
 * because "missing" is a normal, expected outcome.
 */
export function createHttpStorageClient(
  opts: HttpStorageClientOptions,
): HttpStorageClient {
  const baseUrl = opts.baseUrl;
  // Capture once at construction so test injections are stable even if the
  // global `fetch` is later patched.
  const fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
  const getWorkspaceId = opts.getWorkspaceId ?? (() => null);

  // Phase 6 A9: shallow-merge workspace header onto whatever the caller
  // already passes. Resolves the workspace via the supplied function on
  // every call so swapping workspaces at runtime takes effect immediately.
  function withWorkspaceHeader(
    extra?: Record<string, string>,
  ): Record<string, string> | undefined {
    const ws = getWorkspaceId();
    if (!ws) return extra;
    return { ...(extra ?? {}), [WORKSPACE_HEADER]: ws };
  }

  return {
    async createMap(blob) {
      const res = await fetchImpl(joinUrl(baseUrl, "/maps"), {
        method: "POST",
        headers: withWorkspaceHeader(OCTET_STREAM_HEADERS),
        body: blob as BodyInit,
      });
      return expectJsonOrThrow<MapRecord>(res, "createMap");
    },

    async getMap(id) {
      const res = await fetchImpl(joinUrl(baseUrl, `/maps/${encodeURIComponent(id)}`), {
        method: "GET",
        headers: withWorkspaceHeader(),
      });
      if (res.status === 404) return null;
      return expectJsonOrThrow<MapRecord>(res, "getMap");
    },

    async updateMap(id, blob) {
      const res = await fetchImpl(joinUrl(baseUrl, `/maps/${encodeURIComponent(id)}`), {
        method: "PUT",
        headers: withWorkspaceHeader(OCTET_STREAM_HEADERS),
        body: blob as BodyInit,
      });
      return expectJsonOrThrow<MapRecord>(res, "updateMap");
    },

    async createShareToken(mapId) {
      const res = await fetchImpl(
        joinUrl(baseUrl, `/maps/${encodeURIComponent(mapId)}/share`),
        { method: "POST", headers: withWorkspaceHeader() },
      );
      // The server returns { token, url, expires_at } — only `token` and
      // `expires_at` map onto the ShareToken interface; the others are
      // synthesized so consumers get the full shape. `map_id` is mapId
      // (we already know it); `created_at` is now (server doesn't echo).
      const body = await expectJsonOrThrow<{
        token: string;
        url: string;
        expires_at: string;
      }>(res, "createShareToken");
      return {
        token: body.token,
        map_id: mapId,
        mode: "read",
        expires_at: body.expires_at,
        created_at: new Date().toISOString(),
      };
    },

    async resolveToken(token) {
      const res = await fetchImpl(
        joinUrl(baseUrl, `/share/${encodeURIComponent(token)}`),
        { method: "GET", headers: withWorkspaceHeader() },
      );
      if (res.status === 404 || res.status === 410) return null;
      // T13: T8/T9 will consume the { map, mode } body. For autosave we
      // never call resolveToken — the contract surface is here for
      // interface completeness only.
      const body = await expectJsonOrThrow<{
        map: MapRecord;
        mode: "read";
        expires_at?: string;
      }>(res, "resolveToken");
      return {
        token,
        map_id: body.map.id,
        mode: body.mode,
        expires_at: body.expires_at ?? new Date(Date.now() + 7 * 86400_000).toISOString(),
        created_at: body.map.created_at,
      };
    },

    async getShareBlob(token) {
      const res = await fetchImpl(
        joinUrl(baseUrl, `/share/${encodeURIComponent(token)}/blob`),
        { method: "GET", headers: withWorkspaceHeader() },
      );
      if (res.status === 404) return null;
      if (res.status === 410) throw new ShareExpiredError();
      if (!res.ok) {
        throw new Error(
          `[storage-http] getShareBlob failed: ${res.status} ${res.statusText}`,
        );
      }
      return await res.arrayBuffer();
    },
  };
}
