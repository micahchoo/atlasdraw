// SPDX-License-Identifier: MIT
// Byte-for-byte identity contract for the tiered base64url codec.
//
// The codec picks native Uint8Array#toBase64 → Node Buffer → chunked
// btoa/atob at module load. These tests pin the environment-selected tier
// AND the exported fallback tier to the exact output of the original
// per-byte reference implementation, so swapping tiers can never change
// the wire format.

import { describe, expect, it } from "vitest";

import {
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  _fallbackUint8ArrayToBase64Url,
  _fallbackBase64UrlToUint8Array,
} from "./base64url.js";

// The original (pre-optimization) implementation, kept as the reference the
// fast paths must match byte for byte.
function referenceEncode(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function referenceDecode(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Deterministic PRNG so fuzz failures reproduce.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Sizes straddle base64 block boundaries (0–4), the fallback's CHUNK_SIZE
// boundary (0x8000 ± 1), and a large payload.
const EDGE_SIZES = [0, 1, 2, 3, 4, 31, 32, 33, 0x7fff, 0x8000, 0x8001, 200_000];

function synthBuf(n: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = Math.floor(rand() * 256);
  }
  return buf;
}

function assertMatchesReference(
  encode: typeof uint8ArrayToBase64Url,
  decode: typeof base64UrlToUint8Array,
): void {
  for (const n of EDGE_SIZES) {
    const buf = synthBuf(n, n + 1);
    const expected = referenceEncode(buf);
    expect(encode(buf)).toBe(expected);
    expect(decode(expected)).toEqual(referenceDecode(expected));
    expect(decode(expected)).toEqual(buf);
  }

  // Subarray views must encode their own bytes, not the whole backing buffer.
  const backing = synthBuf(1000, 42);
  const view = backing.subarray(17, 917);
  expect(encode(view)).toBe(referenceEncode(backing.slice(17, 917)));

  // Fuzz.
  const rand = mulberry32(7);
  for (let t = 0; t < 200; t++) {
    const n = 1 + Math.floor(rand() * 5000);
    const buf = synthBuf(n, t);
    const expected = referenceEncode(buf);
    expect(encode(buf)).toBe(expected);
    expect(decode(expected)).toEqual(buf);
  }
}

describe("base64url codec (environment-selected tier)", () => {
  it("matches the reference implementation byte for byte", () => {
    assertMatchesReference(uint8ArrayToBase64Url, base64UrlToUint8Array);
  });

  it("round-trips the empty payload", () => {
    expect(uint8ArrayToBase64Url(new Uint8Array(0))).toBe("");
    expect(base64UrlToUint8Array("")).toEqual(new Uint8Array(0));
  });
});

describe("base64url codec (chunked fallback tier)", () => {
  it("matches the reference implementation byte for byte", () => {
    assertMatchesReference(
      _fallbackUint8ArrayToBase64Url,
      _fallbackBase64UrlToUint8Array,
    );
  });

  it("round-trips the empty payload", () => {
    expect(_fallbackUint8ArrayToBase64Url(new Uint8Array(0))).toBe("");
    expect(_fallbackBase64UrlToUint8Array("")).toEqual(new Uint8Array(0));
  });
});
