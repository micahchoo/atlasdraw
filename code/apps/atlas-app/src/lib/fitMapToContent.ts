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
//
// `fitMapToLayer` is the same camera move framed on one data layer's
// FeatureCollection — the "zoom to layer" action in the sheet panel's layer
// card. It shares this module's padding/zoom/duration so a zoom-to-layer and a
// scroll-back-to-content land the content at the same size; a second copy of
// those constants is how the two silently drift apart.
//
// The bounds math for a FeatureCollection lives here rather than in
// @atlasdraw/geo because that package carries no GeoJSON type dependency and
// its computeSceneBounds walks Excalidraw elements, which a data layer never
// becomes.

import { computeSceneBounds } from "@atlasdraw/geo";

import type { LngLatBox } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection, Position } from "geojson";

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

/** The narrowest MapLibre surface a camera fit needs, so tests can stub it. */
export interface FitBoundsSurface {
  fitBounds(
    bounds: [[number, number], [number, number]],
    opts: { padding: number; maxZoom: number; duration: number },
  ): void;
}

/**
 * Union the lng/lat extent of every coordinate in a FeatureCollection.
 *
 * Returns null when there is nothing to frame — an empty collection, or one
 * whose features all carry `geometry: null` (RFC 7946-legal, and the same
 * features `LayerProvenance.droppedCount` reports). Callers must treat null as
 * "don't move the camera" rather than framing [0,0], which would throw the user
 * into the Gulf of Guinea.
 *
 * GeometryCollection is walked recursively even though `requireHomogeneousGeometry`
 * rejects it at import: layers also arrive by conversion and collaboration,
 * and silently framing nothing is worse than handling the case.
 */
export function computeFeatureCollectionBounds(
  fc: FeatureCollection,
): LngLatBox | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let any = false;

  const visitPosition = ([lng, lat]: Position) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }
    if (lng < west) {
      west = lng;
    }
    if (lng > east) {
      east = lng;
    }
    if (lat < south) {
      south = lat;
    }
    if (lat > north) {
      north = lat;
    }
    any = true;
  };

  // Positions nest to a different depth per geometry type (Point → Position,
  // Polygon → Position[][], MultiPolygon → Position[][][]). Recursing on
  // "is the first element a number?" handles all of them without a per-type
  // switch that would need editing every time GeoJSON grows a type.
  const visitCoords = (coords: unknown): void => {
    if (!Array.isArray(coords)) {
      return;
    }
    if (typeof coords[0] === "number") {
      visitPosition(coords as Position);
      return;
    }
    for (const child of coords) {
      visitCoords(child);
    }
  };

  const visitGeometry = (
    geometry: FeatureCollection["features"][number]["geometry"],
  ): void => {
    if (!geometry) {
      return;
    }
    if (geometry.type === "GeometryCollection") {
      geometry.geometries.forEach(visitGeometry);
      return;
    }
    visitCoords(geometry.coordinates);
  };

  for (const feature of fc.features) {
    visitGeometry(feature.geometry);
  }

  return any ? { west, south, east, north } : null;
}

/**
 * Frame the camera on one data layer. Returns false — without touching the
 * camera — when there is no map yet or the layer has no framable geometry, so
 * the caller can tell the user instead of leaving them wondering.
 */
export function fitMapToLayer(
  map: FitBoundsSurface | null,
  fc: FeatureCollection | undefined,
): boolean {
  if (!map || !fc) {
    return false;
  }
  const box = computeFeatureCollectionBounds(fc);
  if (!box) {
    return false;
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
