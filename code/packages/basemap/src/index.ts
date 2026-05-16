// @atlasdraw/basemap — Phase 1 (Wave 1, Task 3): MapCanvas skeleton.
// Phase 2, Wave 2a: LayerStyle + style compiler (consumed by Wave 2b T12/T13).
// Phase 4, Wave 0 (T2428): BasemapRegistry + pmtiles-protocol + style-builder.
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md

export { MapCanvas } from "./MapCanvas";
export type { MapCanvasProps, MapCanvasInitialView } from "./MapCanvas";

export type { LayerStyle, StyleExpression } from "./style";
export { compileLayer, defaultLayerStyle } from "./style-compiler";

export { BASEMAPS, getBasemap } from "./BasemapRegistry";
export type { BasemapConfig } from "./BasemapRegistry";

export { registerPmtilesProtocol } from "./pmtiles-protocol";

export { buildStyle } from "./style-builder";
export type { BuildStyleOptions } from "./style-builder";

// Phase 4, Wave 1 (T7): resolver + remote-gate. The pmtiles path is
// caller-supplied (see resolver.ts boundary contract); this package does
// not read environment variables.
export { resolveStyle, BasemapRemoteGatedError } from "./resolver";
export type { ResolveStyleOptions } from "./resolver";
