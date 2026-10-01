// @atlasdraw/geo — public surface.
export * from "./types.js";
export { computeSceneBounds } from "./bounds.js";
export type { LngLatBox } from "./bounds.js";
export { rotateAbout, shapeCenter, shapeOutline } from "./sceneGeometry.js";
export type { SceneShape } from "./sceneGeometry.js";
export {
  WORLD_TILE_SIZE,
  MAX_MERCATOR_LAT,
  REFERENCE_ZOOM,
  mercatorX,
  mercatorY,
  frameAt,
  documentFrame,
  sceneUnitsPerPixel,
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
export { migrateElementV1, savedCameraTurn } from "./migrateV1.js";
export type { V1Element } from "./migrateV1.js";
export { areaOf, geodesicDistance, lengthOf } from "./measure.js";
export type { LngLat } from "./measure.js";
export {
  measureShape,
  scenePathLength,
  sceneRingArea,
} from "./sceneMeasure.js";
export type { MeasurableShape, ShapeMeasure } from "./sceneMeasure.js";
