import { describe, it, expect } from "vitest";
import { isGeoCustomData, type GeoAnchor } from "./types.js";

describe("GeoCustomData type guard", () => {
  it("accepts a valid point GeoCustomData", () => {
    expect(
      isGeoCustomData({
        geo: { kind: "point", lng: -73.95, lat: 40.68, zRef: 13 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toBe(true);
  });

  it("accepts a valid bbox GeoCustomData", () => {
    expect(
      isGeoCustomData({
        geo: { kind: "bbox", west: -74, south: 40, east: -73, north: 41, zRef: 10 },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toBe(true);
  });

  it("accepts a valid polyline GeoCustomData", () => {
    expect(
      isGeoCustomData({
        geo: {
          kind: "polyline",
          coordinates: [
            [-73.95, 40.68],
            [-73.9, 40.7],
          ] as Array<[number, number]>,
          zRef: 12,
        },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toBe(true);
  });

  it("rejects unknown projection", () => {
    expect(
      isGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "globe",
        schemaVersion: 1,
      }),
    ).toBe(false);
  });

  it("rejects schemaVersion mismatch", () => {
    expect(
      isGeoCustomData({
        geo: { kind: "point", lng: 0, lat: 0, zRef: 0 },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 2,
      }),
    ).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(isGeoCustomData(null)).toBe(false);
    expect(isGeoCustomData("string")).toBe(false);
    expect(isGeoCustomData(42)).toBe(false);
  });

  it("rejects missing geo field", () => {
    expect(
      isGeoCustomData({
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toBe(false);
  });

  it("rejects null geo field", () => {
    expect(
      isGeoCustomData({
        geo: null,
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      }),
    ).toBe(false);
  });
});
