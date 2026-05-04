# Phase 1 — Geo Foundation
**Weeks 2–5 (extended per Q7)**
**Date:** 2026-05-03
**Status:** Ready to execute

---

## Goal

A rectangle drawn on MapLibre stays glued to its lat/lng coordinates during pan and zoom, across all five target browsers, with coordinate-sync performance measured within the Spec §8 budget. At phase end, a first-time visitor can open the app, see a Protomaps Light basemap, activate the Pin tool, drop pins on landmarks, pan and zoom freely, and watch every pin remain exactly over its location.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  apps/atlas-app                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MapEditor.tsx (absolute-positioned stack)           │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  Excalidraw layer  (z-index: 1)               │  │   │
│  │  │  pointer-events: auto|none (tool-gated)        │  │   │
│  │  │  viewBackgroundColor: transparent              │  │   │
│  │  │  scrollbars: off, grid: off                    │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  <MapCanvas> (z-index: 0)                     │  │   │
│  │  │  maplibregl.Map — camera source of truth       │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │                                                      │   │
│  │  useCoordinateSync hook                              │   │
│  │   map.on("move|zoom|rotate|pitch")                   │   │
│  │     → CoordinateSync.syncMapToScene()                │   │
│  │     → excalidrawAPI.updateScene({captureUpdate:"never"}) │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

packages/geo                        packages/basemap
  types.ts                            MapCanvas.tsx
    GeoAnchor (point|bbox|polyline)     pmtiles-protocol.ts
    GeoCustomData                       BasemapRegistry
  CoordinateSync.ts                     style-builder.ts
    syncMapToScene()
    syncSceneToMap()
    projectElement()
  projection.ts
  geoToExcalidraw.ts
  excalidrawToGeo.ts
  bounds.ts
  measure.ts (stub)
  index.ts

packages/tools
  PinTool.ts
  PinPopup.tsx
  types.ts (AtlasdrawTool)

bench/
  synthetic-scene-gen.ts
  coord-sync.bench.ts
  results/phase-1-baseline.json
```

---

## Tech Stack Additions (Phase 1)

| Library | Purpose | License |
|---|---|---|
| `maplibre-gl` | Map renderer, camera, `project`/`unproject` | BSD-3-Clause |
| `pmtiles` (pmtiles JS) | PMTiles protocol adapter for MapLibre | MIT |
| `lodash.throttle` | Throttle `syncMapToScene` to 16ms | MIT |
| `fast-check` | Property-based testing for coord round-trips | MIT |
| `@playwright/test` | Cross-browser E2E test matrix | Apache-2.0 |

No other new runtime dependencies in Phase 1.

---

## Phase Boundary Contracts

### Consumes (from Phase 0)

- Turborepo monorepo workspace at `/mnt/Ghar/2TA/DevStuff/atlasdraw/` with `apps/atlas-app`, `packages/` scaffold.
- Excalidraw fork running as `packages/excalidraw` (stripped of PWA/analytics/branding per Spec §1).
- ADR-0001 (fork rationale), ADR-0002 (license split), ADR-0003 (coord system) present in `docs/decisions/`.
- GitHub Actions CI pipeline (green, Node 20+22, vitest passing).
- No geo packages, no MapLibre, no coordinate sync — Phase 0 is pure Excalidraw baseline.

### Produces (for downstream phases)

| Artifact | Consumed by |
|---|---|
| `packages/geo` (public exports: `CoordinateSync`, `GeoAnchor`, `GeoCustomData`, `projectElement`, `geoToExcalidraw`, `excalidrawToGeo`, `bounds`) | Phase 2 (data layers), Phase 3 (file format), Phase 5 (collab CRDT) |
| `packages/basemap` (`<MapCanvas>`, `BasemapRegistry`, `pmtiles-protocol`) | Phase 2 (layer panel), Phase 4 (style editor) |
| `packages/tools/PinTool` (AtlasdrawTool contract) | Phase 2 (all geo-aware tools) |
| `apps/atlas-app/components/MapEditor.tsx` | Phase 2 (add LayerPanel), Phase 4 (embed) |
| `apps/atlas-app/hooks/useCoordinateSync.ts` | Phase 2 (extended to data-layer elements) |
| `bench/results/phase-1-baseline.json` (p50/p95/p99 frame times) | Phase 2 benchmark regression gate (+20% budget) |
| Browser test matrix (`docs/test-matrix/phase-1.md`) | Phase 4 (expanded for embed), Phase 5 (collab) |

---

## Flow Map Preamble

Two critical flows run through this phase. Every implementation task sits on one of these two spines. Subagents: read the flow node your task occupies; you don't need to trace the full flow.

### Flow A — Pan/Zoom → CoordinateSync → Scene Update

```
map.on("move|zoom|rotate|pitch")
  → [throttle 16ms]
  → useCoordinateSync.handleCameraChange()
  → CoordinateSync.syncMapToScene()
  → loop: projectElement(el) for each geo-anchored element
      → map.project([lng, lat])  (Flow A.1: point)
      → map.project(nw) + map.project(se)  (Flow A.2: bbox)
      → map.project each coordinate, offset to local  (Flow A.3: polyline)
      → apply scaleMode factor (geographic | screen | hybrid)
  → excalidrawAPI.updateScene({ elements: updated, captureUpdate: "never" })
  → Excalidraw re-renders canvas (all elements repositioned)
```

Invariant: `syncMapToScene` never writes `customData.geo` — it reads it and writes `x/y/width/height/points` only. Geo anchor is the source of truth; pixel position is derived.

### Flow B — Pointer-Down → Tool Dispatch → Element Creation → Geo Anchor Write

```
user pointer-down on MapEditor
  → isDrawingMode check (pointer-events gate)
      → if false: event passes through to MapLibre (pan/drag)
      → if true: Excalidraw captures event
  → Excalidraw tool dispatch
      → customType: "pin" → PinTool.onPointerDown(e, ctx)
          → ctx.map.unproject([e.clientX, e.clientY]) → LngLat
          → createPinElement(lngLat, ctx.appState)
              → GeoAnchor { kind: "point", lng, lat, zRef: map.getZoom() }
              → GeoCustomData { geo, scaleMode: "screen", schemaVersion: 1, projection: "mercator" }
          → excalidrawAPI.updateScene({ elements: [...existing, newPinEl] })
  → Flow A triggers immediately (map "move" not fired, but scene update applied)
```

Invariant: every element created by a geo-aware tool must exit `onPointerDown` with a valid `GeoCustomData` in `customData`. An element without a geo anchor is invisible to `syncMapToScene`.

---

## File Structure

One-line responsibility per file. Files marked `[NEW]` are created in this phase; `[MOD]` are modified.

```
packages/geo/
  types.ts [NEW]
    — GeoAnchor discriminated union (point|bbox|polyline), GeoCustomData with projection field (Q12)
  CoordinateSync.ts [NEW]
    — syncMapToScene(), syncSceneToMap(), projectElement(); throttled hot path
  projection.ts [NEW]
    — Thin wrappers around map.project/unproject for future worker-offload seam
  geoToExcalidraw.ts [NEW]
    — Converts GeoJSON Feature → ExcalidrawElementSkeleton with customData.geo populated
  excalidrawToGeo.ts [NEW]
    — Inverse: reads customData.geo from ExcalidrawElement, returns GeoAnchor
  bounds.ts [NEW]
    — Computes geographic bbox of an arbitrary set of geo-anchored elements
  measure.ts [NEW]
    — Turf.js stub: area(), length(), centroid() — returns null; Phase 2 fills in
  index.ts [NEW]
    — Public barrel: re-exports only the stable surface consumed by downstream packages
  package.json [NEW]
    — "name": "@atlasdraw/geo", MIT license, no React dep
  __tests__/
    CoordinateSync.test.ts [NEW]
      — Unit: syncMapToScene with mocked map.project; point/bbox/polyline cases
    projection.property.test.ts [NEW]
      — Property-based (fast-check): project(unproject(p)) ≈ p within float epsilon
    geoToExcalidraw.test.ts [NEW]
      — Unit: GeoJSON Point/Polygon/LineString → element with correct customData
    excalidrawToGeo.test.ts [NEW]
      — Unit: element with geo anchor → correct GeoAnchor round-trip

packages/basemap/
  MapCanvas.tsx [NEW]
    — React component; mounts maplibregl.Map, exposes instance via forwardRef, manages style
  BasemapRegistry.ts [NEW]
    — BASEMAPS array: protomaps-light, protomaps-dark, openfreemap-bright
  pmtiles-protocol.ts [NEW]
    — Registers pmtiles:// protocol on maplibregl once, idempotently (guard flag)
  style-builder.ts [NEW]
    — Builds MapLibre style JSON from BasemapRegistry entry; stub for Maputnik in Phase 6
  index.ts [NEW]
    — Public barrel
  package.json [NEW]
    — "name": "@atlasdraw/basemap", MPL-2.0 license
  __tests__/
    MapCanvas.test.tsx [NEW]
      — Component test (vitest + @testing-library/react); mocks maplibregl

packages/tools/
  types.ts [NEW]
    — AtlasdrawTool interface (id, icon, cursor, onPointerDown, defaultScaleMode)
  PinTool.ts [NEW]
    — Pin tool: creates point GeoAnchor, scaleMode: "screen", customType: "pin"
  PinPopup.tsx [NEW]
    — React popup shown on pin click; receives lngLat + element label as props
  index.ts [NEW]
    — Public barrel
  package.json [NEW]
    — "name": "@atlasdraw/tools", AGPL-3.0 license
  __tests__/
    PinTool.test.ts [NEW]
      — Unit: onPointerDown produces correct GeoCustomData with projection: "mercator"

apps/atlas-app/
  components/
    MapEditor.tsx [NEW]
      — Absolute-positioned stack: <MapCanvas> z=0, <Excalidraw> z=1 transparent
  hooks/
    useCoordinateSync.ts [NEW]
      — Wires map.on("move|zoom|rotate|pitch") → CoordinateSync.syncMapToScene()
    useToolState.ts [NEW]
      — Tracks active Excalidraw tool; exposes isDrawingMode boolean
    useMapRef.ts [NEW]
      — Manages maplibregl.Map ref lifecycle (mount/unmount safety)
  styles/
    MapEditor.module.css [NEW]
      — Positioning and pointer-events rules for the stack

bench/
  synthetic-scene-gen.ts [NEW]
    — Generates N geo-anchored ExcalidrawElements with random point/bbox/polyline anchors
  coord-sync.bench.ts [NEW]
    — Vitest bench: runs syncMapToScene on 5k elements, records frame time
  results/
    phase-1-baseline.json [NEW]
      — Written by bench run: { p50, p95, p99, budget: "<8ms", pass: bool }

docs/test-matrix/
  phase-1.md [NEW]
    — Browser/tool manual test matrix: Chrome/Firefox/Safari/iOS Safari/Android Chrome × pan/zoom/draw/pin
```

---

## Tasks

---

### Task 1: [Wave 0] Types Schema — GeoAnchor + GeoCustomData [CHANGE SITE]

**Orient:** Every downstream task in this phase depends on the `GeoAnchor` discriminated union and `GeoCustomData` type. This task establishes the contract all other tasks read from — it must ship before any implementation begins.

**Flow position:** Step 0 of Flow A and Flow B (types precede both flows; no upstream node)

**Upstream contract:** Phase 0 Phase 0 workspace skeleton — packages/excalidraw exists, ExcalidrawElement type is importable.

**Downstream contract:** Exports `GeoAnchor`, `GeoCustomData`, `ScaleMode` to `CoordinateSync`, `PinTool`, `geoToExcalidraw`, `excalidrawToGeo`. Behavioral invariant: `GeoCustomData.schemaVersion` is always literal `1`; `projection` is always `"mercator"` (per Q12, to reserve the field for future CRS support).

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/geo/types.ts`
- Create: `packages/geo/__tests__/types.test.ts`
- Create: `packages/geo/package.json`
- Create: `packages/geo/index.ts`

- [ ] **Step 1:** Write a minimal type-only test that imports the types and asserts the discriminated union covers all three kinds.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: FAIL — module not found.

- [ ] **Step 2:** Create `packages/geo/package.json` with `"name": "@atlasdraw/geo"`, `"license": "MIT"`, `"main": "index.ts"`, peer dep on `maplibre-gl`.

- [ ] **Step 3:** Create `packages/geo/types.ts` with `GeoAnchor` (point | bbox | polyline), `GeoCustomData` (geo, scaleMode, schemaVersion: 1, projection: "mercator"), `ScaleMode` type alias, `SCHEMA_VERSION = 1` constant.

  Apply Q12: include `projection: "mercator"` as a required field in `GeoCustomData`. Comment: "Reserved for future CRS support per Q12."

- [ ] **Step 4:** Create `packages/geo/index.ts` barrel exporting types.

- [ ] **Step 5:** Run test.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: PASS — type import test green.

- [ ] **Step 6:** Commit.

  Run: `git add packages/geo/`
  `git commit -m "feat(geo): add GeoAnchor types, GeoCustomData with projection field (Q12)"`
  Expected: clean commit, CI green on type-only package.

---

### Task 2: [Wave 0] Types Schema — AtlasdrawTool Interface [CHANGE SITE]

**Orient:** The AtlasdrawTool interface is the contract PinTool implements and MapEditor consumes — it must exist before either. Establishing it in Wave 0 prevents interface drift between tasks that run in parallel in Wave 2+.

**Flow position:** Step 0 of Flow B (precedes tool dispatch node; no upstream node)

**Upstream contract:** `GeoCustomData` from Task 1 (tools write it on pointer-down).

**Downstream contract:** `AtlasdrawTool` exported from `packages/tools/types.ts`. Invariant: every tool declares `defaultScaleMode: ScaleMode`.

**Skill:** none

**Files:**
- Create: `packages/tools/types.ts`
- Create: `packages/tools/package.json`
- Create: `packages/tools/index.ts`

- [ ] **Step 1:** Create `packages/tools/package.json` with `"name": "@atlasdraw/tools"`, `"license": "AGPL-3.0"`, peer deps on `@atlasdraw/geo`, `maplibre-gl`, `react`.

- [ ] **Step 2:** Create `packages/tools/types.ts` with `AtlasdrawTool` interface: `{ id: string; icon: React.FC; cursor: string; defaultScaleMode: ScaleMode; onPointerDown(e: PointerEvent, ctx: ToolContext): void }` and `ToolContext` type: `{ map: maplibregl.Map; excalidrawAPI: ExcalidrawImperativeAPI; elements: readonly ExcalidrawElement[] }`.

- [ ] **Step 3:** Create barrel `packages/tools/index.ts`.

- [ ] **Step 4:** Verify TypeScript compiles.

  Run: `pnpm --filter @atlasdraw/tools exec tsc --noEmit`
  Expected: 0 errors.

- [ ] **Step 5:** Commit.

  Run: `git commit -m "feat(tools): add AtlasdrawTool interface and ToolContext"`

---

### Task 3: [Wave 1a] `packages/basemap` — MapCanvas Component [CHANGE SITE]

**Orient:** `<MapCanvas>` is the React shell around `maplibregl.Map`. It must exist before `MapEditor` can stack the two layers. This task creates the basemap package and its central component.

**Flow position:** Step 1 of Flow A (map instance → useCoordinateSync → syncMapToScene; this node creates the map instance)

**Upstream contract:** None — leaf node in the dependency graph, mounts against the DOM.

**Downstream contract:** `<MapCanvas ref={mapRef} styleId="protomaps-light" />` where `mapRef.current` is a live `maplibregl.Map` instance after mount. Invariant: ref is null before mount and after unmount; never throws on style switch while elements are loading.

**Skill:** `characterization-testing`

**Codebooks:** `interactive-spatial-editing`

**Files:**
- Create: `packages/basemap/MapCanvas.tsx`
- Create: `packages/basemap/BasemapRegistry.ts`
- Create: `packages/basemap/pmtiles-protocol.ts`
- Create: `packages/basemap/style-builder.ts`
- Create: `packages/basemap/__tests__/MapCanvas.test.tsx`
- Create: `packages/basemap/package.json`
- Create: `packages/basemap/index.ts`

- [ ] **Step 1:** Create `packages/basemap/package.json` with `"name": "@atlasdraw/basemap"`, `"license": "MPL-2.0"`, deps: `maplibre-gl`, `pmtiles`, peer: `react`.

- [ ] **Step 2:** Create `packages/basemap/pmtiles-protocol.ts`. Register `pmtiles://` on `maplibregl` once using a module-level boolean guard. Export `registerPmtilesProtocol()`.

- [ ] **Step 3:** Create `packages/basemap/BasemapRegistry.ts` with `BASEMAPS` array containing at minimum: `protomaps-light` (PMTiles via local bundle), `protomaps-dark`, `openfreemap-bright` (public URL). Export `BasemapEntry` type and `getBasemap(id: string)` helper.

- [ ] **Step 4:** Create `packages/basemap/style-builder.ts` — `buildStyle(entry: BasemapEntry): maplibregl.StyleSpecification`. For Phase 1, returns `entry.styleUrl` as a string reference (full custom build is Phase 6). Export `buildStyle`.

- [ ] **Step 5:** Create `packages/basemap/MapCanvas.tsx`. Use `React.forwardRef<maplibregl.Map, MapCanvasProps>`. On mount: call `registerPmtilesProtocol()`, instantiate `maplibregl.Map` with container ref, set `style: buildStyle(basemap)`. **Per OQ-2:** Pass `maxPitch: 0` and `pitchWithRotate: false` in `MapOptions` at construction — this enforces Phase 1's pitch=0 constraint at the MapLibre boundary, keeping CoordinateSync projection-agnostic. On style prop change: call `map.setStyle(...)`. On unmount: `map.remove()`. Props: `styleId: string`, `initialViewState?: { center, zoom }`, `className?: string`.

- [ ] **Step 6:** Write characterization test for `MapCanvas`. Mock `maplibregl` entirely via `vi.mock`. Assert: map instantiated on mount, `map.remove` called on unmount, `map.setStyle` called on styleId prop change.

  Run: `pnpm --filter @atlasdraw/basemap test`
  Expected: PASS — 3 characterization tests green.

- [ ] **Step 7:** Commit.

  Run: `git commit -m "feat(basemap): add MapCanvas component, pmtiles protocol, BasemapRegistry"`

---

### Task 4: [Wave 1b] `packages/geo` — CoordinateSync Skeleton + projection.ts [CHANGE SITE]

**Orient:** `CoordinateSync` is the brain of Phase 1. This task builds the class skeleton with working `projectElement` stubs so the type surface is stable and parallel tasks (Tasks 5, 6, 7) can implement against it immediately.

**Flow position:** Step 2 of Flow A (map.on("move") → **CoordinateSync.syncMapToScene()** → excalidrawAPI.updateScene)

**Upstream contract:** Receives `maplibregl.Map` instance and `ExcalidrawImperativeAPI` at construction. `map.project([lng, lat])` must return `{ x: number; y: number }`.

**Downstream contract:** `syncMapToScene()` reads `el.customData as GeoCustomData`, calls `projectElement(el)` for each, calls `excalidrawAPI.updateScene({ elements, captureUpdate: "never" })`. Invariant: elements without `customData.geo` are returned unchanged; `captureUpdate: "never"` is always passed to prevent undo stack pollution.

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/geo/CoordinateSync.ts`
- Create: `packages/geo/projection.ts`
- Create: `packages/geo/__tests__/CoordinateSync.test.ts`

- [ ] **Step 1:** Write failing unit tests for `syncMapToScene`:
  - Test A: element without `customData.geo` is returned unchanged.
  - Test B: element with `kind: "point"` anchor gets `x/y` updated from `map.project`.
  - Test C: `captureUpdate: "never"` is passed to `updateScene`.
  Mock `maplibregl.Map` with `project: vi.fn().mockReturnValue({ x: 100, y: 200 })`.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: FAIL — CoordinateSync not defined.

- [ ] **Step 2:** Create `packages/geo/projection.ts`. Export `projectPoint(map, lng, lat): { x: number; y: number }` and `unprojectPoint(map, x, y): { lng: number; lat: number }`. These are thin delegates; the seam exists so the worker-offload path (future) can swap them without touching CoordinateSync.

- [ ] **Step 3:** Create `packages/geo/CoordinateSync.ts`. Class with constructor `(map: maplibregl.Map, excalidrawAPI: ExcalidrawImperativeAPI)`. Implement `syncMapToScene()` with correct `captureUpdate: "never"`. Implement `projectElement()` as a switch on `geo.kind` — point arm working, bbox and polyline arms returning `{ ...el }` stubs. Implement `syncSceneToMap(el)` as a stub returning a default point anchor (fills in Tasks 5–7).

- [ ] **Step 4:** Run tests.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: Tests A and C PASS; Test B PASS; polyline/bbox tests not yet written.

- [ ] **Step 5:** Commit.

  Run: `git commit -m "feat(geo): CoordinateSync skeleton + projection.ts wrappers"`

---

### Task 5: [Wave 2a] Geo Math — projectElement for Point Anchor [CHANGE SITE]

**Orient:** The point anchor is the simplest projection case and the one used by PinTool — getting it right verifies the round-trip contract that all other anchor kinds extend.

**Flow position:** Step 3a of Flow A (CoordinateSync.syncMapToScene → **projectElement: point** → updated element)

**Upstream contract:** Receives `ExcalidrawElement` with `customData.geo.kind === "point"`, `{ lng, lat, zRef }`, and `scaleMode`. `map.project([lng, lat])` is assumed accurate.

**Downstream contract:** Returns `{ ...el, x: screenX, y: screenY }`. For `scaleMode: "screen"`, width/height unchanged. For `scaleMode: "geographic"`, width/height derived from pixel-per-degree at current zoom (not yet implemented — Task 8). Invariant: input `customData.geo` is never mutated.

**Skill:** `test-driven-development`

**Files:**
- Modify: `packages/geo/CoordinateSync.ts` (point arm of `projectElement`)
- Modify: `packages/geo/__tests__/CoordinateSync.test.ts`

- [ ] **Step 1:** Expand test file with point-projection test suite:
  - At zoom 12, `map.project([0, 0])` returns `{ x: 500, y: 400 }` — element should have `x: 500, y: 400`.
  - After zoom change, map returns different `{ x, y }` — element updates.
  - `customData.geo` object is not mutated.

  Run: `pnpm --filter @atlasdraw/geo test -- --reporter=verbose`
  Expected: new tests FAIL.

- [ ] **Step 2:** Implement the `kind: "point"` arm in `projectElement`. Use `projectPoint()` from `projection.ts`. Return `{ ...el, x: p.x, y: p.y }`.

- [ ] **Step 3:** Run tests.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all point-anchor tests PASS.

- [ ] **Step 4:** Commit.

  Run: `git commit -m "feat(geo): implement point anchor projection in CoordinateSync"`

---

### Task 6: [Wave 2b] Geo Math — projectElement for BBox Anchor [CHANGE SITE]

**Orient:** The bbox anchor is used by rectangles and polygons drawn over geographic areas — the archetypal demo element that "stays glued to a building."

**Flow position:** Step 3b of Flow A (CoordinateSync.syncMapToScene → **projectElement: bbox** → updated element)

**Upstream contract:** `customData.geo.kind === "bbox"`, `{ west, south, east, north, zRef }`. `map.project` for NW and SE corners.

**Downstream contract:** Returns `{ ...el, x: nw.x, y: nw.y, width: se.x - nw.x, height: se.y - nw.y }`. Invariant: `width` and `height` are always positive; if projection yields negative (unusual camera angle), clamp to 1.

**Skill:** `test-driven-development`

**Files:**
- Modify: `packages/geo/CoordinateSync.ts` (bbox arm)
- Modify: `packages/geo/__tests__/CoordinateSync.test.ts`

- [ ] **Step 1:** Write bbox tests:
  - NW projects to `{ x: 100, y: 100 }`, SE to `{ x: 300, y: 250 }` → element has `x:100, y:100, width:200, height:150`.
  - Verify negative-dimension guard.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: bbox tests FAIL.

- [ ] **Step 2:** Implement `kind: "bbox"` arm. Compute `nw = projectPoint(map, geo.west, geo.north)`, `se = projectPoint(map, geo.east, geo.south)`. Apply positive guard.

- [ ] **Step 3:** Run tests.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all PASS including previous point tests.

- [ ] **Step 4:** Commit.

  Run: `git commit -m "feat(geo): implement bbox anchor projection in CoordinateSync"`

---

### Task 7: [Wave 2c] Geo Math — projectElement for Polyline Anchor [CHANGE SITE]

**Orient:** Polyline anchor handles routes and freehand paths. It requires computing local-relative points after projecting all coordinates — Excalidraw stores polyline points relative to element origin.

**Flow position:** Step 3c of Flow A (CoordinateSync.syncMapToScene → **projectElement: polyline** → updated element)

**Upstream contract:** `customData.geo.kind === "polyline"`, `{ coordinates: [lng, lat][], zRef }`. Receives array of at least 2 coordinate pairs.

**Downstream contract:** Returns `{ ...el, x: minX, y: minY, points: [[0,0], [dx1,dy1], ...] }` where each point is relative to `(minX, minY)`. Invariant: `el.points[0]` is always `[0, 0]`.

**Skill:** `test-driven-development`

**Files:**
- Modify: `packages/geo/CoordinateSync.ts` (polyline arm)
- Modify: `packages/geo/__tests__/CoordinateSync.test.ts`

- [ ] **Step 1:** Write polyline tests:
  - Two-point line: projects to `[{x:10,y:20}, {x:30,y:50}]` → `x:10, y:20, points:[[0,0],[20,30]]`.
  - Three-point line with minimum not at index 0.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: polyline tests FAIL.

- [ ] **Step 2:** Implement `kind: "polyline"` arm. Project all coordinates, compute `minX = Math.min(...xs)`, `minY = Math.min(...ys)`, offset each point.

- [ ] **Step 3:** Run full test suite.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all 3 anchor kinds PASS.

- [ ] **Step 4:** Commit.

  Run: `git commit -m "feat(geo): implement polyline anchor projection in CoordinateSync"`

---

### Task 8: [Wave 2d] Geo Math — scaleMode (geographic | screen | hybrid) [CHANGE SITE]

**Orient:** Scale mode controls whether an element's pixel size changes with zoom. Without it, all geographic elements would visually balloon or shrink incorrectly as the user zooms in/out.

**Flow position:** Step 3.5 of Flow A — applies after `projectElement` computes position, modifies `width/height` or `points` scale factor.

**Upstream contract:** `projectElement` output (position computed) + `scaleMode` field from `GeoCustomData` + `zRef` (zoom at creation) + `map.getZoom()` (current zoom).

**Downstream contract:** Final element with correctly scaled pixel dimensions. Invariant for `screen`: width/height unchanged from stored values. Invariant for `geographic`: width/height scale with `2^(currentZoom - zRef)`. Invariant for `hybrid`: scale factor = `clamp(2^(currentZoom - zRef), 2^-2, 2^2)` (clamped to ±2 zoom levels of `zRef`).

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/geo/scaleMode.ts`
- Modify: `packages/geo/CoordinateSync.ts` (apply scale factor after position)
- Modify: `packages/geo/__tests__/CoordinateSync.test.ts`

- [ ] **Step 1:** Create `packages/geo/scaleMode.ts`. Export `computeScaleFactor(mode: ScaleMode, zRef: number, currentZoom: number): number`. geographic = `Math.pow(2, currentZoom - zRef)`, screen = `1`, hybrid = `Math.min(4, Math.max(0.25, Math.pow(2, currentZoom - zRef)))`.

- [ ] **Step 2:** Write tests for all three modes at multiple zoom deltas. Verify hybrid clamps at ±2 zoom level delta.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: scaleMode tests FAIL (function not in CoordinateSync yet).

- [ ] **Step 3:** Apply `computeScaleFactor` in CoordinateSync `projectElement` after position computation. Scale `width * factor`, `height * factor`, and polyline points by `factor`.

- [ ] **Step 4:** Run tests.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all PASS.

- [ ] **Step 5:** Commit.

  Run: `git commit -m "feat(geo): scaleMode trichotomy (geographic|screen|hybrid) in projectElement"`

---

### Task 9: [Wave 2e] Geo Math — Property-Based Round-Trip Tests [CHANGE SITE]

**Orient:** Manual tests can miss floating-point edge cases. Property-based tests with `fast-check` catch projection drift across the full lng/lat space — this is the correctness gate before Phase 1 ships.

**Flow position:** Verification node for Flow A (projectElement) + Flow B (syncSceneToMap inverse)

**Upstream contract:** `projectElement` for all three anchor kinds, `syncSceneToMap` (inverse path via `unprojectPoint`).

**Downstream contract:** `bench/results/phase-1-baseline.json` is not written here — that's Task 17. This task establishes correctness; Task 17 establishes speed.

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/geo/__tests__/projection.property.test.ts`
- Modify: `packages/geo/CoordinateSync.ts` (complete `syncSceneToMap` inverse for point anchor)

- [ ] **Step 1:** Install `fast-check` in `packages/geo`.

  Run: `pnpm --filter @atlasdraw/geo add -D fast-check`
  Expected: package.json updated.

- [ ] **Step 2:** Write property test: `fc.property(fc.float({min:-179,max:179}), fc.float({min:-85,max:85}), (lng, lat) => { project then unproject; assert |lng' - lng| < 1e-6 && |lat' - lat| < 1e-6 })`. Use a mock `maplibregl.Map` that implements actual Mercator math (use `maplibre-gl`'s `MercatorCoordinate.fromLngLat` to build the mock — do not invent the math).

- [ ] **Step 3:** Run 100 property trials.

  Run: `pnpm --filter @atlasdraw/geo test -- --reporter=verbose`
  Expected: 100/100 trials PASS; if any fail, the projection math has a bug — fix it before moving on.

- [ ] **Step 4:** Implement `syncSceneToMap` for `kind: "point"` in `CoordinateSync.ts` (call `unprojectPoint(map, el.x, el.y)` → returns `GeoCustomData`).

- [ ] **Step 5:** Run full geo test suite.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all tests including property tests PASS. Record final count.

- [ ] **Step 6:** Commit.

  Run: `git commit -m "test(geo): property-based coord round-trip tests with fast-check"`

---

### Task 10: [Wave 2f] Geo Exports — geoToExcalidraw + excalidrawToGeo [CHANGE SITE]

**Orient:** Downstream phases (Phase 2 data layers, Phase 3 file format) import GeoJSON and need a reliable conversion to/from ExcalidrawElement. Establishing this now creates the contract the rest of the system depends on.

**Flow position:** Utility flow — not on A or B critical path, but consumed by both at import/export boundaries.

**Upstream contract:** GeoJSON `Feature` with geometry `Point | Polygon | LineString`. Excalidraw `ExcalidrawElement` with `customData.geo` populated.

**Downstream contract:** `geoToExcalidraw(feature): ExcalidrawElementSkeleton` — produces the minimal shape accepted by Excalidraw's programmatic creation API. `excalidrawToGeo(el): GeoAnchor | null` — returns null for non-geo elements (safe for downstream to filter on).

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/geo/geoToExcalidraw.ts`
- Create: `packages/geo/excalidrawToGeo.ts`
- Create: `packages/geo/bounds.ts` *(add-on per OQ-5 resolution)*
- Create: `packages/geo/__tests__/geoToExcalidraw.test.ts`
- Create: `packages/geo/__tests__/excalidrawToGeo.test.ts`
- Create: `packages/geo/__tests__/bounds.test.ts` *(add-on per OQ-5 resolution)*

- [ ] **Step 1:** Write tests for `geoToExcalidraw`:
  - GeoJSON Point → element with `customData.geo.kind === "point"`, `scaleMode: "screen"`.
  - GeoJSON Polygon → element with `customData.geo.kind === "bbox"`, `scaleMode: "geographic"`.
  - GeoJSON LineString → element with `customData.geo.kind === "polyline"`, `scaleMode: "hybrid"`.

- [ ] **Step 2:** Implement `geoToExcalidraw.ts`. Map geometry type to anchor kind; set sensible default scaleMode per spec §3.4 table; populate `projection: "mercator"`, `schemaVersion: 1`.

- [ ] **Step 3:** Write tests for `excalidrawToGeo`: element with geo anchor returns correct type; element without returns null.

- [ ] **Step 4:** Implement `excalidrawToGeo.ts`.

- [ ] **Step 5 (OQ-5):** Create `packages/geo/bounds.ts`. Export `computeSceneBounds(elements: ExcalidrawElement[]): LngLatBounds | null` — iterate elements, filter those with `customData.geo`, union their coordinate extents into a `LngLatBounds`. Returns `null` if no geo elements. Write one unit test: array with no geo elements returns null. This is the complete Phase 1 implementation; Phase 2 is the first real consumer.

- [ ] **Step 6:** Update `packages/geo/index.ts` to export `geoToExcalidraw`, `excalidrawToGeo`, `computeSceneBounds`.

- [ ] **Step 7:** Run tests.

  Run: `pnpm --filter @atlasdraw/geo test`
  Expected: all PASS.

- [ ] **Step 8:** Commit.

  Run: `git commit -m "feat(geo): geoToExcalidraw + excalidrawToGeo converters + computeSceneBounds (OQ-5)"`

---

### Task 11: [Wave 3] App Layer — Stack MapEditor (MapCanvas + Excalidraw) [CHANGE SITE]

**Orient:** This is the first time the two coordinate systems share a DOM — the visual keystone. Getting the CSS stacking, transparent background, and disabled Excalidraw chrome right is a prerequisite for all subsequent visible-result testing.

**Flow position:** Step 1 of the composite flow: DOM construction that enables both Flow A and Flow B.

**Upstream contract:** `<MapCanvas>` from Task 3 exists and exports correct ref type. `packages/excalidraw` exports `<Excalidraw>` with `viewBackgroundColor`, `gridModeEnabled`, `scrollModeEnabled` props.

**Downstream contract:** `MapEditor` renders both layers in an absolute-positioned container; `mapRef.current` is populated after mount; `excalidrawAPI` ref is populated after Excalidraw initialization. Invariant: Excalidraw canvas background is `transparent` (verified visually — map tiles show through).

**Skill:** `characterization-testing`

**Files:**
- Create: `apps/atlas-app/components/MapEditor.tsx`
- Create: `apps/atlas-app/styles/MapEditor.module.css`
- Create: `apps/atlas-app/hooks/useMapRef.ts`

- [ ] **Step 1:** Create `apps/atlas-app/styles/MapEditor.module.css`. Define `.root` (position: relative, width/height: 100%), `.mapLayer` (position: absolute, inset: 0, z-index: 0), `.excalidrawLayer` (position: absolute, inset: 0, z-index: 1).

- [ ] **Step 2:** Create `apps/atlas-app/hooks/useMapRef.ts`. Returns a `React.RefCallback<maplibregl.Map>` that stores the instance in a ref and triggers a state update so dependent hooks re-render when the map is available.

- [ ] **Step 3:** Create `apps/atlas-app/components/MapEditor.tsx`. Mount `<MapCanvas>` in `.mapLayer`, mount `<Excalidraw>` in `.excalidrawLayer` with `viewBackgroundColor="transparent"`, `gridModeEnabled={false}`, `scrollModeEnabled={false}`. Expose `onMount?: (mapInstance: maplibregl.Map, api: ExcalidrawImperativeAPI) => void` prop.

  Stub: pointer-events toggle is wired to a hardcoded `isDrawingMode: false` — Task 13 fills this in.

- [ ] **Step 4:** Mount `<MapEditor>` in `apps/atlas-app/app/page.tsx` (or equivalent root). Verify in browser: map tiles render, Excalidraw canvas is transparent (tiles visible through it).

  Run: `pnpm --filter atlas-app dev`
  Expected: browser shows map tiles with Excalidraw toolbar overlaid; canvas background is transparent; no console errors.

- [ ] **Step 5:** Write characterization test for `MapEditor`: assert both `MapCanvas` and `Excalidraw` are rendered in the DOM. Mock both.

  Run: `pnpm --filter atlas-app test`
  Expected: PASS.

- [ ] **Step 6:** Commit.

  Run: `git commit -m "feat(app): stack MapCanvas + Excalidraw in MapEditor, transparent canvas"`

---

### Task 12: [Wave 3] App Layer — useCoordinateSync Hook [CHANGE SITE]

**Orient:** The hook is the wire between the map's camera events and `CoordinateSync.syncMapToScene`. Without it, element positions never update on pan/zoom — the whole demo is inert.

**Flow position:** Step 2 of Flow A (map.on("move") → **useCoordinateSync** → CoordinateSync.syncMapToScene)

**Upstream contract:** Receives `maplibregl.Map | null` and `ExcalidrawImperativeAPI | null`; both may be null while mounting. Must not call sync if either is null.

**Downstream contract:** On every `"move"`, `"zoom"`, `"rotate"`, `"pitch"` event, calls `sync.syncMapToScene()` throttled to at most once per 16ms (`lodash.throttle`). Invariant: throttle is cancelled on cleanup to prevent calling sync after unmount.

**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/hooks/useCoordinateSync.ts`
- Modify: `apps/atlas-app/components/MapEditor.tsx` (wire hook)

- [ ] **Step 1:** Add `lodash.throttle` to `apps/atlas-app`.

  Run: `pnpm --filter atlas-app add lodash.throttle && pnpm --filter atlas-app add -D @types/lodash.throttle`
  Expected: installed.

- [ ] **Step 2:** Write unit tests for `useCoordinateSync`:
  - When map fires "move", `syncMapToScene` is called.
  - When map fires 10 "move" events in 5ms, `syncMapToScene` is called at most twice (throttle behavior).
  - On unmount, no further calls after cleanup.
  Use `vi.useFakeTimers()`.

- [ ] **Step 3:** Create `apps/atlas-app/hooks/useCoordinateSync.ts`. Use `useEffect` with map and API as deps. Register all four event types. Throttle the handler at 16ms. Return `void`.

- [ ] **Step 4:** Wire `useCoordinateSync` into `MapEditor.tsx` using the `onMount` callback from Task 11.

- [ ] **Step 5:** Run tests.

  Run: `pnpm --filter atlas-app test`
  Expected: PASS.

- [ ] **Step 6:** Manual verification: pan the map in the browser.

  Run: `pnpm --filter atlas-app dev`
  Expected: if a geo-anchored element exists in the scene, it should track the map during pan. (Full verification comes in Task 15 after PinTool exists.)

- [ ] **Step 7:** Commit.

  Run: `git commit -m "feat(app): useCoordinateSync hook wires map events to CoordinateSync (16ms throttle)"`

---

### Task 13: [Wave 3] Event Routing — Pointer-Events Toggle (Tool Gate) [CHANGE SITE]

**Orient:** This is the mechanism that makes Excalidraw and MapLibre share one viewport without conflict. When no draw tool is active, all pointer events must reach MapLibre for pan/zoom. When a draw tool is active, Excalidraw must capture them to create elements. Getting this toggle wrong produces the worst possible UX: a map that won't pan, or a drawing surface that eats every click.

**Flow position:** Decision node of Flow B (pointer-down → **isDrawingMode gate** → MapLibre | Excalidraw)

**Upstream contract:** Active tool state from Excalidraw `AppState.activeTool`. `AppState` is read via `excalidrawAPI.getAppState()` or via onChange callback.

**Downstream contract:** `isDrawingMode: boolean` — true when `activeTool.type !== "hand"` and `activeTool.type !== "selection"`. CSS class on Excalidraw wrapper sets `pointer-events: none | auto` accordingly.

**Skill:** `characterization-testing`

**Codebooks:** `gesture-disambiguation`, `interactive-spatial-editing`

**Files:**
- Create: `apps/atlas-app/hooks/useToolState.ts`
- Modify: `apps/atlas-app/components/MapEditor.tsx` (apply pointer-events toggle)
- Modify: `apps/atlas-app/styles/MapEditor.module.css` (pointer-events classes)

- [ ] **Step 1:** Create `apps/atlas-app/hooks/useToolState.ts`. Subscribe to Excalidraw `onChange`. Track `activeTool.type`. Export `isDrawingMode: boolean` (true for any tool type that is not "hand" or "selection"). Also export `activeTool` for downstream tool-dispatch consumers.

- [ ] **Step 2:** Add `.excalidrawLayerActive` CSS class (pointer-events: auto) and update `.excalidrawLayer` base to pointer-events: none. Apply conditional class in `MapEditor.tsx` based on `isDrawingMode`.

- [ ] **Step 3:** Write characterization tests:
  - When `activeTool.type === "hand"`, wrapper has `pointer-events: none`.
  - When `activeTool.type === "rectangle"`, wrapper has `pointer-events: auto`.

  Run: `pnpm --filter atlas-app test`
  Expected: characterization tests PASS.

- [ ] **Step 4:** Manual verification in browser:
  - Default tool (hand) → mouse click and drag pans the map.
  - Switch to rectangle tool → mouse click and drag draws in Excalidraw.
  - Switch back to hand → panning resumes.

  Run: `pnpm --filter atlas-app dev`
  Expected: both behaviors work without page reload.

- [ ] **Step 5:** Commit.

  Run: `git commit -m "feat(app): pointer-events toggle on Excalidraw wrapper based on active tool"`

---

### Task 14: [Wave 3] First Geo-Aware Tool — PinTool [CHANGE SITE]

**Orient:** PinTool is the first end-to-end proof that Flow B works: user clicks map, pin appears at that lat/lng, survives pan/zoom. This is the demo moment the spec calls out.

**Flow position:** Flow B terminal node (Excalidraw captures event → **PinTool.onPointerDown** → element with GeoCustomData → scene update)

**Upstream contract:** `ToolContext.map` is a live `maplibregl.Map`. `e.clientX/clientY` are viewport coordinates. `scaleMode: "screen"` is the pin default per Spec §3.4.

**Downstream contract:** Creates `ExcalidrawElement` with `customData: { geo: { kind: "point", lng, lat, zRef }, scaleMode: "screen", schemaVersion: 1, projection: "mercator" }`. Invariant: `projection: "mercator"` is always set (Q12).

**Skill:** `test-driven-development`

**Files:**
- Create: `packages/tools/PinTool.ts`
- Create: `packages/tools/PinPopup.tsx`
- Create: `packages/tools/__tests__/PinTool.test.ts`

- [ ] **Step 1:** Write unit tests for `PinTool.onPointerDown`:
  - At mock coordinates `(500, 300)`, map unprojects to `{ lng: -73.98, lat: 40.75 }` — element should have `customData.geo = { kind: "point", lng: -73.98, lat: 40.75, zRef: 12 }`.
  - `scaleMode` must be `"screen"`.
  - `projection` must be `"mercator"` (Q12 assertion).
  - `schemaVersion` must be `1`.

  Run: `pnpm --filter @atlasdraw/tools test`
  Expected: FAIL — PinTool not defined.

- [ ] **Step 2:** Implement `packages/tools/PinTool.ts`. `onPointerDown`: call `ctx.map.unproject([e.clientX, e.clientY])`, build `GeoCustomData`, call `createPinElement` helper that returns an `ExcalidrawElementSkeleton` (use Excalidraw's `newElementWith` or `newTextElement` — pin is a small circle + label), call `ctx.excalidrawAPI.updateScene`.

- [ ] **Step 3:** Create `packages/tools/PinPopup.tsx` — minimal React component that renders a popup with the pin's label and lat/lng. Accept `{ lngLat: { lng, lat }, label: string }` props only — no internal map references (per OQ-4: this keeps the component portable so Phase 2 can mount it via `ReactDOM.createRoot` inside a `maplibregl.Popup` DOM node without rewrite). Styling is CSS-module basic; design polish is Phase 4. Wire to the pin element via `maplibregl.Popup` using `.setDOMContent()` on click.

- [ ] **Step 4:** Run tests.

  Run: `pnpm --filter @atlasdraw/tools test`
  Expected: all PASS including Q12 projection assertion.

- [ ] **Step 5:** Register `PinTool` in `MapEditor.tsx` — use Excalidraw's custom tool registration and add a Pin button to the toolbar (can be a plain icon button for Phase 1; toolbar design is Phase 4).

- [ ] **Step 6:** Manual verification.

  Run: `pnpm --filter atlas-app dev`
  Expected: click Pin button, click map, pin icon appears at click location, pan/zoom and pin stays over same lat/lng.

- [ ] **Step 7:** Commit.

  Run: `git commit -m "feat(tools): PinTool with point GeoAnchor, screen scaleMode, projection:mercator (Q12)"`

---

### Task 15: [Wave 3] End-to-End Smoke Test — Rectangle Stays Glued [CHANGE SITE]

**Orient:** The spec's single acceptance criterion for Phase 1 is: "a rectangle drawn on MapLibre stays glued to its lat/lng during pan/zoom." This task writes the Playwright E2E test that encodes that criterion as an automated check.

**Flow position:** Acceptance verification for the full Flow A + Flow B composite.

**Upstream contract:** `MapEditor` running with coordinate sync active. Rectangle tool draws bbox-anchored elements.

**Downstream contract:** Playwright test in CI matrix: passes on Chrome and Firefox (Webkit/mobile to be added in Task 19). Written to `apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts`.

**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts`
- Create: `apps/atlas-app/playwright.config.ts` (if not already present from Phase 0)

- [ ] **Step 1:** Verify Playwright is installed.

  Run: `pnpm --filter atlas-app exec playwright --version`
  Expected: version string. If not installed: `pnpm --filter atlas-app add -D @playwright/test && pnpm exec playwright install chromium firefox`.

- [ ] **Step 2:** Write E2E test: (a) open app, (b) switch to rectangle tool, (c) draw a rectangle over a known landmark viewport position, (d) record the element's `customData.geo` bbox, (e) pan the map 200px left, (f) assert the element's rendered pixel position has shifted by ~200px in the correct direction, (g) assert `customData.geo` bbox is unchanged (source of truth untouched).

- [ ] **Step 3:** Run on Chrome.

  Run: `pnpm --filter atlas-app exec playwright test e2e/phase-1-geo-foundation.spec.ts --project=chromium`
  Expected: PASS.

- [ ] **Step 4:** Run on Firefox.

  Run: `pnpm --filter atlas-app exec playwright test e2e/phase-1-geo-foundation.spec.ts --project=firefox`
  Expected: PASS. If FAIL: treat as a blocker for Task 19 (cross-browser hardening week).

- [ ] **Step 5:** Commit.

  Run: `git commit -m "test(e2e): rectangle stays glued to lat/lng during pan/zoom (Playwright)"`

---

### Task 16: [SPIKE][Wave 3] Coord-Sync Benchmark Spike [CHANGE SITE]

**Orient:** Per Q8, the `<8ms syncMapToScene on 5k elements` budget is a wish until measured. This spike instruments the hot path with real numbers before Phase 1 is declared done. If the budget is missed by >2x, an incremental projection task is inserted before Phase 2 begins.

**Flow position:** Performance gate node — runs after Flow A is fully implemented (Tasks 4–8), before Phase 1 closure.

**Skill:** `perf-investigation`

**Files:**
- Create: `bench/synthetic-scene-gen.ts`
- Create: `bench/coord-sync.bench.ts`
- Create: `bench/results/phase-1-baseline.json`

- [ ] **Step 1:** Implement `bench/synthetic-scene-gen.ts`. Generates an array of N `ExcalidrawElement` objects with random geo anchors distributed across `{ kind: ["point","bbox","polyline"], scaleMode: ["geographic","screen","hybrid"] }`. Export `generateScene(n: number): ExcalidrawElement[]`.

- [ ] **Step 2:** Implement `bench/coord-sync.bench.ts` using Vitest bench API. Instantiate a `CoordinateSync` with a real `maplibregl.Map` (headless, JSDOM). Call `syncMapToScene()` on a 5,000-element scene 100 times. **Instrument both hot-path segments separately (OQ-3):** wrap the `map.project()` loop with `performance.now()` before/after each call and accumulate, then wrap the `excalidrawAPI.updateScene()` call with `performance.now()` before/after each call separately. Record per-iteration `project_ms`, `updatescene_ms`, and `total_ms`. Compute p50, p95, p99 for each segment independently.
<!-- shape-incorporated 2026-05-03: OQ-3 resolution — replaceAllElements is always O(n); split instrumentation is required so OQ-1 decision rule has segment-level data to act on -->

- [ ] **Step 3:** Run benchmark.

  Run: `pnpm vitest bench bench/coord-sync.bench.ts`
  Expected: benchmark completes; outputs p50/p95/p99 in milliseconds.

- [ ] **Step 4:** Write results to `bench/results/phase-1-baseline.json`. Schema (OQ-1 gating requires segment breakdown):
  ```json
  {
    "timestamp": "<ISO>",
    "nodeVersion": "<string>",
    "platform": "<string>",
    "elementCount": 5000,
    "budget": { "p99_total": 8 },
    "project": { "p50ms": 0, "p95ms": 0, "p99ms": 0 },
    "updateScene": { "p50ms": 0, "p95ms": 0, "p99ms": 0 },
    "total": { "p50ms": 0, "p95ms": 0, "p99ms": 0 },
    "dominantSegment": "project | updateScene | balanced",
    "pass": false
  }
  ```
  Set `dominantSegment` to whichever segment accounts for ≥60% of `total.p99ms`; set to `"balanced"` if neither exceeds 60%.
<!-- shape-incorporated 2026-05-03: OQ-1 decision rule requires per-segment p99 to select incremental projection strategy; flat schema was insufficient -->

- [ ] **Step 5:** Evaluate using total p99 gate first, then segment breakdown to select strategy (OQ-1 + OQ-3):

  **Gate:**
  - If `total.p99ms < 8`: PASS. Set `pass: true`. Add note: "Q8 gate passed." Continue to Task 17.
  - If `8 <= total.p99ms < 16` (within 2x): WARN. Set `pass: true`. Add note: "borderline — monitor in Phase 2." Continue.
  - If `total.p99ms >= 16` (>2x budget): FAIL. Set `pass: false`. **Do not proceed to Task 17.** Activate Task 20 (Conditional) below — select variant by dominant segment:

  **Segment decision rule (only applies when gate fails):**
  | `dominantSegment` | Task 20 Variant | Strategy |
  |---|---|---|
  | `"project"` | Candidate A or B | Viewport-bbox filter (A) or Worker offload via MercatorCoordinate (B) |
  | `"updateScene"` | Candidate C | Dirty-bit diff — pass only changed elements to `updateScene`, not full array |
  | `"balanced"` | Candidate A + C | Both strategies in combination |

  Record chosen variant in `bench/results/phase-1-baseline.json` under `"task20Variant"`.

  Run: `cat bench/results/phase-1-baseline.json`
  Expected: JSON file with `pass` and `dominantSegment` fields populated.
<!-- shape-incorporated 2026-05-03: OQ-1 decision rule formalized as gating table — segment dominance drives Task 20 variant selection; resolves the unstructured "see OQ-1" reference -->

- [ ] **Step 6:** Commit.

  Run: `git commit -m "bench(geo): coord-sync baseline — 5k elements, p50/p95/p99 recorded (Q8 gate)"`

---

### Task 17: [Wave 4] Cross-Browser Hardening — Event Routing (Chrome/Firefox/Safari) [CHANGE SITE]

**Orient:** Per Q7, week 5 is dedicated to event-routing hardening. Pointer events, wheel events, touch events, and the `pointerEvents` CSS toggle behave differently across Chrome, Firefox, Safari, and iOS Safari. This task runs the test matrix and fixes discovered regressions.

**Flow position:** Hardening pass over the pointer-events toggle node (Task 13) and the full Flow B entry point.

**Upstream contract:** Task 13 is complete; Task 15 Playwright smoke test passes on Chrome and Firefox.

**Downstream contract:** All 5 browser columns in `docs/test-matrix/phase-1.md` are checked PASS. Known-broken entries are documented as `[DEFER P2]` with an issue reference.

**Skill:** `characterization-testing`

**Codebooks:** `gesture-disambiguation`, `interactive-spatial-editing`

**Files:**
- Create: `docs/test-matrix/phase-1.md`
- Modify: `apps/atlas-app/components/MapEditor.tsx` (apply browser-specific fixes discovered during hardening)
- Modify: `apps/atlas-app/styles/MapEditor.module.css` (apply browser-specific fixes)

- [ ] **Step 1:** Create `docs/test-matrix/phase-1.md`. Rows: pan-map, zoom-map, draw-rectangle, draw-pin, switch-tool-back-to-hand, touch-pan (mobile), pinch-zoom (mobile). Columns: Chrome, Firefox, Safari (WebKit), iOS Safari (manual), Android Chrome (manual).

- [ ] **Step 2:** Run automated Playwright tests across WebKit (Safari proxy).

  Run: `pnpm --filter atlas-app exec playwright test e2e/phase-1-geo-foundation.spec.ts --project=webkit`
  Expected: ideally PASS; note any failures.

- [ ] **Step 3:** For each Playwright failure, add a regression test that captures the specific failure mode (characterization test pattern: describe the bug, then fix it, then verify the test now passes).

- [ ] **Step 4:** Apply fixes to `MapEditor.tsx` / CSS. Common issues to anticipate:
  - Safari: `pointer-events: none` on a child canvas may not propagate correctly — may need `touch-action: none` on the map layer.
  - Firefox: wheel event `deltaMode` differs — MapLibre handles this, but custom wheel handlers may need `deltaMode` normalization.
  - iOS Safari: `pointerdown` fires before `touchstart`; `pointerEvents: none` on the Excalidraw wrapper may still capture events in some Safari versions — may need explicit `touch-action` rules.

- [ ] **Step 5:** Manually test on iOS Safari and Android Chrome (or BrowserStack). Record results in matrix.

- [ ] **Step 6:** Run full Playwright matrix.

  Run: `pnpm --filter atlas-app exec playwright test e2e/ --project=chromium --project=firefox --project=webkit`
  Expected: all automated browser columns PASS. Manual columns documented in matrix.

- [ ] **Step 7:** Commit.

  Run: `git commit -m "fix(app): cross-browser event-routing hardening for pointer-events toggle (Q7 week 5)"`

---

### Task 18: [Wave 4] Cross-Browser E2E Matrix — Geo Foundation [CHANGE SITE]

**Orient:** The acceptance gate for Phase 1 requires a documented test matrix showing pin-drop and rectangle-geo behavior across all target browsers. This task closes that gate.

**Flow position:** Final acceptance verification node — all preceding tasks must be complete.

**Upstream contract:** Task 17 hardening complete; Task 16 benchmark baseline recorded.

**Downstream contract:** `docs/test-matrix/phase-1.md` is fully populated. Phase 2 plan references this document as its browser-compatibility baseline.

**Skill:** none

**Files:**
- Modify: `docs/test-matrix/phase-1.md`
- Modify: `apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts` (add any missing browser-specific assertions)

- [ ] **Step 1:** Expand Playwright spec to cover: (a) Pin tool — drop pin, pan 200px, verify pin tracks map. (b) Rectangle tool — draw bbox, zoom in 2 levels, verify element stays over correct area. (c) Switch tools: hand → rectangle → hand — verify pointer routing changes correctly each time.

- [ ] **Step 2:** Run full matrix.

  Run: `pnpm --filter atlas-app exec playwright test e2e/ --project=chromium --project=firefox --project=webkit --reporter=html`
  Expected: HTML report at `playwright-report/index.html`. All automated tests PASS.

- [ ] **Step 3:** Fill in the manual test matrix columns (iOS Safari, Android Chrome) with PASS/FAIL/DEFER. Any DEFER must reference a seeds issue.

- [ ] **Step 4:** Add Phase 1 closure note to matrix: benchmark baseline recorded at `bench/results/phase-1-baseline.json`; p99 result; Q8 gate status.

- [ ] **Step 5:** Commit.

  Run: `git commit -m "test(e2e): complete Phase 1 browser test matrix; all automated browsers PASS (Q7 acceptance)"`

---

### Task 19: [Wave 4] CI Green — All Phase 1 Tests [CHANGE SITE]

**Orient:** Phase 1 is not done until CI is green across all Node versions and all test suites. This task audits the full CI matrix and resolves any remaining failures.

**Flow position:** CI gate — runs last in the phase.

**Upstream contract:** All implementation tasks (1–18) complete. `packages/geo`, `packages/basemap`, `packages/tools` are all in `pnpm-workspace.yaml`. GitHub Actions workflow from Phase 0 covers all packages.

**Downstream contract:** GitHub Actions CI pipeline green on main. Node 20 and Node 22. `pnpm test --recursive` exits 0.

**Skill:** none

**Files:**
- Modify: `.github/workflows/ci.yml` (add E2E job if not present; add bench CI step)
- Modify: `pnpm-workspace.yaml` (if new packages not yet registered)

- [ ] **Step 1:** Verify all new packages are in workspace.

  Run: `pnpm -r list --depth 0`
  Expected: `@atlasdraw/geo`, `@atlasdraw/basemap`, `@atlasdraw/tools` listed.

- [ ] **Step 2:** Run full recursive test suite locally.

  Run: `pnpm -r test`
  Expected: all packages exit 0. Note any failures.

- [ ] **Step 3:** Check CI workflow covers: `pnpm -r test` on Node 20 + 22, `playwright test` on chromium + firefox + webkit, `pnpm vitest bench` for the benchmark (report only, not gate — benchmark is informational in CI).

- [ ] **Step 4:** Push to CI and verify.

  Run: `git push` (after human approval)
  Expected: all CI jobs green.

- [ ] **Step 5:** Commit any CI config changes.

  Run: `git commit -m "chore: CI green — Phase 1 packages, E2E, benchmark reporting"`

---

### Task 20: [CONDITIONAL — Wave 5, only if Task 16 Step 5 fails] Incremental Projection
<!-- shape-incorporated 2026-05-03: Task 20 stub promoted from unplanned contingency to visible conditional section; not a committed task — triggers only on p99>=16ms in Task 16; variant selected by dominantSegment field per OQ-1 decision rule -->

**Trigger condition:** `bench/results/phase-1-baseline.json` has `pass: false` (total p99 >= 16ms). Do not start this task otherwise.

**Orient:** If Task 16 reveals that `syncMapToScene` is too slow at 5k elements, the hot path must be made incremental before Phase 2 begins. Phase 2 adds real data layers with potentially many more elements — shipping a known-broken perf profile forward is not acceptable.

**Variant selection:** Read `dominantSegment` from `bench/results/phase-1-baseline.json` (written in Task 16 Step 5):

- **Candidate A (viewport-bbox filter):** `dominantSegment === "project"`. Skip elements whose `customData.geo` coordinates lie outside the current map viewport bbox before calling `map.project()`. Requires calling `map.getBounds()` before the loop. Expected O(n) filter before O(k) projection loop where k << n for typical zoom levels.

- **Candidate B (Worker offload):** `dominantSegment === "project"`, preferred if Candidate A alone doesn't close the gap. Move `projectPoint` calls into a Web Worker using `MercatorCoordinate.fromLngLat` math directly (no MapLibre Map instance in worker). Requires the `projection.ts` seam established in Task 4 — this is exactly the seam it was designed for.

- **Candidate C (dirty-bit diff):** `dominantSegment === "updateScene"`. Add a dirty flag to each geo-anchored element (keyed by element id + `customData.geo` hash). Only pass changed elements to `updateScene`. Requires splitting the single `excalidrawAPI.updateScene({ elements: allElements })` call into: merge changed elements into the existing array, then call `updateScene` with the merged result. Note: `scene.replaceAllElements` is still called on every `updateScene` call — the win is reducing the array size, not eliminating the rebuild.

**Acceptance:** Re-run `bench/coord-sync.bench.ts` after implementing the chosen strategy. Total p99 must be < 8ms. Update `bench/results/phase-1-baseline.json` with a `task20` key recording the strategy applied and the post-fix measurements.

**Files:** TBD based on variant selected. Update this stub with real file list when triggered.

---

## Execution Waves

Dependencies flow left to right. Tasks within the same wave column can be dispatched in parallel.

```
Wave 0         Wave 1          Wave 2                    Wave 3              Wave 4
(Day 1)        (Days 2-3)      (Days 4-7)                (Days 8-12)         (Days 13-20)
                                                                               [Q7 hardening week]

Task 1         Task 3          Task 5 (point)            Task 11 (stack)     Task 17 (cross-browser)
Types:         MapCanvas       Task 6 (bbox)             Task 12 (sync hook) Task 18 (E2E matrix)
GeoAnchor +    in parallel     Task 7 (polyline)         Task 13 (pointer    Task 19 (CI green)
GeoCustomData  with:           Task 8 (scaleMode)          events toggle)
               Task 4          Task 9 (property tests)   Task 14 (PinTool)
Task 2         CoordinateSync  Task 10 (converters)      Task 15 (E2E smoke)
AtlasdrawTool  skeleton                                  Task 16 [SPIKE]
Interface                                                  (benchmark)

SERIAL GATES:
  Wave 0 must complete before any Wave 1 work starts (types define all interfaces)
  Tasks 3 + 4 must complete before Wave 2 starts (projection wrappers needed)
  Tasks 5+6+7+8 (projection) must complete before Task 12 (sync hook) can be tested end-to-end
  Task 13 (pointer-events) must complete before Task 14 (PinTool) can be manually verified
  Task 16 (benchmark) result determines whether an unplanned Task 20 (incremental projection) is needed
  Task 16 + Task 15 must complete before Task 17 (hardening) begins
  Task 17 must complete before Task 18 (test matrix closure)
```

**Parallelizable pairs (no file conflicts):**
- Tasks 3 + 4: different packages, different files entirely.
- Tasks 5 + 6 + 7: same file (`CoordinateSync.ts`) but different switch arms — serialize within the file, parallelize review/test.
- Tasks 9 + 10: different test files, no shared state.
- Tasks 17 + 18 cannot parallelize (18 depends on 17's fixes).
- Tasks 17 + 19 can partly parallelize (19's CI config can be drafted while 17 runs).

---

## Open Questions

These are new questions specific to Phase 1 tasks — not questions already resolved in `open-questions-resolution.md`.

**OQ-1 — Incremental projection under benchmark failure (Q8 escape hatch):**
STILL OPEN — **Blocking before Phase 2** (gated on Task 16 benchmark result).

No benchmark numbers exist yet; Task 16 must run first. The decision rule is formalized in Task 16 Step 5. Summary:

| Segment dominant (≥60% of total p99) | Task 20 Variant | Candidate strategy |
|---|---|---|
| `map.project()` loop | A or B | Viewport-bbox filter (skip off-screen elements) or Worker offload via `MercatorCoordinate` |
| `scene.replaceAllElements()` call | C | Dirty-bit diff — partial `updateScene` with changed elements only |
| Neither (balanced) | A + C | Both strategies combined |

Do not pre-pick a strategy before Task 16 data exists. Task 20 is conditional — see stub below Task 19.
Re-evaluated at Phase 1 closure. If Task 16 passes (total p99 < 8ms), OQ-1 is moot for Phase 1 and downgraded to a Phase 2 monitoring note.
<!-- shape-incorporated 2026-05-03: OQ-1 reframed as Blocking-before-Phase-2 with explicit gating table; decision rule moved from prose to table matching Task 16 Step 5 -->

**OQ-2 — Does `map.project()` return accurate results under pitch/tilt?**
RESOLVED: The plan's premise was incorrect. `map.project()` IS perspective-correct under pitch. Source inspection of MapLibre GL JS `main` branch confirms: `map.project(lnglat)` → `transform.locationToScreenPoint()` → `coordinatePoint(coord, elevation, pixelMatrix)` where `coordinatePoint` applies a full 4D perspective matrix transform (`vec4.transformMat4` + homogeneous divide `p[0]/p[3], p[1]/p[3]`). `_pixelMatrix` is constructed from the full view-projection matrix including camera tilt. With terrain enabled, it additionally uses `_pixelMatrix3D` + elevation lookup. Result: `map.project()` returns correct screen-space coordinates at any pitch.
Source: `maplibre-gl-js/src/geo/projection/mercator_transform.ts` `locationToScreenPoint` + `coordinatePoint`, commit `fd31bd85`.
**Decision (affects Task 3):** Enforce `pitch: 0` via `MapOptions` at MapCanvas construction (`maxPitch: 0`, `pitchWithRotate: false`), not via a CoordinateSync runtime assertion. This moves the constraint to the MapLibre boundary where it belongs. CoordinateSync remains projection-agnostic. Phase 2 can raise `maxPitch` if tilt support is added.

**OQ-3 — What is the actual cost of `excalidrawAPI.updateScene` for 5k elements?**
RESOLVED: Source inspection confirms `updateScene` with `captureUpdate: "never"` does the following: (1) skips Store capture entirely (no history/undo entry — confirmed: `scheduleMicroAction` is only called when `captureUpdate` is truthy); (2) calls `scene.replaceAllElements(elements)` unconditionally; (3) `replaceAllElements` always calls `this.triggerUpdate()` at the end — no diffing, no element-identity short-circuit, full scene rebuild on every call.
Source: `excalidraw/packages/excalidraw/components/App.tsx` line 4559 `updateScene`, `packages/element/src/Scene.ts` line 271 `replaceAllElements` line 300 `this.triggerUpdate()`.
**Impact on Task 16 benchmark:** `updateScene` with `captureUpdate: "never"` avoids undo-stack work but still triggers a full scene replacement and canvas re-render on every call. Task 16 must instrument `map.project()` loop time separately from `updateScene()` call time. If `updateScene` is the bottleneck, the mitigation path is passing only the changed elements (not the full array), which requires OQ-1 dirty-bit strategy. fast-check v4.7.0 confirmed available (npm registry).

**OQ-4 — PinTool popup lifecycle: MapLibre popup or React portal?**
RESOLVED: Use native `maplibregl.Popup` for Phase 1. Rationale: (1) It is map-coordinate-anchored by design — moves correctly during pan/zoom with zero extra code. (2) Phase 1 popup content is minimal (label + lat/lng). (3) A React portal approach requires injecting a React root inside a MapLibre DOM node, which introduces lifecycle complexity (unmounting, event bubbling through two React roots) with no Phase 1 benefit.
Upgrade path for Phase 2: `maplibregl.Popup` accepts any HTML via `.setDOMContent()`. When Phase 2 requires rich React content, mount a portal React root into the popup's DOM node using `ReactDOM.createRoot`. The Phase 1 `PinPopup.tsx` component is written as a plain React component (not tied to the Popup DOM) so it can be mounted this way in Phase 2 without rewriting. **Constraint on Task 14:** `PinPopup.tsx` must accept `{ lngLat, label }` props only — no internal map references — so it remains portable.

**OQ-5 — Should `bounds.ts` be deferred to Phase 2?**
RESOLVED: Implement `bounds.ts` as a Task 10 add-on. Rationale: (1) Implementation is ~5 lines (iterate elements with `customData.geo`, compute bbox union over `GeoAnchor` coordinates). (2) Deferring risks interface drift — Phase 2 data-layer consumers will need `computeSceneBounds()` and if `GeoAnchor` evolves between Phase 1 and Phase 2, the implementation becomes harder. (3) The `index.ts` barrel exports it from day one so downstream packages can import it without a Phase 2 file-creation change. **Constraint on Task 10:** Add one step at the end — create `packages/geo/bounds.ts` exporting `computeSceneBounds(elements: ExcalidrawElement[]): LngLatBounds | null`. No tests required beyond a single unit test for the null (no geo elements) case.

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
```json
{
  "plan": "2026-05-03-atlasdraw-phase-1-geo-foundation",
  "phase": 1,
  "weeks": "2-5",
  "extended_per": "Q7",
  "task_count": 19,
  "wave_count": 4,
  "artifacts": [
    {
      "path": "packages/geo/types.ts",
      "status": "create",
      "task": 1,
      "wave": 0,
      "exports": ["GeoAnchor", "GeoCustomData", "ScaleMode", "SCHEMA_VERSION"],
      "consumed_by": ["packages/geo/CoordinateSync.ts", "packages/tools/PinTool.ts", "packages/geo/geoToExcalidraw.ts", "packages/geo/excalidrawToGeo.ts"]
    },
    {
      "path": "packages/geo/CoordinateSync.ts",
      "status": "create",
      "tasks": [4, 5, 6, 7, 8, 9],
      "wave": "1-2",
      "exports": ["CoordinateSync"],
      "consumed_by": ["apps/atlas-app/hooks/useCoordinateSync.ts", "bench/coord-sync.bench.ts"]
    },
    {
      "path": "packages/geo/projection.ts",
      "status": "create",
      "task": 4,
      "wave": 1,
      "exports": ["projectPoint", "unprojectPoint"],
      "note": "seam for future worker-offload"
    },
    {
      "path": "packages/geo/scaleMode.ts",
      "status": "create",
      "task": 8,
      "wave": 2,
      "exports": ["computeScaleFactor"]
    },
    {
      "path": "packages/geo/geoToExcalidraw.ts",
      "status": "create",
      "task": 10,
      "wave": 2,
      "exports": ["geoToExcalidraw"],
      "consumed_by": ["Phase 2 data layers", "Phase 3 file format"]
    },
    {
      "path": "packages/geo/excalidrawToGeo.ts",
      "status": "create",
      "task": 10,
      "wave": 2,
      "exports": ["excalidrawToGeo"],
      "consumed_by": ["Phase 3 file format export"]
    },
    {
      "path": "packages/geo/index.ts",
      "status": "create",
      "task": 1,
      "note": "public barrel — stable surface for downstream packages"
    },
    {
      "path": "packages/basemap/MapCanvas.tsx",
      "status": "create",
      "task": 3,
      "wave": 1,
      "exports": ["MapCanvas (forwardRef)"],
      "consumed_by": ["apps/atlas-app/components/MapEditor.tsx"]
    },
    {
      "path": "packages/basemap/pmtiles-protocol.ts",
      "status": "create",
      "task": 3,
      "wave": 1,
      "exports": ["registerPmtilesProtocol"]
    },
    {
      "path": "packages/basemap/BasemapRegistry.ts",
      "status": "create",
      "task": 3,
      "wave": 1,
      "exports": ["BASEMAPS", "BasemapEntry", "getBasemap"]
    },
    {
      "path": "packages/tools/types.ts",
      "status": "create",
      "task": 2,
      "wave": 0,
      "exports": ["AtlasdrawTool", "ToolContext"],
      "consumed_by": ["packages/tools/PinTool.ts", "apps/atlas-app/components/MapEditor.tsx"]
    },
    {
      "path": "packages/tools/PinTool.ts",
      "status": "create",
      "task": 14,
      "wave": 3,
      "exports": ["PinTool"],
      "note": "first geo-aware tool; contract for all Phase 2 tools"
    },
    {
      "path": "packages/tools/PinPopup.tsx",
      "status": "create",
      "task": 14,
      "wave": 3
    },
    {
      "path": "apps/atlas-app/components/MapEditor.tsx",
      "status": "create",
      "tasks": [11, 12, 13],
      "wave": 3,
      "consumed_by": ["apps/atlas-app/app/page.tsx", "Phase 2 LayerPanel mount"]
    },
    {
      "path": "apps/atlas-app/hooks/useCoordinateSync.ts",
      "status": "create",
      "task": 12,
      "wave": 3,
      "consumed_by": ["Phase 2 data-layer element sync"]
    },
    {
      "path": "apps/atlas-app/hooks/useToolState.ts",
      "status": "create",
      "task": 13,
      "wave": 3
    },
    {
      "path": "bench/results/phase-1-baseline.json",
      "status": "create",
      "task": 16,
      "wave": 3,
      "note": "Q8 gate artifact — Phase 2 regression budget is baseline+20%"
    },
    {
      "path": "docs/test-matrix/phase-1.md",
      "status": "create",
      "tasks": [17, 18],
      "wave": 4,
      "note": "Q7 acceptance artifact — Phase 2 references as browser-compat baseline"
    },
    {
      "path": "apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts",
      "status": "create",
      "tasks": [15, 18],
      "wave": "3-4"
    }
  ],
  "phase_boundary": {
    "consumes": ["Phase 0 workspace skeleton", "ADR-0001", "ADR-0002", "ADR-0003", "packages/excalidraw (forked)"],
    "produces": {
      "for_phase_2": ["packages/geo public exports", "packages/basemap", "packages/tools AtlasdrawTool contract", "MapEditor.tsx stacking pattern", "useCoordinateSync.ts", "bench/results/phase-1-baseline.json"],
      "for_phase_3": ["geoToExcalidraw + excalidrawToGeo", "GeoCustomData schema with schemaVersion"],
      "for_phase_4": ["MapEditor.tsx embed surface", "BasemapRegistry"],
      "for_phase_5": ["GeoCustomData + schemaVersion for CRDT merge semantics"]
    }
  },
  "decisions_applied": {
    "Q7": "Phase 1 extended to weeks 2-5; week 5 = event-routing hardening (Task 17) with browser E2E gate (Task 18)",
    "Q8": "Task 16 [SPIKE] runs benchmark before phase closure; p99>=16ms triggers unplanned Task 20 (incremental projection)",
    "Q12": "GeoCustomData includes projection: 'mercator' field; PinTool test asserts its presence (Task 14 Step 1)"
  }
}
```
<!-- PLAN_MANIFEST_END -->

---

## Commit Sequence (from Spec §12, Phase 1 extension)

| Day | Commit | Task |
|---|---|---|
| W2D1 | `feat(geo): GeoAnchor types, GeoCustomData with projection field (Q12)` | T1 |
| W2D1 | `feat(tools): AtlasdrawTool interface and ToolContext` | T2 |
| W2D2 | `feat(basemap): MapCanvas, pmtiles protocol, BasemapRegistry` | T3 |
| W2D2 | `feat(geo): CoordinateSync skeleton + projection.ts wrappers` | T4 |
| W2D3 | `feat(geo): point anchor projection` | T5 |
| W2D3 | `feat(geo): bbox anchor projection` | T6 |
| W2D4 | `feat(geo): polyline anchor projection` | T7 |
| W2D4 | `feat(geo): scaleMode trichotomy` | T8 |
| W2D5 | `test(geo): property-based coord round-trip tests` | T9 |
| W2D5 | `feat(geo): geoToExcalidraw + excalidrawToGeo` | T10 |
| W3D1 | `feat(app): stack MapCanvas + Excalidraw in MapEditor` | T11 |
| W3D2 | `feat(app): useCoordinateSync hook (16ms throttle)` | T12 |
| W3D3 | `feat(app): pointer-events toggle on active tool` | T13 |
| W3D4 | `feat(tools): PinTool with GeoAnchor, projection:mercator` | T14 |
| W3D5 | `test(e2e): rectangle stays glued Playwright spec` | T15 |
| W4D1 | `bench(geo): coord-sync baseline 5k elements (Q8 gate)` | T16 |
| W5D1–W5D3 | `fix(app): cross-browser event-routing hardening` | T17 |
| W5D4 | `test(e2e): Phase 1 browser matrix closed` | T18 |
| W5D5 | `chore: CI green Phase 1` | T19 |

---

## Shape Changes Summary
<!-- Appended by shape-incorporator 2026-05-03 -->

**Structural edit count: 5**

| # | Section edited | Change | Cited Q |
|---|---|---|---|
| 1 | Task 16 Step 2 | Added explicit split instrumentation: `performance.now()` around `map.project()` loop and `updateScene()` call separately; both must be recorded per iteration | OQ-3 |
| 2 | Task 16 Step 4 (JSON schema) | Expanded flat `{p50ms, p95ms, p99ms}` to per-segment schema: `project.{p50,p95,p99}ms`, `updateScene.{p50,p95,p99}ms`, `total.{p50,p95,p99}ms`, `dominantSegment` field, `task20Variant` (written on failure) | OQ-1, OQ-3 |
| 3 | Task 16 Step 5 (gating criteria) | Replaced prose "see OQ-1" with explicit decision table: `dominantSegment` → Task 20 Variant (A/B/C/A+C) | OQ-1, OQ-3 |
| 4 | Open Questions OQ-1 | Reframed from prose decision rule to labeled gating table; marked **Blocking before Phase 2**; added self-closing condition (if Task 16 passes, OQ-1 is moot and downgraded to Phase 2 monitoring note) | OQ-1 |
| 5 | Task 20 stub (new section after Task 19) | Added conditional Task 20 section — not a committed task, triggers only on `pass: false` in Task 16 Step 5; three variant sub-sections (A, B, C) keyed to `dominantSegment`; references `projection.ts` seam from Task 4 | OQ-1 |

**Sections not changed (and why):**
- Task 3 Step 5 (`maxPitch: 0`, `pitchWithRotate: false`): already incorporated by resolver; no CoordinateSync pitch assertion existed in the original plan to remove. OQ-2 fully settled.
- `projection: "mercator"` assertion (Q12): distinct from OQ-2 pitch guard; correctly retained in Task 1, Task 14 test, and OQ-5. Not touched.
- Task 10 file count (now 6 files + 1 modify): exceeds ≤5-files guideline but splitting yields no behavioral benefit. Noted here; no structural edit made.
- Phase boundary contracts, File Structure, Tech Stack table, Artifact Manifest, skill annotations: all stable; no edits.

**Escalations (STILL OPEN at project level):**
- **OQ-1** remains open. It is now Blocking-before-Phase-2. Re-evaluated at Phase 1 closure once `bench/results/phase-1-baseline.json` is written by Task 16.
