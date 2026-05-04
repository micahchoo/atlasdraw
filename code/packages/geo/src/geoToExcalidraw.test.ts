import { describe, it, expect } from "vitest";
import {
  geoToExcalidraw,
  type GeoJSONFeatureLike,
} from "./geoToExcalidraw.js";

describe("geoToExcalidraw", () => {
  it("converts a Point feature to a screen-mode rectangle skeleton", () => {
    const feature: GeoJSONFeatureLike = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.9857, 40.7484] },
    };
    const el = geoToExcalidraw(feature);

    expect(el.type).toBe("rectangle");
    expect(el.customData.scaleMode).toBe("screen");
    expect(el.customData.projection).toBe("mercator");
    expect(el.customData.schemaVersion).toBe(1);
    expect(el.customData.geo.kind).toBe("point");
    if (el.customData.geo.kind === "point") {
      expect(el.customData.geo.lng).toBe(-73.9857);
      expect(el.customData.geo.lat).toBe(40.7484);
      expect(el.customData.geo.zRef).toBe(12); // default
    }
  });

  it("converts a Polygon feature to a geographic-mode bbox rectangle", () => {
    const feature: GeoJSONFeatureLike = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74, 40],
            [-73, 40],
            [-73, 41],
            [-74, 41],
            [-74, 40],
          ],
        ],
      },
    };
    const el = geoToExcalidraw(feature, { zRef: 10 });

    expect(el.type).toBe("rectangle");
    expect(el.customData.scaleMode).toBe("geographic");
    expect(el.customData.geo.kind).toBe("bbox");
    if (el.customData.geo.kind === "bbox") {
      expect(el.customData.geo.west).toBe(-74);
      expect(el.customData.geo.east).toBe(-73);
      expect(el.customData.geo.south).toBe(40);
      expect(el.customData.geo.north).toBe(41);
      expect(el.customData.geo.zRef).toBe(10);
    }
  });

  it("converts a LineString feature to a hybrid-mode line with polyline anchor", () => {
    const feature: GeoJSONFeatureLike = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-74, 40],
          [-73.5, 40.5],
          [-73, 41],
        ],
      },
    };
    const el = geoToExcalidraw(feature);

    expect(el.type).toBe("line");
    expect(el.customData.scaleMode).toBe("hybrid");
    expect(el.customData.geo.kind).toBe("polyline");
    if (el.customData.geo.kind === "polyline") {
      expect(el.customData.geo.coordinates).toEqual([
        [-74, 40],
        [-73.5, 40.5],
        [-73, 41],
      ]);
    }
    // Initial points array is empty — CoordinateSync fills it on sync.
    expect(el.points).toEqual([]);
  });

  it("throws on unsupported geometry type", () => {
    const feature: GeoJSONFeatureLike = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
    };
    expect(() => geoToExcalidraw(feature)).toThrow(
      /unsupported geometry type: MultiPolygon/,
    );
  });

  it("does not alias the caller's coordinate array into customData (defensive copy)", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    const feature: GeoJSONFeatureLike = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
    };
    const el = geoToExcalidraw(feature);
    coords.push([2, 2]);
    if (el.customData.geo.kind === "polyline") {
      expect(el.customData.geo.coordinates).toHaveLength(2);
    }
  });
});
