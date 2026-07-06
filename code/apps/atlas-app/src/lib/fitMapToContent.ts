// SPDX-License-Identifier: AGPL-3.0-only
//
// "Scroll back to content" for the map editor: reframe the MapLibre camera on
// the geographic bounds of the drawn (geo-anchored) content.
//
// Excalidraw's canvas is scroll-locked (the map is the real camera — see
// useExcalidrawChangeHandler), so its native calculateScrollCenter is a no-op.
// Instead we move the MAP to the content's geo bounds and let CoordinateSync
// re-project the elements onto the reframed view (a plain camera move — no
// change to the reprojection math). Reuses @atlasdraw/geo's computeSceneBounds.
//
// Returns true when it moved the map (there was geo-anchored content), or false
// to let the caller fall back to the default behavior.

import { computeSceneBounds } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

/** Padding (px) around the framed content, and the closest zoom fitBounds may pick. */
const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 16;
const FIT_DURATION_MS = 600;

export function fitMapToContent(
  map: maplibregl.Map | null,
  elements: Parameters<typeof computeSceneBounds>[0],
): boolean {
  if (!map) {
    return false;
  }
  const box = computeSceneBounds(elements);
  if (!box) {
    return false; // no geo-anchored content to frame
  }
  map.fitBounds(
    [
      [box.west, box.south],
      [box.east, box.north],
    ],
    { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: FIT_DURATION_MS },
  );
  return true;
}
