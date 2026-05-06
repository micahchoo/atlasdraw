// packages/tools/src/convert.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 2b Task T14 — annotationToFeatureCollection unit tests.
//
// Coverage matrix:
//   1.  rectangle / bbox          → Polygon w/ closed 5-element ring
//   2.  ellipse / point + radius  → Polygon via @turf/circle (ring length > 4)
//   2b. ellipse / bbox            → Polygon approximating ellipse (ring > 5 pts)
//   3.  polygon (open polyline)   → Polygon w/ auto-closed 4-element ring
//   4.  freedraw (closed polyline)→ Polygon w/ NO double-closure
//   4b. freedraw (open polyline)  → LineString (pen stroke, not closed area)
//   5.  line / polyline           → LineString
//   5b. arrow / polyline          → LineString (was: throws — now supported)
//   6.  diamond / bbox            → Polygon with 4 midpoint vertices
//   7.  text                      → throws UnsupportedConvertElementError
//   8.  unknown type "hexagon"    → throws UnsupportedConvertElementError
//   9.  ellipse missing radius    → throws (clear message)

import { describe, it, expect } from "vitest";
import {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "./convert.js";
import type { GeoCustomData } from "@atlasdraw/geo";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function geoBbox(): GeoCustomData {
  return {
    geo: {
      kind: "bbox",
      west: -10,
      south: -5,
      east: 10,
      north: 5,
      zRef: 4,
    },
    scaleMode: "geographic",
    projection: "mercator",
    schemaVersion: 1,
  };
}

function geoPoint(): GeoCustomData {
  return {
    geo: { kind: "point", lng: 0, lat: 0, zRef: 4 },
    scaleMode: "geographic",
    projection: "mercator",
    schemaVersion: 1,
  };
}

function geoPolyline(coords: Array<[number, number]>): GeoCustomData {
  return {
    geo: { kind: "polyline", coordinates: coords, zRef: 4 },
    scaleMode: "geographic",
    projection: "mercator",
    schemaVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("annotationToFeatureCollection", () => {
  it("rectangle with bbox → Polygon with 5-element closed ring", () => {
    const el: ConvertibleElement = {
      id: "el1",
      type: "rectangle",
      customData: geoBbox(),
    };
    const fc = annotationToFeatureCollection(el);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("Polygon");
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]); // closed
    expect(ring[0]).toEqual([-10, -5]);
    expect(ring[2]).toEqual([10, 5]);
  });

  it("ellipse with point + _data.radiusKm → Polygon via turf/circle (ring > 4)", () => {
    const el: ConvertibleElement = {
      id: "el2",
      type: "ellipse",
      customData: { ...geoPoint(), _data: { radiusKm: 5 } },
    };
    const fc = annotationToFeatureCollection(el);
    expect(fc.features).toHaveLength(1);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("Polygon");
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    // turf/circle with steps:64 produces 65 positions (closed ring).
    expect(ring.length).toBeGreaterThan(4);
  });

  it("ellipse with top-level customData.radiusKm fallback → Polygon", () => {
    const el: ConvertibleElement = {
      id: "el2b",
      type: "ellipse",
      customData: { ...geoPoint(), radiusKm: 3 },
    };
    const fc = annotationToFeatureCollection(el);
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("polygon with open polyline (3 distinct points) → Polygon with 4-element auto-closed ring", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ];
    const el: ConvertibleElement = {
      id: "el3",
      type: "polygon",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("Polygon");
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring[0]).toEqual([0, 0]);
  });

  it("freedraw with already-closed polyline → Polygon ring NOT double-closed", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [1, 2],
      [0, 0], // already closed
    ];
    const el: ConvertibleElement = {
      id: "el4",
      type: "freedraw",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    // Should be exactly 4 elements (not 5 — no extra closure appended).
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("line with polyline → LineString with coords as-is", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [5, 5],
      [10, 0],
    ];
    const el: ConvertibleElement = {
      id: "el5",
      type: "line",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("LineString");
    if (g.type !== "LineString") throw new Error("unreachable");
    expect(g.coordinates).toEqual(coords);
  });

  it("polyline (alias) with polyline geo → LineString", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    const el: ConvertibleElement = {
      id: "el5b",
      type: "polyline",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    expect(fc.features[0].geometry.type).toBe("LineString");
  });

  it("text element → throws UnsupportedConvertElementError mentioning 'text'", () => {
    const el: ConvertibleElement = {
      id: "el6",
      type: "text",
      customData: geoPoint(),
    };
    expect(() => annotationToFeatureCollection(el)).toThrow(
      UnsupportedConvertElementError,
    );
    try {
      annotationToFeatureCollection(el);
    } catch (err) {
      expect((err as Error).message).toContain("text");
    }
  });

  it("arrow with polyline geo → LineString with coords as-is", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [5, 5],
      [10, 3],
    ];
    const el: ConvertibleElement = {
      id: "el7",
      type: "arrow",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("LineString");
    if (g.type !== "LineString") throw new Error("unreachable");
    expect(g.coordinates).toEqual(coords);
  });

  it("diamond with bbox → Polygon with 4 midpoint vertices (diamond shape)", () => {
    // geoBbox(): west:-10, south:-5, east:10, north:5 → midX:0, midY:0
    const el: ConvertibleElement = {
      id: "el-diamond",
      type: "diamond",
      customData: geoBbox(),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("Polygon");
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    expect(ring).toHaveLength(5); // 4 vertices + close
    expect(ring[0]).toEqual([0, 5]);    // North
    expect(ring[1]).toEqual([10, 0]);   // East
    expect(ring[2]).toEqual([0, -5]);   // South
    expect(ring[3]).toEqual([-10, 0]);  // West
    expect(ring[4]).toEqual(ring[0]);   // closed
  });

  it("ellipse with bbox → Polygon approximating ellipse (ring > 5 pts, touches bbox extents)", () => {
    // geoBbox(): west:-10, south:-5, east:10, north:5 → cx:0, cy:0, rx:10, ry:5
    const el: ConvertibleElement = {
      id: "el-ellipse-bbox",
      type: "ellipse",
      customData: geoBbox(),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("Polygon");
    if (g.type !== "Polygon") throw new Error("unreachable");
    const ring = g.coordinates[0];
    expect(ring.length).toBeGreaterThan(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    const maxLng = Math.max(...ring.map((p) => p[0]));
    const maxLat = Math.max(...ring.map((p) => p[1]));
    expect(maxLng).toBeCloseTo(10, 1);
    expect(maxLat).toBeCloseTo(5, 1);
  });

  it("freedraw with open polyline → LineString (pen stroke, not auto-closed polygon)", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [3, 1],
      [5, 3],
    ];
    const el: ConvertibleElement = {
      id: "el-freedraw-open",
      type: "freedraw",
      customData: geoPolyline(coords),
    };
    const fc = annotationToFeatureCollection(el);
    const g = fc.features[0].geometry;
    expect(g.type).toBe("LineString");
    if (g.type !== "LineString") throw new Error("unreachable");
    expect(g.coordinates).toEqual(coords);
  });

  it("unknown type 'hexagon' with valid geo → throws UnsupportedConvertElementError", () => {
    const el: ConvertibleElement = {
      id: "el8",
      type: "hexagon",
      customData: geoPoint(),
    };
    expect(() => annotationToFeatureCollection(el)).toThrow(
      UnsupportedConvertElementError,
    );
  });

  it("ellipse without radius → throws with clear message", () => {
    const el: ConvertibleElement = {
      id: "el9",
      type: "ellipse",
      customData: geoPoint(),
    };
    expect(() => annotationToFeatureCollection(el)).toThrow(/radiusKm/);
  });
});
