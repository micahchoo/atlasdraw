// SPDX-License-Identifier: MIT
// Atlasdraw room-key fragment parser — derives a RoomKey from a URL fragment.
//
// Phase 5 Task 1 (atlasdraw plan 2026-05-03 § Task 1). Fragment shape:
//   #<roomId>,<base64url(32-byte AES-256-GCM key)>
// Fragment is opaque to the server (URL hash never leaves the browser);
// only clients that received the link can derive the key. Reuses the
// share-link fragment convention from ADR-0008.

/** Room identifier + AES-GCM key handle. The CryptoKey is non-extractable. */
export interface RoomKey {
  roomId: string;
  key: CryptoKey;
}

/** Base64url → ArrayBuffer. Returns null on malformed input. */
function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> | null {
  // base64url: '-' → '+', '_' → '/'; pad with '=' to multiple of 4.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    // Allocate an explicit ArrayBuffer (not SharedArrayBuffer) so the
    // result is a strict BufferSource for crypto.subtle.importKey.
    const buf = new ArrayBuffer(binary.length);
    const out = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Parse `#<roomId>,<base64url-key>` (with or without leading `#`) into a
 * RoomKey. Returns null on malformed shape, invalid base64url, or non-32-byte
 * key. The AES-GCM key is imported as non-extractable.
 *
 * Async because Web Crypto's `importKey` is a Promise.
 */
export async function parseRoomFragment(hash: string): Promise<RoomKey | null> {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const commaIdx = raw.indexOf(",");
  if (commaIdx < 0) return null;

  const roomId = raw.slice(0, commaIdx);
  const keyB64 = raw.slice(commaIdx + 1);
  if (!roomId || !keyB64) return null;

  const keyBytes = base64urlToBytes(keyB64);
  if (!keyBytes || keyBytes.length !== 32) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return { roomId, key };
  } catch {
    return null;
  }
}
