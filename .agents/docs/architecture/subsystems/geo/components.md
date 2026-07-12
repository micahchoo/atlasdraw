# `packages/geo` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/geo`
**Phase skeleton:** Phase 0 (Phase 1 implements fully)

---

## Overview

`packages/geo` is the pure-math core of Atlasdraw. It owns the coordinate bridge between MapLibre's geographic space (WGS84 `lng/lat`) and Excalidraw's scene space (`x, y` unitless). No React, no DOM, no side effects — all exports are pure functions or plain TypeScript types, making this the only package callable from the CLI, Node workers, and unit tests without a browser.

---

## Major Files and Responsibilities

### `types.ts`
**Phase:** Phase 1 [CHANGE SITE — tech spec §3.1, Phase 1 plan artifact manifest]
**Responsibility:** Canonical type definitions for the geo subsystem. **This is the authoritative source for `GeoAnchor`.** All other packages reference these types; they do not redefine them.
**Key exports:** `GeoAnchor`, `GeoCustomData`, `ScaleMode`, `Projection`
**Dependencies:** None (pure types, no runtime imports)
**Complexity:** ~60 lines, cyclomatic 1 (type declarations only)
**Notes:** MISMATCH-1, MISMATCH-3, MISMATCH-5 in cross-phase audit all stem from downstream plans consuming a stale flat-object shape instead of this discriminated union. This file is the single source of truth.

```ts
// Authoritative shape — do not flatten
export type GeoAnchor =
  | { kind: "point";    lng: number; lat: number;                                        zRef: number; projection: "mercator" }
  | { kind: "bbox";     west: number; south: number; east: number; north: number;       zRef: number; projection: "mercator" }
  | { kind: "polyline"; coordinates: Array<[number, number]>;                           zRef: number; projection: "mercator" };
```
[CONFIDENCE: high — per Phase 1 plan, tech spec §3.1, escalations E-03, Q12]

### `CoordinateSync.ts`
**Phase:** Phase 1 [Phase 1 plan, Task 4 "CoordinateSync — The Brain"]
**Responsibility:** The synchronization engine. Subscribes to MapLibre camera events (`move`, `zoom`, `rotate`, `pitch`), throttles to 16 ms, and re-projects every geo-anchored element's pixel position via `map.project()`. Calls `excalidrawAPI.updateScene()` with `captureUpdate: "never"` to avoid undo-history pollution.
**Dependencies:** `types.ts` (GeoAnchor), `projection.ts` (project wrappers), external: `maplibre-gl`, `@excalidraw/excalidraw` API
**Complexity:** ~200 lines, cyclomatic ~15 (3 GeoAnchor kind branches × 5 scaleMode paths)
**Hot-path:** `syncMapToScene()` — called on every animation frame during pan/zoom. Every ms saved here affects perceived smoothness. No allocations in the inner loop.
**Invariant:** `syncMapToScene` never writes `customData.geo` — reads it, writes `x/y/width/height/points` only. The geo anchor is the source of truth; pixel position is derived.
[CONFIDENCE: high — per Phase 1 plan Flow A, tech spec §3]

### `projection.ts`
**Phase:** Phase 1
**Responsibility:** Thin wrappers around `map.project(lngLat)` and `map.unproject(point)`. Exists so the projection dependency can be swapped for an offscreen/headless implementation (needed by `packages/cli` for server-side rendering without a live MapLibre instance).
**Dependencies:** `maplibre-gl` (interface only — injected, not imported directly)
**Complexity:** ~40 lines, cyclomatic ~3
[CONFIDENCE: high — per tech spec §4.1]

### `geoToExcalidraw.ts`
**Phase:** Phase 1
**Responsibility:** Converts a `GeoJSON.Feature` (any geometry type) into an `ExcalidrawElementSkeleton` with `customData.geo` populated from the feature's geometry. The bridge used at import time.
**Dependencies:** `types.ts`, `@excalidraw/excalidraw` (skeleton types), `geojson` types
**Complexity:** ~100 lines, cyclomatic ~8 (point/linestring/polygon/multipolygon branches)
[CONFIDENCE: high — per tech spec §4.1]

### `excalidrawToGeo.ts`
**Phase:** Phase 1
**Responsibility:** Inverse of `geoToExcalidraw`. Reads `customData.geo` from an Excalidraw element and reconstructs a `GeoJSON.Feature`. Used at export time by `packages/data` parsers and `packages/cli convert`.
**Dependencies:** `types.ts`, `geojson` types
**Complexity:** ~80 lines, cyclomatic ~6
[CONFIDENCE: high — per tech spec §4.1]

### `measure.ts`
**Phase:** Phase 2 [Phase 2 plan, Task T08 measure tool]
**Responsibility:** Turf.js wrappers exposing real-world measurement: `area(el)`, `length(el)`, `centroid(el)`. All return SI units (m², m). Called by the MeasureTool and AreaTool in `packages/tools`.
**Dependencies:** `types.ts`, `@turf/turf` (tree-shaken: `area`, `length`, `centroid`, `feature`)
**Complexity:** ~60 lines, cyclomatic ~5
**Hot-path:** `length()` called on every pointer-move while MeasureTool is active.
[CONFIDENCE: high — per tech spec §4.1]

### `bounds.ts`
**Phase:** Phase 2
**Responsibility:** Computes the geographic bounding box (`LngLatBoundsLike`) of an arbitrary set of Excalidraw elements, by union of each element's `customData.geo` bounds. Used for "fit to selection" and export viewport calculation.
**Dependencies:** `types.ts`, `maplibre-gl` (LngLatBounds)
**Complexity:** ~50 lines, cyclomatic ~4
[CONFIDENCE: high — per tech spec §4.1]

### `index.ts`
**Phase:** Phase 0 (skeleton), Phase 1 (populated)
**Responsibility:** Barrel export. Re-exports everything from all modules above.
**Complexity:** ~20 lines

---

## Cross-Subsystem Notes

- `packages/basemap` imports `CoordinateSync` and `GeoAnchor`.
- `packages/data` imports `GeoAnchor`, `geoToExcalidraw`, `excalidrawToGeo` for serialization.
- `packages/tools` imports `GeoAnchor`, `measure`, `bounds`.
- `packages/sdk` imports `GeoAnchor` (for postMessage API types).
- `packages/cli` imports `projection`, `geoToExcalidraw`, `excalidrawToGeo`, `bounds` (headless, no React).
- `apps/atlas-app` imports `CoordinateSync` (the only React-adjacent consumer — but CoordinateSync itself stays React-free).
