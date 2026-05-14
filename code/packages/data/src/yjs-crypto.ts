// @atlasdraw/data — Yjs AES-GCM Encryption Layer.
//
// Phase 5 stub — NOT wired into the y-websocket path.
// Phase 6 wires if Option B selected; drops if Option A confirmed.
//
// See ADR-0010 for the threat model:
//   docs/architecture/adr/0010-yjs-e2ee-threat-model.md
//
// Escalation E-01 (docs/decisions/escalations.md) documents the structural
// conflict between setupWSConnection and payload encryption. Option C was
// selected on 2026-05-11: this module ships as a tested but unwired stub.

/* ---- helpers ---- */

function uint8ArrayToBase64Url(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToUint8Array(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ---- public API ---- */

/**
 * Encrypt a Yjs binary update using AES-GCM.
 *
 * @param update - Raw Yjs update bytes (Uint8Array) to encrypt.
 * @param key   - A CryptoKey suitable for AES-GCM (generated via
 *                `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, ...)`).
 * @returns An object containing the random 12-byte IV (base64url) and the
 *          ciphertext (base64url, with GCM auth tag appended).
 */
export async function encryptUpdate(
  update: Uint8Array,
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // @types/node v22 uses Uint8Array<ArrayBufferLike> which conflicts with DOM
  // BufferSource. Cast at the Web Crypto API boundary to satisfy tsc.
  const data = update.slice().buffer as ArrayBuffer;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    data as BufferSource,
  );
  return {
    iv: uint8ArrayToBase64Url(iv),
    ciphertext: uint8ArrayToBase64Url(new Uint8Array(encrypted)),
  };
}

/**
 * Decrypt a previously encrypted Yjs binary update.
 *
 * @param payload - The IV and ciphertext from `encryptUpdate`.
 * @param key     - The same CryptoKey used for encryption.
 * @returns The original Yjs update bytes.
 * @throws {DOMException} If the key is wrong or the payload is tampered with
 *         (AES-GCM authentication fails, "OperationError").
 */
export async function decryptUpdate(
  payload: { iv: string; ciphertext: string },
  key: CryptoKey,
): Promise<Uint8Array> {
  const iv = base64UrlToUint8Array(payload.iv);
  const ciphertext = base64UrlToUint8Array(payload.ciphertext);
  const data = ciphertext.slice().buffer as ArrayBuffer;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    data as BufferSource,
  );
  return new Uint8Array(decrypted);
}
