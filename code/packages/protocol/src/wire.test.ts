// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  CLOSE,
  ROOM_SIZE,
  closeReason,
  isRoomId,
  readCloseReason,
  sizeText,
} from "./wire.js";

describe("the room size table", () => {
  it("lets every record the client may write fit in one message, with its framing", () => {
    for (const cap of [
      ROOM_SIZE.rasterBytes,
      ROOM_SIZE.featureBytes,
      ROOM_SIZE.imageDataUrlChars,
    ]) {
      expect(cap + ROOM_SIZE.frameBytes).toBeLessThanOrEqual(
        ROOM_SIZE.messageBytes,
      );
    }
  });

  it("lets a room hold at least one message", () => {
    expect(ROOM_SIZE.roomBytes).toBeGreaterThanOrEqual(ROOM_SIZE.messageBytes);
  });

  it("holds an image of the drawing's own file cap as a data URL", () => {
    // base64 is 4 characters per 3 bytes, plus "data:<type>;base64,".
    expect(ROOM_SIZE.imageDataUrlChars).toBeGreaterThanOrEqual(
      Math.ceil((ROOM_SIZE.imageBytes * 4) / 3) + 64,
    );
  });
});

describe("close codes", () => {
  it("are distinct, and the refusals are in the application range", () => {
    const codes = Object.values(CLOSE);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [name, code] of Object.entries(CLOSE)) {
      if (name !== "messageTooLarge") {
        expect(code).toBeGreaterThanOrEqual(4000);
      }
    }
    expect(CLOSE.messageTooLarge).toBe(1009);
  });

  it("states a size refusal as the size and the cap, in a close frame's 123 bytes", () => {
    const reason = closeReason("room too large", 70_000_000, 67_108_864);
    expect(reason).toBe("room too large: 70000000 > 67108864");
    expect(new TextEncoder().encode(reason).length).toBeLessThanOrEqual(123);
    expect(readCloseReason(reason)).toEqual({
      what: "room too large",
      size: 70_000_000,
      cap: 67_108_864,
    });
    expect(readCloseReason("denied")).toBeNull();
  });
});

describe("room ids", () => {
  it("are lower-case UUIDs", () => {
    expect(isRoomId("3e1915ed-5afb-4706-a6af-f600f29cde94")).toBe(true);
    expect(isRoomId("3E1915ED-5AFB-4706-A6AF-F600F29CDE94")).toBe(false);
    expect(isRoomId("comments/abc")).toBe(false);
  });
});

describe("sizeText", () => {
  it("says kilobytes under a megabyte and megabytes from one", () => {
    expect(sizeText(64 * 1024)).toBe("64.0 KB");
    expect(sizeText(16 << 20)).toBe("16.0 MB");
  });
});
