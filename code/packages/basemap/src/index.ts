// @atlasdraw/basemap — Phase 1 (Wave 1, Task 3): MapCanvas skeleton.
// Phase 2, Wave 2a: LayerStyle + style compiler (consumed by Wave 2b T12/T13).
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md

export { MapCanvas } from "./MapCanvas";
export type { MapCanvasProps, MapCanvasInitialView } from "./MapCanvas";

export type { LayerStyle } from "./style";
export { compileLayer, defaultLayerStyle } from "./style-compiler";
