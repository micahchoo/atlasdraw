// @atlasdraw/geo — public surface.
export * from "./types.js";
// CoordinateSync moved to @atlasdraw/basemap (2026-05-25).
export type {
  ExcalidrawElementLike,
  ExcalidrawAPI,
} from "./excalidrawTypes.js";
export {
  projectPoint,
  unprojectPoint,
  normalizeLng,
  cameraRotation,
  rotateAbout,
} from "./projection.js";
export { computeSceneBounds } from "./bounds.js";
export type { LngLatBox } from "./bounds.js";
// Wave 2a hardening: deep parser + migration shim for untrusted GeoCustomData input.
export {
  parseGeoCustomData,
  migrate,
  GeoCustomDataParseError,
} from "./parseGeoCustomData.js";
export { normalizeElementsForExport } from "./canonicalExport.js";
// Scale-mode utilities — consumed by @atlasdraw/basemap's CoordinateSync
// (see docs/superpowers/plans/2026-05-25-remaining-debt-approach.md §5).
export {
  computeScaleFactor,
  clampHybridFactor,
  HYBRID_FACTOR_MIN,
  HYBRID_FACTOR_MAX,
} from "./scaleMode.js";
// ADR-0015 spike — world coordinates.
export {
  WORLD_TILE_SIZE,
  MAX_MERCATOR_LAT,
  mercatorX,
  mercatorY,
  frameAt,
  toScene,
  toLngLat,
  viewportFor,
  cameraFor,
} from "./world.js";
export type {
  WorldFrame,
  MapCamera,
  SceneViewport,
  ScenePoint,
} from "./world.js";
export { migrateElementV1 } from "./migrateV1.js";
