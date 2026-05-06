import { describe, it, expect } from "vitest";
import {
  parseGeoCustomData,
  migrate,
  GeoCustomDataParseError,
} from "./parseGeoCustomData.js";
import type { GeoCustomData } from "./types.js";

const validPoint: GeoCustomData = {
  geo: { kind: "point", lng: -73.95, lat: 40.68, zRef: 13 },
  scaleMode: "screen",
  projection: "mercator",
  schemaVersion: 1,
};

const validBbox: GeoCustomData = {
  geo: { kind: "bbox", west: -74, south: 40, east: -73, north: 41, zRef: 10 },
  scaleMode: "geographic",
  projection: "mercator",
  schemaVersion: 1,
};

const validPolyline: GeoCustomData = {
  geo: {
    kind: "polyline",
    coordinates: [
      [-73.95, 40.68],
      [-73.9, 40.7],
    ],
    zRef: 12,
  },
  scaleMode: "hybrid",
  projection: "mercator",
  schemaVersion: 1,
};

describe("parseGeoCustomData", () => {
  it("returns a valid point GeoCustomData unchanged in shape", () => {
    const result = parseGeoCustomData(validPoint);
    expect(result).toEqual(validPoint);
  });

  it("returns a valid bbox GeoCustomData unchanged in shape", () => {
    const result = parseGeoCustomData(validBbox);
    expect(result).toEqual(validBbox);
  });

  it("returns a valid polyline GeoCustomData unchanged in shape", () => {
    const result = parseGeoCustomData(validPolyline);
    expect(result).toEqual(validPolyline);
  });

  it("throws GeoCustomDataParseError when schemaVersion is missing", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
      }),
    ).toThrow(/schemaVersion/);
  });

  it("routes schemaVersion 0 through migrate, which throws unknown version", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 0,
      }),
    ).toThrow(/unknown version/);
  });

  it("throws when geo.kind is an unknown string", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "octahedron", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/kind/);
  });

  it("throws when geo.kind is missing entirely", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/kind/);
  });

  it("throws when point.lng is a string instead of a number", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: "-73.95", lat: 40.68, zRef: 13 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(GeoCustomDataParseError);
  });

  it("throws when bbox west is greater than east", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "bbox", west: 10, south: 0, east: -10, north: 5, zRef: 10 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/west.*east/);
  });

  it("throws when bbox south is greater than north", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "bbox", west: -10, south: 5, east: 10, north: 0, zRef: 10 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/south.*north/);
  });

  it("throws when projection is not mercator", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "globe",
        schemaVersion: 1,
      }),
    ).toThrow(/projection/);
  });

  it("throws when scaleMode is not one of the allowed values", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "elastic",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/scaleMode/);
  });

  it("throws when polyline has fewer than 2 coordinates", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "polyline", coordinates: [[0, 0]], zRef: 12 },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/at least 2/);
  });

  it("throws on non-finite numbers (NaN)", () => {
    expect(() =>
      parseGeoCustomData({
        geo: { kind: "point", lng: NaN, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toThrow(/lng/);
  });

  it("throws on null and primitives", () => {
    expect(() => parseGeoCustomData(null)).toThrow(GeoCustomDataParseError);
    expect(() => parseGeoCustomData("string")).toThrow(GeoCustomDataParseError);
    expect(() => parseGeoCustomData(42)).toThrow(GeoCustomDataParseError);
  });
});

describe("migrate", () => {
  it("returns a valid v1 value unchanged when fromVersion is 1", () => {
    expect(migrate(validPoint, 1)).toEqual(validPoint);
  });

  it("validates the value even when fromVersion is 1", () => {
    expect(() =>
      migrate(
        {
          geo: { kind: "point", lng: "bad", lat: 0, zRef: 0 },
          scaleMode: "screen",
          projection: "mercator",
          schemaVersion: 1,
        },
        1,
      ),
    ).toThrow(GeoCustomDataParseError);
  });

  it("throws unknown version for fromVersion 99", () => {
    expect(() => migrate(validPoint, 99)).toThrow(/unknown version/);
  });

  it("throws unknown version for fromVersion 0", () => {
    expect(() => migrate(validPoint, 0)).toThrow(/unknown version/);
  });
});

describe("parseGeoCustomData zRef bounds (T26 / atlasdraw-02f6)", () => {
  // zRef is a MapLibre zoom level. Allowed: finite, [0, MAX_ZREF=24], fractional
  // values OK (MapLibre uses continuous zoom). Rejected: NaN, ±Infinity,
  // negative, > MAX_ZREF.
  const variantsForKind = (zRef: unknown) => [
    {
      ...validPoint,
      geo: { ...validPoint.geo, zRef } as unknown,
    },
    {
      ...validBbox,
      geo: { ...validBbox.geo, zRef } as unknown,
    },
    {
      ...validPolyline,
      geo: { ...validPolyline.geo, zRef } as unknown,
    },
  ];

  it("accepts zRef = 0 (lower bound)", () => {
    for (const v of variantsForKind(0)) {
      expect(() => parseGeoCustomData(v)).not.toThrow();
    }
  });

  it("accepts zRef = 24 (upper bound)", () => {
    for (const v of variantsForKind(24)) {
      expect(() => parseGeoCustomData(v)).not.toThrow();
    }
  });

  it("accepts fractional zRef (continuous zoom)", () => {
    for (const v of variantsForKind(13.7)) {
      expect(() => parseGeoCustomData(v)).not.toThrow();
    }
  });

  it("rejects negative zRef", () => {
    for (const v of variantsForKind(-1)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
      expect(() => parseGeoCustomData(v)).toThrow(/geo\.zRef.*\[0, 24\]/);
    }
  });

  it("rejects zRef > MAX_ZREF (24.0001)", () => {
    for (const v of variantsForKind(24.0001)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
      expect(() => parseGeoCustomData(v)).toThrow(/geo\.zRef.*\[0, 24\]/);
    }
  });

  it("rejects NaN zRef", () => {
    for (const v of variantsForKind(Number.NaN)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
    }
  });

  it("rejects Infinity zRef", () => {
    for (const v of variantsForKind(Number.POSITIVE_INFINITY)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
    }
    for (const v of variantsForKind(Number.NEGATIVE_INFINITY)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
    }
  });

  it("rejects non-number zRef", () => {
    for (const v of variantsForKind("13" as unknown)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
    }
    for (const v of variantsForKind(null as unknown)) {
      expect(() => parseGeoCustomData(v)).toThrow(GeoCustomDataParseError);
    }
  });
});
