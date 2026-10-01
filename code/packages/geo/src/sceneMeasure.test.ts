// SPDX-License-Identifier: MIT
// Measuring a drawn element: scene geometry through the world frame onto
// WGS84. Reference values are GeographicLib 2.1 with the drawn edges followed
// (densified), so they measure the shape as it is drawn on the map.

import { describe, expect, it } from "vitest";

import { measureShape } from "./sceneMeasure";
import { documentFrame, toScene } from "./world";

import type { SceneShape } from "./sceneGeometry";

const frame = documentFrame(0, 0);
const rel = (got: number, want: number) => Math.abs(got - want) / want;

/** A box from its NW and SE corners in lng/lat. */
function box(
  type: string,
  west: number,
  north: number,
  east: number,
  south: number,
  angle = 0,
): SceneShape {
  const nw = toScene(frame, west, north);
  const se = toScene(frame, east, south);
  return {
    type,
    x: nw.x,
    y: nw.y,
    width: se.x - nw.x,
    height: se.y - nw.y,
    angle,
  };
}

/** A linear element through lng/lat vertices. */
function linear(type: string, coords: Array<[number, number]>): SceneShape {
  const pts = coords.map(([lng, lat]) => toScene(frame, lng, lat));
  return {
    type,
    x: pts[0].x,
    y: pts[0].y,
    points: pts.map((p) => [p.x - pts[0].x, p.y - pts[0].y] as const),
  };
}

describe("measureShape", () => {
  it("gives a rectangle on a 1° cell its exact area and perimeter", () => {
    const m = measureShape(frame, box("rectangle", 0, 1, 1, 0));
    expect(m?.kind).toBe("area");
    expect(rel(m!.kind === "area" ? m!.area : 0, 12_308_463_894)).toBeLessThan(
      1e-7,
    );
    expect(
      Math.abs((m!.kind === "area" ? m!.perimeter : 0) - 443_770.918),
    ).toBeLessThan(0.5);
  });

  it("gives a line London to Paris its length along the drawn line", () => {
    const m = measureShape(
      frame,
      linear("line", [
        [-0.1278, 51.5074],
        [2.3522, 48.8566],
      ]),
    );
    // Straight on the Mercator map, which is 16 m longer than the geodesic.
    expect(m).toEqual({ kind: "length", length: expect.any(Number) });
    expect(
      Math.abs((m as { length: number }).length - 343_939.093),
    ).toBeLessThan(0.5);
  });

  it("measures arrows and freehand lines as lengths", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
    ];
    const want = 1_113.195 + 1_105.744;
    for (const type of ["arrow", "freedraw"]) {
      const m = measureShape(frame, linear(type, coords));
      expect(m?.kind).toBe("length");
      expect(Math.abs((m as { length: number }).length - want)).toBeLessThan(
        0.01,
      );
    }
  });

  it("gives a closed line an area and a perimeter", () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const m = measureShape(frame, linear("line", ring));
    expect(m?.kind).toBe("area");
    expect(rel(m!.kind === "area" ? m!.area : 0, 12_308_463_894)).toBeLessThan(
      1e-7,
    );
  });

  it("gives a turned square of about 1 km the same area as the unturned one", () => {
    const flat = measureShape(frame, box("rectangle", 0, 0.009, 0.009, 0));
    const turned = measureShape(
      frame,
      box("rectangle", 0, 0.009, 0.009, 0, Math.PI / 6),
    );
    const a = flat?.kind === "area" ? flat.area : NaN;
    const b = turned?.kind === "area" ? turned.area : NaN;
    expect(a).toBeGreaterThan(990_000);
    expect(rel(b, a)).toBeLessThan(1e-4);
  });

  it("gives a diamond half the area of its box", () => {
    const r = measureShape(frame, box("rectangle", 0, 0.01, 0.01, 0));
    const d = measureShape(frame, box("diamond", 0, 0.01, 0.01, 0));
    expect(d?.kind).toBe("area");
    expect(
      rel(
        d?.kind === "area" ? d.area : NaN,
        r?.kind === "area" ? r.area / 2 : NaN,
      ),
    ).toBeLessThan(1e-4);
  });

  it("gives a 1 km circle its radius, π r² and 2π r", () => {
    const deg = 1000 / 111_319.491; // 1 km of the equator, in degrees
    const m = measureShape(frame, box("ellipse", -deg, deg, deg, -deg));
    expect(m?.kind).toBe("area");
    const e = m as {
      area: number;
      perimeter: number;
      radii?: { a: number; b: number };
    };
    expect(e.radii!.a).toBeCloseTo(1000, 0);
    // North-south: Mercator at 0°, so within the ellipsoid's 0.7%.
    expect(rel(e.radii!.b, 1000)).toBeLessThan(0.008);
    expect(rel(e.area, Math.PI * e.radii!.a * e.radii!.b)).toBeLessThan(1e-4);
    expect(rel(e.perimeter, 2 * Math.PI * 1000)).toBeLessThan(0.005);
  });

  it("measures an ellipse's semi-axes along its own axes when turned", () => {
    const dx = 2000 / 111_319.491;
    const dy = 1000 / 110_574.389;
    const flat = measureShape(frame, box("ellipse", -dx, dy, dx, -dy));
    const turned = measureShape(
      frame,
      box("ellipse", -dx, dy, dx, -dy, Math.PI / 2),
    );
    const f = (flat as { radii: { a: number; b: number } }).radii;
    const t = (turned as { radii: { a: number; b: number } }).radii;
    expect(f.a).toBeCloseTo(2000, -1);
    expect(f.b).toBeCloseTo(1000, -1);
    // Turned a quarter: the x semi-axis now runs north-south.
    expect(rel(t.a, f.a)).toBeLessThan(0.01);
    expect(rel(t.b, f.b)).toBeLessThan(0.01);
  });

  it("gives no measure for text or an empty line", () => {
    expect(measureShape(frame, box("text", 0, 1, 1, 0))).toBeNull();
    expect(measureShape(frame, linear("line", [[0, 0]]))).toBeNull();
  });
});
