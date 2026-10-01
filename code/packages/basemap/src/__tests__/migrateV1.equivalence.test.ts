// SPDX-License-Identifier: MIT
// ADR-0015 criterion 6: a v1 document migrated to world coordinates draws
// every element where v1 draws it, within 1e-6 px, under random cameras.
//
// "Where v1 draws it" is the REAL writer — `CoordinateSync.syncMapToScene` —
// run against a map with exact Web Mercator math, not a copy of its formulas.
// "Where world draws it" is the migrated element pushed through the camera
// bridge's transform: (p + scroll) * zoom, then the drawing layer's CSS
// rotation about the viewport centre.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  WORLD_TILE_SIZE,
  frameAt,
  migrateElementV1,
  viewportFor,
} from "@atlasdraw/geo";

import type {
  ExcalidrawAPI,
  ExcalidrawElementLike,
  GeoAnchor,
  WorldFrame,
} from "@atlasdraw/geo";

import { CoordinateSync } from "../CoordinateSync";

import type { Map as MapLibreMap } from "maplibre-gl";

/** The fuzz harness's FakeMercatorMap, with a variable container and
 * MapLibre's latitude clamp. */
class ExactMap {
  constructor(
    readonly center: { lng: number; lat: number },
    readonly zoom: number,
    readonly bearing: number,
    readonly width: number,
    readonly height: number,
  ) {}
  private world(lng: number, lat: number) {
    const s = WORLD_TILE_SIZE * Math.pow(2, this.zoom);
    // MapLibre's Transform.project clamps here (maplibre-gl 4.7.1).
    const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
    const r = (clamped * Math.PI) / 180;
    return {
      x: ((lng + 180) / 360) * s,
      y: (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI)) * s,
    };
  }
  project([lng, lat]: [number, number]) {
    const c = this.world(this.center.lng, this.center.lat);
    const p = this.world(lng, lat);
    return rotate(
      { x: p.x - c.x, y: p.y - c.y },
      -this.bearing,
      this.width / 2,
      this.height / 2,
    );
  }
  unproject([x, y]: [number, number]) {
    const s = WORLD_TILE_SIZE * Math.pow(2, this.zoom);
    const c = this.world(this.center.lng, this.center.lat);
    const r = rotate(
      { x: x - this.width / 2, y: y - this.height / 2 },
      this.bearing,
      0,
      0,
    );
    const wx = r.x + c.x;
    const wy = r.y + c.y;
    return {
      lng: (wx / s) * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / s))) * 180) / Math.PI,
    };
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return this.center;
  }
  getBearing() {
    return this.bearing;
  }
}

/** Rotate a vector by `deg` (y-down) and add (cx, cy). */
function rotate(
  v: { x: number; y: number },
  deg: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos - v.y * sin + cx, y: v.x * sin + v.y * cos + cy };
}

type Pt = { x: number; y: number };

/** The corners Excalidraw draws for an element with x/y/w/h/angle. */
function corners(el: ExcalidrawElementLike): Pt[] {
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const cx = el.x + w / 2;
  const cy = el.y + h / 2;
  const a = ((el.angle ?? 0) * 180) / Math.PI;
  return [
    { x: el.x, y: el.y },
    { x: el.x + w, y: el.y },
    { x: el.x + w, y: el.y + h },
    { x: el.x, y: el.y + h },
  ].map((p) => rotate({ x: p.x - cx, y: p.y - cy }, a, cx, cy));
}

/** Screen points of the drawn geometry: rect corners or polyline vertices. */
function drawn(el: ExcalidrawElementLike): Pt[] {
  if (el.points) {
    return el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  }
  return corners(el);
}

/** The camera bridge's transform: scene → layer px → CSS rotation. */
function worldToScreen(frame: WorldFrame, map: ExactMap): (p: Pt) => Pt {
  const v = viewportFor(frame, {
    center: map.center,
    zoom: map.zoom,
    width: map.width,
    height: map.height,
  });
  return (p) =>
    rotate(
      {
        x: (p.x + v.scrollX) * v.zoom - map.width / 2,
        y: (p.y + v.scrollY) * v.zoom - map.height / 2,
      },
      -map.bearing,
      map.width / 2,
      map.height / 2,
    );
}

/** What v1 draws: the real CoordinateSync pass over one element. */
function v1Draw(map: ExactMap, el: ExcalidrawElementLike) {
  let out: ExcalidrawElementLike | undefined;
  const api: ExcalidrawAPI = {
    getSceneElements: () => [el],
    updateScene: ({ elements }) => {
      out = elements[0];
    },
  };
  new CoordinateSync({
    map: map as unknown as MapLibreMap,
    excalidrawAPI: api,
  }).syncMapToScene();
  if (!out) {
    throw new Error("CoordinateSync wrote nothing");
  }
  return out;
}

const camera = fc.record({
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
  lat: fc.double({ min: -70, max: 70, noNaN: true }),
  zoom: fc.double({ min: 0.5, max: 22, noNaN: true }),
  bearing: fc.oneof(
    fc.constant(0),
    fc.double({ min: -180, max: 180, noNaN: true }),
  ),
  width: fc.integer({ min: 320, max: 2560 }),
  height: fc.integer({ min: 320, max: 1600 }),
});

/** A v1 element placed within two viewports of the camera, in screen px. */
const v1Element = (map: ExactMap) =>
  fc
    .record({
      kind: fc.constantFrom("point", "bbox", "polyline"),
      sx: fc.double({ min: -1, max: 2, noNaN: true }),
      sy: fc.double({ min: -1, max: 2, noNaN: true }),
      w: fc.double({ min: 2, max: 600, noNaN: true }),
      h: fc.double({ min: 2, max: 600, noNaN: true }),
      zRef: fc.integer({ min: 0, max: 22 }),
      stroke: fc.constantFrom(1, 2, 4),
      fontSize: fc.constantFrom(16, 20, 28),
      angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      pts: fc.array(
        fc.tuple(
          fc.double({ min: -300, max: 300, noNaN: true }),
          fc.double({ min: -300, max: 300, noNaN: true }),
        ),
        { minLength: 1, maxLength: 6 },
      ),
    })
    .map((r): ExcalidrawElementLike => {
      const at = (x: number, y: number): [number, number] => {
        const ll = map.unproject([x, y]);
        return [ll.lng, ll.lat];
      };
      const x = r.sx * map.width;
      const y = r.sy * map.height;
      let geo: GeoAnchor;
      let lastSync: Record<string, unknown>;
      if (r.kind === "point") {
        const [lng, lat] = at(x, y);
        geo = { kind: "point", lng, lat, zRef: r.zRef };
        lastSync = {
          w0: r.w,
          h0: r.h,
          fontSize0: r.fontSize,
          strokeWidth0: r.stroke,
        };
      } else if (r.kind === "bbox") {
        // A north-up box: corners from the unrotated camera's frame.
        const north = new ExactMap(
          map.center,
          map.zoom,
          0,
          map.width,
          map.height,
        );
        const [west, northLat] = (() => {
          const ll = north.unproject([x, y]);
          return [ll.lng, ll.lat];
        })();
        const se = north.unproject([x + r.w, y + r.h]);
        geo = {
          kind: "bbox",
          west,
          north: northLat,
          east: se.lng,
          south: se.lat,
          zRef: r.zRef,
        };
        lastSync = { strokeWidth0: r.stroke, a0: r.angle };
      } else {
        geo = {
          kind: "polyline",
          coordinates: [[0, 0] as const, ...r.pts].map(([px, py]) =>
            at(x + px, y + py),
          ),
          zRef: r.zRef,
        };
        lastSync = { strokeWidth0: r.stroke };
      }
      return {
        id: `el-${r.kind}`,
        type:
          r.kind === "point"
            ? "text"
            : r.kind === "bbox"
            ? "rectangle"
            : "line",
        x,
        y,
        width: r.w,
        height: r.h,
        angle: 0,
        strokeWidth: r.stroke,
        ...(r.kind === "point" ? { fontSize: r.fontSize } : {}),
        ...(r.kind === "polyline" ? { points: [[0, 0]] } : {}),
        customData: {
          geo,
          scaleMode: "geographic",
          projection: "mercator",
          schemaVersion: 1,
          _lastSync: lastSync,
        },
      };
    });

function onTheWorld(geo: GeoAnchor): boolean {
  const lat = (v: number) => Math.abs(v) < 85.05;
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  switch (geo.kind) {
    case "point":
      return lat(geo.lat);
    case "bbox":
      return (
        lat(geo.north) && lat(geo.south) && wrap(geo.east) > wrap(geo.west)
      );
    case "polyline": {
      const lngs = geo.coordinates.map(([lng]) => wrap(lng));
      return (
        geo.coordinates.every(([, la]) => lat(la)) &&
        Math.max(...lngs) - Math.min(...lngs) < 180
      );
    }
  }
}

describe("v1 → world migration (ADR-0015 criterion 6)", () => {
  it("draws every element within 1e-6 px of where v1 draws it", () => {
    let worst = 0;
    let worstStyle = 0;
    let checked = 0;
    fc.assert(
      fc.property(
        camera.chain((c) => {
          const map = new ExactMap(
            { lng: c.lng, lat: c.lat },
            c.zoom,
            c.bearing,
            c.width,
            c.height,
          );
          return fc.tuple(
            fc.constant(map),
            v1Element(map),
            // The document frame: anywhere near, any reference zoom.
            fc.integer({ min: 0, max: 22 }),
          );
        }),
        ([map, el, z0]) => {
          // Only elements that are on the Mercator world: beyond MapLibre's
          // latitude clamp, or across the antimeridian, v1 collapses a box to
          // its 1-px floor and nothing draws "where v1 draws it".
          fc.pre(onTheWorld((el.customData as { geo: GeoAnchor }).geo));
          const frame = frameAt(map.center.lng, map.center.lat, z0);
          const migrated = migrateElementV1(el, frame);
          // The world element carries no anchor and no cache.
          expect(
            (migrated.customData as Record<string, unknown> | undefined)?.geo,
          ).toBeUndefined();

          const v1 = v1Draw(map, el);
          const toScreen = worldToScreen(frame, map);
          const kind = (el.customData as { geo: GeoAnchor }).geo.kind;
          // A point anchor is drawn upright by v1 under a turned camera
          // (billboarded), and turned with the layer by world. Only its
          // anchor is comparable there — see the ADR's Outcome.
          const v1Pts =
            kind === "point" && map.bearing !== 0
              ? [{ x: v1.x, y: v1.y }]
              : drawn(v1);
          const wPts =
            kind === "point" && map.bearing !== 0
              ? [{ x: migrated.x, y: migrated.y }]
              : drawn(migrated);
          expect(wPts.length).toBe(v1Pts.length);
          for (let i = 0; i < v1Pts.length; i++) {
            const s = toScreen(wPts[i]);
            const err = Math.hypot(s.x - v1Pts[i].x, s.y - v1Pts[i].y);
            worst = Math.max(worst, err);
            expect(err).toBeLessThan(1e-6);
          }
          const zoom = Math.pow(2, map.zoom - frame.z0);
          for (const key of ["strokeWidth", "fontSize"] as const) {
            if (typeof v1[key] === "number") {
              const err = Math.abs((migrated[key] as number) * zoom - v1[key]!);
              worstStyle = Math.max(worstStyle, err);
              expect(err).toBeLessThan(1e-6);
            }
          }
          checked++;
        },
      ),
      { numRuns: 5000, seed: 15 },
    );
    // eslint-disable-next-line no-console
    console.info(
      `[migrate] ${checked} elements, worst geometry error ${worst.toExponential(
        2,
      )} px, worst stroke/font error ${worstStyle.toExponential(2)} px`,
    );
  });
});
