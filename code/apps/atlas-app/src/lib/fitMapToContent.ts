// SPDX-License-Identifier: AGPL-3.0-only
//
// Camera fits: frame the map on drawn elements (their lng/lat bounds through
// the world frame), on a lng/lat box (a raster's corners) or on a data
// layer's FeatureCollection. One set of padding, zoom and duration
// constants, so every "zoom to" lands its content at the same size; a second
// copy of those constants is how the fits drift apart.
//
// The bounds math for a FeatureCollection lives here rather than in
// @atlasdraw/geo because that package carries no GeoJSON type dependency.

import { computeSceneBounds } from "@atlasdraw/geo";

import type { LngLatBox, WorldFrame } from "@atlasdraw/geo";

import type { FeatureCollection, Position } from "geojson";

/** Padding (px) around the framed content, and the closest zoom fitBounds may pick. */
const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 16;
const FIT_DURATION_MS = 600;

/**
 * Frame the camera on drawn elements: the lng/lat box of their outlines in
 * the document's world frame. Returns false, without touching the camera,
 * when there is no map or nothing to frame.
 */
export function fitMapToContent(
  map: FitBoundsSurface | null,
  elements: Parameters<typeof computeSceneBounds>[0],
  frame: WorldFrame,
): boolean {
  const box = computeSceneBounds(elements, frame);
  return box ? fitMapToBox(map, box) : false;
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

/**
 * Frame the camera on a geographic bounding box. Returns false when the map is
 * absent, so callers can gate their feedback. Uses the same padding, maxZoom,
 * and duration as fitMapToLayer — one set of constants,
 * one visual result.
 */
export function fitMapToBox(
  map: FitBoundsSurface | null,
  box: LngLatBox,
  opts: { animate?: boolean } = {},
): boolean {
  if (!map) {
    return false;
  }
  map.fitBounds(
    [
      [box.west, box.south],
      [box.east, box.north],
    ],
    {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      // A view that opens on the box jumps there; a user's "zoom to" glides.
      duration: opts.animate === false ? 0 : FIT_DURATION_MS,
    },
  );
  return true;
}
