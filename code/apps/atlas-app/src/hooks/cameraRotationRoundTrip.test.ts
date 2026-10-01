// SPDX-License-Identifier: AGPL-3.0-only
//
// The bearing sign, checked against a real Mercator projection.
//
// One place writes a rotation (`setCameraRotation`, `bearing = -degrees`) and
// one reads it (`useCameraRotation`, `degrees = -bearing`). The drawing layer
// is turned by that angle, so if the sign were wrong the drawing would turn
// against the map. A `setBearing` spy can only show that the conversion
// negates; this file measures the screen angle of geographic east on
// `FakeMercatorMap`, whose bearing follows MapLibre's documented convention,
// and asks whether negating is right.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect } from "vitest";

import { setCameraRotation } from "@atlasdraw/basemap";

import { FakeMercatorMap } from "./__tests__/fakeMercatorMap";

import type * as maplibregl from "maplibre-gl";

/**
 * The screen angle of geographic east, degrees, y-down: project two points a
 * hair apart along the centre parallel. Literal longitudes, no wrap: the
 * Mercator transform is affine in world x, so the angle holds across the
 * antimeridian.
 */
function measuredDeg(map: FakeMercatorMap): number {
  const { lng, lat } = map.getCenter();
  const a = map.project([lng, lat]);
  const b = map.project([lng + 1e-3, lat]);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** What useCameraRotation reports for a map. */
function reportedDeg(map: FakeMercatorMap): number {
  return -map.getBearing();
}

/** Wrap to (-180, 180], so 190 and -170 compare as the same camera. */
function wrapDeg(deg: number): number {
  return deg - 360 * Math.round(deg / 360);
}

describe("setCameraRotation ↔ measured rotation round trip", () => {
  it.each([-137, -33, 0, 45, 179])(
    "useCameraRotation's -bearing is the measured angle at bearing %d",
    (bearing) => {
      const map = new FakeMercatorMap(6, { lng: 12, lat: 45 });
      map.setBearing(bearing);
      expect(wrapDeg(reportedDeg(map))).toBeCloseTo(
        wrapDeg(measuredDeg(map)),
        6,
      );
    },
  );

  it.each([-170, -137, -90, -33, 15, 45, 90, 137, 179])(
    "asking for %d° of rotation measures back as %d°",
    (requested) => {
      const map = new FakeMercatorMap(6, { lng: 12, lat: 45 });

      setCameraRotation(map as unknown as maplibregl.Map, requested);

      expect(measuredDeg(map)).toBeCloseTo(requested, 6);
    },
  );

  it("would fail if the conversion stopped negating", () => {
    // The mutation the spy tests also catch, restated here against a real
    // projection so this file stands on its own.
    const map = new FakeMercatorMap(6, { lng: 12, lat: 45 });

    setCameraRotation(map as unknown as maplibregl.Map, 45);

    expect(measuredDeg(map)).not.toBeCloseTo(-45, 6);
  });

  it("holds at the antimeridian", () => {
    for (const lng of [179.9995, 180, 200]) {
      const map = new FakeMercatorMap(6, { lng, lat: 0 });

      setCameraRotation(map as unknown as maplibregl.Map, 30);

      expect(measuredDeg(map)).toBeCloseTo(30, 6);
    }
  });

  it("sends 0 to a camera that measures as north-up", () => {
    const map = new FakeMercatorMap(6, { lng: 12, lat: 45 });
    map.setBearing(60);

    setCameraRotation(map as unknown as maplibregl.Map, 0);

    expect(measuredDeg(map)).toBe(0);
  });

  it("survives a full turn in both directions", () => {
    // The compass accumulates drag deltas without clamping, so it can hand
    // `setCameraRotation` a value outside (-180, 180]. MapLibre wraps bearing
    // internally; this asserts the round trip wraps with it rather than
    // landing somewhere else.
    const map = new FakeMercatorMap(6, { lng: 12, lat: 45 });

    for (const requested of [370, -370, 540, -540]) {
      setCameraRotation(map as unknown as maplibregl.Map, requested);
      expect(wrapDeg(measuredDeg(map))).toBeCloseTo(wrapDeg(requested), 6);
    }
  });
});
