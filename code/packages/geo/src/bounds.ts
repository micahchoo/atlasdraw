// SPDX-License-Identifier: MIT
//
// The lng/lat box that holds a drawing: "fit the map to the content", "zoom
// to this annotation".
//
// The FeatureCollection equivalent ("zoom to layer") lives in atlas-app's
// lib/fitMapToContent.ts: @atlasdraw/geo carries no GeoJSON type dependency,
// and a data layer is never an Excalidraw element.

import { shapeOutline } from "./sceneGeometry.js";
import { toLngLat } from "./world.js";

import type { SceneShape } from "./sceneGeometry.js";
import type { WorldFrame } from "./world.js";

export type LngLatBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * The box of every live element's drawn outline, or null when there is none.
 * Scene y grows southward and Mercator is monotone, so the scene box's corners
 * are the lng/lat box's corners.
 */
export function computeSceneBounds(
  elements: ReadonlyArray<SceneShape & { readonly isDeleted?: boolean }>,
  frame: WorldFrame,
): LngLatBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    for (const p of shapeOutline(el)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }
  const nw = toLngLat(frame, { x: minX, y: minY });
  const se = toLngLat(frame, { x: maxX, y: maxY });
  return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
}
