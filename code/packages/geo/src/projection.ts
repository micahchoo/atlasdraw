// packages/geo/src/projection.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 1 Task 4 — thin projection seam.
//
// These functions are intentionally thin delegates over `map.project` /
// `map.unproject`. The seam exists so a future worker-offload path (e.g.
// OffscreenCanvas + transferable matrix) can swap the implementation without
// touching CoordinateSync.ts.
//
// Math lives in MapLibre (Web Mercator). Do NOT replicate it here.

import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Normalize a longitude to [-180, 180].
 *
 * MapLibre's `map.unproject` can return lngs outside this range when the map
 * is positioned near the date line or has scrolled past one world-width.
 * MapLibre's `map.project` does NOT wrap out-of-range lngs — it treats lng=-254°
 * literally, placing the element 360° west of the intended location. Normalizing
 * at both the storage seam (unprojectPoint) and the projection seam (projectPoint)
 * ensures geo anchors are always in canonical range.
 */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Project a geographic coordinate to a pixel offset from the map container origin.
 *
 * Delegates to `map.project([lng, lat])` which applies the full MapLibre
 * camera transform (Web Mercator → NDC → container pixels).
 *
 * When the Excalidraw scene shares the same pixel space as the map container
 * (identity scroll offsets), the returned `{x, y}` IS the scene coordinate.
 *
 * @param map - Attached MapLibre `Map` instance.
 * @param lng - Longitude in decimal degrees.
 * @param lat - Latitude in decimal degrees.
 * @returns Pixel offset `{x, y}` from the map container's top-left corner.
 */
export function projectPoint(
  map: MapLibreMap,
  lng: number,
  lat: number,
): { x: number; y: number } {
  // TODO(Wave2-Task5): validate that projection === "mercator" before delegating.
  // For now we delegate unconditionally — only "mercator" exists in v1.
  // Normalize lng so out-of-range anchors (e.g. -254° → 106°E) project correctly.
  const pt = map.project([normalizeLng(lng), lat]);
  return { x: pt.x, y: pt.y };
}

/**
 * Inverse-project a pixel offset from the map container back to geographic
 * coordinates.
 *
 * Delegates to `map.unproject({x, y})`.
 *
 * @param map - Attached MapLibre `Map` instance.
 * @param x   - Pixel x offset from the map container's top-left corner.
 * @param y   - Pixel y offset from the map container's top-left corner.
 * @returns Geographic coordinate `{lng, lat}`.
 */
export function unprojectPoint(
  map: MapLibreMap,
  x: number,
  y: number,
): { lng: number; lat: number } {
  // `map.unproject` accepts PointLike = Point | [number, number].
  // Passing a tuple literal directly (without a cast) lets TypeScript infer [number, number].
  // Normalize returned lng — MapLibre can return values outside [-180, 180] at the dateline.
  const lngLat = map.unproject([x, y]);
  return { lng: normalizeLng(lngLat.lng), lat: lngLat.lat };
}

/**
 * Longitude delta used to probe the screen direction of geographic east.
 * Any value works — `atan2` is scale-invariant — but it must be large enough
 * that the two projected points differ by more than float noise at zoom 0.
 */
const EAST_PROBE_DEG = 1e-3;

/**
 * Screen-space rotation of the geographic east axis, in radians, in the
 * y-down coordinate system Excalidraw's `angle` field uses.
 *
 * This is the camera bearing expressed the way an element's `angle` wants it.
 * It is *measured*, not derived from `map.getBearing()`: we project two points
 * a hair apart along the centre parallel and read the angle of the resulting
 * screen vector. That means no code here has to be right about MapLibre's
 * bearing sign convention, and the answer stays correct if the projection
 * stops being plain Mercator. `getBearing() === 0` is used only as an exact
 * fast path — a north-up camera is north-up under any convention.
 *
 * Valid only at pitch 0, which is the only pitch Atlasdraw allows
 * (`MapCanvas.tsx` constructs the map with `maxPitch: 0`). Under pitch the
 * rotation varies across the viewport and one number cannot describe it.
 *
 * @param map - Attached MapLibre `Map` instance.
 * @returns Rotation in radians; exactly 0 when the camera is north-up.
 */
export function cameraRotation(map: MapLibreMap): number {
  if (map.getBearing() === 0) {
    return 0;
  }
  const { lng, lat } = map.getCenter();
  // Both probe points are projected LITERALLY — no `normalizeLng`. That call is
  // right at the storage and projection seams, where an out-of-range lng would
  // misplace an element; it is wrong here. This is a derivative, and it needs
  // the two points to stay adjacent. Normalizing wraps `lng + EAST_PROBE_DEG`
  // to ≈ -180 when the centre sits just west of the antimeridian, putting the
  // east probe a full world-width away and reporting a hard 180° rotation.
  // Literal treatment is exactly the continuous behaviour a derivative wants:
  // the Mercator transform is affine in world x, so a whole-world offset shifts
  // both points equally and cancels out of `atan2`.
  const origin = map.project([lng, lat]);
  const east = map.project([lng + EAST_PROBE_DEG, lat]);
  const dx = east.x - origin.x;
  const dy = east.y - origin.y;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  return Math.atan2(dy, dx);
}

/**
 * Rotate `(x, y)` about `(cx, cy)` by `angle` radians, y-down.
 *
 * Matches Excalidraw's own element rotation, which is about the element's
 * centre — so this is the inverse operation to what `angle` renders.
 */
export function rotateAbout(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
): { x: number; y: number } {
  if (angle === 0) {
    return { x, y };
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
