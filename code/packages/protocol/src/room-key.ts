// SPDX-License-Identifier: MIT
// Atlasdraw room-key fragment parser + generator — derives a RoomKey from a
// URL fragment, and mints fresh room keys for new collab sessions.
//
// Phase 5 Task 1 (atlasdraw plan 2026-05-03 § Task 1) + collab-integration
// plan 2026-05-15 (Step 1). Fragment shape:
//   #room:<roomId>,<base64url(32-byte AES-256-GCM key)>
//
// The `room:` prefix is mandatory (Q-P5-2): possession of a valid
// `#room:`-prefixed URL grants write capability; the prefix forward-compats
// against additional hash-rooted modes on the editor path and disambiguates
// at the parser boundary. The legacy un-prefixed shape is rejected; no
// production callers exist yet.
//
// Fragment is opaque to the server (URL hash never leaves the browser);
// only clients that received the link can derive the key. Reuses the
// share-link fragment convention from ADR-0008.

/** Room identifier + AES-GCM key handle. The CryptoKey is non-extractable. */
export interface RoomKey {
  roomId: string;
  key: CryptoKey;
}

/** Required prefix on every room fragment (Q-P5-2). */
const ROOM_PREFIX = "room:";

/** Raw bytes → base64url (no padding). '+' → '-', '/' → '_', strip trailing '='. */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64url → ArrayBuffer. Returns null on malformed input. */
function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> | null {
  // Reject characters that are not valid in base64url before padding.
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
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
 * Build a room URL fragment from a roomId and a base64url-encoded key.
 *
 * Used by ShareDialog to render the collab URL after `generateRoomKey()`.
 *
 * @param roomId - The room identifier (typically a UUID v4 string).
 * @param keyB64 - Base64url-encoded 32-byte AES-256-GCM key (no padding).
 * @returns The fragment string, including the leading `#`.
 */
export function buildRoomFragment(roomId: string, keyB64: string): string {
  return "#" + ROOM_PREFIX + roomId + "," + keyB64;
}

/**
 * Generate a fresh room key and matching URL fragment for a new collab
 * session. Mints a 256-bit AES-GCM key via Web Crypto, a UUID v4 roomId via
 * `crypto.randomUUID()`, and the `#room:<roomId>,<keyB64>` fragment per
 * Q-P5-2.
 *
 * The returned `CryptoKey` is extractable so callers can re-encode it (e.g.
 * for display, persistence, or QR generation). Once the key is in use for
 * encrypt/decrypt the caller may re-import as non-extractable if desired.
 *
 * @returns An object containing the room identifier, the AES-GCM key
 *   handle, and the URL fragment (including leading `#`) ready to append to
 *   the editor location.
 */
export async function generateRoomKey(): Promise<{
  roomId: string;
  key: CryptoKey;
  fragment: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  const keyB64 = bytesToBase64url(new Uint8Array(raw));
  const roomId = crypto.randomUUID();
  const fragment = buildRoomFragment(roomId, keyB64);
  return { roomId, key, fragment };
}

/**
 * Parse a `#room:<roomId>,<base64url-key>` fragment into a RoomKey. Returns
 * null on malformed shape, missing `room:` prefix (Q-P5-2), invalid
 * base64url, or non-32-byte key. The AES-GCM key is imported as
 * non-extractable.
 *
 * Per Q-P5-1, the room key is the symmetric key used to encrypt
 * `SCENE_UPDATE` and `SCENE_SNAPSHOT` payloads end-to-end between peers; the
 * relay never decrypts.
 *
 * Async because Web Crypto's `importKey` is a Promise.
 *
 * @param hash - The URL fragment (with or without leading `#`).
 * @returns A RoomKey, or null if the fragment is not a valid room fragment.
 */
export async function parseRoomFragment(hash: string): Promise<RoomKey | null> {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(ROOM_PREFIX)) return null;
  const body = raw.slice(ROOM_PREFIX.length);

  const commaIdx = body.indexOf(",");
  if (commaIdx < 0) return null;

  const roomId = body.slice(0, commaIdx);
  const keyB64 = body.slice(commaIdx + 1);
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
