// SPDX-License-Identifier: AGPL-3.0-only
//
// useShareLink — make a read-only link to the document.
//
// The document is encoded once, as the same `.atlasdraw` bytes a save writes
// (data layers, rasters and pasted images included). Then:
//
//   - Hash mode   — the bytes fit in a URL fragment: `<base>m#v2:<base64url>`.
//                   Fully self-contained, no server.
//   - Upload mode — they do not: the bytes go to the document's own server
//                   map (the one the autosave updates), and the server mints
//                   a token for `<base>m/<token>`. The token reads the map's
//                   latest bytes, so a later save updates the link. It lasts
//                   until revoked unless the owner chose an expiry.
//
// The size test is on the encoded bytes. Nothing is left out to make a
// document fit: a document that does not fit and cannot be uploaded gets an
// error message and no link.
//
// An expiry is honoured for every size. A hash link holds the map itself,
// so nothing can end it: when the owner chooses an expiry, the link is an
// upload link, however small the map. A hash link is made only for "until
// you stop it", and the dialog says that it never expires.
//
// A `frozen` link shows the revision just saved and no later one
// (docs/architecture/adr/0020-server-version-history.md). It too is an upload
// link however small the map, so the owner can stop it and the server keeps
// that version while it lives.

import { useCallback, useState } from "react";

import { uint8ArrayToBase64Url, write } from "@atlasdraw/data";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { routeUrl } from "../routes";
import { revokeShare, shareDocument } from "../state/remoteMapIdCache";

import type { HttpStorageClient } from "../services/createHttpStorageClient";

export type ShareMode = "hash" | "upload";

export interface ShareLink {
  url: string;
  mode: ShareMode;
  /** The server token of an upload link; null for a hash link. */
  token: string | null;
  /** When an upload link stops working; null if it does not. */
  expiresAt: string | null;
  /** True when later saves do not change what the link shows. */
  frozen: boolean;
}

export interface GenerateOptions {
  /** Show the revision saved now, and no later one. */
  frozen?: boolean;
}

export interface UseShareLinkOptions {
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
}

export interface UseShareLinkState {
  isSharing: boolean;
  error: string | null;
  mode: ShareMode | null;
  /**
   * `expiresInDays` null: a link that lasts. A number makes an upload link
   * whatever the size, because only the server can end a link.
   */
  generate: (
    expiresInDays?: number | null,
    options?: GenerateOptions,
  ) => Promise<ShareLink | null>;
  /** End an upload link. False if the server could not. */
  revoke: (token: string) => Promise<boolean>;
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

  const generate = useCallback(
    async (
      expiresInDays: number | null = null,
      options: GenerateOptions = {},
    ): Promise<ShareLink | null> => {
      const frozen = options.frozen ?? false;
      setIsSharing(true);
      setError(null);
      setMode(null);
      try {
        const doc = getDoc();
        const bytes = await blobToUint8Array(await write(doc));

        if (
          expiresInDays === null &&
          !frozen &&
          bytes.byteLength <= HASH_BYTE_LIMIT
        ) {
          setMode("hash");
          return {
            url: routeUrl({
              kind: "share",
              map: { hash: `${HASH_PREFIX}${uint8ArrayToBase64Url(bytes)}` },
            }),
            mode: "hash",
            token: null,
            expiresAt: null,
            frozen: false,
          };
        }

        try {
          const share = await shareDocument(
            client,
            bytes,
            doc.manifest.id,
            expiresInDays,
            { frozen },
          );
          setMode("upload");
          return {
            url: routeUrl({ kind: "share", map: { token: share.token } }),
            mode: "upload",
            token: share.token,
            expiresAt: share.expiresAt,
            frozen: share.revision !== null,
          };
        } catch (err) {
          const reason = err instanceof Error ? ` (${err.message})` : "";
          setError(
            frozen
              ? `A link that shows only this version is kept on the server, and the server could not store it${reason}. Try again.`
              : bytes.byteLength <= HASH_BYTE_LIMIT
              ? `A link that expires is kept on the server, and the server could not store it${reason}. Try again, or choose "Until you stop it" for a link that holds the map itself.`
              : `This map is too large for a link on its own, and the server could not store it${reason}. Try again, or save the file and send it.`,
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
    },
    [client, getDoc],
  );

  const revoke = useCallback(
    async (token: string): Promise<boolean> => {
      try {
        await revokeShare(client, getDoc().manifest.id, token);
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not stop the link.",
        );
        return false;
      }
    },
    [client, getDoc],
  );

  return { isSharing, error, mode, generate, revoke, reset };
}
