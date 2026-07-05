// @atlasdraw/data — barrel.
//
// Phase 2 Wave 1b T10 implemented the GeoJSON parser in ./geojson; Wave 2b
// T13 (MapEditor drop import) is the first consumer that imports from the
// package root, so the barrel re-export is added here. CSV and Shapefile
// followed in Phase 3. Future format adapters (KML/GPX — still unimplemented)
// should follow the same pattern — re-export their parser entry point
// through this file rather than from a deep path.

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
// Phase 6 A8 — `CsvReadOptions` adds an optional Photon geocoder hook.
export {
  parseCSV,
  CSVParseError,
  CSV_HEURISTIC_THRESHOLD,
  CSV_HEURISTIC_THRESHOLD_SMALL_DATASET,
} from "./csv";
export type { CsvReadOptions } from "./csv";

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

// Phase 5 Task 4 — Yjs CRDT type model for real-time data layers.
export {
  YjsLayer,
  addFeature,
  deleteFeature,
  setProperty,
  appendVertex,
  deleteVertex,
} from "./yjs-layer";
export { toGeoJSON, observeLayer } from "./yjs-snapshot";

// Phase 5 Task 8 — Yjs AES-GCM Encryption Layer (stub, not wired).
// Phase 6 wires if Option B selected; drops if Option A confirmed.
// See ADR-0010: docs/architecture/adr/0010-yjs-e2ee-threat-model.md
export { encryptUpdate, decryptUpdate } from "./yjs-crypto";

// Base64url helpers shared by yjs-crypto.ts and, downstream, atlas-app's
// scene-crypto.ts — both frame AES-GCM IV/ciphertext the same way over
// different payload shapes (raw Yjs updates vs. Excalidraw scene JSON).
export { uint8ArrayToBase64Url, base64UrlToUint8Array } from "./base64url";

// Phase 5 Task 12 — Undo behavior under distributed state.
// Yjs UndoManager wrapped with per-user origin scoping so User A's undo
// never silently removes User B's work.
export { CollabUndoManager } from "./collab-undo-manager";

// Phase 6 A11 — `.excalidrawlib` reader + built-in atlas library index.
// Powers the atlas-app AssetLibraryPanel (Phase 6 A12) which pushes the
// bundled wildfire / transit / hazard fixtures into Excalidraw's built-in
// library via `excalidrawAPI.updateLibrary({ libraryItems, merge: true })`.
export { parseLibraryFile, getBuiltInLibraries } from "./asset-library";
export type { ExcalidrawLibrary, LibraryParseError } from "./asset-library";
