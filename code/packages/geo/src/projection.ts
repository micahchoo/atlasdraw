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
