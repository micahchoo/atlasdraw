// SPDX-License-Identifier: AGPL-3.0-only
// Tests for fitMapToContent — the "scroll back to content" map-reframe.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi } from "vitest";

import { fitMapToContent } from "./fitMapToContent";

import type maplibregl from "maplibre-gl";

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
