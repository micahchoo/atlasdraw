// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// The import pipeline on real files, through the real parsers.

import { describe, expect, it } from "vitest";

import { LIMITS } from "@atlasdraw/protocol";

import { sizeRefusal } from "./importFormat";
import { runImport } from "./importPipeline";

const MB = 1024 * 1024;

describe("sizeRefusal", () => {
  it("takes a data file up to the import cap, which a server save also takes", () => {
    expect(sizeRefusal({ name: "a.geojson", size: LIMITS.import })).toBeNull();
    expect(LIMITS.import).toBeLessThanOrEqual(LIMITS.upload);
  });

  it("refuses a data file over the import cap, and names the cap", () => {
    const why = sizeRefusal({ name: "a.geojson", size: LIMITS.import + 1 });
    expect(why).toContain(`${LIMITS.import / MB} MB`);
  });

  it("takes a larger GeoTIFF: it is resampled, so the layer stays small", () => {
    expect(
      sizeRefusal({ name: "scene.tif", size: LIMITS.import + MB }),
    ).toBeNull();
    expect(
      sizeRefusal({ name: "scene.tif", size: LIMITS.importRaster + 1 }),
    ).toContain(`${LIMITS.importRaster / MB} MB`);
  });
});

const geojson = (name: string, value: unknown) =>
  new File([JSON.stringify(value)], name, { type: "application/geo+json" });

const pointFeature = (coordinates: unknown) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates },
});

describe("runImport: data the map can draw", () => {
  it("splits mixed GeoJSON into one layer per kind, as KML and GPX do", async () => {
    const outcome = await runImport(
      geojson("mixed.geojson", {
        type: "FeatureCollection",
        features: [
          pointFeature([13.4, 52.5]),
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [13, 52],
                  [14, 52],
                  [14, 53],
                  [13, 52],
                ],
              ],
            },
          },
        ],
      }),
      "geojson",
    );
    expect(outcome.ok && outcome.kind === "vector").toBe(true);
    if (!outcome.ok || outcome.kind !== "vector") {
      return;
    }
    expect(outcome.layers.map((l) => l.label)).toEqual([
      "mixed.geojson — areas",
      "mixed.geojson — points",
    ]);
  });

  it("refuses GeoJSON in metres with no declared system, and names the fix", async () => {
    const outcome = await runImport(
      geojson("proj.geojson", {
        type: "FeatureCollection",
        features: [pointFeature([1491681.18, 6891041.72])],
      }),
      "geojson",
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/proj\.geojson.*EPSG:4326/);
  });

  it("reprojects GeoJSON that declares EPSG:3857, and says it did", async () => {
    const outcome = await runImport(
      geojson("merc.geojson", {
        type: "FeatureCollection",
        crs: {
          type: "name",
          properties: { name: "urn:ogc:def:crs:EPSG::3857" },
        },
        features: [pointFeature([1491681.18, 6891041.72])],
      }),
      "geojson",
    );
    expect(outcome.ok && outcome.kind === "vector").toBe(true);
    if (!outcome.ok || outcome.kind !== "vector") {
      return;
    }
    expect(outcome.reprojectedFrom).toBe("EPSG:3857");
    const [lng, lat] = (
      outcome.layers[0]!.fc.features[0]!.geometry as { coordinates: number[] }
    ).coordinates;
    expect(lng).toBeCloseTo(13.4, 3);
    expect(lat).toBeCloseTo(52.5, 3);
  });

  it("drops and counts features with no coordinates", async () => {
    const outcome = await runImport(
      geojson("some.geojson", {
        type: "FeatureCollection",
        features: [
          pointFeature([13.4, 52.5]),
          { type: "Feature", properties: {}, geometry: { type: "Point" } },
        ],
      }),
      "geojson",
    );
    expect(outcome.ok && outcome.kind === "vector").toBe(true);
    if (!outcome.ok || outcome.kind !== "vector") {
      return;
    }
    expect(outcome.layers).toHaveLength(1);
    expect(outcome.layers[0]!.fc.features).toHaveLength(1);
    expect(outcome.layers[0]!.droppedCount).toBe(1);
  });

  it("refuses a file with no feature the map can draw, and adds no empty layer", async () => {
    const outcome = await runImport(
      geojson("empty.geojson", {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: null }],
      }),
      "geojson",
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(
      /empty\.geojson.*no feature/,
    );
  });

  it("refuses a CSV with x and y in metres, and names the fix", async () => {
    const outcome = await runImport(
      new File(["name,x,y\nA,500000,4649776\n"], "utm.csv", {
        type: "text/csv",
      }),
      "csv",
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/metres.*EPSG:4326/);
  });
});
