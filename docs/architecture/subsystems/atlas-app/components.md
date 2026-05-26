# atlas-app -- Components

**Status: Audited.** Ground-truth derived from live source tree (2026-05-15).
Replaces the speculative May 3 version.

> Sources: source tree survey (56 non-test source files, 45 test files, 21,361
> lines), file-level header analysis, lint/type-escape/todo inventory.

---

## Component Map

### 1. Root

**`App.tsx`** (100 lines)
- Hand-rolled path detection (no router dep). Routes: `/m...` -> ShareView,
  `/#room:<id>,<key>` -> MapEditor (collab), `/billing` -> BillingPage.
  Everything else -> MapEditor.
- Thin shell: creates `HttpStorageClient`, resolves workspace context, renders
  the selected view + `<AriaAnnouncer>`.
- SPIs (Single Points of Ingress): reads `window.location` once at mount.

**`main.tsx`** (~20 lines)
- StrictMode + `<App />` mount.

### 2. Editor Surface

**`components/MapEditor.tsx`** (1538 lines) -- **HOTSPOT**
- Central composition surface. Renders MapLibre base layer, Excalidraw canvas,
  sidebar, dialogs, overlays. Manages ~15 distinct sub-component instances.
- Contains: Excalidraw callback wiring, import/export handlers, collab init,
  comment-anchor overlay lifecycle, PMTiles style loading, dev-only console
  logging (`import.meta.env.DEV` branch).
- **Drainage point**: all cross-subsystem communication flows through here.
  53 `any` escapes in this file alone -- much of the surface area is glue
  code that bypasses Excalidraw's loose type boundary.
- **Decomposition candidate**: the file is 3x larger than the next largest
  component (StylePanel 572 lines) and handles concerns belonging in at least
  5 separate modules.

### 3. Map Integration

**`hooks/useCoordinateSync.ts`**
- Subscribes to MapLibre `move`/`zoom`, calls coordinate-sync projection.
- Perf-sensitive hot path (up to 60 fps during pan/zoom).

**`hooks/useMapRef.ts`**
- Returns `{ mapRef, mapEl }` -- ref-based MapLibre instance accessor.

**`hooks/useMapWheelRouter.ts`**
- Routes wheel events between MapLibre zoom and Excalidraw scroll.

### 4. Layers

**`components/LayerPanel.tsx`** (405 lines)
- Custom `<Sidebar>` tab. Displays `LayerRegistry` entries. Supports
  add/remove/toggle-visibility/reorder. Has TODO markers for drag-and-drop
  reorder (TODO comment: HACK -- custom UNSAFE handler).
- **Stub**: reorder uses `onPointerDown` bypass hack.

**`hooks/useLayerRegistry.ts`**
- Zustand slice accessor for layer registry state.

**`hooks/useLayerRegistrySync.ts`**
- Syncs layer registry changes to Yjs doc (Phase 5 bridge).
- Uses `ts-ignore` for Yjs layer binding bridge.

**`state/layerRegistry.ts`** (209 lines)
- Types-only module defining `AnnotationLayerEntry` and `DataLayerEntry`.
- Comment references implementation landing in T11 (Phase 2 Wave 2). Types
  shipped ahead of runtime impl. Exports `LayerStyle` re-export from basemap.

**`state/useDataLayerFCStore.ts`** (85 lines)
- Standalone Zustand store bridging a documented gap: FeatureCollections live
  inside MapLibre sources after `map.addSource` and aren't retrievable as
  plain JS objects. This store holds a snapshot for save/restore round-trip.

**`state/selectDocument.ts`** (190 lines)
- Pure synthesis function. Assembles `AtlasdrawDocument` from Excalidraw API +
  LayerRegistry + DataLayerFCStore. Called each autosave tick.
- **Pattern**: function-module (not a hook or component), no lint suppressions,
  well-documented provenance.

### 5. Persistence & File I/O

**`state/persistence.ts`** (505 lines)
- IndexedDB autosave (primary) + File System Access API (Chromium enhancement).
- 5s trailing-edge debounce + 30s ceiling. 4 `ts-ignore` suppressions for
  File System Access API type gaps (not-yet-standardized API surface).

**`state/usePersistenceStore.ts`**
- Zustand wrapper around persistence lifecycle.

**`state/hydrate.ts`**
- Loads saved state from IndexedDB on boot. 1 `ts-ignore`.

**`lib/export.ts`**
- Excalidraw scene export (PNG/SVG). Types: `ExportOpts`.

**`lib/print-pdf.ts`** (400 lines)
- PDF generation with MapLibre map screenshot, Excalidraw scene canvas,
  layer legend, ODBL attribution. LayerLegendEntry / PrintOptions types.

**`components/PrintDialog.tsx`** (374 lines)
- Print/PDF export dialog. Page size, orientation, layer selection.

### 6. Share

**`components/ShareDialog.tsx`** (386 lines)
- Share modal. Two paths: URL-hash inline (< 32 KB) or upload to storage
  (> 32 KB). Uses lz-string compression.

**`components/ShareView.tsx`**
- Read-only viewer. Mounts MapLibre + Excalidraw in read-only mode for
  `/m/:uuid` routes. Has console.log statements.

**`hooks/useShareLink.ts`**
- Size-gates the bundle and orchestrates share-link creation.

### 7. Collab (Phase 5)

**`state/collab.ts`** (502 lines) -- **HOTSPOT**
- Single gatekeeper opening/closing both WebSocket connections (Socket.IO +
  y-websocket). Manages: socket lifecycle, Yjs doc setup, scene encryption,
  room key from URL fragment, collab undo manager, peer cursor state.
- **Drainage point**: second-largest state module. Handles concerns that
  could be split (connection lifecycle, encryption, cursor tracking).

**`hooks/useCollab.ts`**
- React binding for collab state. Uses `ts-ignore` for Socket.IO event types.

**`hooks/useCollabRoom.ts`**
- Room membership manager. Uses `ts-ignore`.

**`components/CollabWrapper.tsx`** (42 lines)
- Conditional gateway -- null when collab disabled (Q1 contract: single-player
  = zero WebSocket connections). When active, renders CursorOverlay + PresenceList.
- **Well-factored**: single responsibility, explicit null gate.

**`components/CursorOverlay.tsx`**
- SVG cursor dots + collaborator labels. Rendered only when collab active.

**`components/PresenceList.tsx`**
- Compact sidebar collaborator list.

**`collab/scene-crypto.ts`**
- Scene encryption/decryption for collab sessions.

### 8. Comments (Phase 6)

**`components/CommentsPanel.tsx`** (313 lines)
- Threaded comment list sidebar. Has TODO markers for @mention support.
- Heavier than expected for a single panel.

**`components/CommentsPanelHost.tsx`** (57 lines)
- Thin wrapper: reads collab state, wires pending-anchor coordination to
  MapEditor's overlay. Registers as Excalidraw sidebar tab.
- **Well-factored**: separation between panel logic (CommentsPanel) and
  host wiring (CommentsPanelHost).

**`components/CommentAnchor.tsx`**
- Individual comment pin rendered on map. Screen-space projected.

**`components/CommentAnchorsOverlay.tsx`** (216 lines)
- Iterates CommentsLayer.comments list, renders CommentAnchor per row.
- Map anchors: `map.project([lng,lat])`, re-projected on every move+zoomend.
- Element anchors: `sceneCoordsToViewportCoords` from @atlasdraw/common.
- Pointer events scoped to anchors (container is `pointer-events:none`).

**`state/comments.ts`** (311 lines)
- `CommentsLayer` class -- Yjs-backed comment thread management.
- Has TODO marker. Uses `any` type escapes for Yjs observer pattern.

**`state/comments-anchor-picker.ts`** (73 lines)
- Vanilla store with `subscribe` + `getSnapshot` (no Zustand). Single
- instance per app, consumed via `useSyncExternalStore`.
- **Architecture note**: bypasses Zustand intentionally to avoid wrapping
  MapEditor in a context provider. Module-level singleton matches
  MapEditor's lifetime. Works but unusual for the codebase.

### 9. Styling & Basemap

**`components/StylePanel.tsx`** (572 lines)
- MapLibre style editor. Second largest component. Edits paint/layout
  properties for vector layers.

**`components/BasemapPickerDialog.tsx`**
- Dialog listing registered basemap styles.

**`components/MaputnikDialog.tsx`**
- Maputnik-style JSON style editor dialog.

**`components/ColorRampPicker.tsx`**
- Color ramp selector for layer styling.

### 10. Hosted-Only Features (Phase 6 Wave 3)

**`components/WorkspaceSwitcher.tsx`** (325 lines)
- Tenant/workspace selection UI.

**`components/BillingPage.tsx`** (339 lines)
- Stripe billing portal. Stripe types use `any` escapes.

**`components/AssetLibraryPanel.tsx`** (308 lines)
- Reusable symbol/marker library. Has `console.log` debug statements.
- TODO/stub patterns visible.

**`state/workspace.ts`** (63 lines)
- Opaque branded `WorkspaceId` type. Small, focused.

**`config/app-config.ts`**
- Zod-validated app config from `import.meta.env`. `BuildTarget` schema
  for hosted vs self-hosted.

### 11. Accessibility (Phase 6 Wave 3)

**`components/AriaAnnouncer.tsx`**
- Screen-reader announcer for dynamic content changes.

**`components/FocusTrap.tsx`**
- Focus trap for modal dialogs. Uses `any` type for focusable element query.

**`components/AboutDialog.tsx`**
- About/credits dialog.

### 12. Tools

**`tools/seedToElement.ts`** (344 lines)
- Converts GeoJSON seeds to Excalidraw elements for geo-ready shape library.

**`hooks/useAtlasdrawTool.ts`** (320 lines)
- Tool lifecycle manager for atlasdraw custom tools (pin, route-snap, polygon,
  measure). Uses `ts-ignore` for Excalidraw tool registration bridge.

**`hooks/useToolState.ts`**
- Generic tool state management. Exposes `ToolState` interface.

**`hooks/useGeoAnchor.ts`** (388 lines)
- Geo-anchor CRDT merge logic. Complex merge semantics.

**`hooks/useAutosave.ts`**
- Autosave lifecycle hook. Wires persistence.ts debounced save.

**`hooks/useYjsLayer.ts`**
- Yjs data-layer integration bridge.

### 13. Services

**`services/createHttpStorageClient.ts`** (333 lines)
- HTTP client for storage backend. Defines `MapRecord`, `ShareToken`,
  `StorageClient`, `WorkspaceSummary`, `CheckoutSessionResponse` types.

---

## Quality Signals

### Type Hygiene

| Signal | Count | Severity |
|--------|-------|----------|
| Files with `any` type escape | 53 of 56 source files | HIGH |
| Lint suppression directives | 26 total | MEDIUM |
| `console.log/warn/error` in source | 13 instances | LOW |
| `import.meta.env` cast (`as Record<string...>`) | 1 in MapEditor | LOW |

The `any` escape count (53 of 56 files) is systemic. Most escapes trace to
three root causes:
1. Excalidraw type boundary (vendored types are loose -- ~21K `any` in
   vendored code per subsystems.md)
2. Yjs observer patterns (callback arguments are untyped)
3. File System Access API (not yet standardized, `ts-ignore` needed)

### Test Coverage

| Metric | Count |
|--------|-------|
| Source files | 56 |
| Test files | 45 |
| File-pair ratio | ~80% |
| Test directories | 7 (`components/__tests__`, `hooks/__tests__`, `state/__tests__`, `state/__tests__`, `config/__tests__`, `services/__tests__`, `lib/__tests__` + root `__tests__`) |
| Skipped tests | 0 (`test.skip` / `it.skip` / `xit`) |
| `.spec` files | 0 |

Notable: no integration/E2E tests. All 45 test files are unit tests.
CommentsPanel.test.tsx has `pendingAnchor` fixture patterns but no
`.skip` markers. No E2E CI in place (per subsystems.md).

### Code Debt Markers

| File | Line | Marker | Description |
|------|------|--------|-------------|
| CommentsPanel.tsx | ~10 | TODO | @mention support placeholder |
| CommentsPanelHost.tsx | ~20 | TODO | pending-anchor wiring |
| LayerPanel.tsx | ~200 | HACK | Custom UNSAFE pointer handler for drag-reorder |
| MapEditor.tsx | ~480 | import.meta | Dev-only logging branch |
| state/comments.ts | ~50 | TODO | Yjs observer type workaround |

### Size Distribution

```
Components by LOC:
 1538  MapEditor.tsx         (HOTSPOT -- 3x next largest)
  572  StylePanel.tsx
  405  LayerPanel.tsx
  386  ShareDialog.tsx
  374  PrintDialog.tsx
  339  BillingPage.tsx
  325  WorkspaceSwitcher.tsx
  313  CommentsPanel.tsx
  308  AssetLibraryPanel.tsx
  216  CommentAnchorsOverlay.tsx

State by LOC:
  505  persistence.ts
  502  collab.ts            (HOTSPOT)
  311  comments.ts
  209  layerRegistry.ts
  190  selectDocument.ts

Hooks by LOC:
  388  useGeoAnchor.ts
  324  useLayerRegistrySync.ts
  320  useAtlasdrawTool.ts
```

---

## Tech Debt Inventory

### 1. MapEditor.tsx Kitchen Sink (HIGH)
1538 lines handling: Excalidraw lifecycle, PMTiles loading, sidebar tabs,
dialogs, dev-only logging, file import/export, collab init, comment-anchor
overlays. Should be decomposed into specialized modules.

### 2. Systemic `any` Escape (HIGH)
53 of 56 source files contain at least one `any`. While many trace to the
vendored Excalidraw boundary, the density makes systematic type narrowing
impossible without a dedicated wave. The 21K figure in subsystems.md
includes vendored code.

### 3. CollabState Monolith (MEDIUM)
502 lines managing socket lifecycle, Yjs doc, encryption, peer cursors,
undo manager. Split candidates: connection lifecycle, cursor tracking, crypto.

### 4. No E2E Tests (MEDIUM)
45 unit tests but zero E2E tests. The map+canvas rendering stack is the
highest-risk surface and is uncovered at the integration level.

### 5. LayerPanel Reorder Hack (LOW)
Uses `onPointerDown` with a HACK comment for drag-and-drop reorder. Missing
proper drag-and-drop implementation.

### 6. Debug Logging in Source (LOW)
13 `console.log/warn/error` calls in non-test source. Most are in dev-only
branches (`import.meta.env.DEV`) but a few persist in production paths.

### 7. Comments-Anchor Vanilla Store (LOW)
Module-level singleton with `useSyncExternalStore` is unconventional for this
codebase (everything else uses Zustand). Works correctly but creates a second
state management pattern.

### 8. AssetLibraryPanel Stub (LOW)
Has debug logging and feels incomplete. 308 lines but no corresponding
resolver/symbol registry visible in tree.

---

## Stratigraphy

### Phase 1 (Monolithic scaffold)
`App.tsx`, `MapEditor.tsx`, `useCoordinateSync`, `useMapRef`,
`useMapWheelRouter`

### Phase 2 (Data layers)
`layerRegistry.ts`, `LayerPanel.tsx`, `useLayerRegistry.ts`,
`useLayerRegistrySync.ts`, `useToolState.ts`, `useAtlasdrawTool.ts`

### Phase 3 (File format & persistence)
`persistence.ts`, `usePersistenceStore.ts`, `hydrate.ts`, `selectDocument.ts`,
`export.ts`, `print-pdf.ts`, `PrintDialog.tsx`, `ShareDialog.tsx`,
`ShareView.tsx`, `useShareLink.ts`

### Phase 4 (Share & storage)
`createHttpStorageClient.ts`, `useDataLayerFCStore.ts`, `ShareView` routing

### Phase 5 (Realtime collab)
`collab.ts`, `useCollab.ts`, `useCollabRoom.ts`, `CollabWrapper.tsx`,
`CursorOverlay.tsx`, `PresenceList.tsx`, `scene-crypto.ts`,
`useLayerRegistrySync.ts` (augmented), `useYjsLayer.ts`

### Phase 6 Wave 1-2 (Comments & styling)
`comments.ts`, `comments-anchor-picker.ts`, `CommentsPanel.tsx`,
`CommentsPanelHost.tsx`, `CommentAnchor.tsx`, `CommentAnchorsOverlay.tsx`,
`StylePanel.tsx`, `ColorRampPicker.tsx`, `MaputnikDialog.tsx`,
`BasemapPickerDialog.tsx`

### Phase 6 Wave 3 (Hosted & a11y)
`AriaAnnouncer.tsx`, `FocusTrap.tsx`, `AboutDialog.tsx`,
`WorkspaceSwitcher.tsx`, `BillingPage.tsx`, `AssetLibraryPanel.tsx`,
`workspace.ts`, `app-config.ts`

### Fault Lines

1. **Zustand vs vanilla stores**: Most state uses Zustand, but
   `comments-anchor-picker` uses a module-level singleton with
   `useSyncExternalStore`. The reason (avoid context provider wrapping
   MapEditor) is documented and valid, but introduces a second pattern.

2. **LayerRegistry types-first**: `layerRegistry.ts` shipped types-only
   (Phase 2 T01), with runtime implementation deferred to T11. Ten files
   depend on the types while the runtime was being implemented.

3. **FC storage gap closure**: `useDataLayerFCStore` was a Phase 4 addition
   closing a Phase 3 gap (documented as `mx-91343d`). The phase ordering
   meant `selectDocument.ts` shipped with `layers: new Map()` as a
   placeholder before the FC registry existed.

### Inverted Strata

- **MapEditor.tsx** receives new concerns every phase rather than
  decomposing. The file grows by accretion -- collab init (Phase 5) was
  added alongside comment-anchor overlay wiring (Phase 6) alongside PMTiles
  path reading (Phase 3). Each phase adds a new section rather than
  extracting a new module.
- The `import.meta.env` pattern in MapEditor spans three distinct feature
  groups (PMTiles path, dev logging, env config). New env vars are added
  to the existing `import.meta.env as Record<string...>` cast rather than
  using `app-config.ts`'s Zod schema.

### Diagenesis (Hack on load-bearing code)

- LayerPanel drag-reorder uses `UNSAFE` pointer handler (HACK comment).
- MapEditor's `import.meta.env` cast (`as Record<string, string | undefined>`)
  subverts the type system on a file that's the single point of integration
  for the entire app.

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|-----------|-----------|
| Phase 1-3 (core editor, layers, persistence) | HIGH | 30+ unit tests, 2+ months in production, well-documented |
| Phase 4 (share, storage client) | HIGH | 2 test suites, tight scope |
| Phase 5 (collab) | MEDIUM-HIGH | Complex state machine (502-line collab.ts) but 1 test suite + clear Q-contracts |
| Phase 6 comments | MEDIUM | Fresh (May 2026), TODO markers present, no E2E coverage for overlay positioning |
| Phase 6 hosted/billing | MEDIUM | Stripe integration tested but workspace switching is new |
| Phase 6 a11y (AriaAnnouncer, FocusTrap) | MEDIUM | Standard patterns, lightly tested |
| Overall subsystem | MEDIUM | 80% file-pair test ratio is good, but systemic `any` escape, no E2E, and MapEditor hotspot reduce confidence |

### Key Risks

1. **MapEditor decomposition pressure**: At 1538 lines and growing each
   phase, the file is the single highest-risk component. A refactor wave
   will be required before Phase 7.
2. **Type boundary erosion**: 53/56 files with `any` means the entire
   subsystem leaks type safety. Any refactor across the Excalidraw boundary
   will be manual and error-prone.
3. **No integration tests**: The map+canvas rendering stack is the app's
   core value proposition and has zero E2E coverage.
