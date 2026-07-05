// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 10 — Scene Encryption Adapter.
//
// AES-GCM encryption/decryption for Excalidraw SCENE_UPDATE payloads.
// Matches Excalidraw's existing E2EE model using room-key derived CryptoKey.
//
// Camera and cursor events are plaintext by design (see ADR-0010
// § "What the relay can see").
//
// See docs/architecture/adr/0010-yjs-e2ee-threat-model.md

import { uint8ArrayToBase64Url, base64UrlToUint8Array } from "@atlasdraw/data";

import type { ExcalidrawElement } from "@atlasdraw/excalidraw";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize Excalidraw elements to JSON, then AES-GCM encrypt with a random
 * 12-byte IV.
 *
 * @param elements - The Excalidraw scene elements to encrypt.
 * @param key      - AES-GCM CryptoKey (generated or imported by RoomKey).
 * @returns An object with base64url-encoded `iv` and `ciphertext`.
 */
export async function encryptScene(
  elements: ExcalidrawElement[],
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(elements));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // @types/node v22 uses Uint8Array<ArrayBufferLike> which conflicts with DOM
  // BufferSource. Cast at the Web Crypto API boundary to satisfy tsc.
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return {
    iv: uint8ArrayToBase64Url(iv),
    ciphertext: uint8ArrayToBase64Url(new Uint8Array(encrypted)),
  };
}

/**
 * Decrypt a previously encrypted SCENE_UPDATE payload and deserialize the
 * Excalidraw elements array.
 *
 * @param payload - The IV and ciphertext from `encryptScene`.
 * @param key     - The same CryptoKey used for encryption.
 * @returns The deserialized ExcalidrawElement array.
 * @throws {DOMException} If the key is wrong or the payload is tampered with
 *         (AES-GCM authentication fails, "OperationError").
 * @throws {SyntaxError} If the decrypted JSON is malformed.
 */
export async function decryptScene(
  payload: { iv: string; ciphertext: string },
  key: CryptoKey,
): Promise<ExcalidrawElement[]> {
  const iv = base64UrlToUint8Array(payload.iv);
  const ciphertext = base64UrlToUint8Array(payload.ciphertext);
  const data = ciphertext.slice().buffer as ArrayBuffer;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    data as BufferSource,
  );
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted)) as ExcalidrawElement[];
}
