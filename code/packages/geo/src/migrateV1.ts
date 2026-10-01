// SPDX-License-Identifier: MIT
//
// Version 1 elements (screen pixels + customData.geo) → world coordinates.
//
// A v1 element's truth is its anchor plus the `_lastSync` baselines, read the
// way `CoordinateSync._projectElement` reads them (the fallbacks included), so
// the migrated element draws where v1 draws it. Its screen x/y are ignored:
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
 * Migrate one v1 element. An element without an anchor is returned as it is:
 * v1 draws it fixed to the screen, which no world position reproduces.
 *
 * `screen` and `hybrid` scale modes are migrated as geographic. No creation
 * path has stamped them since 2026-07-19 and no saved document uses them.
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
