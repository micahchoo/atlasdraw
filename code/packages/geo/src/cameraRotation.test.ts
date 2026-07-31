// RT-2 — `cameraRotation` / `rotateAbout`.
//
// `cameraRotation` deliberately measures the projection rather than reading
// `getBearing()` and converting, so the tests below drive it with fake maps
// whose `project` applies a known rotation, and check that it recovers the
// rotation the map actually applied. The `getBearing() === 0` fast path is
// tested for what it is: a shortcut that must not call `project` at all.

import { describe, it, expect, vi } from "vitest";

import { cameraRotation, rotateAbout } from "./projection.js";

import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Fake map whose `project` is "scale by `worldPx` degrees→pixels, then rotate
 * the result by `screenDeg` about the container centre" — the shape of a real
 * MapLibre transform at pitch 0, with everything but the rotation stripped.
 */
function makeRotatedMap(
  bearing: number,
  screenDeg: number,
  worldPx = 1000,
  centerLng = 0,
) {
  const a = (screenDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Like MapLibre's own `project`, this treats the longitude literally: it does
  // not wrap. That is the mechanism the antimeridian test below depends on.
  const project = vi.fn((coord: [number, number]) => {
    const dx = coord[0] * worldPx;
    const dy = -coord[1] * worldPx; // north is up before rotation
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  });
  return {
    map: {
      project,
      getBearing: () => bearing,
      getCenter: () => ({ lng: centerLng, lat: 0 }),
    } as unknown as MapLibreMap,
    project,
  };
}

describe("cameraRotation", () => {
  it("returns 0 without projecting anything when the camera is north-up", () => {
    const { map, project } = makeRotatedMap(0, 0);
    expect(cameraRotation(map)).toBe(0);
    expect(project).not.toHaveBeenCalled();
  });

  it("recovers the rotation the projection applied, in radians, y-down", () => {
    for (const deg of [-170, -90, -33, 15, 45, 120, 179]) {
      const { map } = makeRotatedMap(1, deg);
      expect(cameraRotation(map)).toBeCloseTo((deg * Math.PI) / 180, 9);
    }
  });

  it("gives the same answer wherever the camera sits, antimeridian included", () => {
    // The east probe adds 1e-3° to the centre longitude. Normalizing that sum
    // wraps a centre at 179.9995° round to ≈ -180°, which projects a full
    // world-width west and reports ≈ 180° of rotation instead of 42°. So these
    // centres are not decoration: 179.9995 and 180 are the failing band, and
    // the out-of-range 200 covers a camera that has panned past one world copy
    // (MapLibre does not wrap `getCenter().lng` back for you).
    const expected = (42 * Math.PI) / 180;
    for (const centerLng of [0, -73.9, 179, 179.9995, 180, 200]) {
      const { map } = makeRotatedMap(1, 42, 1000, centerLng);
      expect(cameraRotation(map), `centre lng ${centerLng}`).toBeCloseTo(
        expected,
        9,
      );
    }
  });

  it("probes two adjacent longitudes, never a wrapped pair", () => {
    // The angle assertions above cannot catch a wrap of the *origin* probe: a
    // whole-world shift is positive and along the parallel, so the difference
    // vector still points east and `atan2` is unchanged. It is inert today and
    // a landmine tomorrow — it makes the "derivative" span a world width. This
    // is the contract that rules it out: the two probes stay a hair apart.
    const { map, project } = makeRotatedMap(1, 42, 1000, 200);
    cameraRotation(map);
    expect(project).toHaveBeenCalledTimes(2);
    const [[origin], [east]] = project.mock.calls;
    expect(east[0] - origin[0]).toBeCloseTo(1e-3, 12);
  });

  it("is scale-invariant — zoom does not change the answer", () => {
    const shallow = makeRotatedMap(1, 42, 1);
    const deep = makeRotatedMap(1, 42, 1e7);
    expect(cameraRotation(shallow.map)).toBeCloseTo(
      cameraRotation(deep.map),
      9,
    );
  });

  it("returns 0 rather than NaN when the probe collapses", () => {
    const map = {
      project: () => ({ x: 5, y: 5 }),
      getBearing: () => 90,
      getCenter: () => ({ lng: 0, lat: 0 }),
    } as unknown as MapLibreMap;
    expect(cameraRotation(map)).toBe(0);
  });
});

describe("rotateAbout", () => {
  it("is the identity at angle 0, without touching the value", () => {
    expect(rotateAbout(3, 7, 1, 1, 0)).toEqual({ x: 3, y: 7 });
  });

  it("turns a point a quarter-turn clockwise on screen (y-down)", () => {
    const p = rotateAbout(10, 0, 0, 0, Math.PI / 2);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });

  it("round-trips: rotating by -a undoes rotating by a", () => {
    const a = 0.937;
    const p = rotateAbout(123, -45, 10, 20, a);
    const back = rotateAbout(p.x, p.y, 10, 20, -a);
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(-45, 9);
  });

  it("leaves the centre of rotation fixed", () => {
    const p = rotateAbout(10, 20, 10, 20, 1.234);
    expect(p.x).toBeCloseTo(10, 12);
    expect(p.y).toBeCloseTo(20, 12);
  });
});
