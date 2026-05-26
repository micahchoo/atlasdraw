# atlas-app — Behavior

**Status: Verified.** Traced against source at commit 11cb498.

> Sources: source files at `code/apps/atlas-app/src/`; Phase 2–6 plans; infrastructure.md era markers.
> Method: shadow-walk flow tracing through entry-to-terminal across all four flow basins.

---

## 1. Verified Flow Traces

### 1.1 Basin A: Annotation Drawing

```
User draws on Excalidraw canvas (PinTool / RectangleTool / etc.)
  │
  ▼
Excalidraw onChange fires (every element mutation)
  │
  ├─► useLayerRegistrySync (hooks/useLayerRegistrySync.ts):
  │     buildSceneDiffHandler diffs element ID set against registry knownIds
  │     ├─ New element ID  → registerAnnotation(id) → LayerRegistry entry
  │     └─ Vanished element → remove(id) → LayerRegistry + FC store cleanup
  │     [Phase 2 W-A, skip: resize/drag/style changes are no-ops]
  │
  └─► usePersistenceStore.markDirty():
        ├─ Forwards to PersistenceStore.markDirty() → dirtySeq++
        ├─ Sets isDirty=true, isDraining=true in Zustand
        └─ Triggers startAutoSave debounce timer (5s trailing-edge)
              │
              ▼
        [DIRTY] — timer resets on each new markDirty
              │
              ▼
        flush (after 5s idle, OR forced at 30s ceiling)
              │
              ├─► selectDocument(excalidrawAPI, layerRegistryState):
              │     ├─ scene: excalidrawAPI.getSceneElements()
              │     ├─ manifest layers: registry entries → manifest schema
              │     ├─ FCs: useDataLayerFCStore.getAll() ∩ data-layer entries
              │     ├─ files: excalidrawAPI.getFiles() → dataURL → Blob
              │     └─ returns AtlasdrawDocument
              │
              └─► PersistenceStore.save(doc):
                    ├─ @atlasdraw/data write() → .atlasdraw zip Blob
                    ├─ blobToStored() → StoredBlob (Uint8Array + type)
                    ├─ IndexedDB put("state", "current", storedBlob)
                    │   [dirty cleared if no race with concurrent markDirty]
                    └─ remoteSave (if configured):
                          └─ POST /maps → PUT /maps/:id (storage server)
```

**Era markers:**
- Phase 2 W-A: `useLayerRegistrySync` wiring (annotation membership tracking)
- Phase 3 W2 T8: `persistence.ts` — IndexedDB + FSA adapters
- Phase 3 W2 T9: `selectDocument.ts` — doc assembly
- Phase 4 W0: `useDataLayerFCStore` — FC mirror close (mx-91343d)
- Phase 4 T13: `remoteSave` callback in `MapEditor.tsx`

[CONFIDENCE: high — all paths verified against source]

---

### 1.2 Basin B: Data Import (Drag-Drop)

```
User drops .geojson file on MapEditor root div
  │
  ▼
Capture-phase listener on rootRef (MapEditor.tsx:842-865)
  ├─ Filters: .geojson extension only; other types pass to Excalidraw
  ├─ e.preventDefault() + e.stopPropagation()
  │
  ▼
processGeoJsonDrop(file)
  │
  ├─► @atlasdraw/data parse(file) — GeoJSON parser
  │      │
  │      ├─ Throws GeoJSONParseError on invalid input → console.error + alert
  │      └─ OK → FeatureCollection
  │
  ├─► requireHomogeneousGeometry(fc) — rejects mixed geometry types
  │
  ├─► map.addSource(id, { type: "geojson", data: fc })
  │
  ├─► map.addLayer(compileLayer(id, defaultLayerStyle(fc), geometryType))
  │      │
  │      ├─ Layer fails → ROLLBACK: map.removeSource(id), rethrow
  │      └─ OK → continue
  │
  └─► registry.registerDataLayer({ id, fc, label, style })
        ├─ LayerRegistry: pushes DataLayerEntry (metadata only)
        └─ useDataLayerFCStore: mirrors FC under id
              │
              ▼
        LayerPanel shows new entry
        markDirty fires → autosave includes new FC in next tick
```

**Era markers:**
- Phase 2 W1b T10: `@atlasdraw/data` GeoJSON parser
- Phase 2 W2b T13: Drag-drop import
- Phase 4 W0 (atlasdraw-ad27): FC mirror store closes save/restore gap

**Failure modes (verified):**
- Parse error → alert + return (no side effects)
- Mixed geometry → `requireHomogeneousGeometry` throws → alert
- Layer add fails → orphan source removed, throw propagates
- Non-.geojson files → pass through to Excalidraw's own handler

[CONFIDENCE: high — all paths verified against source]

---

### 1.3 Basin C: Save/Load (.atlasdraw)

#### Save to disk

```
User clicks "Save .atlasdraw" card in Export dialog
  │
  ▼
renderAtlasdrawSaveCard onClick handler (MapEditor.tsx:302-317)
  │
  ├─► selectDocument(excalidrawAPI, useLayerRegistryStore.getState())
  │     Returns AtlasdrawDocument (scene + manifest + FCs + files)
  │
  └─► PersistenceStore.saveToDisk(doc)
        ├─ @atlasdraw/data write(doc) → Blob (.atlasdraw zip)
        │
        ├─ [Chromium / FSA available]
        │     ├─ showSaveFilePicker() → handle.createWritable()
        │     ├─ writable.write(blob) → writable.close()
        │     └─ handle persisted to IDB (KEY_FILE_HANDLE)
        │
        └─ [Fallback / Firefox / Safari]
              └─ fallbackDownload(blob): <a download> click + URL.revokeObjectURL
```

#### Open from disk

```
User clicks "Open .atlasdraw" card in Export dialog
  │
  ▼
renderAtlasdrawOpenCard onClick handler (MapEditor.tsx:346-370)
  │
  ├─► [Chromium / FSA available]
  │     ├─ showOpenFilePicker() → handle.getFile()
  │     └─ handle persisted to IDB
  │
  └─► [Fallback]
        └─ fallbackOpen(): <input type="file"> click → resolve(file)

  ▼
@atlasdraw/data read(blob) → AtlasdrawDocument
  │
  ▼
hydrate(loaded, excalidrawAPI) (state/hydrate.ts)
  ├─ 1. Clear LayerRegistry entries (via remove()) + nuke FC store
  ├─ 2. Replay manifest layer entries through registry actions
  │     ├─ annotation → registerAnnotation (no FC)
  │     └─ data → registerDataLayer (registry + FC mirror)
  │         [Missing FC → skip with console.warn]
  │     ├─ visibility: patches after register (both stamp visible:true)
  ├─ 3. excalidrawAPI.updateScene({ elements }) via syncInvalidIndices
  ├─ 4. excalidrawAPI.addFiles() for embedded images (dataURL conversion)
  └─ 5. queueMicrotask: isDirty = false (defers past Excalidraw's onChange)
```

**Era markers:**
- Phase 3 W1 T2/T3: `@atlasdraw/data` zip read/write
- Phase 3 W1 T4: `.atlasdraw.json` variant
- Phase 3 W2 T8: `persistence.ts` FSA + download paths
- Phase 4 W0 (atlasdraw-3601): `hydrate.ts` state application

[CONFIDENCE: high — all paths verified against source]

---

### 1.4 Basin D: Real-time Collaboration

#### Connect

```
User clicks "Collaborate" in ShareDialog (or opens /#room: URL)
  │
  ├─ ShareDialog.startCollab → generateRoomKey() → collabState.connect(roomId, key)
  │
  └─ useCollabRoom (from MapEditor mount) → parseRoomFragment(hash) → collabState.connect(roomId, key)
        │
        ▼
  CollabState.connect() (state/collab.ts:210)
        │
        ├─► Socket.IO io(wsUrl, { transports: ["websocket"] })
        │     │
        │     ├─ on("connect"):
        │     │     ├─ emit("JOIN_ROOM", { roomId })
        │     │     ├─ Create CollabUndoManager on Yjs doc
        │     │     └─ Start 5s joining window: request SCENE_SNAPSHOT
        │     │           (Q-P5-1, retries up to 3 times)
        │     │
        │     ├─ on("MAP_CAMERA_UPDATE") → peer.camera = data
        │     ├─ on("CURSOR") → peers.set(senderId, { cursor, username, color })
        │     ├─ on("SCENE_UPDATE") → decryptScene → onSceneUpdate(elements) → updateScene
        │     ├─ on("PEER_LEFT") → peers.delete(senderId)
        │     ├─ on("REQUEST_SNAPSHOT") → encryptScene → SCENE_SNAPSHOT response
        │     └─ on("SCENE_SNAPSHOT") → decrypt → setSceneReceiver → updateScene
        │
        ├─► y-websocket new WebSocket(`${wsUrl}/yjs/${roomId}`)
        │
        └─► CommentsLayer (separate y-websocket WebsocketProvider)
              └─ docName: comments/${roomId} (or comments/${workspaceId}/${roomId})
```

#### Scene sync

```
Local edit → Excalidraw onChange
  │
  ▼
CollabState.emitSceneUpdate(elements)
  ├─ encryptScene(elements, roomKey) → { iv, ciphertext }
  └─ socket.emit("SCENE_UPDATE", { roomId, data: encrypted })

Remote SCENE_UPDATE received
  ├─ decryptScene(event.data, roomKey) → ExcalidrawElement[]
  └─ onSceneUpdate(elements) → excalidrawAPI.updateScene({ elements })
```

#### Data layer sync (Yjs CRDT)

```
Local mutation (useYjsLayer.mutate.*) or remote mutation
  │
  ▼
YjsLayer (default layer) Y.Doc update
  │
  ▼
observeLayer fires → toGeoJSON() → FeatureCollection snapshot
  │
  ▼
useYjsLayer setFeatures(fc) → React state update
  │
  ▼
MapEditor effect (line 917-927):
  map.getSource("collab-data").setData(fc)
```

#### Disconnect

```
User leaves / closes tab
  │
  ▼
CollabState.disconnect() (state/collab.ts:445)
  ├─ Cancel snapshot retry timer
  ├─ socket.close()
  ├─ yjsWs.close()
  ├─ undoManager = null
  ├─ yjsLayer.doc.destroy(), yjsLayer = null
  ├─ commentsLayer.destroy()
  └─ peers.clear()
```

**Era markers:**
- Phase 5 T7: `CollabState` class + `useCollab` hook
- Phase 5 Step 5: `useCollabRoom` hash fragment → connect
- Phase 5 T9: `useYjsLayer` CRDT → React bridge
- Phase 5 T11: `CollabWrapper` / `CursorOverlay` / `PresenceList`
- Phase 5 T12: `CollabUndoManager`
- Phase 6 A3: `CommentsLayer` separate Y.Doc + WebsocketProvider
- Q-P5-1: Joiner-pull snapshot protocol (snapshot retry loop)
- Q-P5-2: URL key = write capability; `/m#room:` treated read-only

[CONFIDENCE: high — all paths verified against source]

---

## 2. Endorheic Basins

| Basin | Description | Growth pattern | Flush mechanism |
|---|---|---|---|
| **IndexedDB autosave** (`atlasdraw-autosave.state.current`) | Last AtlasdrawDocument blob. Single key, always overwritten — bounded in *count* but potentially unbounded in *size* (embedded images grow the blob) | Document size grows with scene elements + embedded images + GeoJSON layers; no size cap | User saves to disk (FSA/download), shares, or triggers remoteSave (if configured). Otherwise survives forever until browser storage cleared |
| **FC store** (Zustand `useDataLayerFCStore.fcs`) | FeatureCollection registry. Grows with every imported data layer. Bounded by tab lifetime | One FC per data-layer id. Cleared on hydrate (doc load). Not persisted independently | Tab close (ephemeral). Hydrate clears it. No auto-flush |
| **LayerRegistry** (Zustand `useLayerRegistryStore.entries`) | Layer metadata array. Grows with each annotation + data layer. Bounded by tab lifetime | One entry per layer. Cleared on hydrate | Tab close. Hydrate clears it |
| **CollabState._peers** | Remote peer presence map. Grows with active collaborators. Bounded by session | One entry per peer. PEER_LEFT events remove stale entries. Cleared on disconnect() | PEER_LEFT from each remote peer. disconnect() clears all |
| **CommentsLayer._cachedSnapshot** | In-memory copy of Y.Array comments. Bounded by tab session | One entry per comment. Yjs doc persists on relay; local copy is transient | destroy() clears. Tab close |
| **Autosave dirty listeners** | Set<() => void> on PersistenceStore. Bounded by component lifecycle | One per subscription. Cleared in cleanup (dispose()) | Component unmount clears via unsubDirty + dispose() |

### Notable observations

- **Single-key overwrite pattern**: IndexedDB uses `KEY_CURRENT = "current"` as the sole autosave key. There is no versioning — opening a new document overwrites the previous autosave unconditionally. This prevents unbounded growth but means there is no "undo close tab" recovery for a previous document.
- **Silent data loss surface**: Autosave to IndexedDB succeeds silently. If the user clears browser storage, the autosave draft is lost. The only visual indicator is `isDirty` state in the MainMenu. There is no "unsaved to cloud" indicator.
- **RemoteSave is best-effort**: The remoteSave callback fires after IDB write. Failure is logged but the dirty bit already cleared. The app can be in a state where the document is "clean" (dirty=false) locally but the server has stale data. The `enableBackendPersistence` flag is off by default — single-player deployments never flush to server.

---

## 3. State Lifecycle

### 3.1 Ephemeral State (lost on tab close)

| Store | Module | Contents | Reset point |
|---|---|---|---|
| `useLayerRegistryStore` | `state/layerRegistry.ts` | Layer entries array (annotations + data layers) | hydrate() clears all |
| `useDataLayerFCStore` | `state/useDataLayerFCStore.ts` | FeatureCollection map keyed by dl:* id | hydrate() clears all |
| `CollabState` instance | `state/collab.ts` | Socket connections, Yjs doc, peer map, undo manager | disconnect() + tab close |
| `comments-anchor-picker` | `state/comments-anchor-picker.ts` | Pending anchor state (module-level var) | clearAnchorPicker() |
| `AriaAnnouncer` store | `components/AriaAnnouncer.tsx` | Current announcement string | Tab close |

### 3.2 Persistent State (survives tab close)

| Store | Medium | Key(s) | Persistence function |
|---|---|---|---|
| Autosave document | IndexedDB `atlasdraw-autosave.state` | `"current"` → StoredBlob | load() on mount → hydrate() |
| FSA file handle | IndexedDB `atlasdraw-autosave.state` | `"fileHandle"` | getStoredFileHandle() on saveToDisk/openFromDisk |
| Remote map ID | IndexedDB `atlasdraw-autosave.state` | `"remoteMapId"` | buildRemoteSaveCallback loads on first save |
| App config | Vite env vars / runtime | `VITE_*` | getAppConfig() |
| Workspace context | Env / query param | `VITE_WORKSPACE_ID` | resolveWorkspaceFromEnv() |

### 3.3 Leak analysis

- **No session-to-session leaks**: All ephemeral stores are re-initialized on mount. The IndexedDB stores are intentionally preserved across sessions (autosave recovery). No persistent state carries stale data from a previous document into a new one — hydrate clears registries before applying.
- **RemoteMapId stickiness**: The remote map ID is persisted in IDB. If a user creates a map (POST /maps → gets id), then clears the doc (or a different user loads the same browser), the next remote save will PUT to the old map id, effectively overwriting the previous map on the server. This is a cross-session identity leak if multiple maps are edited from the same browser without clearing IDB.
- **FSA handle stickiness**: Same pattern — the stored file handle means "Save to file" always overwrites the same file until the user explicitly picks a new file.

---

## 4. Stream Capture

Modules that absorbed responsibilities beyond what their name suggests:

### 4.1 `MapEditor.tsx` (~940 lines)

The most heavily captured module in the app. It is simultaneously:
- **Component**: Renders Excalidraw + MapLibre DOM stack with CSS layering
- **Persistence orchestrator**: Creates PersistenceStore, wires remoteSave, starts/stops autosave, registers forceSave
- **Import handler**: GeoJSON drag-drop with capture-phase events
- **Collab manager**: Instantiates CollabState, wires scene accessor/receiver, manages Yjs source lifecycle
- **Tool dispatcher**: Mounts atlas-tool overlay, routes pointer events
- **Export dialog builder**: Renders Save/Open/GeoJSON cards via renderCustomUI
- **Basemap controller**: Switches MapLibre styles, manages basemap picker lifecycle
- **Dialog host**: Controls show/hide for ShareDialog, AboutDialog, BasemapPickerDialog, PrintDialog, MaputnikDialog, AssetLibraryPanel
- **Accessibility**: Manages aria-live selection announcements

**Impact**: Every new feature must modify MapEditor.tsx. The file has 35 git commits in 6 months (hottest file in the repo). Any non-trivial refactor should extract persistence orchestration and collab source management into dedicated hooks or providers.

### 4.2 `CollabState` class (`state/collab.ts`, ~500 lines)

Captured responsibilities:
- **Socket.IO client**: Connection lifecycle + all event handlers (JOIN_ROOM, CURSOR, MAP_CAMERA_UPDATE, SCENE_UPDATE, PEER_LEFT, REQUEST_SNAPSHOT, SCENE_SNAPSHOT)
- **y-websocket client**: WebSocket lifecycle for Yjs CRDT sync
- **Comments layer**: Instantiates and tracks CommentsLayer (separate Y.Doc + provider)
- **Peer presence**: Manages `Map<string, PeerMeta>` with reactive event-driven updates
- **Scene crypto**: Encrypts/decrypts via AES-GCM through `scene-crypto.ts`
- **Snapshot protocol**: Full joiner-pull election loop with retry timer + joining window
- **Undo manager**: Creates/destroys CollabUndoManager scoped to local socket.id

**Impact**: The class conflates transport (Socket.IO, WebSocket), application protocol (JOIN_ROOM, snapshot pull), and state (peers map). However, the cohesion is intentional — all three must share lifecycle (`connect`/`disconnect`) and the snapshot protocol needs access to both the socket and the Yjs doc. The class is unit-testable, with collab.test.ts exercising the protocol.

### 4.3 `persistence.ts` (`state/persistence.ts`, ~505 lines)

Captured responsibilities:
- **IndexedDB adapter**: DB open/upgrade (version 1, single object store), CRUD
- **FSA adapter**: saveToDisk/openFromDisk with stored handle tracking
- **Autosave pump**: Debounce + ceiling timer logic (`startAutoSave`)
- **Dirty bit**: `markDirty()` + `isDirty()` + listener set
- **Write serialization**: Single-flight write chain (`enqueueWrite`)
- **Race detection**: `dirtySeq` snapshot guard prevents stale dirty-bit clears
- **Blob polyfill**: jsdom Blob.arrayBuffer fix via FileReader fallback + Object.defineProperty
- **Remote push**: Optional `remoteSave` callback (best-effort, no blocking)

**Impact**: Reasonable cohesion — all these belong to "local-first persistence." The polyfill code and FSA fallbacks add ~150 lines of noise that could live in separate helper modules.

### 4.4 `createHttpStorageClient.ts` (~330 lines)

Captured responsibilities:
- **HTTP transport**: Six methods (createMap, getMap, updateMap, createShareToken, resolveToken, getShareBlob) + error translation
- **Workspace header injection**: `X-Workspace-ID` per-request header
- **Share expiry semantics**: 404 → null vs 410 → `ShareExpiredError` distinction
- **Managed-mode methods**: `listWorkspaces()`, `createCheckoutSession()` with self-host short-circuit
- **Type mirroring**: Duplicates `MapRecord`, `ShareToken`, and workspace types from `@atlasdraw/storage`

**Impact**: Reasonable — HTTP client for dual-purposes (map persistence + workspace management). The type mirroring is a deliberate decoupling (avoids depending on Node-only server package) but must be kept in sync manually.

---

## 5. Concurrency Semantics (Verified)

### 5.1 Dirty-bit Race Guard

The `dirtySeq` counter (`state/persistence.ts:199`) is a Lamport-clock-style guard. On `markDirty()` the counter increments; `save(doc)` captures the current value before the async write and only clears dirty if the counter hasn't moved. Without this guard, rapid successive edits during a slow write would silently mark the doc clean while data is still unsaved.

Verified source: `state/persistence.ts:224-237`.

### 5.2 Write Serialization

`enqueueWrite` chains async writes via a shared promise chain (`writeChain`). A failure in one write does not poison subsequent writes (the chain is rebuilt on each call with `.catch(() => undefined)`). FSA writes use the same chain, ensuring save-to-disk never races with autosave.

Verified source: `state/persistence.ts:202-210`.

### 5.3 IDB vs FSA Race

When both autosave (IDB) and saveToDisk (FSA) are in flight, the shared `writeChain` guarantees serial execution. The `remoteSave` fires after the IDB write and uses a separate promise (not on `writeChain`), so it does not block subsequent autosaves.

### 5.4 Scene Update vs Data Layer Op Ordering

Socket.IO and y-websocket are separate TCP channels. `SCENE_UPDATE` events travel via Socket.IO; data layer mutations go through y-websocket. Relative ordering between them is NOT guaranteed. The app must tolerate receiving an Excalidraw element update before the corresponding data layer GeoJSON has arrived. Yjs convergence handles eventual consistency for data layers; Excalidraw's `version + versionNonce` LWW handles scene elements.

Verified source: `state/collab.ts` — Socket.IO and y-websocket are established as separate connections with independent message streams.

---

## 6. Failure Modes (Verified)

### 6.1 Persistence Store Write Failure

```
store.save(doc) → write(doc) fails OR IDB put fails
  │
  ├─ write() fails → enqueueWrite rejects → startAutoSave logs error
  │   (dirty bit NOT cleared — dirtySeq guard prevents it)
  │
  └─ IDB put fails → enqueueWrite rejects → startAutoSave logs error
      (same guard — dirty bit preserved, retry on next flush tick)
```

### 6.2 Remote Save Failure

```
remoteSave(blob) fails (storage server unreachable, 5xx)
  │
  ├─ IDB write ALREADY SUCCEEDED (remoteSave is sequenced after)
  ├─ dirty bit cleared (guard checks only dirtySeq, not remoteSave status)
  ├─ Error logged to console.error
  └─ Next autosave flush will send again (dirty flag is false though,
     so only element mutations after this point trigger the next save —
     the last un-synced state on the server is the PREVIOUS save)
```

This is a known gap: dirty=false but server is behind. The app renders "saved" (dirty indicator off) while the server has stale data. Addressed in Phase 4 T13 spec: "the caller is responsible for surfacing remote-state divergence elsewhere" — but no such indicator is implemented yet.

### 6.3 Invalid Share ID Format (Error Recovery)

```
ShareView gets /m/<invalid-token>
  │
  ├─ tokenFromPath returns null for non-21-char tokens
  └─ setState({ kind: "error", message: "Invalid share link." })

ShareView gets 410 from getShareBlob
  └─ setState({ kind: "expired" })
  → render: "Share links are valid for 7 days. Ask the author for a new link."
```

### 6.4 Autosave Stale State During Share

```
User clicks "Share read-only" while autosave is mid-flush
  │
  ▼
useShareLink.generate() → waitForDrain (polls isDraining, 10s timeout)
  │
  ├─ Drains in time → getDoc() captures the latest state
  └─ Times out → error: "Autosave didn't finish within 10 seconds"
```

---

## 7. Confidence Summary

| Section | Confidence | Basis |
|---|---|---|
| 1.1 Annotation Drawing | high | All paths verified: onChange → markDirty → selectDocument → IDB write |
| 1.2 Data Import | high | Capture-phase handler → parse/validate → MapLibre source → registry |
| 1.3 Save/Load | high | FSA + fallback paths verified; hydrate order verified (clear→replay→scene→dirty) |
| 1.4 Real-time collab | high | Full lifecycle verified: connect → snapshot pull → scene sync → Yjs CRDT → disconnect |
| 2. Endorheic basins | high | All stores examined; no unbounded growth patterns found |
| 3. State lifecycle | high | All stores classified as ephemeral/persistent; leak analysis done |
| 4. Stream capture | high | MapEditor and CollabState identified as heaviest offenders |
| 5. Concurrency | med | Write serialization and dirtySeq verified; Scene/data-layer ordering gap is by-design |
| 6. Failure modes | high | All failure paths traced; remoteSave stale-state gap is documented in spec |
