// SPDX-License-Identifier: MIT
// Phase 2 Wave 4 Task T17 — scaleMode helpers for CoordinateSync._projectElement.
// Closes seed atlasdraw-375a.
//
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T17
// See docs/decisions/wave4-pre-dispatch-scrub-2026-05-04.md
//
// ---------------------------------------------------------------------------
// Concept
// ---------------------------------------------------------------------------
//
// Every geo-anchored element carries `customData.scaleMode ∈
// {"geographic", "screen", "hybrid"}`. The mode controls how the element's
// SIZE behaves as the user zooms the map after authoring:
//
//   geographic — size scales with the map projection (a rectangle covering
//                two real-world degrees stays covering two degrees no matter
//                the zoom). This is the "natural" behavior of the projection.
//
//   screen     — size is locked to the screen-space measurement that was
//                stored at authoring time (a 32px pin stays 32px on screen at
//                every zoom). Position still tracks the geographic anchor.
//
//   hybrid     — geographic-style scaling, but factor clamped so the element
//                stays visible/legible at extreme zoom deltas. Bounded ±2
//                zoom levels (=> 0.25× .. 4×) by current spec.
//
// `factor = 2^(currentZoom - zRef)` reflects MapLibre's per-zoom-level 2× scale.
// `currentZoom == zRef` => factor == 1 (identity). `currentZoom = zRef + 1`
// doubles; `currentZoom = zRef - 1` halves. Per Web Mercator math, this matches
// the change in pixels-per-real-world-meter between zoom levels.

/**
 * Compute the geographic scale factor between authoring zoom (`zRef`) and
 * current camera zoom.
 *
 * @returns `2^(currentZoom - zRef)`. Returns `1.0` when zooms are equal.
 */
export function computeScaleFactor(currentZoom: number, zRef: number): number {
  return Math.pow(2, currentZoom - zRef);
}

/**
 * Hybrid-mode bounds: ±2 zoom levels of geographic scaling, equivalent to
 * `[2^-2, 2^+2] = [0.25, 4.0]`. Outside this range, the element clamps so it
 * remains visible/legible at extreme zoom deltas.
 */
export const HYBRID_FACTOR_MIN = 0.25;
export const HYBRID_FACTOR_MAX = 4.0;

/**
 * Clamp a scale factor to the hybrid-mode bounds `[0.25, 4.0]`.
 */
export function clampHybridFactor(factor: number): number {
  return Math.min(HYBRID_FACTOR_MAX, Math.max(HYBRID_FACTOR_MIN, factor));
}
