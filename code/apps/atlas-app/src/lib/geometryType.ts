// SPDX-License-Identifier: AGPL-3.0-only

import type { FeatureCollection } from "geojson";

/**
 * Pick a MapLibre layer kind for the FeatureCollection's first feature.
 * Wave 2b stays simple: one geometry kind per dropped file. Mixed-geometry
 * collections (Phase 5) will need split-by-type rendering. Points fall back
 * to "circle"; unknown/empty falls back to "circle" too (renders nothing
 * harmlessly).
 */
export function inferGeometryType(
  fc: FeatureCollection,
): "fill" | "line" | "circle" {
  const t = fc.features[0]?.geometry?.type;
  if (t === "Polygon" || t === "MultiPolygon") {
    return "fill";
  }
  if (t === "LineString" || t === "MultiLineString") {
    return "line";
  }
  return "circle";
}
