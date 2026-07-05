// packages/data/src/base64url.ts
// SPDX-License-Identifier: MIT
//
// Shared base64url encode/decode helpers for AES-GCM payloads. Used by
// yjs-crypto.ts (Yjs binary updates) and, via the package barrel, by
// apps/atlas-app/src/collab/scene-crypto.ts (Excalidraw scene JSON) — both
// need the same IV/ciphertext framing, just over different payload shapes.

export function uint8ArrayToBase64Url(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToUint8Array(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
