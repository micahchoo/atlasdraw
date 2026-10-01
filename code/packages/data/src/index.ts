// @atlasdraw/data — barrel.
//
// Format adapters re-export their parser entry point through this file;
// consumers import from the package root, not from a deep path.

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

// Manifest schema and the AtlasdrawDocument runtime type.
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

// .atlasdraw zip read/write.
export {
  write,
  read,
  AtlasdrawFormatError,
  AtlasdrawWriteCache,
} from "./atlasdraw";

// Pure-JSON variant (.atlasdraw.json).
export { writeJSON, readJSON, AtlasdrawJSONError } from "./atlasdraw-json";

// CSV → GeoJSON parser, with an optional Photon geocoder hook
// (`CsvReadOptions.geocoder`).
export {
  parseCSV,
  CSVParseError,
  CSV_HEURISTIC_THRESHOLD,
  CSV_HEURISTIC_THRESHOLD_SMALL_DATASET,
} from "./csv";
export type { CsvReadOptions, CsvImportStats } from "./csv";

// FeatureCollection → the text of a GeoJSON or CSV file, for the
// layer panel's "Export as …" items. The inverse of `parse` and `parseCSV`.
export { toGeoJSONText, toCSV, toWKT, csvGeometryMode } from "./export";
export type { CsvGeometryMode, GeoJSONTextOptions } from "./export";

// Photon-compatible geocoder client + LRU cache. Operator-configured; no
// default endpoint (docs/architecture/adr/0006-telemetry.md and
// 0011-hosted-mode-telemetry.md).
export {
  PhotonGeocoder,
  GeocoderNetworkError,
  GeocoderResponseError,
} from "./geocode";
export type { GeocodeResult, GeocoderConfig } from "./geocode";

// Shapefile → GeoJSON parser.
export { parseShapefile, ShapefileParseError } from "./shapefile";

// Browser-only thumbnail generator (returns null in Node).
export { generateThumbnail } from "./thumbnail";

// GeoTIFF decode. Bytes in, pixels plus four lng/lat corners out.
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

// `.excalidrawlib` reader + built-in atlas library index. The atlas-app
// AssetLibraryPanel pushes the bundled libraries into Excalidraw's own
// library with `excalidrawAPI.updateLibrary({ libraryItems, merge: true })`.
export { parseLibraryFile, getBuiltInLibraries } from "./asset-library";
export type { ExcalidrawLibrary, LibraryParseError } from "./asset-library";
