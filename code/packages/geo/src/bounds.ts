// packages/geo/src/bounds.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 2 Task 10 — Scene-wide geographic bounds.
//
// Iterates geo-anchored elements, unions their lng/lat extents into a single
// box. Used by viewport "zoom to fit" and persistence camera defaults.

import { isGeoCustomData } from "./types.js";
import type { ExcalidrawElementLike } from "./CoordinateSync.js";

export type LngLatBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function computeSceneBounds(
  elements: ReadonlyArray<ExcalidrawElementLike>,
): LngLatBox | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let any = false;

  for (const el of elements) {
    if (!isGeoCustomData(el.customData)) continue;
    const geo = el.customData.geo;

    let elWest: number;
    let elEast: number;
    let elSouth: number;
    let elNorth: number;

    if (geo.kind === "point") {
      elWest = elEast = geo.lng;
      elSouth = elNorth = geo.lat;
    } else if (geo.kind === "bbox") {
      elWest = geo.west;
      elEast = geo.east;
      elSouth = geo.south;
      elNorth = geo.north;
    } else {
      // polyline
      if (geo.coordinates.length === 0) continue;
      elWest = Infinity;
      elEast = -Infinity;
      elSouth = Infinity;
      elNorth = -Infinity;
      for (const [lng, lat] of geo.coordinates) {
        if (lng < elWest) elWest = lng;
        if (lng > elEast) elEast = lng;
        if (lat < elSouth) elSouth = lat;
        if (lat > elNorth) elNorth = lat;
      }
    }

    if (elWest < west) west = elWest;
    if (elEast > east) east = elEast;
    if (elSouth < south) south = elSouth;
    if (elNorth > north) north = elNorth;
    any = true;
  }

  if (!any) return null;
  return { west, south, east, north };
}
