// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the camera fits: a lng/lat box and a data layer.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi } from "vitest";

import { documentFrame, toScene } from "@atlasdraw/geo";

import {
  computeFeatureCollectionBounds,
  fitMapToBox,
  fitMapToContent,
  fitMapToLayer,
} from "./fitMapToContent";

import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";

const makeMap = () => ({ fitBounds: vi.fn() } as unknown as maplibregl.Map);

describe("fitMapToContent", () => {
  const frame = documentFrame(2, 48);
  const rect = (west: number, north: number, east: number, south: number) => {
    const nw = toScene(frame, west, north);
    const se = toScene(frame, east, south);
    return {
      type: "rectangle",
      x: nw.x,
      y: nw.y,
      width: se.x - nw.x,
      height: se.y - nw.y,
    };
  };

  it("returns false and does nothing when the map is not ready", () => {
    expect(fitMapToContent(null, [rect(2, 49, 3, 48)], frame)).toBe(false);
  });

  it("returns false with nothing to frame", () => {
    const map = makeMap();
    expect(fitMapToContent(map, [], frame)).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("fits the union of the elements' lng/lat boxes", () => {
    const map = makeMap();
    expect(
      fitMapToContent(map, [rect(2, 49, 3, 48), rect(-1, 47, 0, 46)], frame),
    ).toBe(true);
    const [[[west, south], [east, north]]] = (
      map.fitBounds as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(west).toBeCloseTo(-1, 9);
    expect(south).toBeCloseTo(46, 9);
    expect(east).toBeCloseTo(3, 9);
    expect(north).toBeCloseTo(49, 9);
  });
});

const fc = (
  features: Array<FeatureCollection["features"][number]>,
): FeatureCollection => ({ type: "FeatureCollection", features });

const feat = (geometry: Geometry | null) =>
  ({
    type: "Feature",
    properties: {},
    geometry,
  } as FeatureCollection["features"][number]);

describe("computeFeatureCollectionBounds", () => {
  it("returns null for an empty collection", () => {
    expect(computeFeatureCollectionBounds(fc([]))).toBeNull();
  });

  it("returns null when every feature has null geometry", () => {
    // These are the same features LayerProvenance counts as dropped. Framing
    // [0,0] here would fly the user to the Gulf of Guinea.
    expect(
      computeFeatureCollectionBounds(fc([feat(null), feat(null)])),
    ).toBeNull();
  });

  it("collapses to a degenerate box for a single point", () => {
    expect(
      computeFeatureCollectionBounds(
        fc([feat({ type: "Point", coordinates: [5, 10] })]),
      ),
    ).toEqual({ west: 5, south: 10, east: 5, north: 10 });
  });

  it("unions across every geometry nesting depth", () => {
    // Point (Position), LineString (Position[]), MultiPolygon (Position[][][]).
    const box = computeFeatureCollectionBounds(
      fc([
        feat({ type: "Point", coordinates: [0, 0] }),
        feat({
          type: "LineString",
          coordinates: [
            [-10, 5],
            [3, 8],
          ],
        }),
        feat({
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [20, -4],
                [22, -4],
                [22, -2],
                [20, -4],
              ],
            ],
          ],
        }),
      ]),
    );
    expect(box).toEqual({ west: -10, south: -4, east: 22, north: 8 });
  });

  it("walks a GeometryCollection", () => {
    expect(
      computeFeatureCollectionBounds(
        fc([
          feat({
            type: "GeometryCollection",
            geometries: [
              { type: "Point", coordinates: [1, 1] },
              { type: "Point", coordinates: [4, 9] },
            ],
          }),
        ]),
      ),
    ).toEqual({ west: 1, south: 1, east: 4, north: 9 });
  });

  it("ignores non-finite coordinates rather than poisoning the box", () => {
    expect(
      computeFeatureCollectionBounds(
        fc([
          feat({ type: "Point", coordinates: [NaN, 3] }),
          feat({ type: "Point", coordinates: [7, 2] }),
        ]),
      ),
    ).toEqual({ west: 7, south: 2, east: 7, north: 2 });
  });
});

describe("fitMapToLayer", () => {
  it("returns false without touching the camera when the map is not ready", () => {
    expect(
      fitMapToLayer(null, fc([feat({ type: "Point", coordinates: [1, 2] })])),
    ).toBe(false);
  });

  it("returns false when the layer has no FeatureCollection registered", () => {
    const map = makeMap();
    expect(fitMapToLayer(map, undefined)).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("returns false — and does NOT move the camera — for unframable geometry", () => {
    const map = makeMap();
    expect(fitMapToLayer(map, fc([feat(null)]))).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("frames the layer with the same padding/zoom as scroll-back-to-content", () => {
    const map = makeMap();
    expect(
      fitMapToLayer(
        map,
        fc([
          feat({ type: "Point", coordinates: [-3, 40] }),
          feat({ type: "Point", coordinates: [12, 52] }),
        ]),
      ),
    ).toBe(true);

    const [bounds, opts] = (
      map.fitBounds as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(bounds).toEqual([
      [-3, 40],
      [12, 52],
    ]);
    // Shared constants: a zoom-to-layer and a zoom-to-content must land the
    // content at the same size, or the two read as different products.
    expect(opts).toEqual({ padding: 64, maxZoom: 16, duration: 600 });
  });
});

describe("fitMapToBox", () => {
  it("jumps with no animation when asked, for a view that opens there", () => {
    const map = makeMap();
    fitMapToBox(
      map,
      { west: 0, south: 0, east: 1, north: 1 },
      { animate: false },
    );
    const [, opts] = (map.fitBounds as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(opts.duration).toBe(0);
  });

  it("returns false without touching the camera when the map is not ready", () => {
    expect(fitMapToBox(null, { west: 0, south: 0, east: 0, north: 0 })).toBe(
      false,
    );
  });

  it("frames the camera on the supplied geographic bounds", () => {
    const map = makeMap();
    const box = { west: -73.99, south: 40.74, east: -73.98, north: 40.75 };
    expect(fitMapToBox(map, box)).toBe(true);

    const [bounds, opts] = (
      map.fitBounds as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(bounds).toEqual([
      [-73.99, 40.74],
      [-73.98, 40.75],
    ]);
    // Must share the same constants as fitMapToLayer.
    expect(opts).toEqual({ padding: 64, maxZoom: 16, duration: 600 });
  });
});

describe("a fit never throws on bounds the map refuses", () => {
  /** A map that refuses a latitude off the globe, as MapLibre's LngLat does. */
  const strictMap = () =>
    ({
      fitBounds: vi.fn((bounds: [[number, number], [number, number]]) => {
        for (const [, lat] of bounds) {
          if (lat > 90 || lat < -90) {
            throw new Error(
              "Invalid LngLat latitude value: must be between -90 and 90",
            );
          }
        }
      }),
    } as unknown as maplibregl.Map);

  it("returns false and leaves the camera for a box off the globe", () => {
    const map = strictMap();
    expect(() =>
      fitMapToBox(map, {
        west: 1_491_681,
        south: 6_891_041,
        east: 1_491_700,
        north: 6_891_100,
      }),
    ).not.toThrow();
    expect(
      fitMapToBox(map, {
        west: 0,
        south: 2_000_000,
        east: 1,
        north: 2_000_001,
      }),
    ).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("returns false for a layer whose positions are metres", () => {
    const map = strictMap();
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [1_491_681, 6_891_041] },
        },
      ],
    };
    expect(fitMapToLayer(map, fc)).toBe(false);
  });

  it("returns false when the map throws for any other reason", () => {
    const map = {
      fitBounds: vi.fn(() => {
        throw new Error("style not loaded");
      }),
    } as unknown as maplibregl.Map;
    expect(fitMapToBox(map, { west: 0, south: 0, east: 1, north: 1 })).toBe(
      false,
    );
  });
});
