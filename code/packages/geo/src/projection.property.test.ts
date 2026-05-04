// Phase 1 Wave 2 Task 9 — projection round-trip property test.
//
// Verifies that `projectPoint(map, lng, lat)` followed by `unprojectPoint(map, x, y)`
// recovers the original (lng, lat) within numeric tolerance, across the full
// projectable lng/lat space (lat clamped to ±85° per Web Mercator's standard
// projectable range).
//
// Uses MapLibre's real `MercatorCoordinate` math to back the fake `Map` —
// per the plan, we do NOT reinvent the Mercator formulas. If MapLibre's math
// has a bug, this test surfaces it; if our seam (`projectPoint` / `unprojectPoint`
// in `projection.ts`) loses precision, this test surfaces that too.
//
// Note (Task 9 deferral): plan Step 4 instructs implementing `syncSceneToMap`
// for `kind: "point"`. Skipped this wave — `syncSceneToMap` has no immediate
// consumer (PinTool, Task 14, is the first); Wave 1.5 already deferred this
// scope for the same reason and the present round-trip property test stands
// alone at the projection level.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { MercatorCoordinate } from "maplibre-gl";
import { projectPoint, unprojectPoint } from "./projection.js";

/**
 * Build a fake `Map` whose `project` / `unproject` use real Web Mercator math
 * via `MercatorCoordinate`. `worldSize = 512 * 2^zoom` is the standard MapLibre
 * tile-pixel world dimension at a given zoom.
 */
function makeFakeMap(zoom: number) {
  const worldSize = 512 * Math.pow(2, zoom);
  return {
    project(coord: [number, number]) {
      const m = MercatorCoordinate.fromLngLat({ lng: coord[0], lat: coord[1] });
      return { x: m.x * worldSize, y: m.y * worldSize };
    },
    unproject(point: [number, number]) {
      const mc = new MercatorCoordinate(point[0] / worldSize, point[1] / worldSize);
      const ll = mc.toLngLat();
      return { lng: ll.lng, lat: ll.lat };
    },
  };
}

describe("projection round-trip — property test (Task 9)", () => {
  it("project ∘ unproject is identity within 1e-6 across the projectable lng/lat space", () => {
    const map = makeFakeMap(12);
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 179, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
        (lng, lat) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { x, y } = projectPoint(map as any, lng, lat);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const back = unprojectPoint(map as any, x, y);
          expect(Math.abs(back.lng - lng)).toBeLessThan(1e-6);
          expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("project ∘ unproject identity holds at multiple zoom levels", () => {
    for (const zoom of [0, 5, 12, 18]) {
      const map = makeFakeMap(zoom);
      fc.assert(
        fc.property(
          fc.double({ min: -179, max: 179, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
          (lng, lat) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { x, y } = projectPoint(map as any, lng, lat);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const back = unprojectPoint(map as any, x, y);
            expect(Math.abs(back.lng - lng)).toBeLessThan(1e-6);
            expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6);
          },
        ),
        { numRuns: 25 },
      );
    }
  });
});
