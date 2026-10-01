// SPDX-License-Identifier: MIT
// ADR-0015 spike — v1 (screen pixels + customData.geo) → world coordinates.
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
import { normalizeLng } from "./projection.js";
import { toScene } from "./world.js";

import type { ExcalidrawElementLike } from "./excalidrawTypes.js";
import type { GeoCustomData } from "./types.js";
import type { WorldFrame } from "./world.js";

/** The keys that exist only to keep v1's screen copy in step. */
const V1_KEYS = new Set([
  "geo",
  "scaleMode",
  "projection",
  "schemaVersion",
  "_lastSync",
]);

function stripV1(customData: unknown): Record<string, unknown> | undefined {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(customData as Record<string, unknown>)) {
    if (!V1_KEYS.has(k)) {
      rest[k] = v;
    }
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Migrate one v1 element. An element without an anchor is returned as it is:
 * v1 draws it fixed to the screen, which no world position reproduces.
 *
 * `screen` and `hybrid` scale modes are migrated as geographic. No creation
 * path has stamped them since 2026-07-19 and no saved document uses them.
 */
export function migrateElementV1<T extends ExcalidrawElementLike>(
  el: T,
  frame: WorldFrame,
): T {
  if (!isGeoCustomData(el.customData)) {
    return el;
  }
  const cd = el.customData as GeoCustomData & { _lastSync?: unknown };
  const sync = (cd._lastSync ?? {}) as Record<string, unknown>;
  const anchor = cd.geo;
  const s = Math.pow(2, frame.z0 - anchor.zRef);
  const strokeWidth0 = num(sync.strokeWidth0) ?? el.strokeWidth;
  const base = {
    ...el,
    customData: stripV1(el.customData),
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
      const angle = num(sync.a0) ?? el.angle;
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
