// SPDX-License-Identifier: AGPL-3.0-only
// Shared read-only document loader for ShareView and EmbedView.
//
// Two entry shapes per ADR-0008, extracted so both the share viewer (`/m…`)
// and the embed (`/embed…`) resolve a document identically:
//   - Hash mode  : `#v1:<lz-string base64>` — self-contained, no network.
//   - Token mode : a 21-char id → `.atlasdraw` blob over HTTP.
//
// NOTE: hash-mode payloads are `JSON.stringify(doc)`, so the document's
// `layers`/`files` Maps do not survive (Maps JSON-serialize to `{}`). Hash
// docs therefore carry `scene` + `manifest` only; callers must not assume
// `doc.layers.get` exists on a hash-loaded document.

import LZString from "lz-string";
import { read, type AtlasdrawDocument } from "@atlasdraw/data";

import {
  createHttpStorageClient,
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";
import { getAppConfig } from "../config/app-config";

export type ShareLoadResult =
  | { kind: "ready"; doc: AtlasdrawDocument }
  | { kind: "not-found" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/** Decode a `#v1:<lz>` fragment into a document. Throws on bad input. */
export function decodeHashDoc(hash: string): AtlasdrawDocument {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!stripped.startsWith("v1:")) {
    throw new Error("Unsupported share-link version.");
  }
  const json = LZString.decompressFromBase64(stripped.slice("v1:".length));
  if (!json) {
    throw new Error("Corrupted share-link payload.");
  }
  return JSON.parse(json) as AtlasdrawDocument;
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
  if (hash.startsWith("#v1:")) {
    try {
      return { kind: "ready", doc: decodeHashDoc(hash) };
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
    return { kind: "ready", doc: await read(new Blob([buf])) };
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
