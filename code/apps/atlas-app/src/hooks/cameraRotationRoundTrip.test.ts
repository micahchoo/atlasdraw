// SPDX-License-Identifier: AGPL-3.0-only
// RT-3 — the seam between the one place that WRITES a bearing and the one
// place that READS a rotation.
//
// Rotation ships with a deliberate asymmetry. Every consumer — the bbox
// anchors (RT-2), the printed north arrow (RT-4), the compass needle —
// *measures* the camera's rotation off the live projection, so none of them
// depends on MapLibre's bearing sign convention. But a control has to turn the
// camera, and `map.setBearing` is the only setter there is, so
// `setCameraRotation` (`@atlasdraw/basemap`) converts once: `bearing =
// -degrees`. That single line is the whole trust surface.
//
// **Why this file exists and the spy tests in
// `packages/basemap/src/__tests__/cameraRotation.test.ts` are not enough.**
// A `setBearing` spy can only pin *that* the conversion negates. If MapLibre's
// bearing ran the same sign as the east-angle, the spy assertion stays green
// and the map turns backwards under the drag. Asking whether negating is
// *right* needs a map you can set a bearing on and then measure — which is
// `FakeMercatorMap`, and which lives in the app's test tree rather than either
// package's, so the round trip is asserted here where both halves resolve.
//
// (An earlier attempt at this lived in the basemap suite and asserted
// `-(-137) === 137` — true under every possible convention, including a wrong
// one. Chief Opus caught it reviewing `40dc175`. This is the test it was
// pretending to be.)
//
// **What this still cannot settle, and it is the honest limit.**
// `FakeMercatorMap` documents its own bearing as "the same convention as
// MapLibre's `getBearing()`" (`geoOpFuzz.harness.ts:49-53`) — a reading of the
// docs, not a verified fact, since nobody has run this app. So the round trip
// proves the compass and the anchors agree with **each other**. If both are
// consistently backwards relative to real MapLibre, this stays green and the
// map turns the wrong way from the drag. That failure is loud on the first
// frame, which is why it was judged acceptable to confine rather than remove —
// but only opening the editor settles it.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect } from "vitest";

import { setCameraRotation } from "@atlasdraw/basemap";
import { cameraRotation } from "@atlasdraw/geo";

import { FakeMercatorMap } from "./geoOpFuzz.harness";

import type maplibregl from "maplibre-gl";

/** `cameraRotation` reports radians; every caller and the compass want degrees. */
function measuredDeg(map: FakeMercatorMap): number {
  return (cameraRotation(map as unknown as maplibregl.Map) * 180) / Math.PI;
}

/** Wrap to (-180, 180], so 190 and -170 compare as the same camera. */
function wrapDeg(deg: number): number {
  return deg - 360 * Math.round(deg / 360);
}

describe("setCameraRotation ↔ cameraRotation round trip", () => {
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

  it("holds at the antimeridian, where the probe used to wrap", () => {
    // `4505042` fixed `cameraRotation` reporting 180° for a camera centred in
    // (179.999, 180]. That fix is asserted in the geo suite against a linear
    // fake; this checks the whole round trip survives it over real Mercator.
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
