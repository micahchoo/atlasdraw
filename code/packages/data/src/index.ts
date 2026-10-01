// @atlasdraw/data — barrel.
//
// Phase 2 Wave 1b T10 implemented the GeoJSON parser in ./geojson; Wave 2b
// T13 (MapEditor drop import) is the first consumer that imports from the
// package root, so the barrel re-export is added here. CSV and Shapefile
// followed in Phase 3. Format adapters re-export their parser entry point
// through this file rather than from a deep path.

export {
  parse,
  GeoJSONParseError,
  requireHomogeneousGeometry,
  splitByGeometryKind,
  geometryKindOf,
} from "./geojson";
export type { AtlasGeometryKind, GeometryKindPart } from "./geojson";

// KML, KMZ and GPX → GeoJSON. Output can mix geometry kinds.
export {
  parseKML,
  parseKMZ,
  parseGPX,
  GeoXmlParseError,
  KML_FOLDER_PROPERTY,
} from "./geoxml";
export type {
  GeoXmlFormat,
  GeoXmlImport,
  GeoXmlParseErrorCode,
} from "./geoxml";

// Phase 3 Wave 0 Task 1 — manifest schema + AtlasdrawDocument runtime type.
export {
  ManifestSchema,
  BasemapRefSchema,
  CameraSchema,
  LayerEntrySchema,
  PermissionsSchema,
  ULIDSchema,
  WorldFrameSchema,
} from "./manifest-schema";
export type {
  Manifest,
  BasemapRef,
  Camera,
  LayerEntry,
  TileLayerEntry,
  Permissions,
  WorldFrameData,
  AtlasdrawDocument,
  SavedComment,
  SceneElement,
} from "./manifest-schema";

// Format migrations: every reader brings an older file to the current version.
export {
  CURRENT_MANIFEST_VERSION,
  MIGRATIONS,
  MigrationError,
  migrate,
} from "./migrations";
export type { MigrationStep, StoredDocument } from "./migrations";

// Phase 3 Wave 1 Task 2/3 — .atlasdraw zip read/write.
export {
  write,
  read,
  AtlasdrawFormatError,
  AtlasdrawWriteCache,
} from "./atlasdraw";

// Phase 3 Wave 1 Task 4 — pure-JSON variant (.atlasdraw.json).
export { writeJSON, readJSON, AtlasdrawJSONError } from "./atlasdraw-json";

// Phase 3 Wave 1 Task 6 — CSV → GeoJSON parser.
// Phase 6 A8 — `CsvReadOptions` adds an optional Photon geocoder hook.
export {
  parseCSV,
  CSVParseError,
  CSV_HEURISTIC_THRESHOLD,
  CSV_HEURISTIC_THRESHOLD_SMALL_DATASET,
} from "./csv";
export type { CsvReadOptions, CsvImportStats } from "./csv";

// Phase 6 A7 — Photon-compatible geocoder client + LRU cache.
// Operator-configured; no default endpoint (ADR-0006 / ADR-0011).
export {
  PhotonGeocoder,
  GeocoderNetworkError,
  GeocoderResponseError,
} from "./geocode";
export type { GeocodeResult, GeocoderConfig } from "./geocode";

// Phase 3 Wave 1 Task 7 — Shapefile → GeoJSON parser.
export { parseShapefile, ShapefileParseError } from "./shapefile";

// Phase 3 Wave 1 Task 5 — Browser-only thumbnail generator (returns null in Node).
export { generateThumbnail } from "./thumbnail";

// FU-1 RA-2 — GeoTIFF decode. Bytes in, pixels plus four lng/lat corners out.
export {
  decodeGeoTiff,
  encodeRasterPng,
  fitWithin,
  RASTER_MAX_DIM,
  RasterDecodeError,
  UnsupportedRasterCrsError,
} from "./geotiff";
export type { DecodedRaster, RasterCorners } from "./geotiff";

// base64url for bytes in URLs (share links).
export { uint8ArrayToBase64Url, base64UrlToUint8Array } from "./base64url";

// Phase 6 A11 — `.excalidrawlib` reader + built-in atlas library index.
// Powers the atlas-app AssetLibraryPanel (Phase 6 A12) which pushes the
// bundled wildfire / transit / hazard fixtures into Excalidraw's built-in
// library via `excalidrawAPI.updateLibrary({ libraryItems, merge: true })`.
export { parseLibraryFile, getBuiltInLibraries } from "./asset-library";
export type { ExcalidrawLibrary, LibraryParseError } from "./asset-library";
