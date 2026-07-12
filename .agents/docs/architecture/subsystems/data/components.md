# `packages/data` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/data`
**Phase skeleton:** Phase 0; GeoJSON Phase 2; KML/GPX/CSV/Shapefile/GeoTIFF Phase 3; YjsLayer Phase 5; Felt importer Phase 6

---

## Overview

`packages/data` is the file format I/O subsystem. Pure parsers and writers — no React, no DOM, no UI. Every parser exports a consistent `{ parse, write }` interface with GeoJSON as the pivot format. It also hosts the `LayerRegistry` type and the Yjs CRDT layer model. No side effects at module level; all state is in caller-provided data structures.

---

## Major Files and Responsibilities

### `geojson.ts`
**Phase:** Phase 2 [Phase 2 plan, Task T10 "Data Layer Import — GeoJSON"]
**Responsibility:** Read and write GeoJSON. The pivot format — all other parsers produce and consume GeoJSON. Validates against GeoJSON spec, wraps loose inputs (bare Geometry, Feature) into `FeatureCollection`. Write produces a clean, deterministic JSON blob.
**Dependencies:** none internal; external: `geojson` types
**Complexity:** ~80 lines, cyclomatic ~5
[CONFIDENCE: high — per tech spec §4.3]

### `kml.ts`
**Phase:** Phase 3 [Phase 3 plan]
**Responsibility:** Parse KML files to GeoJSON FeatureCollection. Uses `togeojson` library. Write produces KML from GeoJSON via the same library.
**Dependencies:** none internal; external: `@tmcw/togeojson`
**Complexity:** ~50 lines, cyclomatic ~3
[CONFIDENCE: high — per tech spec §4.3]

### `gpx.ts`
**Phase:** Phase 3 [Phase 3 plan]
**Responsibility:** Parse GPX track files to GeoJSON. Uses `togeojson`. Write path produces GPX. Preserves track segments, waypoints, routes as distinct feature types.
**Dependencies:** none internal; external: `@tmcw/togeojson`
**Complexity:** ~50 lines, cyclomatic ~3
[CONFIDENCE: high — per tech spec §4.3]

### `csv.ts`
**Phase:** Phase 3 [Phase 3 plan]
**Responsibility:** Parse CSV files with geographic coordinate detection. Two strategies: (1) column-name heuristics (`lat`/`latitude`, `lng`/`lon`/`longitude`, case-insensitive); (2) column-statistics heuristics (numeric columns in valid lat/lng ranges). Address column detection for future geocoding (`address`, `street`, `location` headers). Each row becomes a GeoJSON Point feature; all other columns become feature properties.
**Dependencies:** none internal; external: `papaparse`
**Complexity:** ~120 lines, cyclomatic ~12 (heuristic branches)
[CONFIDENCE: high — per tech spec §4.3]

### `shapefile.ts`
**Phase:** Phase 3 [Phase 3 plan]
**Responsibility:** Parse Shapefile (`.zip` containing `.shp`, `.dbf`, `.prj`) to GeoJSON. Uses `shpjs` (calvinmetcalf/shapefile-js). Accepts `ArrayBuffer` of the zip.
**Dependencies:** none internal; external: `shpjs`
**Complexity:** ~40 lines, cyclomatic ~3
[CONFIDENCE: high — per tech spec §4.3]

### `geotiff.ts`
**Phase:** Phase 3 [Phase 3 plan]
**Responsibility:** Load Cloud-Optimized GeoTIFF (COG) files via `geotiff.js`. Returns not a GeoJSON FeatureCollection but a `RasterLayerSpec` describing the COG source for use with MapLibre's `raster` source type via the `cog://` protocol plugin. The `parse` return type is a discriminated union to accommodate this.
**Dependencies:** none internal; external: `geotiff`
**Complexity:** ~80 lines, cyclomatic ~5
[CONFIDENCE: med — COG handling is more complex than vector formats; exact API extrapolated from spec §4.3]

### `atlasdraw.ts`
**Phase:** Phase 2 [Phase 2 plan, native format serialization]
**Responsibility:** Read and write the `.atlasdraw` native format (per tech spec §6). Serializes the full scene: Excalidraw elements (with `customData.geo` preserved), layer metadata, basemap style ID, viewport state. The write path uses `excalidrawToGeo` from `packages/geo` to re-derive canonical GeoJSON for portability. The parse path calls `geoToExcalidraw` to reconstruct element skeletons.
**Dependencies:** `packages/geo` (`excalidrawToGeo`, `geoToExcalidraw`, `GeoAnchor`); external: none
**Complexity:** ~150 lines, cyclomatic ~8
[CONFIDENCE: high — per tech spec §6, Phase 2 plan]

### `felt.ts`
**Phase:** Phase 6 [Phase 6 plan, Task 15 "Felt importer — implementation"; Q13 read-only]
**Responsibility:** Read-only import of Felt's `.felt` export format (GeoJSON FeatureCollection from Felt Layer Exports API, or `Felt-Export.zip`). Maps Felt's layer model to Atlasdraw's layer model. Permissive: `console.warn` on unknown feature types, never throws, always returns best partial output. No write path; no round-trip sync.
**Dependencies:** `geojson.ts`; external: none
**Complexity:** ~120 lines, cyclomatic ~10
[CONFIDENCE: high — per Phase 6 plan Task 15, Q13]

### `layer-registry.ts`
**Phase:** Phase 2 [Phase 2 plan]
**Responsibility:** **Type definition only** for the `LayerRegistry` shape. The runtime Zustand slice (`useLayerRegistry`) lives in `apps/atlas-app/state/store.ts` — not in this package. This file provides the TypeScript interface that the Zustand slice is typed against.

**MISMATCH-2 note (cross-phase audit):** Phase 3 plan incorrectly attributes `LayerRegistry` source to `packages/geo`. The correct attribution: type lives here (`packages/data/layer-registry.ts`); Zustand runtime slice lives at `apps/atlas-app/state/store.ts` (exported as `useLayerRegistry`). This package owns the type; `apps/atlas-app` owns the state.

**Dependencies:** none internal; external: none (pure type declarations)
**Complexity:** ~40 lines, cyclomatic 1
[CONFIDENCE: high — per cross-phase audit MISMATCH-2, Phase 2 plan]

### `yjs-layer.ts`
**Phase:** Phase 5 [Phase 5 plan, Task 4 "packages/data — YjsLayer Type Model"]
**Responsibility:** Yjs CRDT layer model. Wraps a `Y.Doc` with a typed layer structure: top-level `Y.Map<string, Y.Map>` keyed by layer ID; per-layer `Y.Map` keyed by `FeatureId`; per-feature `Y.Map` with `type`, `properties` (nested `Y.Map`), `geometry` (`Y.Map` with `coordinates` as `Y.Array<Y.Array<[number, number]>>`). Exports mutation helpers: `addFeature`, `deleteFeature`, `setProperty`, `appendVertex`, `deleteVertex`.
**Dependencies:** none internal; external: `yjs`
**Complexity:** ~180 lines, cyclomatic ~8
[CONFIDENCE: high — per Phase 5 plan Task 4]

### `yjs-snapshot.ts`
**Phase:** Phase 5 [Phase 5 plan, Task 4 Step 3]
**Responsibility:** Converts a `YjsLayer` Yjs document into a GeoJSON FeatureCollection snapshot for rendering, export, and diff comparison. Read-only projection — does not mutate the Y.Doc.
**Dependencies:** `yjs-layer.ts`, `geojson.ts`; external: `yjs`
**Complexity:** ~60 lines, cyclomatic ~4
[CONFIDENCE: high — per Phase 5 plan Task 4]

### `index.ts`
**Phase:** Phase 0 (skeleton), Phase 2+ (populated)
**Responsibility:** Barrel export.
**Complexity:** ~20 lines

---

## Cross-Subsystem Notes

- `packages/geo` is an upstream dependency — `packages/data` uses `GeoAnchor`, `geoToExcalidraw`, `excalidrawToGeo`.
- `apps/atlas-app/state/store.ts` uses `LayerRegistry` type from this package.
- `packages/cli` uses `geojson`, `kml`, `gpx`, `shapefile`, `atlasdraw` for the `convert` command.
- `packages/sdk` serialization path uses `atlasdraw.ts` (via the editor's save flow in `apps/atlas-app`).
