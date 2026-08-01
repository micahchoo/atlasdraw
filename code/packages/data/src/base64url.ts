// packages/data/src/base64url.ts
// SPDX-License-Identifier: MIT
//
// Shared base64url encode/decode helpers for AES-GCM payloads. Used by
// yjs-crypto.ts (Yjs binary updates) and, via the package barrel, by
// apps/atlas-app/src/collab/scene-crypto.ts (Excalidraw scene JSON) — both
// need the same IV/ciphertext framing, just over different payload shapes.
//
// Three implementations, picked at module load, fastest available first. All
// three produce identical output for valid input (asserted across sizes and
// fuzzed payloads in base64url.test.ts): unpadded RFC 4648 §5 base64url.
//   1. Native Uint8Array#toBase64 / Uint8Array.fromBase64
//      (Chrome 140+, Firefox 133+, Safari 18.2+, Node 25+).
//   2. Node Buffer "base64url" codec (storage/realtime apps, vitest).
//   3. Chunked String.fromCharCode + btoa/atob for every other browser.
// The chunking in (3) is load-bearing: the previous per-byte
// `binary += String.fromCharCode(buf[i])` loop cost ~17 ms per MB on the
// emitSceneUpdate hot path; chunked apply is ~3× faster, the native paths
// are 20–400× faster.
//
// Malformed input (not produced by this encoder) fails in all three decode
// paths, but at different sites: atob/fromBase64 throw here, the Buffer codec
// skips invalid characters and leaves the AES-GCM auth tag to reject the
// garbage bytes. Callers treat any failure identically (discard payload).

interface NativeBase64Uint8Array extends Uint8Array {
  toBase64(opts: { alphabet: "base64url"; omitPadding: boolean }): string;
}

interface NativeBase64Uint8ArrayCtor extends Uint8ArrayConstructor {
  fromBase64(s: string, opts: { alphabet: "base64url" }): Uint8Array;
}

interface NodeBufferLike extends Uint8Array {
  toString(encoding?: "base64url"): string;
}

interface NodeBufferCtorLike {
  from(
    input: ArrayBufferLike,
    byteOffset: number,
    length: number,
  ): NodeBufferLike;
  from(input: string, encoding: "base64url"): NodeBufferLike;
}

const hasNativeBase64 =
  typeof (Uint8Array.prototype as Partial<NativeBase64Uint8Array>).toBase64 ===
    "function" &&
  typeof (Uint8Array as Partial<NativeBase64Uint8ArrayCtor>).fromBase64 ===
    "function";

const NodeBuffer = (globalThis as { Buffer?: NodeBufferCtorLike }).Buffer;

// Max args per fromCharCode.apply call — stays far below engine argument
// limits (~64k in V8, lower elsewhere).
const CHUNK_SIZE = 0x8000;

/** Tier-3 encode. Exported only so base64url.test.ts can pin it to the same
 * output as the environment-selected tier; import the un-prefixed function. */
export function _fallbackUint8ArrayToBase64Url(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      buf.subarray(i, i + CHUNK_SIZE) as unknown as number[],
    );
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Tier-3 decode. Exported only for base64url.test.ts, as above. */
export function _fallbackBase64UrlToUint8Array(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64Url(buf: Uint8Array): string {
  if (hasNativeBase64) {
    return (buf as NativeBase64Uint8Array).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    });
  }
  if (NodeBuffer) {
    return NodeBuffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString(
      "base64url",
    );
  }
  return _fallbackUint8ArrayToBase64Url(buf);
}

export function base64UrlToUint8Array(s: string): Uint8Array {
  if (hasNativeBase64) {
    return (Uint8Array as unknown as NativeBase64Uint8ArrayCtor).fromBase64(s, {
      alphabet: "base64url",
    });
  }
  if (NodeBuffer) {
    // Copy out of Buffer's shared allocation pool so callers get a standalone
    // array whose .buffer contains exactly these bytes, as before.
    return new Uint8Array(NodeBuffer.from(s, "base64url"));
  }
  return _fallbackBase64UrlToUint8Array(s);
}
