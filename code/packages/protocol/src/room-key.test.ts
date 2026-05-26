// SPDX-License-Identifier: MIT
// Tests for room-key fragment generation + parsing.
// Covers Q-P5-2 (mandatory `room:` prefix) and round-trip with
// `generateRoomKey` (Phase 5 collab-integration plan 2026-05-15 § Step 1).

import { describe, expect, it } from "vitest";

import {
  buildRoomFragment,
  generateRoomKey,
  parseRoomFragment,
} from "./room-key";

/** Base64url-encode a Uint8Array (no padding). Test-only helper. */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Build a `#room:<id>,<key>` fragment from raw bytes for tests. */
function fragmentFromBytes(roomId: string, keyBytes: Uint8Array): string {
  return `#room:${roomId},${bytesToBase64url(keyBytes)}`;
}

describe("generateRoomKey", () => {
  it("mints a roomId, an AES-GCM key, and a `#room:`-prefixed fragment", async () => {
    const result = await generateRoomKey();
    expect(result.roomId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.key).toBeDefined();
    expect(result.key.algorithm).toMatchObject({ name: "AES-GCM" });
    expect(result.fragment.startsWith("#room:")).toBe(true);
    expect(result.fragment).toContain(`${result.roomId},`);
  });

  it("round-trips through parseRoomFragment", async () => {
    const minted = await generateRoomKey();
    const parsed = await parseRoomFragment(minted.fragment);
    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(minted.roomId);
  });
});

describe("buildRoomFragment", () => {
  it("emits the `#room:<roomId>,<keyB64>` shape", () => {
    const f = buildRoomFragment("abc-123", "AAAA");
    expect(f).toBe("#room:abc-123,AAAA");
  });
});

describe("parseRoomFragment", () => {
  // A valid 32-byte key, base64url-encoded (no padding).
  const validKey = new Uint8Array(32).fill(7);

  it("accepts a well-formed fragment with the `room:` prefix", async () => {
    const fragment = fragmentFromBytes("abc-123", validKey);
    const result = await parseRoomFragment(fragment);
    expect(result).not.toBeNull();
    expect(result!.roomId).toBe("abc-123");
    expect(result!.key).toBeDefined();
  });

  it("accepts the fragment without a leading `#`", async () => {
    const fragment = fragmentFromBytes("abc-123", validKey).slice(1);
    const result = await parseRoomFragment(fragment);
    expect(result).not.toBeNull();
    expect(result!.roomId).toBe("abc-123");
  });

  it("rejects the legacy un-prefixed shape (Q-P5-2)", async () => {
    // Legacy form: `#<roomId>,<key>` — the `room:` prefix is now mandatory.
    const legacy = `#abc-123,${bytesToBase64url(validKey)}`;
    const result = await parseRoomFragment(legacy);
    expect(result).toBeNull();
  });

  it("rejects a fragment missing the comma separator", async () => {
    const result = await parseRoomFragment(
      `#room:abc-123${bytesToBase64url(validKey)}`,
    );
    expect(result).toBeNull();
  });

  it("rejects a fragment missing the `room:` prefix entirely", async () => {
    const result = await parseRoomFragment("#abc-123,AAAA");
    expect(result).toBeNull();
  });

  it("rejects an empty roomId", async () => {
    const result = await parseRoomFragment(
      `#room:,${bytesToBase64url(validKey)}`,
    );
    expect(result).toBeNull();
  });

  it("rejects an empty key segment", async () => {
    const result = await parseRoomFragment("#room:abc-123,");
    expect(result).toBeNull();
  });

  it("rejects malformed base64url in the key segment", async () => {
    // `$` is not a valid base64url character.
    const result = await parseRoomFragment("#room:abc-123,not$valid$base64");
    expect(result).toBeNull();
  });

  it("rejects a wrong-length key (16 bytes instead of 32)", async () => {
    const shortKey = new Uint8Array(16).fill(1);
    const fragment = fragmentFromBytes("abc-123", shortKey);
    const result = await parseRoomFragment(fragment);
    expect(result).toBeNull();
  });

  it("rejects a wrong-length key (48 bytes instead of 32)", async () => {
    const longKey = new Uint8Array(48).fill(1);
    const fragment = fragmentFromBytes("abc-123", longKey);
    const result = await parseRoomFragment(fragment);
    expect(result).toBeNull();
  });
});
