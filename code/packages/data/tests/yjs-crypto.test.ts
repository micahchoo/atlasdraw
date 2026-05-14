// @atlasdraw/data — Yjs AES-GCM Encryption Layer tests.
// Phase 5 Task 8: stub API tests — encryptUpdate/decryptUpdate round-trip,
// wrong-key rejection, and ciphertext uniqueness.

import { describe, it, expect } from "vitest";
import { encryptUpdate, decryptUpdate } from "../src/yjs-crypto";

/** Convenience: generate a fresh 256-bit AES-GCM key. */
async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

describe("yjs-crypto", () => {
  it("encrypt + decrypt round-trip returns original Uint8Array", async () => {
    const key = await generateKey();
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);

    const encrypted = await encryptUpdate(original, key);
    const decrypted = await decryptUpdate(encrypted, key);

    expect(decrypted).toEqual(original);
  });

  it("decrypt with wrong key throws", async () => {
    const keyA = await generateKey();
    const keyB = await generateKey();
    const original = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    const encrypted = await encryptUpdate(original, keyA);

    // decryptUpdate with a different key should reject (GCM auth fails)
    await expect(decryptUpdate(encrypted, keyB)).rejects.toThrow();
  });

  it("different payloads produce different ciphertexts", async () => {
    const key = await generateKey();
    const payloadA = new Uint8Array([0x01, 0x02, 0x03]);
    const payloadB = new Uint8Array([0x04, 0x05, 0x06]);

    const resultA = await encryptUpdate(payloadA, key);
    const resultB = await encryptUpdate(payloadB, key);

    expect(resultA.ciphertext).not.toBe(resultB.ciphertext);
  });
});
