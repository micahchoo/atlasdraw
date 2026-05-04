# `packages/basemap` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0 (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/basemap`
**Phase skeleton:** Phase 0; core implemented Phase 1; style-compiler schema Phase 3; categorical/graduated compiler Phase 6

---

## Overview

`packages/basemap` is the React-facing MapLibre wrapper. It provides the `<MapCanvas>` component (the bottom layer of the dual-canvas stack), the basemap style registry, the pmtiles protocol registration, and the style-compiler that translates user-authored `LayerStyle` objects into MapLibre `LayerSpecification` expressions. It contains the only React component in the geo-foundation packages.

---

## Major Files and Responsibilities

### `MapCanvas.tsx`
**Phase:** Phase 1 [Phase 1 plan, Task 3 "packages/basemap — MapCanvas Component"]
**Responsibility:** The React shell around a `maplibregl.Map` instance. Manages the map's DOM mount/unmount lifecycle. Exposes a `ref` of type `maplibregl.Map` to the parent (`MapEditor`). Handles style switching without crashing during mid-load state. Applies `pointer-events: none` on itself — all pointer routing is managed by `MapEditor`.
**Dependencies:** `BasemapRegistry.ts`, `pmtiles-protocol.ts`; external: `maplibre-gl`, `react`
**Complexity:** ~150 lines, cyclomatic ~8
**Invariant:** `ref.current` is `null` before mount and after unmount. Never `null` during a mounted lifecycle. Style switch never throws even if map is mid-load.
[CONFIDENCE: high — per Phase 1 plan Task 3]

### `BasemapRegistry.ts`
**Phase:** Phase 1 [Phase 1 plan, Task 3]
**Responsibility:** A registry mapping string style IDs (e.g. `"protomaps-light"`, `"protomaps-dark"`, `"protomaps-satellite"`) to MapLibre style URLs or inline style objects. Supports PMTiles-backed offline styles and network-backed styles. Default style is `"protomaps-light"` (per Q3: hybrid basemap default, PMTiles bundled).
**Dependencies:** `pmtiles-protocol.ts`; external: none at import time
**Complexity:** ~80 lines, cyclomatic ~4
**Endorheic basin:** The registry is a module-level `Map<string, StyleEntry>`. Flushed only on module reload (never at runtime). Custom styles are registered via `BasemapRegistry.register(id, entry)` — persists for the session.
[CONFIDENCE: high — per Phase 1 plan, Q3]

### `pmtiles-protocol.ts`
**Phase:** Phase 1 [Phase 1 plan, Task 3 Step 2]
**Responsibility:** Registers the `pmtiles://` protocol handler on the `maplibregl` singleton once, using a module-level boolean guard to prevent double-registration. The guard is important because React's StrictMode double-mounts components.
**Dependencies:** external: `pmtiles`, `maplibre-gl`
**Complexity:** ~30 lines, cyclomatic ~2
[CONFIDENCE: high — per Phase 1 plan Step 2]

### `style-builder.ts`
**Phase:** Phase 1 [Phase 1 plan, Task 3]
**Responsibility:** Builds the MapLibre style JSON object for a given `BasemapStyle` entry. Handles the layering of pmtiles sources, OpenFreeMap demo sources, and the user's vector/raster data layers. Output is a valid `maplibregl.StyleSpecification`.
**Dependencies:** `BasemapRegistry.ts`; external: `maplibre-gl` types
**Complexity:** ~120 lines, cyclomatic ~6
[CONFIDENCE: med — spec mentions style-builder in Phase 1; internal structure extrapolated]

### `style-compiler.ts`
**Phase:** Schema + solid-color support Phase 3; categorical and graduated expressions completed Phase 6 [Phase 6 plan, Task 10]
**Responsibility:** Compiles user-authored `LayerStyle` objects into MapLibre `LayerSpecification` expressions consumable by `map.addLayer()`. Three rendering modes:
- **Solid color:** direct paint property assignment
- **Categorical:** produces `["match", ["get", field], ...stops, default]`
- **Graduated:** produces `["interpolate", ["linear"|"step"], ["get", field], ...stops]`

**Hot-path:** `compileLayerStyle()` is called on every layer add/update from the Style Editor (Phase 6) and from plugin-authored styles (Phase 7).
**Dependencies:** none internal; external: `maplibre-gl` types
**Complexity:** ~180 lines, cyclomatic ~12 (3 mode branches × 4 layer type branches)
[CONFIDENCE: high — per Phase 6 plan Task 10, Phase 6 produces contract table]

### `index.ts`
**Phase:** Phase 0 (skeleton), Phase 1+ (populated)
**Responsibility:** Barrel export.
**Complexity:** ~15 lines

---

## Cross-Subsystem Notes

- `apps/atlas-app/components/MapEditor.tsx` is the primary consumer of `<MapCanvas>`. It stacks MapLibre (bottom, `pointer-events: none`) and Excalidraw (top, `pointer-events: auto` when drawing).
- `packages/geo/CoordinateSync` receives the `maplibregl.Map` instance that `<MapCanvas>` exposes via ref.
- `packages/data` uses `style-compiler` indirectly through the layer rendering pipeline.
- Phase 7 plugin sandbox consumes `LayerStyle` type and `compileLayerStyle` for plugin-authored styles (per Phase 6 produces contract).
