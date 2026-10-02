// SPDX-License-Identifier: MIT
// @atlasdraw/basemap — LayerStyle, the style of one data layer. Consumed by
// style-compiler and by atlas-app's data layers.
//
// Forward-compatibility convention: every new field is optional, so an
// existing style and every existing consumer keep working when it is absent.

/**
 * Data-driven paint expression. Compiled into a MapLibre expression by
 * `compileLayer` when present on a `LayerStyle`. The compiler is *data-blind*:
 * graduated stops must already be concrete numeric breakpoints supplied by the
 * caller (the `StylePanel` computes quantile / equal-interval stops in atlas-app).
 */
export type StyleExpression =
  | {
      kind: "categorical";
      property: string;
      stops: Array<{ value: string | number; color: string }>;
      fallback: string;
    }
  | {
      kind: "graduated";
      property: string;
      method: "linear" | "quantile" | "equal-interval";
      stops: Array<{ stop: number; color: string }>;
      fallback: string;
    };

/**
 * Labels from one property of each feature. `size` is in pixels
 * (6..48); `halo` draws a white outline round the text so it reads over any
 * colour. Labels need the basemap's glyphs: the compiler draws none without
 * a font (see `compileLayers`).
 */
export interface LabelStyle {
  property: string;
  size: number;
  halo: boolean;
}

/** The comparisons a filter offers: =, ≠, <, >, contains. */
export type FilterOp = "==" | "!=" | "<" | ">" | "contains";

/**
 * Draw only the features whose `property` passes the comparison.
 * `value` is kept as the user typed it; < and > read it as a number.
 */
export interface FilterStyle {
  property: string;
  op: FilterOp;
  value: string;
}

/**
 * How a point layer draws: each point, clusters of nearby points with their
 * count, or a heatmap of point density. Lines and areas draw "points" only.
 */
export type PointDisplay = "points" | "clusters" | "heatmap";

/**
 * A point's radius from a number property: `min` and below draw at
 * `minRadius` pixels, `max` and above at `maxRadius`, and values between are
 * linear. Data-blind like a graduated colour: the caller reads `min` and
 * `max` off the data. A feature whose value is not a number keeps the plain
 * radius.
 */
export interface SizeStyle {
  property: string;
  min: number;
  max: number;
  minRadius: number;
  maxRadius: number;
}

export interface LayerStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0..1
  // When set, compileLayer emits a MapLibre paint expression instead of a
  // flat color literal. Absent means the flat colors above.
  expression?: StyleExpression;
  // Absent means no labels and no filter.
  label?: LabelStyle;
  filter?: FilterStyle;
  // Point layers only. Absent means "points" at the plain radius.
  points?: PointDisplay;
  size?: SizeStyle;
}
