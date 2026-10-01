// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { LIMITS } from "./limits.js";
import { ROOM_SIZE } from "./wire.js";

describe("LIMITS", () => {
  it("lets every record fit in one message, and every message in a room", () => {
    const { record } = LIMITS;
    for (const bytes of [record.raster, record.features, record.image]) {
      expect(bytes).toBeLessThanOrEqual(LIMITS.message);
    }
    expect(LIMITS.message).toBeLessThanOrEqual(LIMITS.room);
  });

  it("lets a map that took an import at the cap still be saved to the server", () => {
    expect(LIMITS.import).toBeLessThanOrEqual(LIMITS.upload);
  });

  it("lets a saved map open again: the archive caps hold what a save writes", () => {
    const { archive } = LIMITS;
    // A data layer is one entry; an import at the cap becomes one layer.
    expect(archive.entryBytes).toBeGreaterThanOrEqual(LIMITS.import);
    expect(archive.totalBytes).toBeGreaterThanOrEqual(archive.entryBytes);
    expect(archive.entries).toBeGreaterThan(0);
  });

  it("is the room's size table", () => {
    expect(ROOM_SIZE.messageBytes).toBe(LIMITS.message);
    expect(ROOM_SIZE.roomBytes).toBe(LIMITS.room);
    expect(ROOM_SIZE.rasterBytes).toBe(LIMITS.record.raster);
    expect(ROOM_SIZE.featureBytes).toBe(LIMITS.record.features);
    expect(ROOM_SIZE.imageBytes).toBe(LIMITS.record.image);
  });
});
