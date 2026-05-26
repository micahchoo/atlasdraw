// SPDX-License-Identifier: MIT
// Tests for scaleMode helpers (Phase 2 Wave 4 Task T17).

import { describe, it, expect, vi } from "vitest";

import {
  computeScaleFactor,
  clampHybridFactor,
  HYBRID_FACTOR_MIN,
  HYBRID_FACTOR_MAX,
} from "@atlasdraw/geo";

import {
  CoordinateSync,
  type ExcalidrawAPI,
  type ExcalidrawElementLike,
} from "./CoordinateSync";

import type { GeoCustomData } from "@atlasdraw/geo";

// ---------------------------------------------------------------------------
// Unit: computeScaleFactor
// ---------------------------------------------------------------------------

describe("computeScaleFactor", () => {
  it("returns 1.0 when currentZoom == zRef (identity)", () => {
    expect(computeScaleFactor(12, 12)).toBe(1);
    expect(computeScaleFactor(0, 0)).toBe(1);
    expect(computeScaleFactor(-3, -3)).toBe(1);
  });

  it("doubles per +1 zoom level", () => {
    expect(computeScaleFactor(13, 12)).toBe(2);
    expect(computeScaleFactor(15, 12)).toBe(8);
    expect(computeScaleFactor(20, 12)).toBe(256);
  });

  it("halves per -1 zoom level", () => {
    expect(computeScaleFactor(11, 12)).toBe(0.5);
    expect(computeScaleFactor(9, 12)).toBe(0.125);
    expect(computeScaleFactor(4, 12)).toBe(1 / 256);
  });

  it("respects fractional zooms (MapLibre supports decimal zoom)", () => {
    expect(computeScaleFactor(12.5, 12)).toBeCloseTo(Math.SQRT2, 10);
    expect(computeScaleFactor(11.5, 12)).toBeCloseTo(1 / Math.SQRT2, 10);
  });
});

// ---------------------------------------------------------------------------
// Unit: clampHybridFactor
// ---------------------------------------------------------------------------

describe("clampHybridFactor", () => {
  it("exposes ±2-zoom-level bounds as named constants", () => {
    expect(HYBRID_FACTOR_MIN).toBe(0.25);
    expect(HYBRID_FACTOR_MAX).toBe(4);
  });

  it("passes through values within [0.25, 4.0]", () => {
    expect(clampHybridFactor(1)).toBe(1);
    expect(clampHybridFactor(0.25)).toBe(0.25);
    expect(clampHybridFactor(4)).toBe(4);
    expect(clampHybridFactor(0.5)).toBe(0.5);
    expect(clampHybridFactor(3.99)).toBe(3.99);
  });

  it("clamps below 0.25", () => {
    expect(clampHybridFactor(0)).toBe(0.25);
    expect(clampHybridFactor(0.1)).toBe(0.25);
    expect(clampHybridFactor(-1)).toBe(0.25);
  });

  it("clamps above 4.0", () => {
    expect(clampHybridFactor(4.01)).toBe(4);
    expect(clampHybridFactor(16)).toBe(4);
    expect(clampHybridFactor(Number.POSITIVE_INFINITY)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Integration: CoordinateSync._projectElement × non-default scaleMode combos
// ---------------------------------------------------------------------------
//
// Mirrors the helper pattern from CoordinateSync.test.ts. zRef=12 throughout;
// vary `getZoom()` to drive factor.

function makeMap(opts: {
  project?: ReturnType<typeof vi.fn>;
  zoom?: number;
}) {
  return {
    project: opts.project ?? vi.fn().mockReturnValue({ x: 100, y: 100 }),
    on: vi.fn(),
    off: vi.fn(),
    getCenter: vi.fn().mockReturnValue({ lng: 0, lat: 0 }),
    getZoom: vi.fn().mockReturnValue(opts.zoom ?? 12),
    getPitch: vi.fn().mockReturnValue(0),
    getBearing: vi.fn().mockReturnValue(0),
  };
}

function makeProjectByLngLat(
  table: ReadonlyArray<
    readonly [readonly [number, number], { x: number; y: number }]
  >,
) {
  return vi.fn((coord: [number, number]) => {
    const key = JSON.stringify(coord);
    const hit = table.find(([k]) => JSON.stringify(k) === key);
    if (!hit) {throw new Error(`Unmocked project call: ${key}`);}
    return hit[1];
  });
}

function makeApi(elements: ExcalidrawElementLike[]) {
  const updateScene = vi.fn();
  const api: ExcalidrawAPI = {
    getSceneElements: vi.fn().mockReturnValue(elements),
    updateScene,
  };
  return { api, updateScene };
}

function runSync(map: ReturnType<typeof makeMap>, el: ExcalidrawElementLike) {
  const { api, updateScene } = makeApi([el]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });
  sync.syncMapToScene();
  return updateScene.mock.calls[0][0].elements[0] as ExcalidrawElementLike;
}

describe("_projectElement: point + geographic", () => {
  it("scales width/height by factor at currentZoom == zRef + 1 (factor 2x)", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 500, y: 400 }),
      zoom: 13,
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo",
      x: 0,
      y: 0,
      width: 10,
      height: 8,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
        // eslint-disable-next-line prettier/prettier
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 500, y: 400, width: 20, height: 16 });
  });

  it("scales width/height by 0.5 at currentZoom == zRef - 1", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 100, y: 100 }),
      zoom: 11,
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo-zoomout",
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ width: 8, height: 8 });
  });
});

describe("_projectElement: point + hybrid", () => {
  it("matches geographic within [zRef-2, zRef+2]", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 14, // factor = 4, in-bounds
    });
    const el: ExcalidrawElementLike = {
      id: "p-hyb-in",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ width: 40, height: 40 });
  });

  it("clamps to 4x at currentZoom > zRef + 2", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 20, // factor = 256, clamps to 4
    });
    const el: ExcalidrawElementLike = {
      id: "p-hyb-clamp-up",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ width: 40, height: 40 });
  });

  it("clamps to 0.25x at currentZoom < zRef - 2", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 5, // factor = 1/128, clamps to 0.25
    });
    const el: ExcalidrawElementLike = {
      id: "p-hyb-clamp-down",
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ width: 4, height: 4 });
  });
});

describe("_projectElement: bbox + screen", () => {
  it("uses NW for x/y; preserves el.width/el.height; SE not projected", () => {
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }], // NW
    ]);
    const map = makeMap({ project, zoom: 12 });
    const el: ExcalidrawElementLike = {
      id: "b-screen",
      x: 0,
      y: 0,
      width: 50,
      height: 30,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 100, y: 100, width: 50, height: 30 });
    // SE was NOT projected — confirms we skipped the second projection call.
    expect(project).toHaveBeenCalledTimes(1);
  });
});

describe("_projectElement: bbox + hybrid", () => {
  it("matches geographic when factor in-bounds", () => {
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],
      [[1, -1], { x: 300, y: 250 }],
    ]);
    const map = makeMap({ project, zoom: 12 }); // factor=1, adj=1
    const el: ExcalidrawElementLike = {
      id: "b-hyb-in",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 100, y: 100, width: 200, height: 150 });
  });

  it("counter-scales projected span when factor exceeds clamp", () => {
    // factor = 8 (zoom 15 vs zRef 12), clamps to 4 => adj = 4/8 = 0.5
    // Projected span 200 × 150 -> 100 × 75 (rounded, both >=1 guard).
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],
      [[1, -1], { x: 300, y: 250 }],
    ]);
    const map = makeMap({ project, zoom: 15 });
    const el: ExcalidrawElementLike = {
      id: "b-hyb-clamp",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 100, y: 100, width: 100, height: 75 });
  });
});

describe("_projectElement: polyline + screen", () => {
  it("projects only first coord; preserves el.points", () => {
    const project = makeProjectByLngLat([[[0, 0], { x: 50, y: 60 }]]);
    const map = makeMap({ project, zoom: 12 });
    const storedPoints: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [10, 5],
      [20, -5],
    ];
    const el: ExcalidrawElementLike = {
      id: "l-screen",
      x: 0,
      y: 0,
      points: storedPoints,
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
          zRef: 12,
        },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 50, y: 60 });
    expect(out.points).toBe(storedPoints); // unchanged reference
    expect(project).toHaveBeenCalledTimes(1);
  });
});

describe("_projectElement: polyline + hybrid", () => {
  it("projects all coords; offsets multiplied by clamp(factor)/factor", () => {
    // factor = 8, clamps to 4 => adj = 0.5. Offsets 30,0 -> 15,0 / -30,0 -> -15,0.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
      [[-1, 0], { x: 20, y: 50 }],
    ]);
    const map = makeMap({ project, zoom: 15 });
    const el: ExcalidrawElementLike = {
      id: "l-hyb",
      x: 0,
      y: 0,
      points: [],
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 0],
            [-1, 0],
          ],
          zRef: 12,
        },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [15, 0],
        [-15, 0],
      ],
    });
  });

  it("identity behavior at currentZoom == zRef (factor 1, no clamp adj)", () => {
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
    ]);
    const map = makeMap({ project, zoom: 12 });
    const el: ExcalidrawElementLike = {
      id: "l-hyb-identity",
      x: 0,
      y: 0,
      points: [],
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
          zRef: 12,
        },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [30, 0],
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: default combos must produce IDENTICAL output to pre-T17 impl.
// (Prior CoordinateSync.test.ts asserts these end-to-end; this block is a
// scaleMode-focused belt-and-suspenders.)
// ---------------------------------------------------------------------------

describe("_projectElement: defaults preserved (no regression)", () => {
  it("point + screen — width/height untouched even at non-identity zoom", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 500, y: 400 }),
      zoom: 18, // far from zRef; screen mode must ignore.
    });
    const el: ExcalidrawElementLike = {
      id: "p-screen-default",
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 500, y: 400, width: 8, height: 8 });
  });

  it("bbox + geographic — projected NW/SE span (current behavior)", () => {
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],
      [[1, -1], { x: 300, y: 250 }],
    ]);
    const map = makeMap({ project, zoom: 18 });
    const el: ExcalidrawElementLike = {
      id: "b-geo-default",
      x: 0,
      y: 0,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ x: 100, y: 100, width: 200, height: 150 });
  });

  it("polyline + geographic — points relative to first projected (current behavior)", () => {
    const project = makeProjectByLngLat([
      [[0, 0], { x: 10, y: 20 }],
      [[1, 1], { x: 30, y: 50 }],
    ]);
    const map = makeMap({ project, zoom: 18 });
    const el: ExcalidrawElementLike = {
      id: "l-geo-default",
      x: 0,
      y: 0,
      points: [],
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          zRef: 12,
        },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({
      x: 10,
      y: 20,
      points: [
        [0, 0],
        [20, 30],
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: point + geographic — fontSize scaling and compounding prevention
// ---------------------------------------------------------------------------

describe("_projectElement: point + geographic + fontSize", () => {
  it("scales fontSize by factor alongside width/height", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 13, // factor = 2
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo-fontsize",
      x: 0,
      y: 0,
      width: 100,
      height: 24,
      fontSize: 20,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ width: 200, height: 48, fontSize: 40 });
  });

  it("does not scale fontSize when element has none (non-text element)", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 13,
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo-no-fontsize",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out.fontSize).toBeUndefined();
    expect(out).toMatchObject({ width: 64, height: 64 });
  });
});

describe("_projectElement: point + geographic — no compounding across sequential syncs", () => {
  it("second sync at zoom+2 produces 4x original, not 4x already-scaled", () => {
    const makePointEl = (): ExcalidrawElementLike => ({
      id: "p-no-compound",
      x: 0,
      y: 0,
      width: 10,
      height: 8,
      fontSize: 20,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    });

    // First sync: zoom 13 → factor 2.
    const map13 = makeMap({ project: vi.fn().mockReturnValue({ x: 0, y: 0 }), zoom: 13 });
    const after13 = runSync(map13, makePointEl());
    expect(after13).toMatchObject({ width: 20, height: 16, fontSize: 40 });

    // Second sync using the first result as input: zoom 14 → factor 4.
    // Without the fix this would produce width=80 (20*4) instead of 40 (10*4).
    const map14 = makeMap({ project: vi.fn().mockReturnValue({ x: 0, y: 0 }), zoom: 14 });
    const after14 = runSync(map14, after13);
    expect(after14).toMatchObject({ width: 40, height: 32, fontSize: 80 });
  });
});

// ---------------------------------------------------------------------------
// Regression: strokeWidth scaling and compounding prevention
// ---------------------------------------------------------------------------

describe("_projectElement: strokeWidth scaling", () => {
  it("point + geographic scales strokeWidth by factor", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 13, // factor = 2
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo-stroke",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeWidth: 3,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 6, width: 20, height: 20 });
  });

  it("point + geographic — strokeWidth no compounding across syncs", () => {
    const makeEl = (): ExcalidrawElementLike => ({
      id: "p-sw-no-compound",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeWidth: 3,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    });

    const map13 = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 13,
    });
    const after13 = runSync(map13, makeEl());
    expect(after13).toMatchObject({ strokeWidth: 6 });

    // Second sync at zoom 14 → factor 4. strokeWidth should be 12 (3*4), not 24 (6*4).
    const map14 = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 14,
    });
    const after14 = runSync(map14, after13);
    expect(after14).toMatchObject({ strokeWidth: 12 });
  });

  it("does not scale strokeWidth when element has none", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 13,
    });
    const el: ExcalidrawElementLike = {
      id: "p-geo-no-stroke",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out.strokeWidth).toBeUndefined();
    expect(out).toMatchObject({ width: 64, height: 64 });
  });

  it("polyline + geographic scales strokeWidth by factor", () => {
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
    ]);
    const map = makeMap({ project, zoom: 13 }); // factor = 2
    const el: ExcalidrawElementLike = {
      id: "l-geo-stroke",
      x: 0,
      y: 0,
      strokeWidth: 4,
      points: [],
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
          zRef: 12,
        },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 8 });
  });

  it("bbox + geographic scales strokeWidth by factor", () => {
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],
      [[1, -1], { x: 300, y: 250 }],
    ]);
    const map = makeMap({ project, zoom: 13 }); // factor = 2
    const el: ExcalidrawElementLike = {
      id: "b-geo-stroke",
      x: 0,
      y: 0,
      strokeWidth: 2,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 4 });
  });

  it("point + hybrid scales strokeWidth by clamped factor", () => {
    const map = makeMap({
      project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      zoom: 20, // factor = 256, clamps to 4
    });
    const el: ExcalidrawElementLike = {
      id: "p-hyb-stroke",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeWidth: 3,
      customData: {
        geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 12, width: 40, height: 40 });
  });

  it("polyline + hybrid scales strokeWidth by clamped factor", () => {
    // factor = 8, clamps to 4. Points use adj=0.5, strokeWidth uses 4.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
      [[-1, 0], { x: 20, y: 50 }],
    ]);
    const map = makeMap({ project, zoom: 15 });
    const el: ExcalidrawElementLike = {
      id: "l-hyb-stroke",
      x: 0,
      y: 0,
      strokeWidth: 5,
      points: [],
      customData: {
        geo: {
          kind: "polyline",
          coordinates: [
            [0, 0],
            [1, 0],
            [-1, 0],
          ],
          zRef: 12,
        },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 20 });
  });

  it("bbox + hybrid scales strokeWidth by clamped factor", () => {
    // factor = 8, clamps to 4.
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],
      [[1, -1], { x: 300, y: 250 }],
    ]);
    const map = makeMap({ project, zoom: 15 });
    const el: ExcalidrawElementLike = {
      id: "b-hyb-stroke",
      x: 0,
      y: 0,
      strokeWidth: 2,
      customData: {
        geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      } satisfies GeoCustomData,
    };
    const out = runSync(map, el);
    expect(out).toMatchObject({ strokeWidth: 8 });
  });
});
