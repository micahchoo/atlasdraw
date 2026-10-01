// SPDX-License-Identifier: AGPL-3.0-only
//
// useShareLink — make a read-only link to the document.
//
// The document is encoded once, as the same `.atlasdraw` bytes a save writes
// (data layers, rasters and pasted images included). Then:
//
//   - Hash mode   — the bytes fit in a URL fragment: `/m#v2:<base64url>`.
//                   Fully self-contained, no server.
//   - Upload mode — they do not: the bytes go to the storage server, which
//                   mints a token for `/m/<token>`.
//
// The size test is on the encoded bytes. Nothing is left out to make a
// document fit: a document that does not fit and cannot be uploaded gets an
// error message and no link.

import { useCallback, useState } from "react";

import { uint8ArrayToBase64Url, write } from "@atlasdraw/data";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import type { HttpStorageClient } from "../services/createHttpStorageClient";

export type ShareMode = "hash" | "upload";

export interface UseShareLinkOptions {
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
}

export interface UseShareLinkState {
  isSharing: boolean;
  error: string | null;
  mode: ShareMode | null;
  generate: () => Promise<string | null>;
  reset: () => void;
}

/** The prefix of a hash link's fragment. loadShareDocument reads it. */
export const HASH_PREFIX = "v2:";

/**
 * The most encoded bytes a hash link carries: 36 KiB is 49,152 base64url
 * characters, under the 50,000-character fragment that Safari keeps.
 */
const HASH_BYTE_LIMIT = 36 * 1024;

/**
 * A Blob's bytes. jsdom's Blob has no arrayBuffer(); FileReader gives the
 * same bytes there.
 */
function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
}

export function useShareLink(opts: UseShareLinkOptions): UseShareLinkState {
  const { getDoc, client } = opts;

  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setMode(null);
  }, []);

  const generate = useCallback(async (): Promise<string | null> => {
    setIsSharing(true);
    setError(null);
    setMode(null);
    try {
      const bytes = await blobToUint8Array(await write(getDoc()));

      if (bytes.byteLength <= HASH_BYTE_LIMIT) {
        setMode("hash");
        return `${
          window.location.origin
        }/m#${HASH_PREFIX}${uint8ArrayToBase64Url(bytes)}`;
      }

      try {
        const record = await client.createMap(bytes);
        const token = await client.createShareToken(record.id);
        setMode("upload");
        return `${window.location.origin}/m/${token.token}`;
      } catch (err) {
        const reason = err instanceof Error ? ` (${err.message})` : "";
        setError(
          `This map is too large for a link on its own, and the server could not store it${reason}. Try again, or save the file and send it.`,
        );
        return null;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate share link.",
      );
      return null;
    } finally {
      setIsSharing(false);
    }
  }, [client, getDoc]);

  return { isSharing, error, mode, generate, reset };
}
