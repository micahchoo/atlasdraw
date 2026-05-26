# atlas-app — Contracts

**Status: Verified against source.** Replaces prior speculative version.
Generated 2026-05-16 by Wave 3 Contract agent (characterization-testing at subsystem boundaries).

> Sources: source files in `code/apps/atlas-app/src/`, `code/packages/*/src/`, `code/apps/atlas-app/package.json`.

---

## 1. Contract Surface Map

Every `@atlasdraw/*` and external dependency imported by atlas-app, with the exact imports used.

### 1.1 @atlasdraw/basemap (era 4, distance 3)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `MapCanvas` | React component | MapEditor | Renders the MapLibre GL map layer |
| `MapCanvasInitialView` | type | MapEditor | Props type for initial viewport |
| `compileLayer` | function | MapEditor | Compiles layer config for MapLibre |
| `defaultLayerStyle` | function | MapEditor | Default styling for data layers |
| `getBasemap` | function | MapEditor | Lookup basemap config by id |
| `resolveStyle` | function | MapEditor | Async resolve basemap style JSON |
| `registerPmtilesProtocol` | function | MapEditor | Register pmtiles:// protocol handler |
| `BasemapRemoteGatedError` | class | MapEditor | Error type for remote tile gating |
| `BasemapConfig` | type | MapEditor | Basemap configuration shape |

Single-file consumer: all imports land in `MapEditor.tsx` only.

### 1.2 @atlasdraw/data (era 3, distance 2)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `read` | function | state/persistence.ts | Deserialize .atlasdraw format from blob |
| `write` | function | state/persistence.ts | Serialize document to .atlasdraw blob |
| `AtlasdrawDocument` | type | persistence, useShareLink, useAutosave | Document shape |
| `YjsLayer` | class | useYjsLayer | CRDT layer wrapper on Y.Doc |
| `observeLayer` | function | useYjsLayer | Subscribe to GeoJSON snapshot changes |
| `addFeature` (aliased) | function | useYjsLayer | CRUD: add feature |
| `deleteFeature` (aliased) | function | useYjsLayer | CRUD: delete feature |
| `setProperty` (aliased) | function | useYjsLayer | CRUD: set property |
| `appendVertex` (aliased) | function | useYjsLayer | CRUD: append vertex |
| `deleteVertex` (aliased) | function | useYjsLayer | CRUD: delete vertex |
| `parse` | function | MapEditor | Parse GeoJSON from dropped file |
| `GeoJSONParseError` | class | MapEditor | GeoJSON parse error type |
| `requireHomogeneousGeometry` | function | MapEditor | Enforce single geometry kind per layer |

### 1.3 @atlasdraw/geo (era 1, distance 0)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `projectPoint` | function | seedToElement, useGeoAnchor, useAtlasdrawTool | Mercator projection to screen coords |
| `unprojectPoint` | function | useGeoAnchor | Screen coords to mercator lng/lat |
| `GeoCustomData` | type | seedToElement, useGeoAnchor, useAtlasdrawTool | Shape of element.customData |
| `GeoAnchor` | type | seedToElement, useGeoAnchor, MapEditor | Discriminated union geo anchor |
| `isGeoCustomData` | function | useGeoAnchor, MapEditor, useLayerRegistrySync | Type guard for customData |
| `CoordinateSync` | class | useCoordinateSync | Manages map→scene projection pipeline |
| `ExcalidrawAPI` | type | useCoordinateSync | Decoupled subset of imperative API |
| `normalizeElementsForExport` | function | MapEditor | Normalize geo coords for serialization |

**Contract note**: `ExcalidrawAPI` is a structural subset of `ExcalidrawImperativeAPI`. The geo package intentionally avoids depending on `@excalidraw/excalidraw`. The cast `as ExcalidrawAPI` in `useCoordinateSync` is a type-level bridge.

### 1.4 @atlasdraw/protocol (era 5, distance 4)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `CommentAnchor` | type | announcements test | Comment location type |
| `RealtimeConfig` | type | app-config | Realtime server configuration |
| `parseRoomFragment` | function | useCollabRoom | Parse `#room:<id>,<key>` URL fragment |

### 1.5 @atlasdraw/tools (era 2, distance 1)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `AtlasdrawElementSeed` | type | seedToElement, useAtlasdrawTool | Tool-emitted seed shape |
| `classifyTool` | function | useToolState | Determines if tool is drawing mode |
| `PinTool` | object | MapEditor | Pin placement tool definition |
| `annotationToFeatureCollection` | function | MapEditor | Convert annotation to GeoJSON FC |
| `AtlasdrawTool` | type | useAtlasdrawTool | Tool interface |
| `ToolContext` | type | useAtlasdrawTool | Bridge context for tools |
| `ToolPointerEvent` | type | useAtlasdrawTool | Pointer event shape for tools |
| `UnsupportedConvertElementError` | class | MapEditor | Conversion error type |
| `ConvertibleElement` | type | MapEditor | Elements eligible for data-layer conversion |

### 1.6 @excalidraw/excalidraw (vendored, v0.18.0)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `<Excalidraw>` | React component | MapEditor | The drawing canvas |
| `<MainMenu>` / `<MainMenu.Item>` | React components | MapEditor | Custom main menu |
| `ExcalidrawImperativeAPI` | type | MapEditor, export, hooks | Imperative API interface |
| `ExcalidrawElement` | type | scene-crypto, seedToElement, MapEditor | Scene element type |
| `exportToCanvas` | function | export | Render scene to canvas for PNG export |
| `setExportElementTransformer` | function | MapEditor | Global transform hook for exports |
| `DEFAULT_SIDEBAR` (from @excalidraw/common) | object | MapEditor | Sidebar identity for tab registration |

**Excalidraw props used on `<Excalidraw>`**: `initialData`, `gridModeEnabled`, `onExcalidrawAPI`, `onChange`, `getBackgroundCanvas`, `UIOptions.canvasActions.export`.

**Excalidraw imperative API methods called**: `getSceneElements()`, `updateScene()`, `getAppState()`, `onChange()`, `toggleSidebar()`, `registerSidebarTab()`, `registerContextMenuItem()`.

### 1.7 @excalidraw/element (vendored)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `newFreeDrawElement` | function | seedToElement | Create freedraw ExcalidrawElement |
| `newLinearElement` | function | seedToElement | Create line/arrow ExcalidrawElement |
| `syncInvalidIndices` | function | useAtlasdrawTool | Fix fractional indices after insert |
| `newElement` | function | (documented import) | Generic Excalidraw element factory |
| `ExcalidrawFreeDrawElement` | type | seedToElement | Freedraw element type |
| `ExcalidrawLinearElement` | type | seedToElement | Linear element type |

### 1.8 @excalidraw/math (vendored)

| Import | Kind | Used In | Purpose |
|--------|------|---------|---------|
| `pointFrom` | function | seedToElement | Point creation utility |
| `LocalPoint` | type | seedToElement | Point type `[number, number]` |

### 1.9 maplibre-gl (external, ^4.7.1)

| Import/Method | Used In | Purpose |
|--------------|---------|---------|
| `maplibregl.Map` (type) | All hooks + export | Map instance type |
| `map.project(lngLat)` | seedToElement, useAtlasdrawTool, MapEditor | Project geo→screen coords |
| `map.unproject(point)` | useMapWheelRouter, useAtlasdrawTool | Project screen→geo coords |
| `map.getZoom()` | useAtlasdrawTool | Current zoom level |
| `map.getBounds()` | useAtlasdrawTool | Visible bounds |
| `map.getCanvas()` | export, MapEditor | Raw canvas for composite export |
| `map.setStyle(style)` | MapEditor | Apply basemap style |
| `map.addSource(id, src)` | MapEditor | Add GeoJSON source |
| `map.getSource(id)` | MapEditor | Get existing source |
| `map.removeSource(id)` | MapEditor | Remove source |
| `map.addLayer(layer)` | MapEditor | Add layer |
| `map.getLayer(id)` | MapEditor | Check layer existence |
| `map.removeLayer(id)` | MapEditor | Remove layer |
| `map.setLayoutProperty(id, prop, val)` | useLayerRegistrySync | Toggle layer visibility |
| `map.easeTo(opts)` | useMapWheelRouter | Animated camera move |
| `map.on("move"|"zoom"|"rotate"|"pitch", handler)` | useCoordinateSync | Camera event subscription |
| `map.off(...)` | useCoordinateSync | Camera event cleanup |

---

## 2. Knot Analysis

Dependency crossings weighted by era distance (era 0 = own package):

| Dependency | Consumer Files | Era | Distance | Crossings |
|-----------|---------------|-----|----------|-----------|
| @atlasdraw/geo | 6+ | 1 | 0 | 6 |
| @atlasdraw/tools | 5 | 2 | 1 | 5 |
| @atlasdraw/data | 5 | 3 | 2 | 10 |
| @atlasdraw/basemap | 1 | 4 | 3 | 3 |
| @atlasdraw/protocol | 3 | 5 | 4 | 12 |
| @excalidraw/excalidraw | 6+ | vendored | 5 | 30 |
| @excalidraw/element | 2 | vendored | 5 | 10 |
| maplibre-gl | 7+ | external | 6 | 42 |

**Prime tangles** (irreducible):
- **GeoAnchor data flow**: `customData.geo` flows through every layer (tools → geo → excalidraw → data → persistence). The discriminated union shape is the cross-cutting contract. Irreducible because geo context must survive serialization round-trips.
- **CoordinateSync camera → scene pipeline**: Map camera events → CoordinateSync.syncMapToScene() → Excalidraw.updateScene(). Strict ordering: camera changes first, then elements re-project, then scene renders.
- **Collab bidirectional sync**: Socket.IO events for scene data, y-websocket for CRDT, MapLibre source for rendered features. Three parallel channels sharing one document state.

**Composite tangles** (accidental, refinable):
- **Excalidraw element factories in seedToElement**: `@excalidraw/element` (newFreeDrawElement, newLinearElement) called directly. These are bridge code, but the dependency could be wrapped behind an `@atlasdraw/element` facade to decouple from vendored API surface.
- **ExcalidrawImperativeAPI structural cast**: The `as ExcalidrawAPI` cast in useCoordinateSync. Adding a small adapter layer in `@atlasdraw/geo` would make the decoupling explicit and type-safe.
- **MapLayerRegistry double subscription**: useLayerRegistrySync subscribes to both `excalidrawAPI.onChange` (Bug A) and Zustand store.subscribe (Bug B) tracking the same registry entries through two different channels. These could be unified.

---

## 3. Security Pins

### 3.1 Bidirectional serialization: customData.geo (HIGH)

`element.customData.geo` is the single source of truth for geo-anchored element positions. The discriminated union (`point | bbox | polyline`) must round-trip identically through:
- JSON.stringify/JSON.parse (file save/load)
- structuredClone (postMessage to Phase 7 worker)
- Yjs CRDT binary encoding (collaborative editing)

Any field added to `GeoAnchor` must be present in all three serialization paths.

### 3.2 Excalidraw coordinate lock (HIGH)

Atlas forces `scrollX=0, scrollY=0, zoom=1` on every `onChange` via `handleExcalidrawChange`. This means scene coordinates == screen pixels. Any code path that sets scroll/zoom (Excalidraw's `scrollToContent()` on file load, Excalidraw zoom gestures) breaks the projection. The lock is enforced with a `return` after the reset — geo-sync does NOT fire until scroll is identity. If the reset itself triggers another onChange, the loop is bounded by the `return` guard.

**Load-bearing ordering** in handleExcalidrawChange:
1. Background color intercept
2. Scroll lock (return if non-identity)
3. Post-load geo sync (only reaches here if scroll=identity)
4. Persistence dirty mark
5. ARIA selection announcement

If step 2 fails to execute before step 3, elements render at wrong screen positions.

### 3.3 ViewBackgroundColor intercept race (MEDIUM)

On mount, Excalidraw fires `onChange` with `viewBackgroundColor="#ffffff"` BEFORE `initialData.appState` is applied. Without the `transparentAppliedRef` gate, this initial white flash gets captured into `mapBg`, painting an opaque white rectangle over the map.

The gate: `transparentAppliedRef.current` flips to `true` only after an onChange with `"transparent"` arrives (= initialData took effect). Before that, white onChange values are silently ignored.

### 3.4 Drag-drop capture phase ordering (MEDIUM)

GeoJSON file drops use a capture-phase listener (`{ capture: true }`) on the root div to beat Excalidraw's bubble-phase handler. Excalidraw's `handleAppOnDrop` runs in bubble phase and consumes `dataTransfer.files`. If vendored Excalidraw changes its event phase in a future update, GeoJSON drops silently fail with no fallback.

### 3.5 MapLibre source/layer ordering (MEDIUM)

Code pattern in MapEditor (both GeoJSON drop and collab data layer):
```typescript
map.addSource(id, { type: "geojson", data: fc });          // 1st
map.addLayer(compileLayer(id, style, geometryType));         // 2nd
```
If `addLayer` throws, the source is removed as rollback. But the rollback uses a nested try/catch. A partial failure (source created, layer failed) leaves the source orphaned if the rollback itself also fails.

### 3.6 YjsLayer + MapLibre source lifecycle race (MEDIUM)

Two effects share `COLLAB_DATA_ID`:
- Effect 1 (deps: `map, !!yjsLayer.features`): creates/destroys the MapLibre source+layer
- Effect 2 (deps: `map, yjsLayer.features`): pushes data updates via `src.setData(features)`

If Effect 2 fires before Effect 1 has created the source (e.g., on initial collab activation where both effects fire synchronously in the same render), `map.getSource()` returns `undefined` and `src.setData()` fails silently.

### 3.7 CollabState lifecycle (MEDIUM)

`collabState.setSceneAccessor()` and `setSceneReceiver()` are wired in a `useEffect` keyed on `excalidrawAPI`. If `excalidrawAPI` identity changes (hot reload, React StrictMode double-mount), stale accessor closures capture dead `excalidrawAPI` references. The unmount cleanup calls `collabState.disconnect()` which is idempotent, but between remount and reconnect, inbound SCENE_UPDATE events could be dropped.

### 3.8 Global export element transformer (LOW)

`setExportElementTransformer()` sets a module-level global in Excalidraw. If two MapEditor instances coexist (Vitest tests), the last-unmounted instance's cleanup `setExportElementTransformer(null)` clears the transformer for both. Tests must manage the global lifecycle explicitly.

### 3.9 getBackgroundCanvas stale closure (LOW)

`getBackgroundCanvas` captures `map` at construction time. Excalidraw reads this once at mount. Creating a new callback identity does NOT cause Excalidraw to re-read it. In practice `map` transitions from null to instance exactly once, so this is safe — but if MapLibre ever remounts mid-session, export compositing would render a stale canvas.

---

## 4. Undocumented Contracts

### 4.1 controlled vs uncontrolled Excalidraw (IMPLICIT)

Atlas treats `<Excalidraw>` as an **uncontrolled** component: `initialData` is passed once as a module-scoped const, and all subsequent mutations go through `excalidrawAPI.updateScene()` (imperative). No prop-driven re-rendering. If a future Excalidraw version changes its internal state reconciliation and requires controlled re-renders, this pattern breaks.

### 4.2 Q11 boundary for element factories (IMPLICIT)

seedToElement.ts imports `@excalidraw/element` factories (`newFreeDrawElement`, `newLinearElement`) directly. Under Q11, TOOL code is banned from importing Excalidraw internals. seedToElement is BRIDGE code (atlas-app host side), so it is allowed — but the boundary is undocumented and subtle. A future refactor could accidentally move element creation into a tool and violate Q11.

### 4.3 CoordinateSync lifecycle protocol (IMPLICIT)

`CoordinateSync.attach()` must be called before `syncMapToScene()` has any effect. `detach()` prevents future syncs. The internal `_attached` flag is private. No guard against double-attach or double-detach. Callers (useCoordinateSync) follow the pattern: effect fires → attach + add listeners → cleanup removes listeners + detach. Any code calling `syncMapToScene()` without calling `attach()` first silently no-ops.

### 4.4 registerContextMenuItem gap window (IMPLICIT)

The `registerContextMenuItem` API returns an `unregister` callback. The hook's useEffect cleanup calls `return unregister` (removing the stale item). When deps change, the OLD item is removed, then the NEW item is registered. During the brief inter-effect gap (synchronous in React 18+), NO context menu item exists. The gap is invisible to users but observable in tests.

### 4.5 MapLibre project() coordinate identity (IMPLICIT)

`map.project(lngLat)` returns screen pixels relative to the map canvas bounding rect. Because Excalidraw is locked to `scrollX=0, scrollY=0, zoom=1`, Excalidraw element `x/y` equals `project().x/y` exactly — no scaling or offset. This identity is the foundation of every geo→scene projection in the app. It breaks if:
- Excalidraw zoom is ever set to a value other than 1
- The map canvas and Excalidraw canvas have different CSS sizes or offsets
- CSS transforms are applied to either container

### 4.6 LayerRegistry entry lifecycle ordering (IMPLICIT)

LayerRegistry entries use `MapEditor` as the single ownership authority. The flow is:
1. Annotation layer: Excalidraw creates element → onChange fires → buildSceneDiffHandler registers annotation entry
2. Data layer: GeoJSON drop or Convert action → MapEditor creates MapLibre source+layer → then calls registry.registerDataLayer

Step ordering is enforced by inlining (MapEditor always creates MapLibre source first, then registers). Any independent code path that calls `registry.registerDataLayer` without creating a MapLibre source first creates an orphan entry that the visibility system tries to toggle via `map.setLayoutProperty()` for a non-existent layer.

### 4.7 Socket.IO vs Yjs channel split (IMPLICIT)

Collaborative editing uses two independent channels:
- **Socket.IO**: scene mutations (encrypted Excalidraw element diffs), camera updates, cursor positions, comments
- **y-websocket**: CRDT data-layer operations (GeoJSON feature mutations)

The two channels carry different data and have no ordering guarantees between them. If a user simultaneously annotates (Socket.IO) and edits a data layer feature (y-websocket), the two updates arrive independently with no causal ordering. This is by design (CRDT handles intra-Yjs ordering) but undocumented.

---

## 5. Confidence Assessment

| Section | Confidence | Basis |
|---------|-----------|-------|
| 1. Contract Surface Map | HIGH | Verified against source imports |
| 2. Knot Analysis | HIGH | Source-derived, eras approximate |
| 3. Security Pins | HIGH | All from source code analysis |
| 4.1 controlled vs uncontrolled | HIGH | Verified single-pass initialData pattern |
| 4.2 Q11 boundary for factories | HIGH | Documented in seedToElement.ts comments |
| 4.3 CoordinateSync lifecycle | HIGH | Verified attach/detach in useCoordinateSync |
| 4.4 registerContextMenuItem gap | MED | Deduced from React effect lifecycle |
| 4.5 projection identity | HIGH | Applies to all coordinate projection sites |
| 4.6 LayerRegistry ordering | HIGH | Verified call sites in MapEditor |
| 4.7 Socket/Yjs channel split | HIGH | Verified in useCollab + useYjsLayer |

**Overall confidence**: HIGH for source-verified items (sections 1-3, most of 4). MEDIUM for the two implicit contracts that are deduced rather than verified (4.4, 4.7 dedup).

---

## 6. Future Exposure Surface (Phase 7+)

The SDK plugin contract (AtlasdrawAPI) is spec'd but NOT YET implemented in source. Phase 7 will introduce:
- postMessage routing layer in `packages/sdk/`
- Web Worker sandbox for plugin execution
- structuredClone round-trip enforcement

Until then, the AtlasdrawAPI surface in section 1 of the previous version of this doc is **provisional**. The actual contract between atlas-app and plugins will be defined when Phase 7 begins.
