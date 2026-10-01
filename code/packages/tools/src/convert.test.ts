// packages/tools/src/convert.test.ts
// SPDX-License-Identifier: MPL-2.0
//
// A drawn element as GeoJSON, read from its scene geometry through the world
// frame.

import { describe, expect, it } from "vitest";

import { documentFrame, toLngLat, toScene } from "@atlasdraw/geo";

import {
  annotationToFeatureCollection,
  drawingToFeatureCollection,
  elementGeometry,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "./convert.js";

import type { Polygon, Position } from "geojson";

const frame = documentFrame(0, 0);

/** A box whose NW corner is at (west, north) and SE corner at (east, south). */
function box(
  type: string,
  west: number,
  north: number,
  east: number,
  south: number,
  extra: Partial<ConvertibleElement> = {},
): ConvertibleElement {
  const nw = toScene(frame, west, north);
  const se = toScene(frame, east, south);
  return {
    id: type,
    type,
    x: nw.x,
    y: nw.y,
    width: se.x - nw.x,
    height: se.y - nw.y,
    ...extra,
  };
}

/** A linear element through lng/lat vertices. */
function path(
  type: string,
  coords: Array<[number, number]>,
): ConvertibleElement {
  const pts = coords.map(([lng, lat]) => toScene(frame, lng, lat));
  return {
    id: type,
    type,
    x: pts[0].x,
    y: pts[0].y,
    points: pts.map(
      (p) => [p.x - pts[0].x, p.y - pts[0].y] as [number, number],
    ),
  };
}

function expectPositions(got: Position[], want: Position[]): void {
  expect(got).toHaveLength(want.length);
  got.forEach(([lng, lat], i) => {
    expect(lng).toBeCloseTo(want[i][0], 9);
    expect(lat).toBeCloseTo(want[i][1], 9);
  });
}

describe("elementGeometry", () => {
  it("rectangle → its corners as a closed ring", () => {
    const g = elementGeometry(box("rectangle", -10, 5, 10, -5), frame);
    expect(g?.type).toBe("Polygon");
    expectPositions((g as Polygon).coordinates[0], [
      [-10, 5],
      [10, 5],
      [10, -5],
      [-10, -5],
      [-10, 5],
    ]);
  });

  it("a turned rectangle keeps its turn", () => {
    const flat = box("rectangle", -10, 5, 10, -5);
    const g = elementGeometry({ ...flat, angle: Math.PI / 2 }, frame);
    const [nw] = (g as Polygon).coordinates[0];
    // A quarter turn clockwise on screen takes the NW corner to the
    // north-east of the centre.
    const c = toLngLat(frame, {
      x: flat.x + flat.width! / 2,
      y: flat.y + flat.height! / 2,
    });
    expect(nw[0]).toBeGreaterThan(c.lng);
    expect(nw[1]).toBeGreaterThan(c.lat);
  });

  it("ellipse → a 64-point ring that touches its box", () => {
    const g = elementGeometry(box("ellipse", -10, 5, 10, -5), frame) as Polygon;
    const ring = g.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    expect(Math.max(...ring.map((p) => p[0]))).toBeCloseTo(10, 9);
    expect(Math.min(...ring.map((p) => p[0]))).toBeCloseTo(-10, 9);
  });

  it("diamond → the four edge midpoints", () => {
    const g = elementGeometry(box("diamond", -10, 10, 10, -10), frame);
    const ring = (g as Polygon).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0][0]).toBeCloseTo(0, 9);
    expect(ring[0][1]).toBeCloseTo(10, 9);
    expect(ring[1][0]).toBeCloseTo(10, 9);
  });

  it("line and arrow → LineString through their points", () => {
    for (const type of ["line", "arrow"]) {
      const g = elementGeometry(
        path(type, [
          [0, 0],
          [1, 1],
          [2, 0],
        ]),
        frame,
      );
      expect(g?.type).toBe("LineString");
      expectPositions(g?.type === "LineString" ? g.coordinates : [], [
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
    }
  });

  it("closed freedraw → Polygon, not closed twice", () => {
    const g = elementGeometry(
      path("freedraw", [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]),
      frame,
    ) as Polygon;
    expect(g.type).toBe("Polygon");
    expect(g.coordinates[0]).toHaveLength(4);
  });

  it("open freedraw → LineString", () => {
    const g = elementGeometry(
      path("freedraw", [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
      frame,
    );
    expect(g?.type).toBe("LineString");
  });

  it("text and a pin → a Point at the centre", () => {
    const text = elementGeometry(box("text", -2, 2, 2, -2), frame);
    expect(text?.type).toBe("Point");
    const pin = elementGeometry(
      box("ellipse", -2, 2, 2, -2, { customData: { tool: "pin" } }),
      frame,
    );
    expect(pin?.type).toBe("Point");
    const [lng, lat] = pin?.type === "Point" ? pin.coordinates : [NaN, NaN];
    expect(lng).toBeCloseTo(0, 9);
    expect(lat).toBeCloseTo(0, 6);
  });

  it("a type with no geometry → null", () => {
    expect(elementGeometry(box("selection", 0, 1, 1, 0), frame)).toBe(null);
  });
});

describe("annotationToFeatureCollection", () => {
  it("wraps the geometry in one feature", () => {
    const fc = annotationToFeatureCollection(
      box("rectangle", -1, 1, 1, -1),
      frame,
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("refuses text", () => {
    expect(() =>
      annotationToFeatureCollection(box("text", -1, 1, 1, -1), frame),
    ).toThrow(UnsupportedConvertElementError);
  });

  it("refuses a type with no geometry", () => {
    expect(() =>
      annotationToFeatureCollection(box("hexagon", -1, 1, 1, -1), frame),
    ).toThrow(UnsupportedConvertElementError);
  });
});

describe("drawingToFeatureCollection", () => {
  it("has one feature per live element, without bound text", () => {
    const fc = drawingToFeatureCollection(
      [
        box("rectangle", -1, 1, 1, -1),
        box("ellipse", -1, 1, 1, -1, { isDeleted: true }),
        box("text", -1, 1, 1, -1, { containerId: "rectangle" }),
        box("text", 3, 1, 4, 0),
      ],
      frame,
    );
    expect(fc.features.map((f) => f.geometry.type)).toEqual([
      "Polygon",
      "Point",
    ]);
  });
});
