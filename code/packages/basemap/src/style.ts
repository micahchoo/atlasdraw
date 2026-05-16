// SPDX-License-Identifier: MIT
// @atlasdraw/basemap — LayerStyle interface (Phase 2, Wave 2a).
// Shared style shape consumed by style-compiler and atlas-app's layer registry.
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md
//
// Phase 6 (Wave 1b, A5+A6): added optional `expression` field for MapLibre
// data-driven paint expressions (categorical + graduated). The forward-compat
// convention here is intentionally "kept liberal" (mx-91343d): new optional
// fields stack onto the existing shape without breaking existing styles or
// existing consumers — `defaultLayerStyle` callers and the Phase 2 LayerPanel
// continue to function unchanged when `expression` is absent.

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

export interface LayerStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0..1
  // Phase 6 (A6) — optional. When set, compileLayer emits a MapLibre paint
  // expression instead of a flat color literal. See mx-91343d: extending the
  // LayerStyle shape with optional fields is the project's forward-compat
  // convention; absent `expression` preserves Phase 2 literal-color behavior.
  expression?: StyleExpression;
}
