// packages/tools/src/convert.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 2b Task T14 — Annotation → data-layer geometry conversion.
//
// This module is the pure geometry side of the convert-to-data-layer flow.
// It takes an Excalidraw element decorated with GeoCustomData (and optionally
// a `_data.radiusKm` field for circles) and emits a single-feature
// FeatureCollection that the LayerRegistry + MapLibre stack can consume.
//
// The right-click context menu in MapEditor wires this up:
//   1. read the selected element via excalidrawAPI.getSceneElements()
//   2. call annotationToFeatureCollection(el) → FeatureCollection
//   3. registerDataLayer / addSource / addLayer (mirrors T13 drop flow)
//   4. remove the original element from the Excalidraw scene
//
// Plan-literal drift adjusted (Wave 2b pre-impl scrub 2026-05-04):
//   The plan referenced `customData.radiusKm`, but the host bridge in
//   atlas-app's seedToElement.ts:131 writes seed.data → `customData._data`
//   (escape-hatch pattern). So a circle ellipse element's radius lives at
//   `customData._data.radiusKm`, not `customData.radiusKm`. We accept BOTH
//   shapes here to keep the function robust to future bridge refactors.
//
// GeoAnchor.kind is closed-vs-open agnostic: there is no "polygon" or
// "freehand" kind. Closed-vs-open is determined by element.type (see mapping
// table below).
//
// Mapping table (element.type → output geometry):
//   rectangle           → Polygon  (geo.kind === "bbox" → 4-corner closed ring)
//   ellipse             → Polygon  (geo.kind === "point" + radiusKm → @turf/circle ring)
//   polygon | freedraw  → Polygon  (geo.kind === "polyline" → auto-close ring)
//   line | polyline     → LineString (geo.kind === "polyline" → coords as-is)
//   text | arrow        → throw UnsupportedConvertElementError

import circle from "@turf/circle";
import type {
  FeatureCollection,
  Polygon,
  LineString,
  Position,
} from "geojson";
import type { GeoCustomData } from "@atlasdraw/geo";

/**
 * Minimal element shape this module needs. We avoid taking a wide structural
 * dep on Excalidraw's internal element types — the convert function is pure
 * geometry, no scene-mutation surface, no styling concerns. Atlas-app casts
 * its scene element down to this when calling.
 *
 * `customData._data.radiusKm` is the bridge's escape-hatch shape (see header).
 * `customData.radiusKm` is accepted as a fallback in case future refactors
 * promote the field to a top-level customData key.
 */
export type ConvertibleElement = {
  id: string;
  type: string;
  customData?: GeoCustomData & {
    radiusKm?: number;
    _data?: { radiusKm?: number; [k: string]: unknown };
  };
};

/**
 * Thrown when an element type cannot be converted (text, arrow, or unknown
 * type with valid geo). Caller is expected to catch and surface to the user
 * (e.g. window.alert in MapEditor's right-click handler).
 */
export class UnsupportedConvertElementError extends Error {
  constructor(elementType: string) {
    super(
      `Element type ${JSON.stringify(elementType)} cannot be converted to a data layer`,
    );
    this.name = "UnsupportedConvertElementError";
  }
}

/**
 * Read the circle radius from either bridge-shape or future flat-shape.
 * Returns undefined if neither is present (caller throws).
 */
function readRadiusKm(el: ConvertibleElement): number | undefined {
  const direct = el.customData?.radiusKm;
  if (typeof direct === "number") return direct;
  const nested = el.customData?._data?.radiusKm;
  if (typeof nested === "number") return nested;
  return undefined;
}

/** Close a ring if its first and last positions are not already equal. */
function closeRing(coords: Position[]): Position[] {
  if (coords.length === 0) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
}

/**
 * Convert an Excalidraw element with attached GeoCustomData into a single-feature
 * FeatureCollection. The function trusts the element has valid customData.geo —
 * upstream callers should run parseGeoCustomData before passing untrusted input.
 *
 * @throws UnsupportedConvertElementError for text/arrow/unknown types.
 * @throws Error for malformed geometry (missing radius on ellipse, wrong geo.kind, etc.)
 */
export function annotationToFeatureCollection(
  el: ConvertibleElement,
): FeatureCollection {
  const t = el.type;
  const geo = el.customData?.geo;

  if (t === "text" || t === "arrow") {
    throw new UnsupportedConvertElementError(t);
  }

  if (!geo) {
    throw new Error(
      `annotationToFeatureCollection: element ${el.id} has no customData.geo`,
    );
  }

  // ----- rectangle → Polygon (from bbox)
  if (t === "rectangle") {
    if (geo.kind !== "bbox") {
      throw new Error(
        `annotationToFeatureCollection: rectangle requires geo.kind="bbox", got "${geo.kind}"`,
      );
    }
    const { west: w, south: s, east: e, north: n } = geo;
    const ring: Position[] = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ];
    const polygon: Polygon = { type: "Polygon", coordinates: [ring] };
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: polygon }],
    };
  }

  // ----- ellipse → Polygon (from point + radiusKm via @turf/circle)
  if (t === "ellipse") {
    if (geo.kind !== "point") {
      throw new Error(
        `annotationToFeatureCollection: ellipse requires geo.kind="point", got "${geo.kind}"`,
      );
    }
    const radiusKm = readRadiusKm(el);
    if (typeof radiusKm !== "number" || radiusKm <= 0) {
      throw new Error(
        `annotationToFeatureCollection: ellipse ${el.id} missing positive customData._data.radiusKm`,
      );
    }
    const feat = circle([geo.lng, geo.lat], radiusKm, {
      steps: 64,
      units: "kilometers",
    });
    return {
      type: "FeatureCollection",
      features: [feat],
    };
  }

  // ----- polygon | freedraw → Polygon (auto-close ring)
  if (t === "polygon" || t === "freedraw") {
    if (geo.kind !== "polyline") {
      throw new Error(
        `annotationToFeatureCollection: ${t} requires geo.kind="polyline", got "${geo.kind}"`,
      );
    }
    const ring = closeRing(geo.coordinates as Position[]);
    if (ring.length < 4) {
      throw new Error(
        `annotationToFeatureCollection: ${t} ${el.id} needs >=3 distinct points to form a polygon`,
      );
    }
    const polygon: Polygon = { type: "Polygon", coordinates: [ring] };
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: polygon }],
    };
  }

  // ----- line | polyline → LineString
  if (t === "line" || t === "polyline") {
    if (geo.kind !== "polyline") {
      throw new Error(
        `annotationToFeatureCollection: ${t} requires geo.kind="polyline", got "${geo.kind}"`,
      );
    }
    const ls: LineString = {
      type: "LineString",
      coordinates: geo.coordinates as Position[],
    };
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: ls }],
    };
  }

  // ----- unknown type → unsupported
  throw new UnsupportedConvertElementError(t);
}
