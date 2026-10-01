// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import { normalizeAnchor } from "./comment-schema.js";

describe("normalizeAnchor", () => {
  it("reads a v1 element anchor as the v2 annotation anchor", () => {
    expect(normalizeAnchor({ kind: "element", elementId: "e1" })).toEqual({
      kind: "annotation",
      source: "element",
      elementId: "e1",
    });
  });

  it("keeps every v2 anchor as it is", () => {
    const anchors = [
      { kind: "map", lng: 13.4, lat: 52.5 },
      { kind: "annotation", source: "element", elementId: "e1" },
      { kind: "annotation", source: "raster", rasterId: "rl:1" },
    ] as const;
    for (const a of anchors) {
      expect(normalizeAnchor(a)).toBe(a);
    }
  });
});
