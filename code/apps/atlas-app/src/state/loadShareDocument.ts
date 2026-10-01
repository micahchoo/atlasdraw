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
// Every shape goes through the document gate (documentGate.ts#admit), so a
// viewer meets the same checks as a file the user opens.

import LZString from "lz-string";
import { base64UrlToUint8Array } from "@atlasdraw/data";

import {
  createHttpStorageClient,
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";
import { getAppConfig } from "../config/app-config";

import { admit, type Admitted } from "./documentGate";

import type { SharedMap } from "../routes";

export type ShareLoadResult =
  | { kind: "ready"; admitted: Admitted }
  | { kind: "not-found" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const CORRUPTED = "Corrupted share-link payload.";

/** Decode a hash fragment into an admitted document. Rejects bad input. */
export async function decodeHashDoc(hash: string): Promise<Admitted> {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  let input: unknown;
  if (stripped.startsWith("v2:")) {
    input = base64UrlToUint8Array(stripped.slice("v2:".length));
  } else if (stripped.startsWith("v1:")) {
    const json = LZString.decompressFromBase64(stripped.slice("v1:".length));
    if (!json) {
      throw new Error(CORRUPTED);
    }
    try {
      input = JSON.parse(json);
    } catch {
      throw new Error(CORRUPTED);
    }
  } else {
    throw new Error("Unsupported share-link version.");
  }
  const result = await admit(input, "share");
  if (!result.ok) {
    throw new Error(`${CORRUPTED} ${result.reason}`);
  }
  return result;
}

/** Resolve a shared map. A null map is a damaged link. */
export async function loadShareDocument(
  map: SharedMap | null,
  client?: HttpStorageClient,
): Promise<ShareLoadResult> {
  if (map && "hash" in map) {
    try {
      return { kind: "ready", admitted: await decodeHashDoc(map.hash) };
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
    const result = await admit(new Blob([buf]), "share");
    if (!result.ok) {
      return { kind: "error", message: result.reason };
    }
    return { kind: "ready", admitted: result };
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
