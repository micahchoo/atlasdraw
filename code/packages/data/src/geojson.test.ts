// SPDX-License-Identifier: MIT
// packages/data/src/geojson.test.ts
// Colocated tests for geojson parser/writer.

import { describe, expect, it } from "vitest";

import {
  GeoJSONParseError,
  parse,
  requireHomogeneousGeometry,
  geometryKindOf,
  write,
} from "./geojson.js";

import type { FeatureCollection } from "geojson";

const validFC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.4, 37.8] },
      properties: { name: "SF" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.9, 40.7] },
      properties: { name: "NYC" },
    },
  ],
};

const blobFromJSON = (value: unknown): Blob =>
  new Blob([JSON.stringify(value)], { type: "application/json" });

describe("geojson.parse", () => {
  it("accepts valid FeatureCollection", async () => {
    const fc = await parse(blobFromJSON(validFC));
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.length).toBe(2);
    expect(fc.features[0]?.properties).toEqual({ name: "SF" });
  });

  it("rejects malformed JSON with GeoJSONParseError mentioning JSON", async () => {
    const blob = new Blob(["{not valid json,"], { type: "application/json" });
    await expect(parse(blob)).rejects.toThrowError(GeoJSONParseError);
    await expect(parse(blob)).rejects.toThrow(/JSON/);
  });

  it("rejects bare Feature with message mentioning FeatureCollection", async () => {
    const bareFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    };
    try {
      await parse(blobFromJSON(bareFeature));
      throw new Error("expected parse to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(GeoJSONParseError);
      expect((err as Error).message).toMatch(/FeatureCollection/);
    }
  });

  it("rejects feature missing geometry with field=geometry", async () => {
    const bad = {
      type: "FeatureCollection",
      features: [
        // intentionally missing `geometry`
        { type: "Feature", properties: { name: "no-geo" } },
      ],
    };
    try {
      await parse(blobFromJSON(bad));
      throw new Error("expected parse to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(GeoJSONParseError);
      const e = err as GeoJSONParseError;
      expect(e.field).toBe("geometry");
      expect(e.message).toMatch(/geometry/);
    }
  });
});

describe("geojson.write", () => {
  it("returns a Blob with application/json MIME", async () => {
    const blob = await write(validFC);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json");
  });

  it("round-trips: parse(write(fc)) === fc structurally", async () => {
    const blob = await write(validFC);
    const round = await parse(blob);
    expect(round).toEqual(validFC);
  });
});

describe("requireHomogeneousGeometry (T24 / atlasdraw-4142)", () => {
  const featureOf = (geometry: unknown) =>
    ({ type: "Feature", geometry, properties: {} } as unknown);

  const fcOf = (...geoms: unknown[]): FeatureCollection =>
    ({
      type: "FeatureCollection",
      features: geoms.map(featureOf),
    } as FeatureCollection);

  it("accepts an all-Polygon FC", () => {
    const fc = fcOf(
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
      },
    );
    expect(() => requireHomogeneousGeometry(fc)).not.toThrow();
  });

  it("accepts an all-LineString FC", () => {
    const fc = fcOf(
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        type: "MultiLineString",
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      },
    );
    expect(() => requireHomogeneousGeometry(fc)).not.toThrow();
  });

  it("accepts an all-Point FC", () => {
    const fc = fcOf(
      { type: "Point", coordinates: [0, 0] },
      {
        type: "MultiPoint",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    );
    expect(() => requireHomogeneousGeometry(fc)).not.toThrow();
  });

  it("accepts an empty FC", () => {
    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    expect(() => requireHomogeneousGeometry(fc)).not.toThrow();
  });

  it("ignores null geometries (RFC-legal, non-rendering)", () => {
    const fc = fcOf(
      null,
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      null,
    );
    expect(() => requireHomogeneousGeometry(fc)).not.toThrow();
  });

  it("rejects mixed Polygon + LineString", () => {
    const fc = fcOf(
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    );
    expect(() => requireHomogeneousGeometry(fc)).toThrow(GeoJSONParseError);
    expect(() => requireHomogeneousGeometry(fc)).toThrow(
      /mixed geometry kinds/,
    );
    expect(() => requireHomogeneousGeometry(fc)).toThrow(/fill/);
    expect(() => requireHomogeneousGeometry(fc)).toThrow(/line/);
  });

  it("rejects mixed Point + Polygon", () => {
    const fc = fcOf(
      { type: "Point", coordinates: [0, 0] },
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    );
    expect(() => requireHomogeneousGeometry(fc)).toThrow(GeoJSONParseError);
    expect(() => requireHomogeneousGeometry(fc)).toThrow(
      /mixed geometry kinds/,
    );
  });

  it("rejects GeometryCollection as unsupported", () => {
    const fc = fcOf({
      type: "GeometryCollection",
      geometries: [{ type: "Point", coordinates: [0, 0] }],
    });
    expect(() => requireHomogeneousGeometry(fc)).toThrow(GeoJSONParseError);
    expect(() => requireHomogeneousGeometry(fc)).toThrow(
      /not supported by Atlas/,
    );
  });

  it("rejects unknown geometry type", () => {
    const fc = fcOf({ type: "Hyperbola", coordinates: [] });
    expect(() => requireHomogeneousGeometry(fc)).toThrow(GeoJSONParseError);
  });

  it("error names the offending field path for unsupported geometry", () => {
    const fc = fcOf(
      { type: "Point", coordinates: [0, 0] },
      { type: "GeometryCollection", geometries: [] },
    );
    try {
      requireHomogeneousGeometry(fc);
      throw new Error("expected requireHomogeneousGeometry to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GeoJSONParseError);
      expect((e as GeoJSONParseError).field).toBe("features[1].geometry.type");
    }
  });
});

describe("geometryKindOf", () => {
  const fc = (
    geometries: Array<FeatureCollection["features"][number]["geometry"]>,
  ) =>
    ({
      type: "FeatureCollection",
      features: geometries.map((geometry) => ({
        type: "Feature",
        properties: {},
        geometry,
      })),
    } as FeatureCollection);

  it("skips a leading null geometry", () => {
    expect(
      geometryKindOf(
        fc([
          null as unknown as FeatureCollection["features"][number]["geometry"],
          {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        ]),
      ),
    ).toBe("fill");
  });

  it("names lines and points", () => {
    expect(
      geometryKindOf(
        fc([
          {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        ]),
      ),
    ).toBe("line");
    expect(geometryKindOf(fc([{ type: "Point", coordinates: [0, 0] }]))).toBe(
      "circle",
    );
  });

  it("gives circle for an empty collection", () => {
    expect(geometryKindOf(fc([]))).toBe("circle");
  });
});
