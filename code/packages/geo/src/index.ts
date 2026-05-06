// @atlasdraw/geo — public surface.
export * from "./types.js";
// Phase 1 Wave 1 Task 4
export { CoordinateSync } from "./CoordinateSync.js";
export type {
  CoordinateSyncOptions,
  ExcalidrawAPI,
  ExcalidrawElementLike,
} from "./CoordinateSync.js";
export { projectPoint, unprojectPoint, normalizeLng } from "./projection.js";
// Phase 1 Wave 2 Task 10
export { geoToExcalidraw } from "./geoToExcalidraw.js";
export { excalidrawToGeo } from "./excalidrawToGeo.js";
export { computeSceneBounds } from "./bounds.js";
export type { LngLatBox } from "./bounds.js";
// Wave 2a hardening: deep parser + migration shim for untrusted GeoCustomData input.
export {
  parseGeoCustomData,
  migrate,
  GeoCustomDataParseError,
} from "./parseGeoCustomData.js";
export { normalizeElementsForExport } from "./canonicalExport.js";
