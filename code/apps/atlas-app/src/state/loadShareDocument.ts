// SPDX-License-Identifier: AGPL-3.0-only
// Shared read-only document loader for ShareView and EmbedView.
//
// A link carries the document in its hash or names it by a token:
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

/** Extract a 21-char share token from a `<prefix><token>` path; null if none. */
export function tokenFromPath(pathname: string, prefix: string): string | null {
  const re = new RegExp(`^${prefix}([A-Za-z0-9_-]{21})/?$`);
  const m = re.exec(pathname);
  return m ? m[1] : null;
}

/**
 * Resolve a shared document from a hash fragment or a token. Hash wins if both
 * are present (matches the pre-extraction ShareView precedence).
 */
export async function loadShareDocument(
  hash: string,
  token: string | null,
  client?: HttpStorageClient,
): Promise<ShareLoadResult> {
  if (hash.startsWith("#v1:") || hash.startsWith("#v2:")) {
    try {
      return { kind: "ready", doc: await decodeHashDoc(hash) };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to decode link.",
      };
    }
  }

  if (!token) {
    return { kind: "error", message: "Invalid share link." };
  }

  const cfg = getAppConfig();
  const httpClient =
    client ?? createHttpStorageClient({ baseUrl: cfg.storageBaseUrl ?? "" });
  try {
    const buf = await httpClient.getShareBlob(token);
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
