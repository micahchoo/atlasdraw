// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { CoordinateError, prepareForMap } from "./coordinates.js";

import type { Feature, FeatureCollection, Geometry } from "geojson";

// RFC 7946 allows a null geometry; the types' Feature does not by default.
const feature = (geometry: Geometry | null, n = 0): Feature =>
  ({
    type: "Feature",
    properties: { n },
    geometry,
  } as Feature);

const fc = (
  features: Feature[],
  crs?: string,
): FeatureCollection & { crs?: unknown } => ({
  type: "FeatureCollection",
  features,
  ...(crs ? { crs: { type: "name", properties: { name: crs } } } : {}),
});

const point = (x: number, y: number) =>
  feature({ type: "Point", coordinates: [x, y] });

/** Web Mercator metres of a longitude and latitude. */
function mercator(lng: number, lat: number): [number, number] {
  const R = 6378137;
  return [
    (lng * Math.PI * R) / 180,
    R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  ];
}

describe("prepareForMap", () => {
  it("passes longitude and latitude through unchanged, as one part", () => {
    const input = fc([point(13.4, 52.5), point(2.35, 48.85)]);
    const out = prepareForMap(input);
    expect(out.parts).toEqual([{ kind: "circle", fc: input }]);
    expect(out.parts[0]!.fc).toBe(input);
    expect(out.dropped).toBe(0);
    expect(out.reprojectedFrom).toBeNull();
  });

  it("reads a file that declares CRS84 or EPSG:4326 as it is", () => {
    for (const crs of [
      "urn:ogc:def:crs:OGC:1.3:CRS84",
      "urn:ogc:def:crs:EPSG::4326",
      "EPSG:4326",
    ]) {
      expect(prepareForMap(fc([point(13.4, 52.5)], crs)).dropped).toBe(0);
    }
  });

  it("reprojects a file that declares Web Mercator metres, and says so", () => {
    const [x, y] = mercator(13.4, 52.5);
    const out = prepareForMap(fc([point(x, y)], "urn:ogc:def:crs:EPSG::3857"));
    expect(out.reprojectedFrom).toBe("EPSG:3857");
    const g = out.parts[0]!.fc.features[0]!.geometry as {
      coordinates: number[];
    };
    expect(g.coordinates[0]).toBeCloseTo(13.4, 9);
    expect(g.coordinates[1]).toBeCloseTo(52.5, 9);
  });

  it("refuses metres with no declared system, and names the fix", () => {
    const [x, y] = mercator(13.4, 52.5);
    expect(() => prepareForMap(fc([point(x, y)]))).toThrow(CoordinateError);
    expect(() => prepareForMap(fc([point(x, y)]))).toThrow(/EPSG:4326/);
  });

  it("refuses a projected system it cannot convert, and names it", () => {
    let error: unknown;
    try {
      prepareForMap(
        fc([point(500000, 4649776)], "urn:ogc:def:crs:EPSG::32633"),
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CoordinateError);
    expect((error as Error).message).toMatch(/EPSG:32633.*EPSG:4326/);
  });

  it("drops and counts features with no coordinates or coordinates off the globe", () => {
    const out = prepareForMap(
      fc([
        point(13.4, 52.5),
        feature({ type: "Point" } as unknown as Geometry, 1),
        feature({ type: "Point", coordinates: ["a", "b"] } as never, 2),
        point(13.4, 152.5),
      ]),
    );
    expect(out.dropped).toBe(3);
    expect(out.parts[0]!.fc.features).toHaveLength(1);
  });

  it("splits mixed geometry into one part per kind: areas, lines, points", () => {
    const out = prepareForMap(
      fc([
        point(1, 1),
        feature({
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        }),
        feature({
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        }),
      ]),
    );
    expect(out.parts.map((p) => p.kind)).toEqual(["fill", "line", "circle"]);
  });

  it("counts a feature with no geometry as dropped: the map cannot draw it", () => {
    const out = prepareForMap(fc([point(1, 1), feature(null)]));
    expect(out.dropped).toBe(1);
    expect(out.parts[0]!.fc.features).toHaveLength(1);
  });
});
