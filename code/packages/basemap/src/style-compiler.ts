// @atlasdraw/basemap — style compiler (Phase 2, Wave 2a).
// Converts a LayerStyle + geometry-type hint into a MapLibre LayerSpecification.
// Geometry-type is passed in by the caller (Wave 2b T13) so this stays pure.

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { LayerStyle } from "./style";

/**
 * Build a MapLibre LayerSpecification from id + LayerStyle. Geometry-type-aware:
 * - "fill"   → Polygon/MultiPolygon (uses fillColor + opacity + strokeColor as outline)
 * - "line"   → LineString/MultiLineString (uses strokeColor + strokeWidth + opacity)
 * - "circle" → Point/MultiPoint (uses fillColor + strokeColor + strokeWidth + opacity)
 *
 * The id is used as both the layer id and the source id (set by caller via map.addSource).
 */
export function compileLayer(
  id: string,
  style: LayerStyle,
  geometryType: "fill" | "line" | "circle",
): maplibregl.LayerSpecification {
  if (geometryType === "fill") {
    return {
      id,
      type: "fill",
      source: id,
      paint: {
        "fill-color": style.fillColor ?? "#0aa",
        "fill-opacity": style.opacity ?? 0.5,
        "fill-outline-color": style.strokeColor ?? "#077",
      },
    };
  }
  if (geometryType === "line") {
    return {
      id,
      type: "line",
      source: id,
      paint: {
        "line-color": style.strokeColor ?? "#077",
        "line-width": style.strokeWidth ?? 1,
        "line-opacity": style.opacity ?? 1,
      },
    };
  }
  // circle (point)
  return {
    id,
    type: "circle",
    source: id,
    paint: {
      "circle-color": style.fillColor ?? "#0aa",
      "circle-stroke-color": style.strokeColor ?? "#077",
      "circle-stroke-width": style.strokeWidth ?? 1,
      "circle-opacity": style.opacity ?? 1,
      "circle-radius": 5,
    },
  };
}

/**
 * Pick a sensible default LayerStyle for an inbound FeatureCollection.
 * v1: returns a fixed teal/dark-teal palette regardless of geometry.
 * Tighten in a later wave when LayerStyle gains geometry-specific fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function defaultLayerStyle(_fc: FeatureCollection): LayerStyle {
  return { fillColor: "#0aa", strokeColor: "#077", strokeWidth: 1, opacity: 0.5 };
}
