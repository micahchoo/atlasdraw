// apps/atlas-app/src/tools/seedToElement.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 1a Task T-W1a-BRIDGE — seedToElement bridge unit tests.
//
// One test per supported (type, customType, geo.kind) tuple. Mocks the
// MapLibre `Map.project` method (the only method projectPoint touches) and
// verifies that:
//   - the resulting element has the expected `type`
//   - `customData` carries a full GeoCustomData wrapper with the seed's
//     geo, scaleMode, projection="mercator", schemaVersion=1
//   - the optional `_data` escape is preserved when seed.data is present
//
// Also asserts the existing PinTool branch is unchanged in behavior (no
// regression from the Phase 1 bridge).
//
// Runs via vitest. The atlas-app workspace currently has no vitest devDep
// (T-W1a-BRIDGE flagged this as a follow-up); these tests run from the root
// vitest config once `vitest` is added to the workspace and the root config
// includes `apps/atlas-app/src/**/*.test.ts`.

import { describe, it, expect, vi, beforeAll } from "vitest";

import { seedToElement } from "./seedToElement.js";

import type maplibregl from "maplibre-gl";
import type { AtlasdrawElementSeed } from "@atlasdraw/tools";

// jsdom does not implement canvas. Excalidraw's `newTextElement` calls
// measureText via canvas getContext("2d"). Stub a minimal 2d context so the
// text branch test can run without pulling in the heavy `canvas` package.
beforeAll(() => {
  if (typeof HTMLCanvasElement !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (
      kind: string,
    ): unknown {
      if (kind !== "2d") {
        return null;
      }
      return {
        font: "",
        measureText: (text: string) => ({
          width: text.length * 8,
          actualBoundingBoxAscent: 16,
          actualBoundingBoxDescent: 4,
        }),
        fillText: () => undefined,
        save: () => undefined,
        restore: () => undefined,
      };
    };
  }
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a mock MapLibre map whose `project` returns deterministic scene
 *  coords. Each [lng, lat] is mapped to (lng * 100, -lat * 100) so we can
 *  assert the bridge actually called project and the values are predictable.
 *  `projectPoint` calls `map.project([lng, lat])` — array form per
 *  packages/geo/src/projection.ts.
 */
function makeMap(): maplibregl.Map {
  const project = vi.fn((arg: unknown) => {
    const [lng, lat] = Array.isArray(arg)
      ? (arg as [number, number])
      : [
          (arg as { lng: number; lat: number }).lng,
          (arg as { lng: number; lat: number }).lat,
        ];
    return { x: lng * 100, y: -lat * 100 };
  });
  return { project } as unknown as maplibregl.Map;
}

const Z_REF = 12;

function expectGeoCustomData(
  el: { customData?: unknown },
  seed: AtlasdrawElementSeed,
) {
  expect(el.customData).toMatchObject({
    geo: seed.geo,
    scaleMode: seed.scaleMode,
    projection: "mercator",
    schemaVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// Pin (regression — unchanged behavior from Phase 1)
// ---------------------------------------------------------------------------

describe("seedToElement: pin (regression)", () => {
  it("produces an ellipse with full GeoCustomData wrapper", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "custom",
      customType: "pin",
      geo: { kind: "point", lng: -73.98, lat: 40.75, zRef: Z_REF },
      scaleMode: "screen",
      data: { label: "NYC" },
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("ellipse");
    expectGeoCustomData(el, seed);
    // _data escape preserved (Phase 1 contract)
    expect((el.customData as { _data?: unknown })._data).toEqual({
      label: "NYC",
    });
  });
});

// ---------------------------------------------------------------------------
// New Phase 2 branches
// ---------------------------------------------------------------------------

describe("seedToElement: freedraw (T03 polygon + T05 freehand)", () => {
  it("produces a freedraw element from a polyline", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "freedraw",
      geo: {
        kind: "polyline",
        coordinates: [
          [-73.98, 40.75],
          [-73.97, 40.76],
          [-73.96, 40.74],
          [-73.98, 40.75], // closed ring (polygon variant)
        ],
        zRef: Z_REF,
      },
      scaleMode: "geographic",
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("freedraw");
    expectGeoCustomData(el, seed);
    // points[0] is always [0, 0] (relative to element origin)
    const pts = (el as unknown as { points: ReadonlyArray<[number, number]> })
      .points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.length).toBe(4);
  });
});

describe("seedToElement: line (T04 polyline)", () => {
  it("produces a line element with relative points", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "line",
      geo: {
        kind: "polyline",
        coordinates: [
          [-73.98, 40.75],
          [-73.97, 40.76],
        ],
        zRef: Z_REF,
      },
      scaleMode: "geographic",
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("line");
    expectGeoCustomData(el, seed);
  });
});

describe("seedToElement: arrow (T07)", () => {
  it("produces an arrow element with end-arrowhead", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "arrow",
      geo: {
        kind: "polyline",
        coordinates: [
          [-73.98, 40.75],
          [-73.97, 40.76],
        ],
        zRef: Z_REF,
      },
      scaleMode: "screen",
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("arrow");
    expectGeoCustomData(el, seed);
    expect(
      (el as unknown as { endArrowhead: string | null }).endArrowhead,
    ).toBe("arrow");
  });
});

describe("seedToElement: rectangle (T08)", () => {
  it("produces a rectangle from a bbox geo", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "rectangle",
      geo: {
        kind: "bbox",
        west: -73.99,
        south: 40.74,
        east: -73.97,
        north: 40.76,
        zRef: Z_REF,
      },
      scaleMode: "geographic",
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("rectangle");
    expectGeoCustomData(el, seed);
    // bbox dimensions: |west - east| * 100 = 2 (lng diff scaled)
    //                  |north - south| * 100 = 2 (lat diff scaled)
    expect(el.width).toBeCloseTo(2);
    expect(el.height).toBeCloseTo(2);
  });
});

describe("seedToElement: ellipse (T09 circle)", () => {
  it("produces an ellipse with width===height (rotation-invariant)", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "ellipse",
      geo: { kind: "point", lng: -73.98, lat: 40.75, zRef: Z_REF },
      scaleMode: "screen",
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("ellipse");
    expectGeoCustomData(el, seed);
    // Default circle diameter — width must equal height (rotation invariance).
    expect(el.width).toBe(el.height);
  });
});

describe("seedToElement: text (T06 label)", () => {
  it("produces a text element from a point geo", () => {
    const map = makeMap();
    const seed: AtlasdrawElementSeed = {
      type: "text",
      geo: { kind: "point", lng: -73.98, lat: 40.75, zRef: Z_REF },
      scaleMode: "screen",
      data: { text: "Hello" },
    };
    const el = seedToElement(seed, map);
    expect(el.type).toBe("text");
    expectGeoCustomData(el, seed);
    // _data escape preserved
    expect((el.customData as { _data?: unknown })._data).toEqual({
      text: "Hello",
    });
  });
});

// ---------------------------------------------------------------------------
// Default branch — unsupported tuple throws with diagnostic message
// ---------------------------------------------------------------------------

describe("seedToElement: unsupported tuple", () => {
  it("throws with (type, customType, kind) in the message", () => {
    const map = makeMap();
    const badSeed = {
      type: "custom",
      customType: "unknown-thing",
      geo: { kind: "point", lng: 0, lat: 0, zRef: Z_REF },
      scaleMode: "screen",
    } as unknown as AtlasdrawElementSeed;
    expect(() => seedToElement(badSeed, map)).toThrow(/unsupported/);
  });

  it("throws when geo.kind doesn't match the element type", () => {
    const map = makeMap();
    const badSeed = {
      type: "rectangle",
      geo: { kind: "point", lng: 0, lat: 0, zRef: Z_REF },
      scaleMode: "geographic",
    } as unknown as AtlasdrawElementSeed;
    expect(() => seedToElement(badSeed, map)).toThrow(/rectangle requires/);
  });
});
