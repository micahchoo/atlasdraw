import { describe, it, expect } from "vitest";

import { computeSceneBounds } from "./bounds.js";

import type { ExcalidrawElementLike } from "./CoordinateSync.js";
import type { GeoCustomData } from "./types.js";

function geoEl(id: string, geo: GeoCustomData["geo"]): ExcalidrawElementLike {
  return {
    id,
    x: 0,
    y: 0,
    customData: {
      geo,
      scaleMode: "geographic",
      projection: "mercator",
      schemaVersion: 1,
      // eslint-disable-next-line prettier/prettier
    } satisfies GeoCustomData,
  };
}

describe("computeSceneBounds", () => {
  it("returns null for an empty element list", () => {
    expect(computeSceneBounds([])).toBeNull();
  });

  it("returns null when no element has geo customData", () => {
    const els: ExcalidrawElementLike[] = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 10, customData: { unrelated: true } },
    ];
    expect(computeSceneBounds(els)).toBeNull();
  });

  it("returns a degenerate box for a single point", () => {
    const els = [
      geoEl("p", { kind: "point", lng: -73.99, lat: 40.74, zRef: 12 }),
    ];
    expect(computeSceneBounds(els)).toEqual({
      west: -73.99,
      east: -73.99,
      south: 40.74,
      north: 40.74,
    });
  });

  it("unions a point, a bbox, and a polyline into a single box", () => {
    const els: ExcalidrawElementLike[] = [
      geoEl("pt", { kind: "point", lng: -10, lat: 5, zRef: 12 }),
      geoEl("bb", {
        kind: "bbox",
        west: -5,
        south: 0,
        east: 5,
        north: 10,
        zRef: 12,
      }),
      geoEl("pl", {
        kind: "polyline",
        coordinates: [
          [-20, -3],
          [15, 12],
        ],
        zRef: 12,
      }),
      // Non-geo element should be ignored.
      { id: "ignored", x: 100, y: 100 },
    ];
    expect(computeSceneBounds(els)).toEqual({
      west: -20,
      east: 15,
      south: -3,
      north: 12,
    });
  });

  it("ignores polyline elements with empty coordinate arrays", () => {
    const els = [
      geoEl("pl", { kind: "polyline", coordinates: [], zRef: 12 }),
      geoEl("pt", { kind: "point", lng: 1, lat: 2, zRef: 12 }),
    ];
    expect(computeSceneBounds(els)).toEqual({
      west: 1,
      east: 1,
      south: 2,
      north: 2,
    });
  });
});
