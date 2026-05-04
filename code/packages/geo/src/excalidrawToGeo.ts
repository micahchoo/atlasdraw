// packages/geo/src/excalidrawToGeo.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 2 Task 10 — Excalidraw element → GeoAnchor extraction.
//
// Trivially unwraps customData.geo when present. Callers that need a full
// GeoJSON Feature should compose this with a GeoAnchor → Feature converter.

import { isGeoCustomData, type GeoAnchor } from "./types.js";
import type { ExcalidrawElementLike } from "./CoordinateSync.js";

export function excalidrawToGeo(el: ExcalidrawElementLike): GeoAnchor | null {
  if (isGeoCustomData(el.customData)) {
    return el.customData.geo;
  }
  return null;
}
