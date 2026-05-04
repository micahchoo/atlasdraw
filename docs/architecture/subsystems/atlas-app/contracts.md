# atlas-app — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.7, §5.1, §7.2; open-questions-resolution.md Q11/Q12; cross-phase-audit.md MISMATCH-1/3/5; Phase 4/5/6/7 plans.

---

## 1. AtlasdrawAPI Surface (Plugin Contract)

The public API exposed to plugins. Designed postMessage-safe from Phase 6 per Q11 resolution: all methods async or fire-and-forget, all return values JSON-serializable (no DOM nodes, no class instances, no functions). Structural test verifies every method passes structured-clone round-trip (Phase 6 gate). ADR `0005-sdk-postmessage-contract.md` governs.

[CONFIDENCE: high — Q11 resolution]

```typescript
interface AtlasdrawAPI {
  // Layer operations
  getLayers(): Promise<LayerDescriptor[]>
  addLayer(def: LayerDefinition): Promise<{ layerId: string }>
  removeLayer(layerId: string): Promise<void>
  updateLayerStyle(layerId: string, style: MaplibreStyleExpression): Promise<void>

  // Scene operations
  getElements(): Promise<ExcalidrawElementDescriptor[]>
  addElements(elements: ExcalidrawElementDescriptor[]): Promise<void>

  // Map viewport
  getViewport(): Promise<{ lng: number; lat: number; zoom: number; bearing: number; pitch: number }>
  flyTo(viewport: Partial<Viewport>): Promise<void>

  // Plugin registration (called at install time)
  registerTool(def: ToolDefinition): Promise<void>
  registerLayerType(def: LayerTypeDefinition): Promise<void>
  registerStylingFn(def: StylingFnDefinition): Promise<void>

  // Events (fire-and-forget subscription)
  on(event: AtlasdrawEvent, handler: (payload: unknown) => void): Promise<{ unsubscribe: () => void }>
}
```

**Constraints:**
- All `LayerDefinition`, `ExcalidrawElementDescriptor`, `ToolDefinition` etc. are plain JSON-serializable objects.
- `on()` returns an unsubscribe token (JSON-serializable handle string in Worker context).
- Phase 7 Web Worker sandbox routes all calls over `postMessage`; the API shape must not change between Phase 6 (direct) and Phase 7 (sandboxed).

[CONFIDENCE: med — method names extrapolated from Phase 7 plan "registerTool, registerLayerType, registerStylingFn"; exact signatures speculative]

---

## 2. Plugin Event Hooks

Events the plugin host emits that plugins can subscribe to.

| Event | Payload | Phase | Notes |
|---|---|---|---|
| `layer:added` | `{ layerId, type }` | 6+ | |
| `layer:removed` | `{ layerId }` | 6+ | |
| `layer:styleChanged` | `{ layerId, style }` | 6+ | |
| `viewport:changed` | `{ lng, lat, zoom, bearing, pitch }` | 6+ | Throttled 10 Hz to plugins |
| `scene:changed` | `{ elementIds: string[] }` | 6+ | Batched per animation frame |
| `comment:created` | `{ commentId, threadId, anchorGeo }` | 6+ | |
| `snapshot:saved` | `{ snapshotId, name }` | 7+ | |
| `plugin:error` | `{ pluginId, message }` | 7+ | |

[CONFIDENCE: low — event names extrapolated from feature set; not enumerated in spec]

---

## 3. GeoAnchor / CustomData Contract

Every Excalidraw element that carries geographic context stores it under `element.customData.geo`.

**Canonical shape** (Phase 1 definition, Q12 resolution):
```typescript
type GeoAnchor =
  | { kind: "point";    lng: number; lat: number; zRef: number; projection: "mercator" }
  | { kind: "bbox";     west: number; south: number; east: number; north: number; zRef: number; projection: "mercator" }
  | { kind: "polyline"; coordinates: [number, number][]; zRef: number; projection: "mercator" }

// On Excalidraw element:
element.customData.geo: GeoAnchor
```

**Audit warnings:**
- Phase 3 consumer table incorrectly lists field as `customData.geoAnchor` with flat shape `{ lng, lat, zoom }`. This is MISMATCH-1 and MISMATCH-3 per cross-phase-audit. The canonical field is `customData.geo` and the shape is the discriminated union above.
- MISMATCH-5: `projection` must be `"mercator"` (lowercase string literal), not `'EPSG:4326'`. Q12 resolution confirms `projection: "mercator"`.
- All consumers (`LayerPanel`, `useCoordinateSync`, `CoordinateSync.projectToCanvas`) MUST narrow on `kind` before reading coordinates.

[CONFIDENCE: high — cross-phase-audit MISMATCH-1/3/5, Q12, Phase 1 plan]

---

## 4. Inbound Event Contract (from apps/realtime)

The `atlas-app` collab client connects to `apps/realtime` on two channels. See `realtime/contracts.md` for the server-side definitions.

| Socket.IO Event | Direction | Payload | Handling |
|---|---|---|---|
| `SCENE_UPDATE` | server→client | encrypted Excalidraw element diff | Decrypt → `updateScene()` |
| `MAP_CAMERA_UPDATE` | server→client | `{lng, lat, zoom, bearing, pitch}` | LWW → fly map |
| `CURSOR` | server→client | `{userId, lngLat, color}` | Render peer cursor overlay |
| `COMMENT` | server→client | encrypted comment payload | Dispatch to Yjs comments doc |

Yjs data-layer ops arrive on the separate y-websocket connection at `/yjs/:roomId` as binary frames — not Socket.IO events. Handled by `packages/data` YjsLayer client, not directly by `atlas-app` collab hooks.

[CONFIDENCE: high — tech-spec §5.1]

---

## 5. StorageClient Contract

HTTP client wrapper used by `atlas-app` to talk to `apps/storage`.

```typescript
interface StorageClient {
  createMap(blob: Blob): Promise<{ id: string }>
  getMap(id: string): Promise<MapRecord>
  updateMap(id: string, blob: Blob): Promise<void>
  createShareToken(mapId: string): Promise<{ token: string; url: string }>
  resolveShareToken(token: string): Promise<{ map: MapRecord; mode: 'read' | 'write' }>
}
```

Auth: bearer token (30-day TTL) attached via request interceptor. Token stored in Zustand + localStorage.

[CONFIDENCE: med — Phase 4 plan Tasks 3/4/9; exact method names extrapolated]

---

## 6. Persistence Contract (IndexedDB / FSA)

`state/persistence.ts` exposes two adapters behind a common interface:

```typescript
interface PersistenceAdapter {
  save(key: string, bundle: AtlasdrawBundle): Promise<void>
  load(key: string): Promise<AtlasdrawBundle | null>
  list(): Promise<string[]>
}
```

- **IndexedDB adapter**: always available; used as autosave queue.
- **FSA adapter** (File System Access): available in Chromium; activated when user does "Save to file" or opens a file via the OS picker. On permission revocation mid-session, FSA falls back to IndexedDB silently (failure mode — see `behavior.md`).

[CONFIDENCE: med — tech-spec §4.7 mentions both; interface shape extrapolated]

---

## 7. Snapshot / Versioning Contract (Phase 7)

`atlas-app` components consume `packages/versioning` via:

```typescript
// SnapshotStore (packages/versioning/src/SnapshotStore.ts)
SnapshotStore.save(mapId: string, name?: string): Promise<{ snapshotId: string }>
SnapshotStore.list(mapId: string): Promise<SnapshotDescriptor[]>
SnapshotStore.restore(snapshotId: string): Promise<AtlasdrawBundle>

// DiffEngine (packages/versioning/src/DiffEngine.ts)
DiffEngine.diff(a: SnapshotDescriptor, b: SnapshotDescriptor): Promise<StructuredDiff>
```

GC policy: keep last 50 named snapshots; keep one auto-snapshot per interval (configurable); prune unnamed auto-snapshots older than 30 days. Named snapshots never deleted by auto-GC.

[CONFIDENCE: high — Phase 7 plan Tasks 9/18/19/20]
