// SPDX-License-Identifier: MIT
// Geodesic length and area on the WGS84 ellipsoid, against published values.
//
// Reference values come from GeographicLib 2.1 (Karney), which is exact to
// the nanometre on WGS84. They are literals here so the test does not compute
// its answer with the code it tests.

import { describe, expect, it } from "vitest";

import { areaOf, geodesicDistance, lengthOf } from "./measure";

/** Relative error of `got` against `want`. */
const rel = (got: number, want: number) => Math.abs(got - want) / want;

describe("geodesicDistance", () => {
  it("gives London to Paris as GeographicLib does (343,923.120 m)", () => {
    const d = geodesicDistance(
      { lng: -0.1278, lat: 51.5074 },
      { lng: 2.3522, lat: 48.8566 },
    );
    expect(Math.abs(d - 343_923.12)).toBeLessThan(0.01);
  });

  it("gives Vincenty's own test line, Flinders Peak to Buninyong (54,972.271 m)", () => {
    const dms = (d: number, m: number, s: number) =>
      Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600);
    const d = geodesicDistance(
      { lng: dms(144, 25, 29.5244), lat: dms(-37, 57, 3.7203) },
      { lng: dms(143, 55, 35.3839), lat: dms(-37, 39, 10.1561) },
    );
    expect(Math.abs(d - 54_972.271)).toBeLessThan(0.001);
  });

  it("gives one degree of latitude and of longitude at the equator", () => {
    const o = { lng: 0, lat: 0 };
    expect(geodesicDistance(o, { lng: 0, lat: 1 })).toBeCloseTo(110_574.389, 2);
    expect(geodesicDistance(o, { lng: 1, lat: 0 })).toBeCloseTo(111_319.491, 2);
  });

  it("gives zero for one point", () => {
    expect(geodesicDistance({ lng: 7, lat: 7 }, { lng: 7, lat: 7 })).toBe(0);
  });

  it("stays within 0.5% for a nearly antipodal pair, where Vincenty fails", () => {
    const d = geodesicDistance({ lng: 0, lat: 0 }, { lng: 179.7, lat: 0.5 });
    expect(rel(d, 19_944_127.421)).toBeLessThan(0.005);
  });
});

describe("lengthOf", () => {
  it("adds the segments of a line string", () => {
    const d = lengthOf([
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 1, lat: 1 },
    ]);
    // 1° of the equator plus 1° of the meridian at 1°E.
    expect(d).toBeCloseTo(111_319.491 + 110_574.389, 1);
  });

  it("gives zero for fewer than two points", () => {
    expect(lengthOf([])).toBe(0);
    expect(lengthOf([{ lng: 3, lat: 4 }])).toBe(0);
  });
});

describe("areaOf", () => {
  // A 1° x 1° cell at the equator: GeographicLib's polygon area with the 1°N
  // edge followed along the parallel is 12,308,463,894 m².
  const cell = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 1, lat: 1 },
    { lng: 0, lat: 1 },
  ];

  it("gives the 1° cell at the equator to 1 m² in 12.3 billion", () => {
    expect(Math.abs(areaOf(cell) - 12_308_463_894)).toBeLessThan(1);
  });

  it("does not depend on the winding or on a repeated closing point", () => {
    const back = [...cell].reverse();
    expect(areaOf(back)).toBeCloseTo(areaOf(cell), 3);
    expect(areaOf([...cell, cell[0]])).toBeCloseTo(areaOf(cell), 3);
  });

  it("gives a 1° cell at 60°N as GeographicLib does", () => {
    const north = cell.map((p) => ({ lng: p.lng, lat: p.lat + 60 }));
    // GeographicLib, parallels followed: 6,123,140,879 m².
    expect(rel(areaOf(north), 6_123_140_879)).toBeLessThan(1e-6);
  });

  it("gives zero for fewer than three points", () => {
    expect(areaOf(cell.slice(0, 2))).toBe(0);
  });
});
