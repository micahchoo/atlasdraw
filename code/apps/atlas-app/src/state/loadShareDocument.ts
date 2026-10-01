// SPDX-License-Identifier: AGPL-3.0-only
// The read-only viewer's document loader. A link (routes.ts#SharedMap)
// carries the document or names it by a token:
//   - `#v2:<base64url>` — the document's `.atlasdraw` bytes (useShareLink).
//   - `#v1:<lz-string>` — older links: `JSON.stringify(doc)`. JSON has no
//                          Map, so these carry the manifest and the drawing
//                          only. They are still read, through the format
//                          migrations.
//   - a 21-char token   — the `.atlasdraw` bytes over HTTP.
//
// Every shape goes through the format migrations and the manifest schema
// before a viewer sees it.

import LZString from "lz-string";
import {
  ManifestSchema,
  base64UrlToUint8Array,
  migrate,
  type AtlasdrawDocument,
} from "@atlasdraw/data";

import {
  createHttpStorageClient,
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";
import { getAppConfig } from "../config/app-config";

import { decode } from "./documentIO";

import type { SharedMap } from "../routes";

export type ShareLoadResult =
  | { kind: "ready"; doc: AtlasdrawDocument }
  | { kind: "not-found" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/** Decode a hash fragment into a document. Rejects bad input. */
export async function decodeHashDoc(hash: string): Promise<AtlasdrawDocument> {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  if (stripped.startsWith("v2:")) {
    const bytes = base64UrlToUint8Array(stripped.slice("v2:".length));
    const result = await decode(new Blob([bytes as unknown as BlobPart]));
    if (!result.ok) {
      throw new Error("Corrupted share-link payload.");
    }
    return result.file;
  }
  if (!stripped.startsWith("v1:")) {
    throw new Error("Unsupported share-link version.");
  }
  const json = LZString.decompressFromBase64(stripped.slice("v1:".length));
  if (!json) {
    throw new Error("Corrupted share-link payload.");
  }
  const parsed = JSON.parse(json) as { manifest?: unknown; scene?: unknown };
  const manifest = parsed.manifest;
  const scene = Array.isArray(parsed.scene) ? parsed.scene : [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Corrupted share-link payload.");
  }
  let migrated: ReturnType<typeof migrate>;
  try {
    migrated = migrate({
      manifest: manifest as Record<string, unknown>,
      scene,
    });
  } catch {
    // No version, or one this build cannot read: not a document it can show.
    throw new Error("Corrupted share-link payload.");
  }
  const valid = ManifestSchema.safeParse(migrated.manifest);
  if (!valid.success) {
    throw new Error("Corrupted share-link payload.");
  }
  return {
    manifest: valid.data,
    scene: migrated.scene as AtlasdrawDocument["scene"],
    layers: new Map(),
    styleRef: {},
    files: new Map(),
  };
}

/** Resolve a shared map. A null map is a damaged link. */
export async function loadShareDocument(
  map: SharedMap | null,
  client?: HttpStorageClient,
): Promise<ShareLoadResult> {
  if (map && "hash" in map) {
    try {
      return { kind: "ready", doc: await decodeHashDoc(map.hash) };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to decode link.",
      };
    }
  }

  if (!map) {
    return { kind: "error", message: "Invalid share link." };
  }

  const cfg = getAppConfig();
  const httpClient =
    client ?? createHttpStorageClient({ baseUrl: cfg.storageBaseUrl ?? "" });
  try {
    const buf = await httpClient.getShareBlob(map.token);
    if (!buf) {
      return { kind: "not-found" };
    }
    const result = await decode(new Blob([buf]));
    if (!result.ok) {
      return { kind: "error", message: result.error.message };
    }
    return { kind: "ready", doc: result.file };
  } catch (err) {
    if (err instanceof ShareExpiredError) {
      return { kind: "expired" };
    }
    return {
      kind: "error",
      message:
        err instanceof Error ? err.message : "Failed to load shared map.",
    };
  }
}
