# atlas-app — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.7, Phase 1–7 plans, cross-phase-audit.md (MISMATCH-1/2/3/5), open-questions-resolution.md (Q11/Q12).

---

## Overview

`apps/atlas-app` is the Atlasdraw editor SPA. It replaces `apps/excalidraw-app` (Phase 1). Built on React 18 + TypeScript + Vite + Zustand. The rendering surface stacks MapLibre GL JS beneath an Excalidraw canvas; all geo-aware drawing tools operate in that layered context.

State is split across three systems:
- **Zustand `store.ts`** — UI-only state (panel open/closed, active tool, modal, collab). [CONFIDENCE: high]
- **Excalidraw AppState** — Scene elements, canvas geometry, undo/redo. Never lifted out. [CONFIDENCE: high]
- **Yjs `y-doc`** — Data layer CRDT state, active Phase 5+. [CONFIDENCE: high]

Persistence: IndexedDB (primary autosave), File System Access API (Chromium-only enhancement). [CONFIDENCE: high — tech-spec §4.7, Phase 3 plan]

---

## Feature Areas

### 1. Canvas — MapEditor Stack

**`App.tsx`**
- Root application shell. Mounts MapEditor, wires React context providers (Zustand, Yjs provider, plugin host context).
- Phase: 1 (initial scaffold), evolves each phase.
- Deps: MapEditor, all panel components, PluginHost.
- Complexity: medium (glue code; most logic delegated).
- [CONFIDENCE: high]

**`components/MapEditor.tsx`**
- Central composition surface. Renders MapLibre GL JS map as the base layer; Excalidraw canvas floats above it via CSS `position: absolute` / `z-index` stacking.
- Manages the coordinate sync lifecycle: on every map move/zoom event, calls `useCoordinateSync` to reproject Excalidraw element positions.
- **Perf-sensitive**: CoordinateSync invocation site — called on `map.on('move')` and `map.on('zoom')`. Must debounce/throttle; every frame reprojection is a known performance hazard.
- Phase: 1 (scaffold), Phase 2 (geo tools wired), Phase 3 (persistence wired).
- Deps: `packages/basemap` (MapLibre wrapper), `packages/geo/coordinate-sync.ts`, Excalidraw `<Excalidraw>` component.
- Complexity: high.
- [CONFIDENCE: high — tech-spec §4.7]

**`hooks/useCoordinateSync.ts`**
- Subscribes to MapLibre `move`/`zoom` events. On each event, reads current map viewport and calls `packages/geo/coordinate-sync.ts:CoordinateSync.projectToCanvas()` to update element positions in the Excalidraw scene.
- **Perf-sensitive**: hot path; invoked at up to 60 fps during map pan/zoom.
- Phase: 1–2.
- Deps: `packages/geo/coordinate-sync.ts`, Excalidraw `updateScene` API.
- Complexity: medium-high.
- [CONFIDENCE: high — tech-spec §4.7]

**`hooks/useMapStyle.ts`**
- Reads active basemap style from Zustand store; calls MapLibre `map.setStyle()`.
- Subscribes to style changes from `BasemapPicker` and (Phase 6) `StyleEditorPanel`.
- Phase: 1 (basic), Phase 6 (style editor wired).
- Complexity: low-medium.
- [CONFIDENCE: high]

**`hooks/useScene.ts`**
- Bridge between Excalidraw AppState changes and the rest of the app.
- On scene change: triggers autosave queue (IndexedDB), broadcasts `SCENE_UPDATE` via collab client (Phase 5+).
- Phase: 2+.
- Complexity: medium.
- [CONFIDENCE: med]

---

### 2. Layers

**`components/LayerPanel.tsx`**
- Custom `<Sidebar>` tab. Displays the `LayerRegistry` from Zustand store. Supports add/remove/toggle-visibility/reorder of data layers.
- **MISMATCH-2 note**: The `LayerRegistry` *type* lives in `packages/data/layer-registry.ts`; the *state slice* (Zustand store) lives in `apps/atlas-app/state/store.ts`, exported as `useLayerRegistry`. This panel reads from the Zustand slice, not from `packages/data` directly. [CONFIDENCE: high — cross-phase-audit MISMATCH-2]
- Phase: 2 (basic layer ops), Phase 5 (Yjs-backed layers).
- Deps: `useLayerRegistry` (Zustand slice), `packages/data/layer-registry.ts` (type only).
- Complexity: medium.

**`components/ImportDialog.tsx`**
- Drag-and-drop import modal. Accepts GeoJSON, KML, SHP, CSV (lat/lng columns), `.atlasdraw` files.
- On file drop: delegates parsing to `packages/data` readers; on success, dispatches new layer to Zustand + Yjs doc.
- Phase: 3 (file format), Phase 6 (Felt importer wired via `packages/data/felt.ts`).
- Deps: `packages/data/geojson.ts`, `packages/data/kml.ts`, `packages/data/felt.ts`.
- Complexity: medium.
- [CONFIDENCE: high — tech-spec §4.7, Phase 3 plan]

---

### 3. Basemap

**`components/BasemapPicker.tsx`**
- Dropdown/panel listing registered basemap styles from `packages/basemap` registry.
- On selection: updates Zustand `activeBasemapId`; `useMapStyle` hook handles the MapLibre style swap.
- Phase: 1–2.
- Complexity: low.
- [CONFIDENCE: high — tech-spec §4.7]

---

### 4. Toolbar

**`components/Toolbar.tsx`**
- Custom `<MainMenu>` replacement. Houses geo-aware tool buttons: pin, route-snap, polygon, measure, plus standard Excalidraw tools.
- Tool registry read from `packages/tools/index.ts` (7 tools, Phase 2). Phase 7 plugin tools injected via `PluginHost` into this registry.
- Phase: 1 (scaffold), 2 (7 tools), 7 (plugin tools).
- Complexity: medium.
- [CONFIDENCE: high — tech-spec §4.7]

---

### 5. Share

**`components/ShareDialog.tsx`**
- Modal for sharing the current map.
- Two paths (Phase 4): (a) URL-hash inline share for maps < 32 KB; (b) upload to `apps/storage` → mint share token → `/m/:uuid` URL for maps ≥ 32 KB.
- Displays user-visible note: "This link shows the map as it was when you shared it."
- Phase: 4 (both modes).
- Deps: `hooks/useShareLink.ts`, `StorageClient`.
- Complexity: medium.
- [CONFIDENCE: high — Phase 4 plan Task 8/9]

**`hooks/useShareLink.ts`**
- Orchestrates share-link creation. Size-gates the bundle: < 32 KB → URL-hash compress with `lz-string`; ≥ 32 KB → `POST /maps` → `POST /maps/:id/share` → return `/m/:token`.
- Phase: 4.
- Complexity: medium.
- [CONFIDENCE: high — Phase 4 plan]

**`pages/share/[uuid].tsx`** (read-only viewer)
- Route `/m/:uuid`. On mount, calls `GET /share/:uuid` → receives `{ map: MapRecord, mode: 'read' }`. Loads map into read-only Excalidraw + MapLibre instance.
- Phase: 4.
- Complexity: medium.
- [CONFIDENCE: high — Phase 4 plan Task 9]

---

### 6. Collab

**`state/collab.ts`**
- Zustand slice: `CollabState`. Tracks room ID, connected peers, cursor positions, sync status.
- Phase: 5 (initial), Phase 6 (extended for multi-tenant auth).
- Deps: Socket.IO client, Yjs `y-doc`.
- Complexity: medium-high.
- [CONFIDENCE: high — Phase 5 plan, cross-phase-audit 1.6]

**`hooks/useCollab.ts`** (inferred)
- Manages Socket.IO connection lifecycle. Subscribes to `SCENE_UPDATE`, `MAP_CAMERA_UPDATE`, `CURSOR` events; dispatches to Excalidraw `updateScene` and Zustand camera state.
- **Perf-sensitive**: Yjs sync path — binary frame processing and CRDT merge on each incoming `DATA_LAYER_OP`.
- Phase: 5.
- Complexity: high.
- [CONFIDENCE: med — inferred from tech-spec §5.1 and Phase 5 plan]

---

### 7. Comments

**`components/CommentsPanel.tsx`**
- Threaded comment list sidebar. Renders comment threads from Yjs comments doc (second `Y.Doc` per room, Phase 5/6).
- Phase: 6.
- Deps: `hooks/useComments.ts`, Yjs comments doc.
- Complexity: medium.
- [CONFIDENCE: high — Phase 6 plan Feature 3]

**`components/CommentAnchor.tsx`**
- Map overlay pin for anchored comments. Rendered on the MapLibre layer, positioned by geo-coordinates.
- Phase: 6.
- Complexity: medium.
- [CONFIDENCE: high — Phase 6 plan Feature 3]

**`components/CommentComposer.tsx`**
- Text input with @mention picker. Dispatches new comment to Yjs comments doc via `useComments`.
- Phase: 6.
- Complexity: low-medium.
- [CONFIDENCE: high — Phase 6 plan Feature 3]

**`hooks/useComments.ts`**
- Subscribes to the comments `Y.Doc` WebSocket connection at `apps/realtime/src/comments-doc.ts`.
- Phase: 6.
- Complexity: medium.
- [CONFIDENCE: high — Phase 6 plan Feature 3]

---

### 8. Style Editor

**`components/StyleEditorPanel.tsx`** (inferred name)
- Visual layer-style editor. Edits MapLibre paint/layout properties for vector data layers.
- Phase: 6.
- Deps: `packages/basemap` style types, `useMapStyle` hook.
- Complexity: medium-high.
- [CONFIDENCE: med — Phase 6 plan, PRD v1.0 feature list]

---

### 9. Asset Library

**`components/AssetLibrary.tsx`** (inferred)
- Panel for reusable geo symbols, map markers, custom icons.
- Phase: 6.
- Deps: `packages/sdk` (if plugin-contributed assets land here).
- Complexity: medium.
- [CONFIDENCE: low — PRD v1.0 mention, Phase 6 plan summary; file path not explicitly specified]

---

### 10. Accessibility

**`components/AccessibilityPanel.tsx`** (inferred)
- Hosted-only panel providing WCAG compliance controls: high-contrast basemap, font-size overrides, screen-reader layer descriptions.
- Phase: 6 (hosted only).
- Complexity: low-medium.
- [CONFIDENCE: low — PRD v1.0 hosted features; implementation shape not specified]

---

### 11. Billing (Hosted Only)

**`components/BillingPortal.tsx`** (inferred)
- Stripe billing portal iframe or redirect. Surfaced only in hosted SaaS build (`VITE_HOSTED=true`).
- Phase: 6 (Stripe integration, GAP-1).
- Complexity: low (thin wrapper around Stripe portal URL).
- [CONFIDENCE: low — Phase 6 plan mentions Stripe; component shape not specified]

---

### 12. Versioning / Snapshots (Phase 7)

**`components/versioning/VersionTimeline.tsx`**
- Horizontal slider UI displaying named and auto-generated snapshots as nodes.
- Allows navigating between snapshot states, triggering restore via `SnapshotStore.restore()`.
- Phase: 7.
- Deps: `packages/versioning/SnapshotStore.ts`, `apps/storage/routes/snapshots.ts`.
- Complexity: medium-high.
- [CONFIDENCE: high — Phase 7 plan Feature 4 file structure]

**`components/versioning/VersionDiffViewer.tsx`**
- Side-by-side diff display. Renders structured diff object from `DiffEngine.diff(snapshotA, snapshotB)`.
- Phase: 7.
- Deps: `packages/versioning/DiffEngine.ts`.
- Complexity: medium.
- [CONFIDENCE: high — Phase 7 plan Feature 4]

**`components/versioning/SnapshotNameDialog.tsx`**
- Modal for naming a snapshot before saving.
- Phase: 7.
- Complexity: low.
- [CONFIDENCE: high — Phase 7 plan Feature 4]

---

### 13. Plugin Host (Phase 7)

**`components/PluginHost.tsx`** (inferred)
- Web Worker sandbox host. Loads plugin bundles via `PluginRegistry`, instantiates each in a Worker, bridges `AtlasdrawAPI` calls via `postMessage`.
- Exposes plugin-registered tools to `Toolbar.tsx` and plugin-registered layer types to `LayerPanel`.
- Phase: 7.
- Deps: `packages/sdk/AtlasdrawAPI`, `PluginRegistry`.
- Complexity: high.
- [CONFIDENCE: med — Phase 7 plan Feature 1, Q11 resolution]

**`components/PluginManager.tsx`** (inferred)
- UI for browsing, installing, and removing plugins. Validates SHA-256 integrity and SPDX license on install.
- Phase: 7.
- Deps: `PluginRegistry`, `packages/sdk/PluginManifest`.
- Complexity: medium.
- [CONFIDENCE: med — Phase 7 plan GAP-2 annotation]

---

### 14. AI Styling Panel (Phase 7)

**`components/AIStylingPanel.tsx`** (inferred)
- Local-first AI styling panel. Sends layer data + natural-language style prompt to OpenAI-compat endpoint; applies returned MapLibre style expression.
- Phase: 7.
- Complexity: medium.
- [CONFIDENCE: low — Phase 7 plan summary; implementation shape extrapolated]

---

### 15. Mobile Field Collection (Phase 7)

**`pages/field/[layerToken].tsx`** (inferred)
- Mobile-optimized route for field data collection. Submits feature records to `POST /api/v1/submit/:layerToken` on `apps/storage`.
- Phase: 7.
- Complexity: medium.
- [CONFIDENCE: med — Phase 7 plan Feature 2]

---

## State Layer Summary

| Store | Owner | Contents | Phase |
|---|---|---|---|
| Zustand `store.ts` | `apps/atlas-app` | UI state, layer registry slice, collab state, active tool | 1+ |
| Excalidraw AppState | Excalidraw internal | Scene elements, camera, undo stack | 1+ |
| Yjs `y-doc` (data) | `packages/data` YjsLayer | GeoJSON FeatureCollections per layer (CRDT) | 5+ |
| Yjs `y-doc` (comments) | `apps/realtime/comments-doc.ts` | Comment threads per room | 6+ |
| IndexedDB | `state/persistence.ts` | Autosave queue for offline/unsaved state | 3+ |

---

## GeoAnchor / CustomData Audit Notes

Per MISMATCH-1/3/5 (cross-phase-audit.md):
- The correct field name is `element.customData.geo` (not `geoAnchor`). [CONFIDENCE: high]
- The correct type is `GeoAnchor` discriminated union: `{ kind: "point" | "bbox" | "polyline", ..., zRef: number, projection: "mercator" }`. [CONFIDENCE: high — Phase 1 types, Q12 resolution]
- Any component reading geo metadata from an Excalidraw element MUST use `customData.geo` and narrow on `kind`. The flat `{ lng, lat, zoom }` shape documented in Phase 3 consumer table is a documentation mismatch and must not be implemented. [CONFIDENCE: high — cross-phase-audit MISMATCH-1/3]
