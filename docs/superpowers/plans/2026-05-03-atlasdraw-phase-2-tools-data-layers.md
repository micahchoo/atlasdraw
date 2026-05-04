# Atlasdraw Phase 2 — Geo-aware Tools & Data Layers

**Dates:** Weeks 6–8 (shifted +1 from spec's "Weeks 5–7" per Q7 resolution — Phase 1 extended)
**Goal:** Ship the full annotation toolkit and establish the annotation-vs-data-layer distinction as architectural law throughout the app.
**Status:** Ready to execute. Phase 1 baseline benchmark (`bench/results/phase-1-baseline.json`) is a hard prerequisite.

---

## Header

### Goal

Deliver every geo-aware drawing tool (polygon, polyline, freehand, text label, arrow, rectangle, circle), introduce GeoJSON drag-and-drop import as a first-class **data layer** (not Excalidraw elements), wire a central `LayerRegistry`, build `LayerPanel` for visibility/reorder/style, enable "Convert to data layer" on polygon/polyline/rectangle/circle annotations, and produce a composited PNG export. Re-run the Phase 1 benchmark at end with the regression gate from Q8.

### Tech Stack Additions (Phase 2 only)

| Addition | Reason | Scope |
|---|---|---|
| `@turf/distance` | Circle radius readout in km/mi | `packages/tools/CircleTool.ts` only |
| `@turf/circle` | Circle GeoJSON projection for convert-to-data-layer | `packages/tools/CircleTool.ts` only |

**NOT added this phase:** `papaparse` (Phase 3), `togeojson` (Phase 3 KML/GPX), `shpjs` (Phase 3). Only `@turf/distance` + `@turf/circle` are new dependencies.

---

## Phase Boundary Contracts

### Consumes (from Phase 1)

| Artifact | Source | Shape |
|---|---|---|
| `<MapEditor>` component | `apps/atlas-app/components/MapEditor.tsx` | Mounts MapLibre + Excalidraw stacked; exposes `mapRef`, `excalidrawAPIRef` |
| `CoordinateSync` | `packages/geo/CoordinateSync.ts` | `syncMapToScene(elements, mapState)` + `projectElement(el, mapState)` |
| `GeoAnchor` types | `packages/geo/types.ts` | `point \| bbox \| polyline` discriminated union; `GeoCustomData` with `scaleMode` |
| Pin tool precedent | `packages/tools/PinTool.ts` | `AtlasdrawTool` interface + `setActiveTool({ type:"custom", customType:"..." })` pattern |
| Phase 1 benchmark harness | `bench/run.ts` + `bench/results/phase-1-baseline.json` | Runnable perf harness; p50/p95/p99 frame times on record |
| `BasemapRegistry` | `packages/basemap/index.ts` | `getMap(): maplibregl.Map` reference for `addSource`/`addLayer` calls |

### Produces (for downstream phases)

| Artifact | Consumer | Shape |
|---|---|---|
| Full tool registry (7 tools) | Phase 3 file format serialization; Phase 4 sharing | `packages/tools/index.ts` barrel; all `customType` strings stable |
| `LayerRegistry` Zustand slice | Phase 3 `.atlasdraw` bundle (layer order in `manifest.json`); Phase 5 Yjs CRDT | `apps/atlas-app/state/store.ts` — exported `useLayerRegistry` hook |
| `packages/data/geojson.ts` parse + write | Phase 3 format I/O; Phase 4 GeoJSON export | `parse(blob): Promise<FeatureCollection>` + `write(fc): Promise<Blob>` — pure, no Yjs. **Phase 3 contract obligation:** strict validation (RFC 7946 §3.1.6 winding order, CRS member rejection) is intentionally deferred. Phase 3 must adopt `@placemarkio/check-geojson` (not archived `geojsonhint`) once its API stabilises. Source: OQ-P2-5. |
<!-- shape-incorporated 2026-05-03: OQ-P2-5 — deferral of winding-order + CRS validation to Phase 3 was undocumented as a contract obligation; added to prevent silent inheritance by Phase 3 plan author -->
| PNG export pipeline | Phase 4 sharing; Phase 6 embed PNG fallback | `apps/atlas-app/lib/export.ts` — composited offscreen canvas |
| Phase 2 benchmark results | Q8 acceptance gate | `bench/results/phase-2-with-data-layers.json` |

---

## Flow Map Preamble

Two parallel data flows govern this phase. Every task sits in one or both.

### Flow A — Annotation Creation (tool selection → element in scene)

```
Tool button click
  → setActiveTool({ type:"custom", customType })
  → Excalidraw pointer events suppressed (MapLibre active)
  → onPointerDown on MapEditor overlay
  → map.unproject(screenXY) → [lng, lat]
  → createXxxElement(lngLat, zRef, scaleMode)         [CHANGE SITE per tool]
  → element.customData.geo = GeoAnchor                [polyline | point | bbox]
  → excalidrawAPI.updateScene({ elements: [..., el] })
  → CoordinateSync.syncMapToScene() re-projects
  → Excalidraw re-renders annotation
  → LayerRegistry.registerAnnotation(el.id)           [Wave 2]
  → LayerPanel updates                                 [Wave 2]
```

### Flow B — Data Layer Ingestion (GeoJSON drop → MapLibre layer)

```
dragover + drop on MapEditor
  → FileReader.readAsText(file)
  → packages/data/geojson.ts parse(blob)
  → FeatureCollection validated (strict; reject on error with actionable message)
  → LayerRegistry.registerDataLayer({ id, fc, style: defaultLayerStyle })
  → map.addSource(id, { type:"geojson", data: fc })
  → map.addLayer(buildMapLibreLayer(id, style))       [via basemap/style-compiler.ts]
  → LayerPanel updates (data layer row appears)
```

### Flow C — Convert Annotation to Data Layer (right-click action)

```
Right-click selected annotation (polygon | polyline | rectangle | circle only)
  → context menu "Convert to data layer"
  → annotationToFeatureCollection(element)            [packages/tools/convert.ts]
  → LayerRegistry.convertAnnotationToDataLayer(el.id)
  → excalidrawAPI.updateScene({ elements: elements.filter(e => e.id !== el.id) })
  → Flow B continuation from FeatureCollection step
```

**Text and arrow tools:** "Convert to data layer" is not available (grayed out in context menu). These have no lossless GeoJSON projection. Executor does not implement conversion for these types; a toast "Text and arrow annotations cannot be converted to data layers" confirms the constraint.

### Flow D — PNG Export (composited canvas)

```
Export PNG button
  → canvas1 = maplibreMap.getCanvas()                 [preserveDrawingBuffer:true]
  → canvas2 = await excalidrawAPI.exportToCanvas({ ... })
  → offscreen = new OffscreenCanvas(w, h)
  → ctx.drawImage(canvas1)                            [basemap + data layers]
  → ctx.drawImage(canvas2)                            [annotations — transparent bg]
  → offscreen.convertToBlob({ type:"image/png" })
  → download or return Blob
```

<!-- shape-incorporated 2026-05-03: OQ-P2-2 — Flow D preamble was teaching the wrong model (DPR × scale = 4× on retina); corrected to CSS-pixel language matching T15 amendment -->
Resolution: export at CSS logical pixels × `scale` where `scale` defaults to 2 (matches PRD "2× PNG for print"). Read `mapCanvas.clientWidth`/`clientHeight` (CSS pixels) — NOT `mapCanvas.width`/`height` (physical pixels, which are already DPR-scaled by MapLibre). `OffscreenCanvas(clientWidth * 2, clientHeight * 2)` always produces exactly 2× CSS pixels regardless of device pixel ratio. Source: OQ-P2-2.

---

## File Structure

One-line responsibility per file created or meaningfully modified this phase.

```
packages/geo/
  types.ts                       (MODIFY) — no schema changes; no new GeoAnchor kind for freehand

packages/tools/
  PolygonTool.ts                 (CREATE) — polygon customType, geographic scaleMode, polyline GeoAnchor
  PolylineTool.ts                (CREATE) — polyline/route customType, geographic scaleMode, polyline GeoAnchor
  FreehandTool.ts                (CREATE) — freehand pen customType, hybrid scaleMode, polyline GeoAnchor + smooth
  TextLabelTool.ts               (CREATE) — text label customType, screen scaleMode, point GeoAnchor
  ArrowTool.ts                   (CREATE) — arrow customType, hybrid scaleMode, polyline GeoAnchor (two-point)
  RectangleTool.ts               (CREATE) — rectangle customType, geographic scaleMode, bbox GeoAnchor
  CircleTool.ts                  (CREATE) — circle customType, geographic scaleMode, point GeoAnchor; Turf radius readout
  convert.ts                     (CREATE) — annotationToFeatureCollection() for polygon/polyline/rect/circle
  index.ts                       (MODIFY) — barrel: re-exports all tools + AtlasdrawTool type

packages/data/
  geojson.ts                     (CREATE) — parse(blob)+write(fc); strict validation; no Yjs surface area
  __tests__/geojson.test.ts      (CREATE) — unit tests: valid FC, malformed input, empty FC, large FC

packages/basemap/
  style-compiler.ts              (MODIFY) — extend to compile LayerStyle → addLayer spec (already exists per §7.3)

apps/atlas-app/
  components/MapEditor.tsx       (MODIFY) — add drag-drop handlers; wire all 7 tools; preserveDrawingBuffer:true
  components/LayerPanel.tsx      (CREATE) — Excalidraw <Sidebar> tab; annotation rows + data layer rows; style editor
  components/ImportDialog.tsx    (MODIFY) — GeoJSON drag-drop target calls parse(); error display
  components/Toolbar.tsx         (MODIFY) — register all 7 new tool buttons
  state/store.ts                 (MODIFY) — add LayerRegistry Zustand slice
  state/layerRegistry.ts         (CREATE) — LayerRegistry: types, actions, selectors
  lib/export.ts                  (CREATE) — composited PNG pipeline (Flows D above)
  hooks/useLayerRegistry.ts      (CREATE) — thin hook over store.ts slice

bench/
  run.ts                         (MODIFY) — add data-layer scenario: 50k features + 5k annotations
  results/phase-2-with-data-layers.json  (CREATE by benchmark run — not hand-authored)
```

---

## Execution Waves

### Wave 0 — Type Contracts and Interface Definitions (serial, prerequisite)

All downstream tasks receive interface definitions in their context prefix. No implementations.

**Tasks:** T01, T02

### Wave 1 — Tools + GeoJSON Parser (parallel)

All 7 tools and the GeoJSON parser are independent. Same context prefix; each task gets one file delta. Wave 0 contracts must be in shared prefix.

**Tasks:** T03, T04, T05, T06, T07, T08, T09, T10 (parallel)

### Wave 2 — Registry, Panel, Convert (parallel)

LayerRegistry implementation, LayerPanel, ImportDialog wiring, and Convert action all depend on Wave 0 interfaces and can proceed in parallel once Wave 1 tools are merged (no actual dependency on tool internals — they depend only on the `AtlasdrawTool` interface and the `GeoCustomData` type from Wave 0).

**Tasks:** T11, T12, T13, T14 (parallel)

### Wave 3 — Export + Benchmark (serial within wave; benchmark after export)

PNG export depends on MapEditor having `preserveDrawingBuffer: true` (Wave 2 MapEditor.tsx modification). Benchmark runs last and gates acceptance.

**Tasks:** T15, T16 (T16 after T15)

---

## Tasks

---

### Task T01: Wave 0 — Layer Type Contracts

**Orient:** Define the `LayerRegistryEntry` discriminated union and `LayerRegistry` method signatures so Wave 1 tools and Wave 2 implementations can be dispatched in parallel against a stable interface contract.
**Flow position:** Step 1 of 1 in Wave 0 (bootstrap → **type-contracts** → Wave 1 prefix)
**Upstream contract:** Receives `GeoCustomData`, `GeoAnchor`, `LayerStyle` (Spec §7.3) as-is. No changes to these.
**Downstream contract:** Produces `LayerRegistryEntry` union + `ILayerRegistry` interface consumed by T11 (impl), T12 (LayerPanel), T13 (ImportDialog), T14 (Convert).
**Skill:** `none`
**Codebooks:** `virtualization-vs-interaction-fidelity`
**Files:**
- Create: `apps/atlas-app/state/layerRegistry.ts`

**Steps:**

- [ ] **Step 1: Define LayerRegistryEntry and ILayerRegistry**

Write the type-only module. No runtime code — types and interface signatures only.

```ts
// apps/atlas-app/state/layerRegistry.ts  (types section — no implementation yet)

import type { FeatureCollection } from "geojson";
import type { LayerStyle } from "@atlasdraw/basemap";   // §7.3 shape

export type AnnotationLayerEntry = {
  kind: "annotation";
  id: string;           // matches Excalidraw element.id
  label: string;        // user-visible name, defaults to element type
  visible: boolean;
  order: number;        // z-index within annotation group
};

export type DataLayerEntry = {
  kind: "data";
  id: string;           // prefixed "dl:<uuid>" — never collides with annotation ids
  label: string;
  visible: boolean;
  order: number;        // z-index within data layer group
  featureCount: number;
  style: LayerStyle;
};

export type LayerRegistryEntry = AnnotationLayerEntry | DataLayerEntry;

export interface ILayerRegistry {
  entries: LayerRegistryEntry[];
  registerAnnotation(elementId: string, label?: string): void;
  registerDataLayer(opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }): void;
  convertAnnotationToDataLayer(elementId: string, fc: FeatureCollection): void;
  setVisibility(id: string, visible: boolean): void;
  reorder(id: string, newOrder: number): void;
  updateStyle(id: string, patch: Partial<LayerStyle>): void;
  remove(id: string): void;
}
```

- [ ] **Step 2: Verify the file compiles with no imports missing**

Run: `cd /mnt/Ghar/2TA/DevStuff/atlasdraw && npx tsc --noEmit --project apps/atlas-app/tsconfig.json 2>&1 | head -30`
Expected: zero errors on `layerRegistry.ts` (errors on unimplemented files are acceptable at this stage — only this file is in scope)

---

### Task T02: Wave 0 — AtlasdrawTool Interface Stabilization

**Orient:** Confirm the `AtlasdrawTool` interface in `packages/tools/index.ts` is complete for multi-point (drag-path) tools, so T03–T09 can each implement a tool without cross-modifying the interface.
**Flow position:** Step 1 of 1 in Wave 0 (bootstrap → **tool-interface** → Wave 1 prefix)
**Upstream contract:** Receives `PinTool` pattern from Phase 1 (`onPointerDown` single-point). Multi-point tools need `onPointerMove` + `onPointerUp`.
**Downstream contract:** Produces stable `AtlasdrawTool` type consumed by T03–T09.
**Skill:** `none`
**Files:**
- Modify: `packages/tools/index.ts`

**Steps:**

- [ ] **Step 1: Extend AtlasdrawTool with pointer lifecycle**

```ts
// packages/tools/index.ts
export interface AtlasdrawToolContext {
  map: maplibregl.Map;
  excalidrawAPI: ExcalidrawImperativeAPI;
  elements: readonly ExcalidrawElement[];
  appState: AppState;
}

export interface AtlasdrawTool {
  id: string;
  icon: React.FC;
  cursor: string;
  defaultScaleMode: "geographic" | "screen" | "hybrid";
  /** Single click / first point. Required for all tools. */
  onPointerDown(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  /** Optional: called on every move while pointer is down. */
  onPointerMove?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  /** Optional: called on pointer release to finalize multi-point shapes. */
  onPointerUp?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
}
```

- [ ] **Step 2: Verify no existing tool breaks**

Run: `npx tsc --noEmit --project packages/tools/tsconfig.json 2>&1`
Expected: zero errors

---

### Task T03: Wave 1 — Polygon Tool [CHANGE SITE]

**Orient:** Implement the polygon drawing tool so users can click-to-add vertices and double-click to close a geo-anchored filled region that persists across pan/zoom.
**Flow position:** Step 1 of 7 in Wave 1 tools (tool-interface → **polygon-tool** → tool-registry)
**Upstream contract:** Receives `AtlasdrawTool` interface (T02) and `GeoAnchor { kind:"polyline" }` from `packages/geo/types.ts`.
**Downstream contract:** Produces closed polygon Excalidraw element with `customData.geo = { kind:"polyline", coordinates:[...], zRef }` and `scaleMode:"geographic"`.
**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/PolygonTool.ts`
- Test: `packages/tools/__tests__/PolygonTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests for polygon vertex accumulation and close**

```ts
// packages/tools/__tests__/PolygonTool.test.ts
it("closes polygon on double-click and emits polyline GeoAnchor", () => {
  const tool = PolygonTool;
  const mockCtx = makeMockCtx([/* 3 vertex clicks */]);
  // simulate 3 onPointerDown + 1 double-click via onPointerUp
  // assert element.customData.geo.kind === "polyline"
  // assert coordinates[0] === coordinates[coordinates.length-1] (closed ring)
  // assert element.customData.scaleMode === "geographic"
});
```

Run: `npx vitest run packages/tools/__tests__/PolygonTool.test.ts`
Expected: FAIL — PolygonTool not defined

- [ ] **Step 2: Implement PolygonTool**

- `defaultScaleMode: "geographic"`
- `onPointerDown`: accumulate `[lng,lat]` coordinates into local state
- `onPointerUp`: on double-click signal (two `pointerup` events within 300ms), close ring and call `excalidrawAPI.updateScene`
- `customData.geo = { kind:"polyline", coordinates: [...ring], zRef: map.getZoom() }`
- Polygon rendered via Excalidraw's `freedraw` element type with `simulatePressure: false`

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/PolygonTool.test.ts`
Expected: PASS all assertions

---

### Task T04: Wave 1 — Polyline Tool [CHANGE SITE]

**Orient:** Implement the polyline/route drawing tool so users can click a multi-segment path geo-anchored to the map — the open-path counterpart to the polygon.
**Flow position:** Step 2 of 7 in Wave 1 tools (tool-interface → **polyline-tool** → tool-registry)
**Upstream contract:** Same as T03. No closed ring. `scaleMode:"geographic"`.
**Downstream contract:** Open polyline element. `customData.geo = { kind:"polyline", coordinates:[...open], zRef }`.
**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/PolylineTool.ts`
- Test: `packages/tools/__tests__/PolylineTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

```ts
it("does not close ring on final click", () => {
  // assert coordinates[0] !== coordinates[coordinates.length-1]
  // assert scaleMode === "geographic"
});
```

Run: `npx vitest run packages/tools/__tests__/PolylineTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement PolylineTool**

- `defaultScaleMode: "geographic"`
- Double-click or Escape finalizes the path without closing ring
- Rendered via Excalidraw `line` or `arrow` (no arrowhead) element type

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/PolylineTool.test.ts`
Expected: PASS

---

### Task T05: Wave 1 — Freehand Pen Tool [CHANGE SITE]

**Orient:** Implement the freehand drawing tool as a `polyline` GeoAnchor with `scaleMode:"hybrid"` — the same anchor kind as polyline, no new GeoAnchor variant, with render-time smoothing applied before element creation.
**Flow position:** Step 3 of 7 in Wave 1 tools (tool-interface → **freehand-tool** → tool-registry)
**Upstream contract:** Rapid `onPointerMove` events while pointer is down; dense `[lng,lat]` stream.
**Downstream contract:** Smoothed `polyline` GeoAnchor (Ramer-Douglas-Peucker simplification, epsilon=0.00001°). `scaleMode:"hybrid"`. Rendered via Excalidraw `freedraw` element.

Design decision recorded here: freehand uses `polyline` GeoAnchor + `scaleMode:"hybrid"`. A 4th GeoAnchor kind was considered and rejected — it would be a Phase 1 schema change that invalidates the benchmark baseline. If render-time simplification produces visible artefacts at high zoom, revisit in a follow-up task, not in this phase.

**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/FreehandTool.ts`
- Test: `packages/tools/__tests__/FreehandTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test for simplification**

```ts
it("reduces a 1000-point path to <200 points via RDP", () => {
  // generate 1000 colinear coordinates with minor jitter
  // assert simplified.length < 200
  // assert scaleMode === "hybrid"
});
```

Run: `npx vitest run packages/tools/__tests__/FreehandTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement FreehandTool**

- Collect coordinates on `onPointerMove`
- On `onPointerUp`: run Ramer-Douglas-Peucker (`@turf/simplify` or inline impl — no new dep needed, inline the algorithm at ~30 lines)
- Create `freedraw` element with smoothed coordinates + `customData.geo = { kind:"polyline", coordinates: simplified, zRef }`
- `defaultScaleMode: "hybrid"`

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/FreehandTool.test.ts`
Expected: PASS

---

### Task T06: Wave 1 — Text Label Tool [CHANGE SITE]

**Orient:** Implement the text label tool geo-anchored to a point with `scaleMode:"screen"` so labels stay legible at any zoom level.
**Flow position:** Step 4 of 7 in Wave 1 tools (tool-interface → **text-label-tool** → tool-registry)
**Upstream contract:** Single `onPointerDown` click; no drag path.
**Downstream contract:** Excalidraw `text` element. `customData.geo = { kind:"point", lng, lat, zRef }`. `scaleMode:"screen"`.
**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`, `text-editing-mode-isolation`
**Files:**
- Create: `packages/tools/TextLabelTool.ts`
- Test: `packages/tools/__tests__/TextLabelTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test**

```ts
it("creates text element with screen scaleMode at click location", () => {
  // assert element.type === "text"
  // assert element.customData.geo.kind === "point"
  // assert element.customData.scaleMode === "screen"
});
```

Run: `npx vitest run packages/tools/__tests__/TextLabelTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement TextLabelTool**

- `onPointerDown`: unproject click → `[lng, lat]` → create Excalidraw `text` element at projected screen position
- `defaultScaleMode: "screen"`
- After element creation, call `excalidrawAPI.setActiveTool({ type:"text" })` to hand off to Excalidraw's inline text editor

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/TextLabelTool.test.ts`
Expected: PASS

---

### Task T07: Wave 1 — Arrow Tool [CHANGE SITE]

**Orient:** Implement the arrow tool as a two-point `polyline` GeoAnchor with `scaleMode:"hybrid"` so arrows scale naturally near their creation zoom but don't shrink to invisibility when zooming far out.
**Flow position:** Step 5 of 7 in Wave 1 tools (tool-interface → **arrow-tool** → tool-registry)
**Upstream contract:** Two pointer events: `onPointerDown` (tail) → `onPointerUp` (head).
**Downstream contract:** Excalidraw `arrow` element. `customData.geo = { kind:"polyline", coordinates:[[tail_lng,tail_lat],[head_lng,head_lat]], zRef }`. `scaleMode:"hybrid"`.

Note: "Convert to data layer" is NOT available for arrow elements. This is by design — arrows have no lossless GeoJSON projection. Executor must ensure `convert.ts` (T14) does not accept `arrow` type, and the right-click context menu item is hidden/disabled for arrows and text elements.

**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/ArrowTool.ts`
- Test: `packages/tools/__tests__/ArrowTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test**

```ts
it("creates arrow with hybrid scaleMode and two-coordinate polyline anchor", () => {
  // assert element.type === "arrow"
  // assert element.customData.geo.coordinates.length === 2
  // assert element.customData.scaleMode === "hybrid"
});
```

Run: `npx vitest run packages/tools/__tests__/ArrowTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement ArrowTool**

- `onPointerDown`: record tail `[lng,lat]`, create preview element
- `onPointerMove`: update head position in real time (preview arrow follows cursor)
- `onPointerUp`: finalize head position, call `updateScene`
- `defaultScaleMode: "hybrid"`

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/ArrowTool.test.ts`
Expected: PASS

---

### Task T08: Wave 1 — Rectangle Tool [CHANGE SITE]

**Orient:** Implement the rectangle tool with `bbox` GeoAnchor and `scaleMode:"geographic"` so it covers the same real-world area regardless of zoom.
**Flow position:** Step 6 of 7 in Wave 1 tools (tool-interface → **rectangle-tool** → tool-registry)
**Upstream contract:** Drag gesture: `onPointerDown` (first corner) → `onPointerMove` (preview) → `onPointerUp` (opposite corner).
**Downstream contract:** Excalidraw `rectangle` element. `customData.geo = { kind:"bbox", west, south, east, north, zRef }`. `scaleMode:"geographic"`.
**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/RectangleTool.ts`
- Test: `packages/tools/__tests__/RectangleTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test**

```ts
it("creates rectangle with bbox GeoAnchor corners from drag", () => {
  // simulate drag from (0,0) to (100,100) screen coords
  // assert geo.kind === "bbox"
  // assert geo.west < geo.east
  // assert geo.south < geo.north
  // assert scaleMode === "geographic"
});
```

Run: `npx vitest run packages/tools/__tests__/RectangleTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement RectangleTool**

- `onPointerDown`: record first corner, unproject → `[lng1, lat1]`
- `onPointerMove`: compute current corner, update preview element width/height
- `onPointerUp`: finalize `bbox = { west: min(lng1,lng2), south: min(lat1,lat2), east: max(lng1,lng2), north: max(lat1,lat2) }`
- `defaultScaleMode: "geographic"`

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/RectangleTool.test.ts`
Expected: PASS

---

### Task T09: Wave 1 — Circle Tool with Radius Readout [CHANGE SITE]

**Orient:** Implement the circle tool with `point` GeoAnchor (center + screen radius), `scaleMode:"geographic"`, and a real-world radius readout in km/mi powered by `@turf/distance`.
**Flow position:** Step 7 of 7 in Wave 1 tools (tool-interface → **circle-tool** → tool-registry)
**Upstream contract:** Drag gesture: center on `onPointerDown`, radius edge on `onPointerUp`. `@turf/distance` for km/mi readout.
**Downstream contract:** Excalidraw `ellipse` element (forced `width===height` for circle). `customData.geo = { kind:"point", lng: center_lng, lat: center_lat, zRef }`. `customData.radiusKm: number`. `scaleMode:"geographic"`. A floating readout label (separate `text` element, `scaleMode:"screen"`) shows `"${radius} km"` adjacent to the circle edge.
**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/CircleTool.ts`
- Test: `packages/tools/__tests__/CircleTool.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

```ts
it("attaches radiusKm to customData", () => {
  // simulate drag 100px right from center
  // assert typeof element.customData.radiusKm === "number"
  // assert element.customData.radiusKm > 0
});

it("creates a companion text element showing radius", () => {
  // assert second element in updateScene call is type "text"
  // assert it contains "km" in text content
});
```

Run: `npx vitest run packages/tools/__tests__/CircleTool.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement CircleTool**

```ts
import distance from "@turf/distance";

// onPointerUp:
const centerLngLat = map.unproject([downX, downY]);
const edgeLngLat = map.unproject([upX, upY]);
const radiusKm = distance(
  [centerLngLat.lng, centerLngLat.lat],
  [edgeLngLat.lng, edgeLngLat.lat],
  { units: "kilometers" }
);
```

- Companion text element: `scaleMode:"screen"`, positioned at `(circleScreenX + radius + 8, circleScreenY)`, text `"${radiusKm.toFixed(2)} km"`. Linked via `customData.circleId = circle.id` for co-deletion.
- `defaultScaleMode: "geographic"` on circle element

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/tools/__tests__/CircleTool.test.ts`
Expected: PASS

- [ ] **Step 4: Verify @turf/distance is installed**

Run: `cd /mnt/Ghar/2TA/DevStuff/atlasdraw && node -e "require('@turf/distance')" 2>&1`
Expected: no error, or install `pnpm add @turf/distance @turf/circle` if absent

---

### Task T10: Wave 1 — GeoJSON Parser [CHANGE SITE]

**Orient:** Implement `packages/data/geojson.ts` as a pure, Yjs-free parser/writer so data layer ingestion (Flow B) has a strict validation boundary — malformed GeoJSON is rejected with actionable errors before it reaches MapLibre.
**Flow position:** Step 1 of 1 in Wave 1 parsers (raw blob → **geojson-parse** → validated FeatureCollection)
**Upstream contract:** Receives `Blob | File` from `ImportDialog.tsx` or drop handler.
**Downstream contract:** Resolves `Promise<FeatureCollection>` (RFC 7946) or rejects with `GeoJSONParseError { message: string; line?: number; field?: string }`. Write path: receives `FeatureCollection`, resolves `Promise<Blob>`.

**Important scope note:** No Yjs imports. No MapLibre imports. Pure function module. MIT license (per Q5 constraint — `packages/data` is MIT). GeoJSON FC is a snapshot format; it becomes a Yjs doc snapshot in Phase 5, but that is not this file's concern.

**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/geojson.ts`
- Test: `packages/data/__tests__/geojson.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/geojson.test.ts
describe("geojson.parse", () => {
  it("accepts valid FeatureCollection", async () => {
    const blob = new Blob([JSON.stringify(VALID_FC)], { type: "application/json" });
    const fc = await parse(blob);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.length).toBe(VALID_FC.features.length);
  });

  it("rejects malformed JSON with GeoJSONParseError", async () => {
    await expect(parse(new Blob(["{bad json"]))).rejects.toMatchObject({
      message: expect.stringContaining("JSON"),
    });
  });

  it("rejects non-FeatureCollection with actionable message", async () => {
    const blob = new Blob([JSON.stringify({ type: "Feature" })]);
    await expect(parse(blob)).rejects.toMatchObject({
      message: expect.stringContaining("FeatureCollection"),
    });
  });

  it("rejects features missing geometry with field reference", async () => {
    // FC with one feature where geometry is null
    // expect error to mention feature index
  });

  it("handles 50k feature collection without throw", async () => {
    const large = makeLargeFC(50_000);
    const fc = await parse(new Blob([JSON.stringify(large)]));
    expect(fc.features.length).toBe(50_000);
  });
});

describe("geojson.write", () => {
  it("round-trips FeatureCollection to Blob and back", async () => {
    const blob = await write(VALID_FC);
    const result = await parse(blob);
    expect(result.features).toHaveLength(VALID_FC.features.length);
  });
});
```

Run: `npx vitest run packages/data/__tests__/geojson.test.ts`
Expected: FAIL — parse/write not defined

- [ ] **Step 2: Implement parse and write**

```ts
// packages/data/geojson.ts
export class GeoJSONParseError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

export async function parse(blob: Blob): Promise<FeatureCollection> {
  const text = await blob.text();
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { throw new GeoJSONParseError(`Invalid JSON: ${(e as Error).message}`); }

  if (!raw || typeof raw !== "object" || (raw as any).type !== "FeatureCollection") {
    throw new GeoJSONParseError(
      `Expected a GeoJSON FeatureCollection, got "${(raw as any)?.type ?? typeof raw}"`
    );
  }
  // validate features array; check each feature has geometry
  const fc = raw as FeatureCollection;
  fc.features.forEach((f, i) => {
    if (!f.geometry) {
      throw new GeoJSONParseError(
        `Feature at index ${i} has null geometry — remove or fix it before import`,
        `features[${i}].geometry`
      );
    }
  });
  return fc;
}

export async function write(fc: FeatureCollection): Promise<Blob> {
  return new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/data/__tests__/geojson.test.ts`
Expected: PASS all 6 tests

- [ ] **Step 4: Export from package barrel**

Verify `packages/data/index.ts` re-exports `parse`, `write`, `GeoJSONParseError`.

Run: `npx tsc --noEmit --project packages/data/tsconfig.json 2>&1`
Expected: zero errors

---

### Task T11: Wave 2 — LayerRegistry Implementation [CHANGE SITE]

**Orient:** Implement the `LayerRegistry` Zustand slice using the interface from T01 so LayerPanel (T12), ImportDialog (T13), and Convert action (T14) share a single authoritative layer state.
**Flow position:** Step 1 of 4 in Wave 2 (type-contracts → **registry-impl** → panel/import/convert)
**Upstream contract:** `ILayerRegistry` interface and `LayerRegistryEntry` types from T01. `LayerStyle` shape from Spec §7.3.
**Downstream contract:** `useLayerRegistry()` hook exported from `apps/atlas-app/hooks/useLayerRegistry.ts`; consumed by T12, T13, T14.

**ID space rule:** annotation IDs are raw Excalidraw element IDs (arbitrary strings). Data layer IDs are prefixed `"dl:"` (e.g. `"dl:550e8400-e29b-41d4-a716-446655440000"`). This prevents Phase 5 CRDT key collisions. The prefix is enforced in `registerDataLayer` — throw if `opts.id` does not start with `"dl:"`.

**Skill:** `none`
**Codebooks:** `virtualization-vs-interaction-fidelity`
**Files:**
- Modify: `apps/atlas-app/state/store.ts`
- Modify: `apps/atlas-app/state/layerRegistry.ts` (add implementation to Wave 0 types)
- Create: `apps/atlas-app/hooks/useLayerRegistry.ts`

**Steps:**

- [ ] **Step 1: Write failing test for ID prefix enforcement**

```ts
it("throws if data layer id does not start with dl:", () => {
  const store = createLayerRegistryStore();
  expect(() => store.registerDataLayer({ id: "no-prefix", fc: VALID_FC, label: "x", style: DEFAULT_STYLE }))
    .toThrow("dl:");
});
```

Run: `npx vitest run apps/atlas-app/state/__tests__/layerRegistry.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement Zustand slice**

```ts
// apps/atlas-app/state/layerRegistry.ts (implementation section, after types)
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

// Implementation of ILayerRegistry as a Zustand slice
// registerAnnotation: push AnnotationLayerEntry with visible:true, order = entries.length
// registerDataLayer: enforce "dl:" prefix; push DataLayerEntry
// convertAnnotationToDataLayer: remove annotation entry; call registerDataLayer
// setVisibility: find by id, toggle
// reorder: swap order values
// updateStyle: merge patch into entry.style (data layers only; no-op for annotations)
// remove: filter from entries
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run apps/atlas-app/state/__tests__/layerRegistry.test.ts`
Expected: PASS

- [ ] **Step 4: Wire into store.ts and export hook**

```ts
// apps/atlas-app/hooks/useLayerRegistry.ts
export const useLayerRegistry = () => useStore((s) => s.layerRegistry);
```

Run: `npx tsc --noEmit --project apps/atlas-app/tsconfig.json 2>&1 | grep layerRegistry`
Expected: no errors on these files

---

### Task T12: Wave 2 — LayerPanel Sidebar [CHANGE SITE]

**Orient:** Build the `LayerPanel.tsx` component as an Excalidraw `<Sidebar>` tab so users can toggle visibility, reorder layers, and edit per-layer color/stroke/opacity for both annotation and data layer entries without conflating the two types.
**Flow position:** Step 2 of 4 in Wave 2 (registry-impl → **layer-panel** → user-visible UI)
**Upstream contract:** `useLayerRegistry()` hook from T11; `LayerStyle` from Spec §7.3.
**Downstream contract:** User actions call `setVisibility`, `reorder`, `updateStyle` on registry. Compile `LayerStyle` patch → MapLibre `setPaintProperty` / `setLayoutProperty` via `basemap/style-compiler.ts`. No direct `map.addLayer` calls from this component — only style mutations on existing layers.

**Visual distinction requirement:** Annotation entries render with an "A" badge (or pencil icon). Data layer entries render with a "D" badge (or layers icon). The distinction must be visually unambiguous without color as the sole differentiator (accessibility constraint).

**Skill:** `none`
**Codebooks:** `virtualization-vs-interaction-fidelity`
**Files:**
- Create: `apps/atlas-app/components/LayerPanel.tsx`

**Steps:**

- [ ] **Step 1: Sketch the component tree (no tests yet)**

```
<Sidebar name="layers" docked>
  <Sidebar.Header>Layers</Sidebar.Header>
  <Sidebar.Body>
    <section aria-label="Data Layers">
      {dataLayers.map(entry => <DataLayerRow key={entry.id} entry={entry} />)}
    </section>
    <section aria-label="Annotations">
      {annotationLayers.map(entry => <AnnotationLayerRow key={entry.id} entry={entry} />)}
    </section>
  </Sidebar.Body>
</Sidebar>
```

- [ ] **Step 2: Implement DataLayerRow with style editor**

- Eye icon toggles `setVisibility`
- Drag handle enables `reorder` (use `@dnd-kit/sortable` if already in Excalidraw's deps, else CSS order + up/down buttons — do not add a new dep for this)
- Color swatch opens inline popover: `fill.color`, `stroke.color`, `stroke.width`, `fill.opacity` fields
- On change: call `updateStyle(id, patch)` → emit `map.setPaintProperty` via `style-compiler.ts`

- [ ] **Step 3: Implement AnnotationLayerRow**

- Eye icon toggles element visibility via `excalidrawAPI.updateScene({ elements: elements.map(el => el.id===id ? {...el, isDeleted: !visible} : el) })`
- No style editor (annotations styled via Excalidraw's native sidebar)
- Shows element type label

- [ ] **Step 4: Render verification**

Run: `npx vitest run apps/atlas-app/components/__tests__/LayerPanel.test.tsx`
Expected: renders two sections; annotation badge and data layer badge both present in DOM; no console errors

---

### Task T13: Wave 2 — GeoJSON Drag-and-Drop Import [CHANGE SITE]

**Orient:** Wire the GeoJSON drop handler in `MapEditor.tsx` and `ImportDialog.tsx` so dragging a `.geojson` file onto the canvas parses it strictly, registers a data layer in `LayerRegistry`, and adds MapLibre source + layer — making the data flow from file → validated FC → map render fully operational.
**Flow position:** Step 3 of 4 in Wave 2 (registry-impl → **geojson-drop** → data-layer-visible-on-map)
**Upstream contract:** `parse(blob)` from T10; `LayerRegistry.registerDataLayer` from T11; `map.addSource`/`map.addLayer` from `MapEditor`'s `mapRef`.
**Downstream contract:** After drop, new data layer entry appears in LayerPanel; features render on MapLibre canvas; errors show a user-facing toast with the `GeoJSONParseError.message`.
**Skill:** `none`
**Codebooks:** `virtualization-vs-interaction-fidelity`
**Files:**
- Modify: `apps/atlas-app/components/MapEditor.tsx`
- Modify: `apps/atlas-app/components/ImportDialog.tsx`

**Steps:**

- [ ] **Step 1: Write integration test for drop → MapLibre source registration**

```ts
it("calls map.addSource after successful parse", async () => {
  const mockMap = createMockMap();
  // simulate drop event with valid GeoJSON blob
  await handleDrop(blob, mockMap, mockRegistry);
  expect(mockMap.addSource).toHaveBeenCalledWith(
    expect.stringMatching(/^dl:/),
    { type: "geojson", data: expect.objectContaining({ type: "FeatureCollection" }) }
  );
  expect(mockRegistry.registerDataLayer).toHaveBeenCalled();
});
```

Run: `npx vitest run apps/atlas-app/components/__tests__/MapEditor.drop.test.tsx`
Expected: FAIL

- [ ] **Step 2: Implement drop handler in MapEditor.tsx**

```ts
const handleDrop = useCallback(async (e: DragEvent) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file || !file.name.endsWith(".geojson")) return;
  try {
    const fc = await parse(file);
    const id = `dl:${crypto.randomUUID()}`;
    const style = defaultLayerStyle(fc);  // infer geometry type from first feature
    registry.registerDataLayer({ id, fc, label: file.name, style });
    map.addSource(id, { type: "geojson", data: fc });
    map.addLayer(compileLayer(id, style));  // basemap/style-compiler.ts
  } catch (err) {
    if (err instanceof GeoJSONParseError) showToast(err.message);
    else throw err;
  }
}, [map, registry]);
```

- [ ] **Step 3: Run integration test**

Run: `npx vitest run apps/atlas-app/components/__tests__/MapEditor.drop.test.tsx`
Expected: PASS

---

### Task T14: Wave 2 — Convert Annotation to Data Layer [CHANGE SITE]

**Orient:** Implement the "Convert to data layer" right-click context menu action for polygon, polyline, rectangle, and circle elements, closing PRD §8 Flow 2 (Marcus's loop). Text and arrow elements must show the action disabled with a toast explaining why.
**Flow position:** Step 4 of 4 in Wave 2 (registry-impl → **convert-action** → data-layer-visible-on-map)
**Upstream contract:** Selected annotation element (must be polygon/polyline/rectangle/circle type). `annotationToFeatureCollection(element): FeatureCollection` from `packages/tools/convert.ts`. `LayerRegistry.convertAnnotationToDataLayer` from T11.
**Downstream contract:** Element removed from Excalidraw scene; equivalent data layer registered and rendered on MapLibre. Undo not in scope for this phase.

**Supported element types for conversion:**
- `polygon` / `freedraw` (closed) → GeoJSON `Polygon`
- `polyline` / `line` → GeoJSON `LineString`
- `rectangle` → GeoJSON `Polygon` (from bbox)
- `ellipse` (circle tool output) → GeoJSON `Polygon` via `@turf/circle` (center + radiusKm from `customData.radiusKm`)

**Unsupported types:** `text`, `arrow`. These show the menu item with a disabled state and tooltip: `"Text and arrow annotations cannot be converted to data layers"`. No exception thrown; the action simply does nothing on click.

**Skill:** `none`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Create: `packages/tools/convert.ts`
- Modify: `apps/atlas-app/components/MapEditor.tsx` (context menu wiring)
- Test: `packages/tools/__tests__/convert.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests for annotationToFeatureCollection**

```ts
it("converts rectangle element to GeoJSON Polygon", () => {
  const el = makeRectElement({ geo: { kind:"bbox", west:-1, south:-1, east:1, north:1, zRef:10 } });
  const fc = annotationToFeatureCollection(el);
  expect(fc.features[0].geometry.type).toBe("Polygon");
});

it("converts circle element using turf/circle and radiusKm", () => {
  const el = makeCircleElement({ geo: { kind:"point", lng:0, lat:0, zRef:10 }, radiusKm: 1 });
  const fc = annotationToFeatureCollection(el);
  expect(fc.features[0].geometry.type).toBe("Polygon");
});

it("throws for text element", () => {
  const el = makeTextElement();
  expect(() => annotationToFeatureCollection(el)).toThrow("cannot be converted");
});
```

Run: `npx vitest run packages/tools/__tests__/convert.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement convert.ts**

```ts
import circle from "@turf/circle";

export function annotationToFeatureCollection(element: ExcalidrawElement): FeatureCollection {
  // switch on element.type / customType
  // rectangle (bbox anchor) → bboxToPolygon
  // freedraw/polygon (polyline anchor, closed ring) → coordinates directly
  // line/polyline → LineString
  // ellipse with customData.radiusKm → turf circle
  // text/arrow → throw new Error("Text and arrow annotations cannot be converted to data layers")
}
```

- [ ] **Step 3: Wire context menu in MapEditor.tsx**

- Use Excalidraw's `renderTopRightUI` or context menu override hook
- Show "Convert to data layer" item; disabled state for text/arrow
- On click: call `annotationToFeatureCollection`, then `LayerRegistry.convertAnnotationToDataLayer`, then `updateScene` removing the element, then `map.addSource`/`map.addLayer`

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/tools/__tests__/convert.test.ts`
Expected: PASS all 3 tests

---

### Task T15: Wave 3 — PNG Export Pipeline [CHANGE SITE]

**Orient:** Implement the composited PNG export in `apps/atlas-app/lib/export.ts` so a single export captures both the MapLibre basemap + data layers and the Excalidraw annotation overlay — in that z-order — at 2× device resolution.
**Flow position:** Step 1 of 2 in Wave 3 (all layers rendered → **png-export** → downloadable Blob)
**Upstream contract:** MapLibre `Map` instance with `preserveDrawingBuffer: true` (must be set in `MapEditor.tsx` — verify this is set). Excalidraw `exportToCanvas` API. Viewport dimensions from `mapRef.getCanvas()`.
**Downstream contract:** `exportPNG(map: Map, excalidrawAPI: ExcalidrawImperativeAPI, opts?: ExportOpts): Promise<Blob>` where `ExportOpts = { scale?: number }` (default `scale: 2`). Returns PNG Blob. Consumed by Phase 4 sharing and Phase 6 embed fallback.

**Composition order (load-bearing):** MapLibre canvas → Excalidraw canvas. This order ensures: (a) basemap and data layer features show through transparent annotation pixels; (b) annotations render on top. Reversing the order would silently produce wrong output.

**Resolution (amended per OQ-P2-2):** Export at CSS logical pixels × `scale` where `scale` defaults to 2. Read `mapCanvas.clientWidth`/`clientHeight` (CSS pixels) — NOT `mapCanvas.width`/`height` (physical pixels). On retina devices, `mapCanvas.width` is already `cssWidth * devicePixelRatio`; using it with `scale=2` would produce 4× logical resolution. Using `clientWidth * 2` always produces exactly 2× CSS pixels regardless of DPR, fulfilling PRD §7.1 "2× PNG for print." Source: OQ-P2-2.

**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/lib/export.ts`
- Modify: `apps/atlas-app/components/MapEditor.tsx` — verify/add `preserveDrawingBuffer: true` in MapLibre `Map` constructor options
- Test: `apps/atlas-app/lib/__tests__/export.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test**

```ts
it("composites map canvas under excalidraw canvas in correct order", async () => {
  // Mock canvas must have clientWidth/clientHeight set (CSS pixels), not just width/height.
  // This matches the OQ-P2-2 fix: exportPNG reads clientWidth/clientHeight.
  const mockMap = createMockMapWithCanvas({ cssWidth: 800, cssHeight: 600 });
  const mockAPI = createMockExcalidrawAPI();
  const blob = await exportPNG(mockMap, mockAPI);
  // assert blob.type === "image/png"
  // assert drawImage call order: map canvas first, excalidraw canvas second
  expect(mockCtx.drawImage.mock.calls[0][0]).toBe(mockMap.getCanvas());
  expect(mockCtx.drawImage.mock.calls[1][0]).toBe(excalidrawCanvas);
});
```

Run: `npx vitest run apps/atlas-app/lib/__tests__/export.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement export.ts**

```ts
export async function exportPNG(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  opts: { scale?: number } = {}
): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const mapCanvas = map.getCanvas();
  // Use CSS logical pixel dimensions (clientWidth/clientHeight), NOT the physical
  // canvas dimensions (width/height). On retina (DPR=2), mapCanvas.width is already
  // cssWidth * devicePixelRatio — using it would produce 4× logical resolution.
  // clientWidth/clientHeight are always CSS pixels regardless of DPR.
  const width = mapCanvas.clientWidth;
  const height = mapCanvas.clientHeight;

  const offscreen = new OffscreenCanvas(width * scale, height * scale);
  const ctx = offscreen.getContext("2d")!;
  ctx.scale(scale, scale);

  // Layer 1: MapLibre (basemap + data layers)
  ctx.drawImage(mapCanvas, 0, 0, width, height);

  // Layer 2: Excalidraw annotations (transparent background)
  const excalidrawCanvas = await excalidrawAPI.exportToCanvas({
    elements: excalidrawAPI.getSceneElements(),
    appState: { ...excalidrawAPI.getAppState(), exportBackground: false },
    files: excalidrawAPI.getFiles(),
  });
  ctx.drawImage(excalidrawCanvas, 0, 0, width, height);

  return offscreen.convertToBlob({ type: "image/png" });
}
```

- [ ] **Step 3: Verify preserveDrawingBuffer in MapEditor.tsx**

Run: `grep -n "preserveDrawingBuffer" /mnt/Ghar/2TA/DevStuff/atlasdraw/apps/atlas-app/components/MapEditor.tsx`
Expected: at least one match with `preserveDrawingBuffer: true`

If not found: add `preserveDrawingBuffer: true` to the `new maplibregl.Map({ ... })` options object in `MapEditor.tsx`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/atlas-app/lib/__tests__/export.test.ts`
Expected: PASS

---

### Task T16: Wave 3 — Phase 2 Benchmark Re-gate [CHANGE SITE]

**Orient:** Re-run the Phase 1 benchmark harness with the data layer scenario added (50,000 GeoJSON features + 5,000 annotations at 60fps) to enforce the Q8 acceptance gate: regression budget is +20% over the Phase 1 baseline recorded in `bench/results/phase-1-baseline.json`. Phase 2 does not ship until this gate passes.

**Q8 resolution citation (verbatim from open-questions-resolution.md Q8):**
> "Phase 2 acceptance gate re-runs the benchmark with real data layers added; regression budget is +20%."

**Flow position:** Step 2 of 2 in Wave 3 (png-export done → **benchmark-re-gate** → Phase 2 acceptance)
**Upstream contract:** `bench/results/phase-1-baseline.json` with `p50_frame_ms`, `p95_frame_ms`, `p99_frame_ms` fields. Phase 1 benchmark harness runnable via `npx tsx bench/run.ts`.
**Downstream contract:** `bench/results/phase-2-with-data-layers.json` written. CI check compares p95 values. Phase 2 branch is not merged until this check is green.

**Gate formula:** `phase2.p95_frame_ms <= baseline.p95_frame_ms * 1.20` AND sustained 60fps (16.67ms frame time) with 5,000 annotations + 50,000 GeoJSON features loaded.

**If gate fails:** Do NOT declare Phase 2 done. Escalate to `Skill: perf-investigation` before proceeding. Likely suspects: `CoordinateSync.syncMapToScene` re-running on data layer updates (it should not — data layers are MapLibre-only), large GeoJSON FC held in Zustand causing unnecessary React re-renders, or `style-compiler.ts` being called on every frame.

**Skill:** `perf-investigation`
**Files:**
- Modify: `bench/run.ts`
- Create: `bench/results/phase-2-with-data-layers.json` (by the benchmark run)
- Create: `bench/ci-gate.ts` (assert script for CI)

**Steps:**

- [ ] **Step 1: Extend bench/run.ts with data-layer scenario**

Add scenario `"phase2-50k-features-5k-annotations"`:
- Load `bench/fixtures/large-us-roads.geojson` (50k features; create synthetic fixture if real data not available)
- Add as MapLibre GeoJSON source + fill-extrusion layer
- Inject 5,000 synthetic annotation elements into Excalidraw scene via `updateScene`
- Run 120 frames of simulated pan (update MapLibre camera 120 times, trigger `syncMapToScene` each time)
- Record p50/p95/p99 frame times (using `performance.now()` around each sync call)
- Write results to `bench/results/phase-2-with-data-layers.json`

- [ ] **Step 2: Run benchmark**

Run: `cd /mnt/Ghar/2TA/DevStuff/atlasdraw && npx tsx bench/run.ts --scenario phase2-50k-features-5k-annotations`
Expected: `bench/results/phase-2-with-data-layers.json` written with numeric `p50_frame_ms`, `p95_frame_ms`, `p99_frame_ms`

- [ ] **Step 3: Write and run CI gate assertion**

```ts
// bench/ci-gate.ts
const baseline = JSON.parse(readFileSync("bench/results/phase-1-baseline.json", "utf8"));
const phase2 = JSON.parse(readFileSync("bench/results/phase-2-with-data-layers.json", "utf8"));
const budget = baseline.p95_frame_ms * 1.20;
if (phase2.p95_frame_ms > budget) {
  console.error(`GATE FAIL: p95=${phase2.p95_frame_ms}ms exceeds budget=${budget.toFixed(2)}ms`);
  process.exit(1);
}
console.log(`GATE PASS: p95=${phase2.p95_frame_ms}ms <= budget=${budget.toFixed(2)}ms`);
```

Run: `npx tsx bench/ci-gate.ts`
Expected: `GATE PASS: p95=Xms <= budget=Yms`

If output is `GATE FAIL`: stop, do not merge, invoke `Skill: perf-investigation`.

- [ ] **Step 4: Add gate to CI pipeline**

Verify or add in `.github/workflows/ci.yml`:
```yaml
- name: Benchmark regression gate
  run: npx tsx bench/ci-gate.ts
```

Run: `grep -n "ci-gate" /mnt/Ghar/2TA/DevStuff/atlasdraw/.github/workflows/ci.yml`
Expected: at least one match

---

## Open Questions

<!-- shape-incorporated 2026-05-03: OQ-P2-1 through OQ-P2-5 — all 5 questions resolved 2026-05-03; status line added for audit-readiness -->
**Resolution status: All 5 questions resolved 2026-05-03.** See `docs/decisions/phase-2-research-notes.md` for findings and `docs/decisions/open-questions-resolution.md` for project-level constraints. Individual RESOLVED blocks below.

These were unresolved design decisions that the executor must not silently decide. Each should be resolved before or during Wave 0 and documented as an ADR or an amendment to `open-questions-resolution.md`.

### OQ-P2-1: LayerRegistry ID space — prefixed or typed field?

**Force:** The plan specifies `"dl:"` prefix on data layer IDs to prevent Phase 5 CRDT key collisions. Alternative: flat ID space with a `kind` field as the discriminant. The prefix approach makes collision prevention visible in logs and diffs; the typed-field approach keeps IDs cleaner.

**Default this plan assumes:** `"dl:"` prefix enforced in `registerDataLayer`. If the Phase 5 CRDT design requires flat keys, this decision can be reversed then; the cost is a migration on stored `manifest.json` files.

**Resolve by:** Wave 0 before T11 ships.

**RESOLVED:** CONFIRMED. `"dl:"` prefix is correct. Excalidraw element IDs are bare UUIDs (no prefix), so collision is impossible by construction. Yjs Y.Map keys are arbitrary strings; the prefix prevents accidental cross-namespace collision with zero overhead. The `kind` field handles TypeScript discrimination; the prefix adds log/diff observability. Tasks T01 and T11 unchanged. Source: `open-questions-resolution.md` Q2 (Yjs model); `docs/decisions/phase-2-research-notes.md` OQ-P2-1.

### OQ-P2-2: PNG export resolution — current DPR or fixed 2×?

**Force:** PRD §7.1 says "2× PNG for print." `exportPNG` defaults to `scale: 2` which produces `width * devicePixelRatio * 2` pixels on retina displays (potentially 4× logical resolution). This may produce unexpectedly large files. Alternative: cap at `scale: 2` regardless of DPR; i.e. `OffscreenCanvas(width * 2, height * 2)` always.

**Default this plan assumes:** `OffscreenCanvas(width * scale, height * scale)` where `scale = opts.scale ?? 2` and `width/height` are the logical (CSS) pixel dimensions of the map canvas. Retina users get a physically larger but logically correct export.

**Resolve by:** T15 before merging export pipeline.

**RESOLVED — PLAN AMENDED:** Use CSS logical pixel dimensions (`clientWidth`/`clientHeight`), not the physical WebGL canvas dimensions (`width`/`height`). `map.getCanvas()` on a retina (DPR=2) device returns a canvas where `.width` is already `cssWidth * devicePixelRatio` physical pixels. Using `.width * 2` produces 4× logical resolution (unexpectedly large files). Fix: read `mapCanvas.clientWidth` / `mapCanvas.clientHeight` (CSS pixels). Then `OffscreenCanvas(width * 2, height * 2)` always produces exactly 2× CSS pixels regardless of DPR. **T15 Step 2 amended** to use `clientWidth`/`clientHeight`. Source: MapLibre MapOptions API docs; `docs/decisions/phase-2-research-notes.md` OQ-P2-2.

### OQ-P2-3: MapLibre addLayer reordering — does it force a full re-tile?

**Force:** `LayerPanel` reorder calls imply re-inserting MapLibre layers (no native reorder API — you must `removeLayer` + `addLayer`). On tile-based sources this may trigger a full re-fetch. On GeoJSON sources (which our data layers use) this should be cheap. But if basemap tile layers are interleaved with data layers in the same MapLibre style, reordering data layers may require re-inserting relative to tile layers, which is more complex.

**Default this plan assumes:** Data layers are inserted above all basemap tile layers. Reordering among data layers only calls `map.moveLayer(id, beforeId)` (MapLibre does support this for repositioning within the same source type). If this assumption fails in practice, the executor must surface it as a `[SNAG]`.

**Resolve by:** T12 LayerPanel implementation, verified manually in dev.

**RESOLVED — CONFIRMED with clarification:** `map.moveLayer(id, beforeId?)` is a first-class MapLibre method (source: `maplibre-gl-js/src/ui/map.ts:2851`) — not a remove+re-add workaround. It operates on style layer ordering only. For GeoJSON sources (all data client-side in memory), no server tile re-fetch occurs. For tile-based sources, tile data is already GPU-cached; layer reorder does not invalidate tile cache. The operation triggers exactly one repaint (one WebGL frame). The premise that "no native reorder API exists" was incorrect — `moveLayer` is the native reorder API. T12 executor must call `map.moveLayer(id, beforeId)` directly. No remove+add needed. Source: MapLibre GL JS `map.ts:2851`; MapLibre `Map.moveLayer()` API docs; `docs/decisions/phase-2-research-notes.md` OQ-P2-3.

### OQ-P2-4: Convert-to-data-layer for text and arrow — disabled or hidden?

**Force:** The plan specifies the context menu item appears disabled with a tooltip for text/arrow. Alternative: hide the item entirely for these types (less UI noise; less discoverability of the constraint). The PRD §8 Flow 2 only calls out polygon → data layer; the disabled-with-tooltip approach teaches users the boundary.

**Default this plan assumes:** Disabled with tooltip `"Text and arrow annotations cannot be converted to data layers"`. If user research (or beta feedback) shows it's more confusing than helpful, change to hidden in a follow-up.

**RESOLVED:** CONFIRMED. Disabled-with-tooltip is the correct pattern for an architectural type constraint. Hiding the item removes discoverability — users won't understand why the option exists for polygons but not text. Standard accessible UI guidance: disable and describe rather than silently hide when the constraint is structural, not state-dependent. T14 unchanged. Source: WCAG 2.1 advisory technique; `docs/decisions/phase-2-research-notes.md` OQ-P2-4.

### OQ-P2-5: GeoJSON validation library — inline or @placemarkio/check-geojson?

**Force:** `geojson.ts` (T10) hand-rolls a subset of RFC 7946 validation. `@placemarkio/check-geojson` is a well-tested dedicated library but adds a dependency. Inline validation covers the cases we need (type check, geometry non-null, array types); a library would cover edge cases (winding order, bbox validity, CRS fields) that we don't currently surface in the UI.

**Default this plan assumes:** Inline validation at T10. If Phase 3 format work or user bug reports reveal winding-order or CRS validation failures, add `@placemarkio/check-geojson` then.

**RESOLVED:** CONFIRMED — inline validation for Phase 2. Two research findings:

1. `mapbox/geojsonhint` was **archived May 29, 2024** (read-only, banner: "IMPORTANT: This repo will be archived. Use @placemarkio/check-geojson instead."). Do not reference it as an option.
2. `@placemarkio/check-geojson` is the correct successor (TypeScript, actively maintained, `momoa`-based line-level errors). However, its README states **"the API is not yet stable"** — unsuitable for a locked phase plan. Additionally, it explicitly does NOT check right-hand rule / winding order or CRS fields, which are the exact edge cases the plan defers to Phase 3. Inline validation at T10 covers our actual Phase 2 surface area.

If Phase 3 validation gaps appear, adopt `@placemarkio/check-geojson` (not geojsonhint) at that point, after verifying API stability. T10 unchanged. Source: github.com/mapbox/geojsonhint (archived); github.com/placemark/check-geojson README; `docs/decisions/phase-2-research-notes.md` OQ-P2-5.

---

## Artifact Manifest

<!-- MANIFEST:BEGIN -->
```yaml
phase: 2
plan_file: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md
wave_count: 4   # Wave 0, 1, 2, 3
task_count: 16

produces:
  - path: packages/tools/PolygonTool.ts
    kind: implementation
    wave: 1
    task: T03

  - path: packages/tools/PolylineTool.ts
    kind: implementation
    wave: 1
    task: T04

  - path: packages/tools/FreehandTool.ts
    kind: implementation
    wave: 1
    task: T05

  - path: packages/tools/TextLabelTool.ts
    kind: implementation
    wave: 1
    task: T06

  - path: packages/tools/ArrowTool.ts
    kind: implementation
    wave: 1
    task: T07

  - path: packages/tools/RectangleTool.ts
    kind: implementation
    wave: 1
    task: T08

  - path: packages/tools/CircleTool.ts
    kind: implementation
    wave: 1
    task: T09

  - path: packages/data/geojson.ts
    kind: implementation
    wave: 1
    task: T10

  - path: apps/atlas-app/state/layerRegistry.ts
    kind: implementation
    wave: 2
    task: T01 (types) + T11 (impl)

  - path: apps/atlas-app/state/store.ts
    kind: modified
    wave: 2
    task: T11

  - path: apps/atlas-app/hooks/useLayerRegistry.ts
    kind: implementation
    wave: 2
    task: T11

  - path: apps/atlas-app/components/LayerPanel.tsx
    kind: implementation
    wave: 2
    task: T12

  - path: apps/atlas-app/components/MapEditor.tsx
    kind: modified
    wave: 2
    task: T13 (drop), T15 (preserveDrawingBuffer)

  - path: packages/tools/convert.ts
    kind: implementation
    wave: 2
    task: T14

  - path: apps/atlas-app/lib/export.ts
    kind: implementation
    wave: 3
    task: T15

  - path: bench/run.ts
    kind: modified
    wave: 3
    task: T16

  - path: bench/ci-gate.ts
    kind: implementation
    wave: 3
    task: T16

  - path: bench/results/phase-2-with-data-layers.json
    kind: generated-artifact
    wave: 3
    task: T16

consumes_from_phase_1:
  - packages/geo/types.ts          # GeoAnchor, GeoCustomData — no schema changes
  - packages/geo/CoordinateSync.ts # syncMapToScene — no changes
  - packages/tools/PinTool.ts      # AtlasdrawTool interface precedent
  - apps/atlas-app/components/MapEditor.tsx  # mount point — modified not replaced
  - bench/results/phase-1-baseline.json      # hard prerequisite for T16

produces_for_phase_3:
  - packages/data/geojson.ts       # parse + write, pure snapshot format
  - apps/atlas-app/state/layerRegistry.ts  # layer order → manifest.json

produces_for_phase_4:
  - apps/atlas-app/lib/export.ts   # PNG Blob → sharing
  - packages/tools/index.ts        # stable tool registry

new_dependencies:
  - "@turf/distance": "^6"         # CircleTool radius readout
  - "@turf/circle": "^6"           # CircleTool convert-to-data-layer

license_constraints:
  - packages/tools: MPL-2.0        # per Q5
  - packages/data: MIT             # per Q5
  - apps/atlas-app: AGPL-3.0       # per Q5
```
<!-- MANIFEST:END -->

---

## Shape Changes Summary

**Incorporated:** 2026-05-03 by shape-incorporator agent.
**Wave order:** unchanged. **Task count:** unchanged (16). **File structure:** unchanged. **Escalations:** none.

| # | Section edited | Change | Cited Q |
|---|---|---|---|
| 1 | Flow D preamble (line ~111) | Replaced stale `devicePixelRatio * scale` resolution note with correct CSS-pixel model: read `clientWidth`/`clientHeight`, not `width`/`height`; `OffscreenCanvas(clientWidth * 2, clientHeight * 2)` always = 2× CSS regardless of DPR | OQ-P2-2 |
| 2 | Phase Boundary Contracts → Produces row for `geojson.ts` | Added explicit Phase 3 contract obligation: winding-order + CRS validation deferred; Phase 3 must adopt `@placemarkio/check-geojson` (not archived `geojsonhint`) once stable | OQ-P2-5 |
| 3 | Open Questions section header | Added resolution status line: all 5 questions resolved 2026-05-03 with pointers to research-notes and open-questions-resolution docs | OQ-P2-1 through OQ-P2-5 |

**Verification-only checks (no edits made):**

- **T05 epsilon:** `epsilon=0.00001°` (line 391) already present and explicit — no edit needed. The supplementary turf research confirms this override is load-bearing.
- **T12 moveLayer:** already correctly states `map.moveLayer(id, beforeId)` as first-class API — no edit needed.
- **Wave order:** OQ-P2-3 confirmation that `moveLayer` is cheap (one WebGL repaint, no re-tile) does not change task dependencies. T12 remains Wave 2, parallel with T11/T13/T14.
- **Tech Stack:** `@placemarkio/check-geojson` deferred (not added) — "NOT added this phase" block requires no update since the library was never proposed as an addition.
- **Skill annotations:** no task grew complex enough to warrant a different skill annotation.
