// @atlasdraw/basemap — LayerStyle interface (Phase 2, Wave 2a).
// Shared style shape consumed by style-compiler and atlas-app's layer registry.
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md

export interface LayerStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0..1
}
