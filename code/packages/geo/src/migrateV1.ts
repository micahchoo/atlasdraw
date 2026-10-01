// SPDX-License-Identifier: MIT
//
// Version 1 elements (screen pixels + customData.geo) → world coordinates.
//
// A v1 element's truth is its anchor plus the `_lastSync` baselines, read the
// way the v1 editor's projection read them (the fallbacks included), so the
// migrated element draws where v1 drew it. Its screen x/y are ignored:
// they belong to whichever camera last saved the file.
//
// Every size in v1 is "the baseline at zRef, scaled by 2^(zoom − zRef)". In
// world coordinates the camera supplies 2^(zoom − z0), so the stored size is
// the baseline scaled by 2^(z0 − zRef), once.

import { isGeoCustomData } from "./types.js";
import { toScene } from "./world.js";

import type { GeoCustomData } from "./types.js";
import type { WorldFrame } from "./world.js";

/** The element fields the migration reads and writes. */
export interface V1Element {
  readonly type?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly angle?: number;
  readonly strokeWidth?: number;
  readonly fontSize?: number;
  readonly points?: ReadonlyArray<readonly [number, number]>;
  readonly customData?: unknown;
}

/**
 * Longitude in [-180, 180]. v1 stored anchors through this; a value outside
 * it came from a map scrolled past the antimeridian.
 */
function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The keys that exist only to keep v1's screen copy in step. */
const V1_KEYS = new Set([
  "geo",
  "scaleMode",
  "projection",
  "schemaVersion",
  "_lastSync",
]);

/**
 * The element's customData without the v1 keys, plus `extra`, and with
 * `customData.atlas.unit` set: scene units per screen pixel at the zoom the
 * element was drawn at. The editor draws arrowheads, dashes and rough
 * jitter in that unit (packages/element/src/atlasStyleUnit.ts).
 */
function worldCustomData(
  customData: unknown,
  extra: Record<string, unknown>,
  unit: number,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(customData as Record<string, unknown>)) {
    if (!V1_KEYS.has(k)) {
      rest[k] = v;
    }
  }
  const atlas =
    typeof rest.atlas === "object" && rest.atlas !== null ? rest.atlas : {};
  return { ...rest, ...extra, atlas: { ...atlas, unit } };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * The camera's turn when a v1 file was saved, in radians, y-down.
 *
 * v1 wrote a geographic box's angle as its own turn (`_lastSync.a0`) plus the
 * camera's, and kept no `a0` for `screen` and `hybrid` boxes. Any box with
 * both gives the camera's turn; the file records it nowhere else. 0 when no
 * box has both.
 */
export function savedCameraTurn(elements: readonly unknown[]): number {
  for (const el of elements) {
    const e = el as V1Element;
    if (!isGeoCustomData(e?.customData) || e.customData.geo.kind !== "bbox") {
      continue;
    }
    const sync = ((e.customData as { _lastSync?: unknown })._lastSync ??
      {}) as Record<string, unknown>;
    const a0 = num(sync.a0);
    if (a0 !== undefined && typeof e.angle === "number") {
      return e.angle - a0;
    }
  }
  return 0;
}

/**
 * Where v1's screen pixels sat on the world when the file was saved: the
 * screen point (`sx`, `sy`) is the scene point (`wx`, `wy`), one screen
 * pixel is `scale` scene units, and the screen is turned by `turn` radians
 * (y-down) against the world.
 */
export interface V1Screen {
  readonly sx: number;
  readonly sy: number;
  readonly wx: number;
  readonly wy: number;
  readonly scale: number;
  readonly turn: number;
}

/**
 * The save camera's screen, read from the first anchored box: v1 kept the
 * box's screen rectangle and its geographic corners in step, so the two
 * centres are one point and the two widths give the scale. A file with no
 * anchored box gives the saved camera instead: its screen's top-left corner
 * at the camera's centre, one pixel at the camera's zoom. v1 saved no screen
 * size, so the centre of that screen is not known.
 */
export function v1Screen(
  elements: readonly unknown[],
  frame: WorldFrame,
  camera: { center: readonly [number, number]; zoom: number },
): V1Screen {
  const turn = savedCameraTurn(elements);
  for (const el of elements) {
    const e = el as V1Element;
    if (
      !isGeoCustomData(e?.customData) ||
      e.customData.geo.kind !== "bbox" ||
      !(typeof e.width === "number" && e.width > 0) ||
      typeof e.height !== "number"
    ) {
      continue;
    }
    const geo = e.customData.geo;
    const nw = toScene(frame, normalizeLng(geo.west), geo.north);
    const se = toScene(frame, normalizeLng(geo.east), geo.south);
    return {
      sx: e.x + e.width / 2,
      sy: e.y + e.height / 2,
      wx: (nw.x + se.x) / 2,
      wy: (nw.y + se.y) / 2,
      scale: (se.x - nw.x) / e.width,
      turn,
    };
  }
  const c = toScene(frame, normalizeLng(camera.center[0]), camera.center[1]);
  return {
    sx: 0,
    sy: 0,
    wx: c.x,
    wy: c.y,
    scale: Math.pow(2, frame.z0 - camera.zoom),
    turn,
  };
}

/**
 * A v1 element without an anchor, placed where v1 drew it at the save
 * camera (`v1Screen`). v1 kept it in screen pixels, which in world
 * coordinates is a speck beside the frame's origin. Its sizes are scaled to
 * scene units, and it records one save-camera pixel as its unit. A box takes
 * the screen's turn into its angle; a line's points are turned instead, as
 * v1 turned an anchored line's points.
 */
export function placeUnanchoredV1<T extends V1Element>(
  el: T,
  screen: V1Screen,
): T {
  const { scale: k, turn } = screen;
  const cos = Math.cos(-turn);
  const sin = Math.sin(-turn);
  /** A screen offset from the reference, as a scene offset. */
  const toWorld = (dx: number, dy: number): [number, number] => [
    (dx * cos - dy * sin) * k,
    (dx * sin + dy * cos) * k,
  ];
  const customData = worldCustomData(el.customData ?? {}, {}, k);
  const sizes = {
    ...(el.strokeWidth !== undefined
      ? { strokeWidth: el.strokeWidth * k }
      : {}),
    ...(el.fontSize !== undefined ? { fontSize: el.fontSize * k } : {}),
  };
  if (el.points && el.points.length > 0) {
    const [ox, oy] = toWorld(el.x - screen.sx, el.y - screen.sy);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const points = el.points.map(([px, py]): [number, number] => {
      const p = toWorld(px, py);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      return p;
    });
    return {
      ...el,
      ...sizes,
      customData,
      x: screen.wx + ox,
      y: screen.wy + oy,
      points,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const [cx, cy] = toWorld(el.x + w / 2 - screen.sx, el.y + h / 2 - screen.sy);
  return {
    ...el,
    ...sizes,
    customData,
    x: screen.wx + cx - (w * k) / 2,
    y: screen.wy + cy - (h * k) / 2,
    ...(el.width !== undefined ? { width: w * k } : {}),
    ...(el.height !== undefined ? { height: h * k } : {}),
    ...(el.angle !== undefined || turn !== 0
      ? { angle: (el.angle ?? 0) - turn }
      : {}),
  };
}

/**
 * Migrate one v1 element. An element without an anchor is returned as it is;
 * `placeUnanchoredV1` places it.
 *
 * `screen` and `hybrid` scale modes are migrated as geographic. The last v1
 * releases stamped them on no new element, and no saved document uses them.
 *
 * `savedTurn` is `savedCameraTurn` of the element's file.
 *
 * A point-anchored ellipse is a pin (the pin tool is the only writer of
 * one). It gets `customData.tool = "pin"`, which a new pin also carries, so
 * export can still give it as a point.
 */
export function migrateElementV1<T extends V1Element>(
  el: T,
  frame: WorldFrame,
  savedTurn = 0,
): T {
  if (!isGeoCustomData(el.customData)) {
    return el;
  }
  const cd = el.customData as GeoCustomData & { _lastSync?: unknown };
  const sync = (cd._lastSync ?? {}) as Record<string, unknown>;
  const anchor = cd.geo;
  const s = Math.pow(2, frame.z0 - anchor.zRef);
  const strokeWidth0 = num(sync.strokeWidth0) ?? el.strokeWidth;
  const isPin = anchor.kind === "point" && el.type === "ellipse";
  const base = {
    ...el,
    customData: worldCustomData(el.customData, isPin ? { tool: "pin" } : {}, s),
    ...(strokeWidth0 !== undefined ? { strokeWidth: strokeWidth0 * s } : {}),
  };
  switch (anchor.kind) {
    case "point": {
      const p = toScene(frame, normalizeLng(anchor.lng), anchor.lat);
      const w0 = num(sync.w0) ?? el.width;
      const h0 = num(sync.h0) ?? el.height;
      const fontSize0 = num(sync.fontSize0) ?? el.fontSize;
      return {
        ...base,
        x: p.x,
        y: p.y,
        ...(w0 !== undefined ? { width: w0 * s } : {}),
        ...(h0 !== undefined ? { height: h0 * s } : {}),
        ...(fontSize0 !== undefined ? { fontSize: fontSize0 * s } : {}),
      };
    }
    case "bbox": {
      const nw = toScene(frame, normalizeLng(anchor.west), anchor.north);
      const se = toScene(frame, normalizeLng(anchor.east), anchor.south);
      // `a0` is the user's own turn. Without it, the saved angle holds the
      // camera's turn at save time as well.
      const a0 = num(sync.a0);
      const angle =
        a0 ?? (el.angle !== undefined ? el.angle - savedTurn : undefined);
      return {
        ...base,
        x: nw.x,
        y: nw.y,
        width: se.x - nw.x,
        height: se.y - nw.y,
        ...(angle !== undefined ? { angle } : {}),
      };
    }
    case "polyline": {
      const coords = anchor.coordinates;
      if (coords.length === 0) {
        return base;
      }
      const o = toScene(frame, normalizeLng(coords[0][0]), coords[0][1]);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const points = coords.map(([lng, lat], i): [number, number] => {
        const p = i === 0 ? o : toScene(frame, normalizeLng(lng), lat);
        const px = p.x - o.x;
        const py = p.y - o.y;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        return [px, py];
      });
      return {
        ...base,
        x: o.x,
        y: o.y,
        points,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
  }
}
