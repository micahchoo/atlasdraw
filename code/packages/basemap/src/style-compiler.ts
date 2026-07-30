// SPDX-License-Identifier: MIT
// @atlasdraw/basemap — style compiler (Phase 2, Wave 2a; Phase 6, Wave 1b).
// Converts a LayerStyle + geometry-type hint into a MapLibre LayerSpecification.
// Geometry-type is passed in by the caller (Wave 2b T13) so this stays pure.
//
// Phase 6 (A6): when `style.expression` is set, the compiler emits a
// data-driven MapLibre expression on the geometry-appropriate color paint
// property instead of the flat color literal. The compiler is intentionally
// data-blind: graduated stops are concrete breakpoints supplied by the
// caller. Output is deterministic — same LayerStyle in, byte-equal MapLibre
// expression out.

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { LayerStyle, StyleExpression } from "./style";

// MapLibre paint expressions are typed loosely (recursive `unknown[]`). We use
// `unknown` rather than `any` so consumers must narrow before extracting, but
// the compiler itself constructs the array directly.
type PaintValue = string | number | unknown[];

/** MapLibre layer kinds this compiler emits, keyed off the source geometry. */
export type LayerGeometryType = "fill" | "line" | "circle";

/**
 * A layer's paint block, keyed by MapLibre paint property name. Every key is
 * always present (defaults fill the gaps), which is what lets callers diff two
 * compiled paints and push only the properties that differ.
 */
export type CompiledPaint = Record<string, PaintValue>;

/**
 * Compile a `StyleExpression` into a MapLibre expression array.
 * Returns `fallback` (literal) when stops are empty — there's nothing to match
 * or interpolate against, and MapLibre rejects empty `match` / `interpolate`
 * expressions.
 */
function compileExpression(expr: StyleExpression): PaintValue {
  if (expr.kind === "categorical") {
    if (expr.stops.length === 0) {
      return expr.fallback;
    }
    // ["match", ["get", property], v1, c1, v2, c2, ..., fallback]
    const out: unknown[] = ["match", ["get", expr.property]];
    for (const { value, color } of expr.stops) {
      out.push(value, color);
    }
    out.push(expr.fallback);
    return out;
  }
  // graduated
  if (expr.stops.length === 0) {
    return expr.fallback;
  }
  // For all three methods the compiler emits a linear interpolation — the
  // *method* only controls how the caller chose the stops. (Quantile +
  // equal-interval are data-binning strategies, not paint-time operators.)
  const out: unknown[] = ["interpolate", ["linear"], ["get", expr.property]];
  for (const { stop, color } of expr.stops) {
    out.push(stop, color);
  }
  return out;
}

/**
 * Compile a LayerStyle into just the MapLibre *paint* block for a geometry kind:
 * - "fill"   → Polygon/MultiPolygon (uses fillColor + opacity + strokeColor as outline)
 * - "line"   → LineString/MultiLineString (uses strokeColor + strokeWidth + opacity)
 * - "circle" → Point/MultiPoint (uses fillColor + strokeColor + strokeWidth + opacity)
 *
 * Split out of `compileLayer` so incremental style edits have exactly one
 * LayerStyle → paint translation to lean on: `compileLayer` uses it to build a
 * whole layer spec for `addLayer`, and atlas-app's registry sync diffs two
 * compiled paints to derive the `setPaintProperty` calls for a style patch.
 * A second translation would be free to drift from this one.
 *
 * Phase 6 (A6): when `style.expression` is set, the geometry's primary color
 * paint property (`fill-color` / `line-color` / `circle-color`) receives the
 * compiled expression. Stroke / width / opacity remain flat literals.
 */
export function compilePaint(
  style: LayerStyle,
  geometryType: LayerGeometryType,
): CompiledPaint {
  const exprPaint: PaintValue | undefined = style.expression
    ? compileExpression(style.expression)
    : undefined;

  if (geometryType === "fill") {
    return {
      "fill-color": exprPaint ?? style.fillColor ?? "#0aa",
      "fill-opacity": style.opacity ?? 0.5,
      "fill-outline-color": style.strokeColor ?? "#077",
    };
  }
  if (geometryType === "line") {
    return {
      "line-color": exprPaint ?? style.strokeColor ?? "#077",
      "line-width": style.strokeWidth ?? 1,
      "line-opacity": style.opacity ?? 1,
    };
  }
  // circle (point)
  return {
    "circle-color": exprPaint ?? style.fillColor ?? "#0aa",
    "circle-stroke-color": style.strokeColor ?? "#077",
    "circle-stroke-width": style.strokeWidth ?? 1,
    "circle-opacity": style.opacity ?? 1,
    "circle-radius": 5,
  };
}

/**
 * Build a MapLibre LayerSpecification from id + LayerStyle. The paint block
 * comes from `compilePaint`; this function only picks the layer `type`.
 *
 * The id is used as both the layer id and the source id (set by caller via map.addSource).
 */
export function compileLayer(
  id: string,
  style: LayerStyle,
  geometryType: LayerGeometryType,
): maplibregl.LayerSpecification {
  // CompiledPaint is an open record (so it stays diffable); each branch narrows
  // it to the paint type its layer kind declares.
  const paint = compilePaint(style, geometryType);

  if (geometryType === "fill") {
    return {
      id,
      type: "fill",
      source: id,
      paint: paint as Extract<
        maplibregl.LayerSpecification,
        { type: "fill" }
      >["paint"],
    };
  }
  if (geometryType === "line") {
    return {
      id,
      type: "line",
      source: id,
      paint: paint as Extract<
        maplibregl.LayerSpecification,
        { type: "line" }
      >["paint"],
    };
  }
  // circle (point)
  return {
    id,
    type: "circle",
    source: id,
    paint: paint as Extract<
      maplibregl.LayerSpecification,
      { type: "circle" }
    >["paint"],
  };
}

/**
 * Pick a sensible default LayerStyle for an inbound FeatureCollection.
 * v1: returns a fixed teal/dark-teal palette regardless of geometry.
 * Tighten in a later wave when LayerStyle gains geometry-specific fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function defaultLayerStyle(_fc: FeatureCollection): LayerStyle {
  return {
    fillColor: "#0aa",
    strokeColor: "#077",
    strokeWidth: 1,
    opacity: 0.5,
  };
}
