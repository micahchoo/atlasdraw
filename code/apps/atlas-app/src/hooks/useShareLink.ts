// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T9 — useShareLink hook.
//
// Dual-mode share-link generation:
//   - Hash mode  — for tiny maps. Compress JSON via lz-string and embed it
//                  in the URL fragment. Fully self-contained — no server.
//   - Upload mode — for large maps. Write the `.atlasdraw` blob through the
//                  HTTP storage client, mint a share token, and return a
//                  `/m/<token>` URL.
//
// Two thresholds gate the mode pick:
//   - JSON byte length < 32768 (32 KiB) ── attempt hash mode.
//   - Compressed string length <= 50000 ── Safari hash cap; fall through to
//                                          upload if exceeded.
// Either gate failing → upload mode.
//
// Drain block: before snapshotting, wait until `usePersistenceStore.isDraining`
// is false (max 10s). Without this, share links can publish stale state mid-save.

import { useCallback, useState } from "react";
import LZString from "lz-string";
import type { AtlasdrawDocument } from "@atlasdraw/data";
import { write } from "@atlasdraw/data";
import { usePersistenceStore } from "../state/usePersistenceStore";
import type { HttpStorageClient } from "../services/createHttpStorageClient";

export type ShareMode = "hash" | "upload";

export interface UseShareLinkOptions {
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
  /**
   * Test seam: max ms to wait for autosave to drain. Defaults to 10s.
   */
  drainTimeoutMs?: number;
  /**
   * Test seam: max ms between drain polls. Defaults to 50ms.
   */
  drainPollMs?: number;
}

export interface UseShareLinkState {
  isSharing: boolean;
  error: string | null;
  mode: ShareMode | null;
  generate: () => Promise<string | null>;
  reset: () => void;
}

// 32 KiB. The JSON byte-length gate that decides hash-vs-upload. Anything
// above this is unlikely to fit in a hash even after compression — round
// trip through compress to confirm before falling back.
const HASH_JSON_BYTE_THRESHOLD = 32 * 1024;

// Safari's hash limit is ~64 KB in practice; we cap conservatively at 50000
// chars of compressed base64. Beyond this, always upload.
const HASH_ENC_CHAR_CAP = 50_000;

// `Blob.prototype.arrayBuffer` is universal in real browsers since 2018, but
// jsdom 22 (the test environment) ships a stub Blob without it. FileReader is
// present in both, so we use it as a portable fallback. Mirrors the helper
// in state/persistence.ts:43 so we don't depend on its export surface.
function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (
    typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> })
      .arrayBuffer === "function"
  ) {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else {
        reject(new Error("FileReader returned non-ArrayBuffer result"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
}

async function waitForDrain(
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const start = Date.now();
  // Synchronous initial check — most callers are not mid-save.
  if (!usePersistenceStore.getState().isDraining) return true;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (!usePersistenceStore.getState().isDraining) return true;
  }
  return false;
}

export function useShareLink(opts: UseShareLinkOptions): UseShareLinkState {
  const { getDoc, client } = opts;
  const drainTimeoutMs = opts.drainTimeoutMs ?? 10_000;
  const drainPollMs = opts.drainPollMs ?? 50;

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
      const drained = await waitForDrain(drainTimeoutMs, drainPollMs);
      if (!drained) {
        setError(
          "Autosave didn't finish within 10 seconds — try again in a moment.",
        );
        return null;
      }

      const doc = getDoc();
      const json = JSON.stringify(doc);
      const byteLen = new TextEncoder().encode(json).byteLength;

      // Hash mode attempt.
      if (byteLen < HASH_JSON_BYTE_THRESHOLD) {
        const enc = LZString.compressToBase64(json);
        if (enc && enc.length <= HASH_ENC_CHAR_CAP) {
          // URL-safe — base64 contains '+' / '/' / '='. lz-string's
          // compressToBase64 already strips '=' padding; '+' and '/' are
          // legal in a fragment per RFC 3986. We still leave them as-is
          // because lz-string.decompressFromBase64 needs the exact output
          // back.
          const url = `${window.location.origin}/m#v1:${enc}`;
          setMode("hash");
          return url;
        }
        // Fall through to upload — compressed encoding exceeded the cap.
      }

      // Upload mode. Use the persistence.ts blobToBytes fallback shape:
      // jsdom 22's Blob lacks `.arrayBuffer()`, but FileReader is universal.
      const blob = await write(doc);
      const buf = await blobToUint8Array(blob);
      const record = await client.createMap(buf);
      const token = await client.createShareToken(record.id);
      const url = `${window.location.origin}/m/${token.token}`;
      setMode("upload");
      return url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate share link.";
      setError(message);
      return null;
    } finally {
      setIsSharing(false);
    }
  }, [client, drainPollMs, drainTimeoutMs, getDoc]);

  return { isSharing, error, mode, generate, reset };
}
