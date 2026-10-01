// SPDX-License-Identifier: MIT
// ADR-0015 spike — WorldFrame round trips and agreement with a Mercator camera.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_MERCATOR_LAT,
  WORLD_TILE_SIZE,
  cameraFor,
  frameAt,
  toLngLat,
  toScene,
  viewportFor,
} from "./world";

import type { MapCamera } from "./world";

/** What MapLibre does at pitch 0, bearing 0: world px at z, minus centre. */
function project(
  camera: MapCamera,
  lng: number,
  lat: number,
): { x: number; y: number } {
  const s = WORLD_TILE_SIZE * Math.pow(2, camera.zoom);
  const wx = (l: number) => ((l + 180) / 360) * s;
  const wy = (a: number) => {
    const r = (a * Math.PI) / 180;
    return (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI)) * s;
  };
  return {
    x: wx(lng) - wx(camera.center.lng) + camera.width / 2,
    y: wy(lat) - wy(camera.center.lat) + camera.height / 2,
  };
}

const lng = fc.double({ min: -180, max: 180, noNaN: true });
const lat = fc.double({ min: -80, max: 80, noNaN: true });
const zoom = fc.double({ min: 0, max: 22, noNaN: true });

const frame = fc
  .record({ lng, lat, z: fc.integer({ min: 0, max: 22 }) })
  .map(({ lng, lat, z }) => frameAt(lng, lat, z));

const camera = fc.record({
  center: fc.record({ lng, lat }),
  zoom,
  width: fc.integer({ min: 200, max: 3000 }),
  height: fc.integer({ min: 200, max: 2000 }),
});

describe("WorldFrame (ADR-0015 spike)", () => {
  it("frameAt rounds the reference zoom and origin to integers", () => {
    const f = frameAt(13.4, 52.5, 12.7);
    expect(f.z0).toBe(13);
    expect(Number.isInteger(f.origin.x)).toBe(true);
    expect(Number.isInteger(f.origin.y)).toBe(true);
    // The origin is the frame's own (0, 0).
    const p = toScene(f, 13.4, 52.5);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5);
  });

  it("toLngLat inverts toScene", () => {
    fc.assert(
      fc.property(frame, lng, lat, (f, lo, la) => {
        const back = toLngLat(f, toScene(f, lo, la));
        expect(back.lng).toBeCloseTo(lo, 9);
        expect(back.lat).toBeCloseTo(la, 9);
      }),
    );
  });

  it("clamps latitude where MapLibre does", () => {
    const f = frameAt(0, 0, 4);
    expect(toScene(f, 0, 89).y).toBe(toScene(f, 0, MAX_MERCATOR_LAT).y);
  });

  it("cameraFor inverts viewportFor", () => {
    fc.assert(
      fc.property(frame, camera, (f, cam) => {
        const v = viewportFor(f, cam);
        const back = cameraFor(f, {
          ...v,
          width: cam.width,
          height: cam.height,
        });
        expect(back.zoom).toBeCloseTo(cam.zoom, 9);
        expect(back.center.lng).toBeCloseTo(cam.center.lng, 7);
        expect(back.center.lat).toBeCloseTo(cam.center.lat, 7);
      }),
    );
  });

  it("a scene point lands on the pixel the map projects its lng/lat to", () => {
    let worst = 0;
    fc.assert(
      fc.property(
        frame,
        camera,
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (f, cam, u, v) => {
          // A point within two viewports of the camera — what can be drawn.
          const target = cameraFor(f, {
            ...viewportFor(f, cam),
            width: cam.width,
            height: cam.height,
          });
          const at = toLngLat(f, {
            x:
              toScene(f, target.center.lng, target.center.lat).x +
              (u * cam.width) / Math.pow(2, cam.zoom - f.z0),
            y:
              toScene(f, target.center.lng, target.center.lat).y +
              (v * cam.height) / Math.pow(2, cam.zoom - f.z0),
          });
          if (Math.abs(at.lat) > 80) {
            return;
          }
          const vp = viewportFor(f, cam);
          const s = toScene(f, at.lng, at.lat);
          const screen = {
            x: (s.x + vp.scrollX) * vp.zoom,
            y: (s.y + vp.scrollY) * vp.zoom,
          };
          const expected = project(cam, at.lng, at.lat);
          const err = Math.hypot(screen.x - expected.x, screen.y - expected.y);
          worst = Math.max(worst, err);
          expect(err).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 2000 },
    );
    // eslint-disable-next-line no-console
    console.info(
      `[world] worst scene→screen error: ${worst.toExponential(2)} px`,
    );
  });
});
