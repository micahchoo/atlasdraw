// SPDX-License-Identifier: AGPL-3.0-only
// Tests for fitMapToContent — the "scroll back to content" map-reframe.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi } from "vitest";

import {
  computeFeatureCollectionBounds,
  fitMapToContent,
  fitMapToLayer,
} from "./fitMapToContent";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";

const makeMap = () => ({ fitBounds: vi.fn() } as unknown as maplibregl.Map);

/** Minimal geo-anchored element (satisfies ExcalidrawElementLike + the guard). */
const geoEl = (id: string, geo: unknown) => ({
  id,
  x: 0,
  y: 0,
  customData: {
    geo,
    scaleMode: "geographic",
    projection: "mercator",
    schemaVersion: 1,
  },
});
const pt = (id: string, lng: number, lat: number) =>
  geoEl(id, { kind: "point", lng, lat, zRef: 4 });

// computeSceneBounds takes a minimal element shape; our fixtures match it.
const els = (list: unknown[]) => list as Parameters<typeof fitMapToContent>[1];

describe("fitMapToContent", () => {
  it("returns false and does nothing when the map is not ready", () => {
    expect(fitMapToContent(null, els([pt("a", 2, 48)]))).toBe(false);
  });

  it("returns false when there is no geo-anchored content", () => {
    const map = makeMap();
    expect(fitMapToContent(map, els([]))).toBe(false);
    expect(
      fitMapToContent(
        map,
        els([{ id: "x", x: 0, y: 0, customData: undefined }]),
      ),
    ).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("fits the map to the union bounds of geo elements ([[minLng,minLat],[maxLng,maxLat]])", () => {
    const map = makeMap();
    const result = fitMapToContent(
      map,
      els([
        pt("paris", 2.35, 48.85),
        pt("london", -0.13, 51.5),
        pt("berlin", 13.4, 52.5),
      ]),
    );
    expect(result).toBe(true);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, opts] = (
      map.fitBounds as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(bounds).toEqual([
      [-0.13, 48.85],
      [13.4, 52.5],
    ]);
    expect(opts).toMatchObject({
      padding: expect.any(Number),
      maxZoom: expect.any(Number),
    });
  });

  it("includes bbox and polyline extents in the union", () => {
    const map = makeMap();
    fitMapToContent(
      map,
      els([
        geoEl("box", {
          kind: "bbox",
          west: -5,
          south: 30,
          east: 10,
          north: 40,
          zRef: 4,
        }),
        geoEl("line", {
          kind: "polyline",
          coordinates: [
            [20, 55],
            [25, 60],
          ],
          zRef: 4,
        }),
      ]),
    );
    const [bounds] = (map.fitBounds as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(bounds).toEqual([
      [-5, 30],
      [25, 60],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sheet-panel step 4 — "zoom to layer", the universal gesture after an import.
// ---------------------------------------------------------------------------

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
