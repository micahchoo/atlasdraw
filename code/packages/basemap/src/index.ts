// @atlasdraw/basemap — the MapLibre map (MapCanvas), the camera bridge, the
// basemap catalog and style loading, and the data-layer style compiler.

export { MapCanvas } from "./MapCanvas";
export type { MapCanvasProps, MapCanvasInitialView } from "./MapCanvas";

// Rotation gestures are off unless a view ships a way back to north.
export {
  applyRotationPolicy,
  disableCameraRotation,
  enableCameraRotation,
  setCameraRotation,
} from "./cameraRotation";

export type {
  FilterOp,
  FilterStyle,
  LabelStyle,
  LayerStyle,
  PointDisplay,
  SizeStyle,
  StyleExpression,
} from "./style";
export {
  compileLayer,
  compileLayers,
  compileOutlinePaint,
  compilePaint,
  outlineLayerId,
  defaultLayerStyle,
  compileFilter,
  filterProblem,
  labelLayerId,
  labelProblem,
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  clusterCountLayerId,
  clusterLayerId,
  compileSourceOptions,
  pointProblem,
  POINT_RADIUS_MAX,
  POINT_RADIUS_MIN,
} from "./style-compiler";
export type {
  CompiledPaint,
  CompileLayersOptions,
  LayerGeometryType,
} from "./style-compiler";

export {
  BASEMAPS,
  getBasemap,
  registerBasemap,
  listBasemaps,
} from "./BasemapRegistry";
export type { BasemapConfig } from "./BasemapRegistry";

export { registerPmtilesProtocol } from "./pmtiles-protocol";

export { buildStyle } from "./style-builder";
export type { BuildStyleOptions } from "./style-builder";

// Resolver and remote gate. The caller supplies the pmtiles path (see the
// resolver.ts boundary contract); this package reads no environment variables.
export { resolveStyle, BasemapRemoteGatedError } from "./resolver";
export type { ResolveStyleOptions } from "./resolver";

// The map camera drives Excalidraw's viewport
// (docs/architecture/adr/0015-world-coordinates-gate.md).
export { CameraBridge } from "./CameraBridge";
export type { BridgeMap, BridgeScene, CameraBridgeStats } from "./CameraBridge";
