# atlas-app — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.7; Phase 1–7 plans; cross-phase-audit MISMATCH-2; Q11 resolution.

---

## Internal Module Dependency Graph

```
App.tsx
  ├── components/MapEditor.tsx
  │     ├── hooks/useCoordinateSync.ts ──► packages/geo/coordinate-sync.ts
  │     ├── hooks/useMapStyle.ts ─────────► packages/basemap (MapLibre wrapper)
  │     └── hooks/useScene.ts ────────────► state/collab.ts (Phase 5+)
  │                                        state/persistence.ts
  ├── components/LayerPanel.tsx
  │     └── state/store.ts (useLayerRegistry) ─► packages/data/layer-registry.ts [TYPE ONLY]
  ├── components/Toolbar.tsx
  │     └── packages/tools/index.ts
  │           └── (Phase 7) PluginHost registered tools
  ├── components/BasemapPicker.tsx
  │     └── packages/basemap (style registry)
  ├── components/ImportDialog.tsx
  │     └── packages/data/{geojson,kml,shp,csv,felt}.ts
  ├── components/ShareDialog.tsx
  │     └── hooks/useShareLink.ts ──► StorageClient (HTTP)
  ├── pages/share/[uuid].tsx
  │     └── StorageClient.resolveShareToken()
  ├── state/collab.ts (Phase 5+)
  │     ├── Socket.IO client ──► apps/realtime /socket.io
  │     └── Yjs y-doc ────────► apps/realtime /yjs/:roomId (via packages/data YjsLayer)
  ├── components/CommentsPanel.tsx (Phase 6+)
  │     └── hooks/useComments.ts ──► apps/realtime /yjs/:roomId (comments doc)
  ├── components/versioning/VersionTimeline.tsx (Phase 7+)
  │     └── packages/versioning/SnapshotStore.ts
  ├── components/versioning/VersionDiffViewer.tsx (Phase 7+)
  │     └── packages/versioning/DiffEngine.ts
  ├── components/PluginHost.tsx (Phase 7+)
  │     └── packages/sdk/AtlasdrawAPI
  └── state/store.ts  ◄─── all UI components read/write here
        └── state/persistence.ts  (IndexedDB + FSA)
```

---

## Feature-Area Boundaries

| Feature Area | Primary Files | Can Code-Split? | Notes |
|---|---|---|---|
| Canvas core | `MapEditor.tsx`, `useCoordinateSync.ts`, `useMapStyle.ts`, `useScene.ts`, `App.tsx` | No — entry point | Always in main bundle |
| Layers | `LayerPanel.tsx`, `ImportDialog.tsx` | Partial — ImportDialog lazy | ImportDialog can be lazy-loaded on first open |
| Basemap | `BasemapPicker.tsx` | Yes — lazy panel | Load on panel open |
| Share | `ShareDialog.tsx`, `useShareLink.ts`, `pages/share/[uuid].tsx` | Yes — dialog lazy; viewer is separate route | Viewer route is a Vite entry point |
| Collab | `state/collab.ts`, `useCollab.ts` | Yes — dynamic import when `[realtime] enabled` | Socket.IO client is large; defer until collab activated |
| Comments | `CommentsPanel.tsx`, `CommentAnchor.tsx`, `CommentComposer.tsx`, `useComments.ts` | Yes — lazy sidebar tab | Load when comments tab opened |
| Style editor | `StyleEditorPanel.tsx` | Yes — lazy panel | |
| Asset library | `AssetLibrary.tsx` | Yes — lazy panel | |
| Billing | `BillingPortal.tsx` | Yes — hosted-only chunk | Guarded by `VITE_HOSTED` build flag |
| Versioning | `versioning/` components | Yes — lazy route/panel | Load when timeline UI opened; `packages/versioning` is lazy |
| Plugin host | `PluginHost.tsx`, `PluginManager.tsx` | Yes — lazy | Worker instantiation deferred; large bundle boundary |
| AI styling | `AIStylingPanel.tsx` | Yes — lazy panel | Optional feature; async import |
| Mobile field | `pages/field/[layerToken].tsx` | Yes — separate Vite entry | Mobile route is a distinct entry point |

---

## LayerRegistry Split (MISMATCH-2 Resolution)

The `LayerRegistry` has a deliberate two-location design:

| Location | What lives there | Why |
|---|---|---|
| `packages/data/layer-registry.ts` | `LayerRegistry` TypeScript type; `LayerDescriptor` interface | Shared type; consumed by `packages/cli`, SDK, and server-side validation |
| `apps/atlas-app/state/store.ts` | Zustand slice exposing `useLayerRegistry()` | Runtime state; app-specific; Zustand is an app-layer concern |

**Consumers must import the type from `packages/data`** and the runtime slice from `state/store.ts`. Never import the Zustand slice from `packages/data` (it doesn't live there). This split was introduced in Phase 2; MISMATCH-2 in the cross-phase-audit documents the Phase 3 consumer table incorrectly listing the source as `packages/geo`.

[CONFIDENCE: high — cross-phase-audit MISMATCH-2]

---

## Package Dependencies (External)

| Package | Role | Phase introduced |
|---|---|---|
| `react` / `react-dom` | UI framework | 1 |
| `vite` | Build tool / dev server | 1 |
| `typescript` | Type-checking | 1 |
| `zustand` | UI state | 1 |
| `maplibre-gl` | Map rendering (via `packages/basemap`) | 1 |
| `@excalidraw/excalidraw` | Canvas + scene management | 1 |
| `yjs` | CRDT for data layers | 5 |
| `y-websocket` (client) | Yjs sync transport | 5 |
| `socket.io-client` | Collab event relay | 5 |
| `lz-string` | URL-hash compression for share | 4 |
| `packages/versioning` | Snapshot store + diff engine | 7 |
| `packages/sdk` | AtlasdrawAPI types + plugin manifest | 6 |

---

## Build Configuration Notes

- Vite entry: `apps/atlas-app/index.html` → `App.tsx`.
- Additional entries: `pages/share/[uuid].tsx` (read-only viewer), `pages/field/[layerToken].tsx` (mobile field, Phase 7).
- Code-split boundary for collab: dynamic `import('./state/collab')` guarded by runtime config check (`window.__ATLASDRAW_CONFIG__.realtimeEnabled`).
- `VITE_HOSTED` build flag gates: `BillingPortal.tsx`, `AccessibilityPanel.tsx`, OIDC login flow.
- Tree-shaking: `packages/sdk` AtlasdrawAPI must remain in the main chunk (plugin host needs it synchronously); `packages/versioning` can be async-imported.

[CONFIDENCE: med — build config details extrapolated from feature set and Q10/Q11 constraints]
