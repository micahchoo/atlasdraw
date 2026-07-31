// RT-2 — canonical export and element rotation.
//
// Canonical space is zoom 0 and north-up, so the only rotation that belongs in
// a saved element's `angle` is the user's own. `_lastSync.a0` is where the
// pipeline keeps that, separated from the camera's contribution; without
// reading it here, a document saved while the map was turned would reopen with
// the camera's rotation baked into every bbox element.

import { describe, it, expect } from "vitest";

import { normalizeElementsForExport } from "./canonicalExport.js";

import type { GeoCustomData } from "./types.js";

const bboxGeo: GeoCustomData = {
  geo: { kind: "bbox", west: -1, east: 1, north: 1, south: -1, zRef: 12 },
  scaleMode: "geographic",
  projection: "mercator",
  schemaVersion: 1,
};

function exportOne(el: Record<string, unknown>): Record<string, unknown> {
  return normalizeElementsForExport([el])[0] as Record<string, unknown>;
}

describe("normalizeElementsForExport — rotation", () => {
  it("strips the camera's rotation and saves the user's", () => {
    const userAngle = 0.4;
    const out = exportOne({
      id: "r1",
      x: 700,
      y: 120,
      width: 200,
      height: 100,
      // What the last sync wrote while the camera was turned 90°.
      angle: userAngle - Math.PI / 2,
      customData: {
        ...bboxGeo,
        _lastSync: {
          x: 700,
          y: 120,
          w: 200,
          h: 100,
          a0: userAngle,
          a: userAngle - Math.PI / 2,
        },
      },
    });

    expect(out.angle).toBe(userAngle);
    const sync = (out.customData as { _lastSync: Record<string, number> })
      ._lastSync;
    expect(sync.a0).toBe(userAngle);
    // `a` must agree with the angle actually written, or the first onChange
    // after load reads the difference as a user rotation.
    expect(sync.a).toBe(out.angle);
  });

  it("leaves `angle` alone on documents that predate the a0 baseline", () => {
    const out = exportOne({
      id: "r2",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      angle: 0.25,
      customData: { ...bboxGeo, _lastSync: { x: 0, y: 0, w: 10, h: 10 } },
    });

    expect(out.angle).toBe(0.25);
    expect(
      (out.customData as { _lastSync: Record<string, unknown> })._lastSync,
    ).not.toHaveProperty("a0");
  });

  it("still rewrites position and size to canonical zoom-0 coords", () => {
    const out = exportOne({
      id: "r3",
      x: 999,
      y: 999,
      width: 1,
      height: 1,
      customData: { ...bboxGeo },
    });

    // west=-1 → (179/360)*256; north=1 is above the equator, so y < 128.
    expect(out.x).toBeCloseTo(((-1 + 180) / 360) * 256, 9);
    expect(out.y as number).toBeLessThan(128);
    expect(out.width as number).toBeGreaterThan(0);
    expect(out.height as number).toBeGreaterThan(0);
  });
});
