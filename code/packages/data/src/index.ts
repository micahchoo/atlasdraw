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
