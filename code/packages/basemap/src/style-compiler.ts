// SPDX-License-Identifier: MIT
// @atlasdraw/basemap — style compiler.
// Converts a LayerStyle + geometry-type hint into a MapLibre LayerSpecification.
// The caller passes the geometry type, so this stays pure.
//
// When `style.expression` is set, the compiler emits a
// data-driven MapLibre expression on the geometry-appropriate color paint
// property instead of the flat color literal. The compiler is intentionally
// data-blind: graduated stops are concrete breakpoints supplied by the
// caller. Output is deterministic — same LayerStyle in, byte-equal MapLibre
// expression out.

import type { FeatureCollection } from "geojson";
import type * as maplibregl from "maplibre-gl";
import type {
  FilterStyle,
  LabelStyle,
  LayerStyle,
  PointDisplay,
  SizeStyle,
  StyleExpression,
} from "./style";

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
  // A feature whose value is not a number gets the fallback colour; without
  // the guard, MapLibre fails the evaluation and draws its own default.
  const value = ["get", expr.property];
  const ramp: unknown[] = ["interpolate", ["linear"], value];
  for (const { stop, color } of expr.stops) {
    ramp.push(stop, color);
  }
  return ["case", ["==", ["typeof", value], "number"], ramp, expr.fallback];
}

/**
 * Compile a LayerStyle into just the MapLibre *paint* block for a geometry kind:
 * - "fill"   → Polygon/MultiPolygon (uses fillColor + opacity; the outline is compileOutlinePaint)
 * - "line"   → LineString/MultiLineString (uses strokeColor + strokeWidth + opacity)
 * - "circle" → Point/MultiPoint (uses fillColor + strokeColor + strokeWidth + opacity)
 *
 * Split out of `compileLayer` so incremental style edits have exactly one
 * LayerStyle → paint translation to lean on: `compileLayer` uses it to build a
 * whole layer spec for `addLayer`, and atlas-app's lib/mapOverlays.ts diffs
 * two compiled layers to derive the `setPaintProperty` calls for a style
 * patch. A second translation would be free to drift from this one.
 *
 * When `style.expression` is set, the geometry's primary color
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
    // The polygon's edge is its own line layer (compileOutlinePaint), so
    // stroke colour and width apply to polygons too.
    return {
      "fill-color": exprPaint ?? style.fillColor ?? "#0aa",
      "fill-opacity": style.opacity ?? 0.5,
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
    "circle-radius": style.size ? compileRadius(style.size) : POINT_RADIUS,
  };
}

/** A point's radius in pixels when no property sizes it. */
const POINT_RADIUS = 5;

/**
 * The radius expression for a size by property. A feature whose value is
 * not a number gets the plain radius; `interpolate` clamps outside the range.
 */
function compileRadius(size: SizeStyle): PaintValue {
  const value = ["get", size.property];
  return [
    "case",
    ["==", ["typeof", value], "number"],
    [
      "interpolate",
      ["linear"],
      value,
      size.min,
      size.minRadius,
      size.max,
      size.maxRadius,
    ],
    POINT_RADIUS,
  ];
}

/**
 * The paint of a polygon layer's outline: a line layer over the fill, drawn
 * in the stroke colour at the stroke width. The outline stays opaque when the
 * fill is faded, so the edge of a faded area can still be seen.
 */
export function compileOutlinePaint(style: LayerStyle): CompiledPaint {
  return {
    "line-color": style.strokeColor ?? "#077",
    "line-width": style.strokeWidth ?? 1,
    "line-opacity": 1,
  };
}

/** The id of a polygon layer's outline layer. */
export function outlineLayerId(id: string): string {
  return `${id}::outline`;
}

/** The id of a data layer's label (symbol) layer. */
export function labelLayerId(id: string): string {
  return `${id}::label`;
}

/** The id of a clustered point layer's cluster circles. */
export function clusterLayerId(id: string): string {
  return `${id}::clusters`;
}

/** The id of a clustered point layer's cluster counts. */
export function clusterCountLayerId(id: string): string {
  return `${id}::cluster-count`;
}

/** MapLibre marks a cluster feature with `point_count`. */
const IS_CLUSTER: maplibregl.FilterSpecification = ["has", "point_count"];
const NOT_CLUSTER: maplibregl.FilterSpecification = ["!", IS_CLUSTER];

/** Pixels around a cluster's centre that join points into it. */
const CLUSTER_RADIUS = 50;

const POINT_DISPLAYS: readonly PointDisplay[] = [
  "points",
  "clusters",
  "heatmap",
];

export const POINT_RADIUS_MIN = 1;
export const POINT_RADIUS_MAX = 50;

function sizeProblem(size: SizeStyle): string | null {
  if (typeof size !== "object" || size === null || !size.property) {
    return "Choose a number property to size the points by.";
  }
  const { min, max, minRadius, maxRadius } = size;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max
  ) {
    return "The size range needs a smallest value below its largest.";
  }
  const radius = (r: unknown) =>
    typeof r === "number" && r >= POINT_RADIUS_MIN && r <= POINT_RADIUS_MAX;
  if (!radius(minRadius) || !radius(maxRadius)) {
    return `Use a point size from ${POINT_RADIUS_MIN} to ${POINT_RADIUS_MAX}.`;
  }
  return null;
}

/**
 * Why the map cannot draw this style's point display or point size, or
 * null. Clusters, heatmaps and sizes are for point layers only.
 */
export function pointProblem(
  style: Pick<LayerStyle, "points" | "size">,
  geometryType: LayerGeometryType,
): string | null {
  const { points, size } = style;
  if (points !== undefined && !POINT_DISPLAYS.includes(points)) {
    return "Show the points as points, clusters or a heatmap.";
  }
  if (
    points !== undefined &&
    points !== "points" &&
    geometryType !== "circle"
  ) {
    return "Only a point layer can show clusters or a heatmap.";
  }
  if (size === undefined) {
    return null;
  }
  if (geometryType !== "circle") {
    return "Only a point layer can size its points by a property.";
  }
  return sizeProblem(size);
}

/**
 * The options a data layer's GeoJSON source takes from its style. Only
 * clusters change the source: MapLibre makes the clusters there. The filter
 * goes on the source too, so a cluster counts only the points that pass it.
 * Empty for every other style.
 */
export function compileSourceOptions(
  style: LayerStyle,
  geometryType: LayerGeometryType,
): { cluster?: true; clusterRadius?: number; filter?: unknown[] } {
  if (geometryType !== "circle" || style.points !== "clusters") {
    return {};
  }
  return {
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    ...(style.filter ? { filter: compileFilter(style.filter) } : {}),
  };
}

/** The cluster circles and, with a font, their counts. */
function compileClusterLayers(
  id: string,
  style: LayerStyle,
  font: string[] | undefined,
): maplibregl.LayerSpecification[] {
  const count: maplibregl.ExpressionSpecification = ["get", "point_count"];
  const layers: maplibregl.LayerSpecification[] = [
    {
      id: clusterLayerId(id),
      type: "circle",
      source: id,
      filter: IS_CLUSTER,
      paint: {
        "circle-color": style.fillColor ?? "#0aa",
        "circle-stroke-color": style.strokeColor ?? "#077",
        "circle-stroke-width": style.strokeWidth ?? 1,
        "circle-opacity": style.opacity ?? 1,
        // 12 px for a pair, growing with the count to 24 px at 1000.
        "circle-radius": ["interpolate", ["linear"], count, 2, 12, 1000, 24],
      },
    } as maplibregl.LayerSpecification,
  ];
  if (font) {
    layers.push({
      id: clusterCountLayerId(id),
      type: "symbol",
      source: id,
      filter: IS_CLUSTER,
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": font,
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": LABEL_COLOR,
        "text-halo-color": LABEL_HALO_COLOR,
        "text-halo-width": LABEL_HALO_WIDTH,
      },
    } as maplibregl.LayerSpecification);
  }
  return layers;
}

/** A heatmap of point density, in the layer's own id. */
function compileHeatmapLayer(
  id: string,
  style: LayerStyle,
): maplibregl.LayerSpecification {
  return {
    id,
    type: "heatmap",
    source: id,
    paint: {
      "heatmap-radius": 20,
      "heatmap-opacity": style.opacity ?? 1,
    },
  };
}

/**
 * A no-number stand-in for < and >: `to-number` of a value that is not a
 * number gives this, and it passes neither comparison for any sane value.
 */
const NOT_A_NUMBER_HIGH = 1e308;

/**
 * The MapLibre filter expression for a filter. = and ≠ compare as text, so a
 * number in the data matches the same digits typed in the panel. < and >
 * compare as numbers; a feature with no value, or a value that is not a
 * number, never matches. "contains" ignores case.
 */
export function compileFilter(filter: FilterStyle): unknown[] {
  const value = ["get", filter.property];
  const text = ["to-string", value];
  switch (filter.op) {
    case "==":
    case "!=":
      return [filter.op, text, filter.value];
    case "<":
      return [
        "all",
        ["!=", value, null],
        ["<", ["to-number", value, NOT_A_NUMBER_HIGH], Number(filter.value)],
      ];
    case ">":
      return [
        "all",
        ["!=", value, null],
        [">", ["to-number", value, -NOT_A_NUMBER_HIGH], Number(filter.value)],
      ];
    case "contains":
      return ["in", filter.value.toLowerCase(), ["downcase", text]];
  }
}

/** Why the map cannot apply this filter, or null. */
export function filterProblem(filter: FilterStyle): string | null {
  if (!filter.property) {
    return "Choose a property to filter by.";
  }
  if (
    (filter.op === "<" || filter.op === ">") &&
    (filter.value.trim() === "" || !Number.isFinite(Number(filter.value)))
  ) {
    return "Type a number to compare with < or >.";
  }
  return null;
}

export const LABEL_SIZE_MIN = 6;
export const LABEL_SIZE_MAX = 48;

/** Why the map cannot draw these labels, or null. */
export function labelProblem(label: LabelStyle): string | null {
  if (!label.property) {
    return "Choose a property for the labels.";
  }
  if (
    !Number.isFinite(label.size) ||
    label.size < LABEL_SIZE_MIN ||
    label.size > LABEL_SIZE_MAX
  ) {
    return `Use a label size from ${LABEL_SIZE_MIN} to ${LABEL_SIZE_MAX}.`;
  }
  return null;
}

/** Label text: the panel's ink colour, with a white halo when asked. */
const LABEL_COLOR = "#212529";
const LABEL_HALO_COLOR = "#ffffff";
const LABEL_HALO_WIDTH = 1.5;

function compileLabelLayer(
  id: string,
  label: LabelStyle,
  geometryType: LayerGeometryType,
  font: string[],
): maplibregl.LayerSpecification {
  // A point's label sits under the point; a line's runs along the line; a
  // polygon's is placed inside it by MapLibre.
  const placement =
    geometryType === "circle"
      ? { "text-anchor": "top", "text-offset": [0, 0.6] }
      : geometryType === "line"
      ? { "symbol-placement": "line" }
      : {};
  return {
    id: labelLayerId(id),
    type: "symbol",
    source: id,
    layout: {
      "text-field": ["to-string", ["get", label.property]],
      "text-font": font,
      "text-size": label.size,
      ...placement,
    },
    paint: {
      "text-color": LABEL_COLOR,
      "text-halo-color": LABEL_HALO_COLOR,
      "text-halo-width": label.halo ? LABEL_HALO_WIDTH : 0,
    },
  } as maplibregl.LayerSpecification;
}

export interface CompileLayersOptions {
  /**
   * A font the basemap's glyphs serve, for labels. Without one there are no
   * glyphs to draw text with, and the label layer is left out.
   */
  labelFont?: string[];
}

/**
 * Every MapLibre layer that draws one data layer, bottom first. A polygon
 * layer is a fill and an outline (`outlineLayerId`); a line or point layer is
 * one layer. With `style.label` and a font, a symbol layer for the labels
 * (`labelLayerId`) is last. With `style.filter`, every layer carries the
 * filter. Each layer reads the source named `id`.
 *
 * A point layer with `points: "heatmap"` is one heatmap layer. With
 * `points: "clusters"`, the cluster circles (`clusterLayerId`) and counts
 * (`clusterCountLayerId`, with a font) come first, and every layer picks
 * clusters or single points; the filter is on the source.
 */
export function compileLayers(
  id: string,
  style: LayerStyle,
  geometryType: LayerGeometryType,
  options: CompileLayersOptions = {},
): maplibregl.LayerSpecification[] {
  const display: PointDisplay =
    geometryType === "circle" ? style.points ?? "points" : "points";
  const filter = style.filter ? compileFilter(style.filter) : undefined;
  if (display === "heatmap") {
    const heatmap = compileHeatmapLayer(id, style);
    return [
      filter
        ? ({ ...heatmap, filter } as maplibregl.LayerSpecification)
        : heatmap,
    ];
  }
  const layers: maplibregl.LayerSpecification[] = [
    compileLayer(id, style, geometryType),
  ];
  if (geometryType === "fill") {
    layers.push({
      id: outlineLayerId(id),
      type: "line",
      source: id,
      paint: compileOutlinePaint(style) as Extract<
        maplibregl.LayerSpecification,
        { type: "line" }
      >["paint"],
    });
  }
  if (style.label && options.labelFont) {
    layers.push(
      compileLabelLayer(id, style.label, geometryType, options.labelFont),
    );
  }
  if (display === "clusters") {
    // The source holds the filter (compileSourceOptions). Each layer only
    // picks clusters or single points.
    return [
      ...compileClusterLayers(id, style, options.labelFont),
      ...layers.map(
        (layer) =>
          ({ ...layer, filter: NOT_CLUSTER } as maplibregl.LayerSpecification),
      ),
    ];
  }
  if (!filter) {
    return layers;
  }
  return layers.map(
    (layer) => ({ ...layer, filter } as maplibregl.LayerSpecification),
  );
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
export function defaultLayerStyle(_fc: FeatureCollection): LayerStyle {
  return {
    fillColor: "#0aa",
    strokeColor: "#077",
    strokeWidth: 1,
    opacity: 0.5,
  };
}
