// @atlasdraw/data — barrel.
//
// Phase 2 Wave 1b T10 implemented the GeoJSON parser in ./geojson; Wave 2b
// T13 (MapEditor drop import) is the first consumer that imports from the
// package root, so the barrel re-export is added here. Future format
// adapters (KML/GPX/CSV) will follow the same pattern — re-export their
// parser entry point through this file rather than from a deep path.

export {
  parse,
  GeoJSONParseError,
  requireHomogeneousGeometry,
} from "./geojson";
export type { AtlasGeometryKind } from "./geojson";

// Phase 3 Wave 0 Task 1 — manifest schema + AtlasdrawDocument runtime type.
export {
  ManifestSchema,
  BasemapRefSchema,
  CameraSchema,
  LayerEntrySchema,
  PermissionsSchema,
  ULIDSchema,
} from "./manifest-schema";
export type {
  Manifest,
  BasemapRef,
  Camera,
  LayerEntry,
  Permissions,
  AtlasdrawDocument,
  SceneElement,
} from "./manifest-schema";

// Phase 3 Wave 1 Task 2/3 — .atlasdraw zip read/write.
export { write, read, AtlasdrawFormatError } from "./atlasdraw";

// Phase 3 Wave 1 Task 4 — pure-JSON variant (.atlasdraw.json).
export { writeJSON, readJSON, AtlasdrawJSONError } from "./atlasdraw-json";

// Phase 3 Wave 1 Task 6 — CSV → GeoJSON parser.
export {
  parseCSV,
  CSVParseError,
  CSV_HEURISTIC_THRESHOLD,
  CSV_HEURISTIC_THRESHOLD_SMALL_DATASET,
} from "./csv";

// Phase 3 Wave 1 Task 7 — Shapefile → GeoJSON parser.
export { parseShapefile, ShapefileParseError } from "./shapefile";

// Phase 3 Wave 1 Task 5 — Browser-only thumbnail generator (returns null in Node).
export { generateThumbnail } from "./thumbnail";

// Phase 5 Task 4 — Yjs CRDT type model for real-time data layers.
export { YjsLayer, addFeature, deleteFeature, setProperty, appendVertex, deleteVertex } from "./yjs-layer";
export { toGeoJSON, observeLayer } from "./yjs-snapshot";
