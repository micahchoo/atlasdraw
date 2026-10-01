// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// The byte caps a room puts on images. Each comes from the protocol's size
// table, so a record that passes here fits in one message the relay reads;
// collab.known-red.test.ts measures the rest through a relay.

import { describe, expect, it } from "vitest";

import { MAX_ALLOWED_FILE_BYTES } from "@atlasdraw/common";
import { ROOM_SIZE } from "@atlasdraw/protocol";

import { ROOM_LIMITS, checkFile, checkImage } from "../roomValidation";

describe("room image caps", () => {
  it("let every image record fit in one relay message, with its framing", () => {
    for (const cap of [ROOM_LIMITS.rasterBytes, ROOM_LIMITS.fileDataUrl]) {
      expect(cap + ROOM_SIZE.frameBytes).toBeLessThanOrEqual(
        ROOM_SIZE.messageBytes,
      );
    }
  });

  it("hold a drawing file at Excalidraw's own cap", () => {
    expect(MAX_ALLOWED_FILE_BYTES).toBeLessThanOrEqual(ROOM_SIZE.imageBytes);
  });

  it("refuses a raster image over the byte cap and keeps one under it", () => {
    const under = { mimeType: "image/png", bytes: new Uint8Array(1024) };
    const over = {
      mimeType: "image/png",
      bytes: new Uint8Array(ROOM_LIMITS.rasterBytes + 1),
    };
    expect(checkImage("rl:a", under)).toBe(under);
    expect(checkImage("rl:a", over)).toBeNull();
  });

  it("refuses a drawing file over Excalidraw's file cap and keeps one under it", () => {
    const head = "data:image/png;base64,";
    const under = { mimeType: "image/png", dataURL: `${head}AAAA`, created: 1 };
    const over = {
      mimeType: "image/png",
      dataURL: head + "A".repeat(ROOM_LIMITS.fileDataUrl),
      created: 1,
    };
    expect(checkFile("f1", under)).toBe(under);
    expect(checkFile("f1", over)).toBeNull();
  });
});
