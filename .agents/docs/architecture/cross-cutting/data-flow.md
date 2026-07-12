# Atlasdraw — Data Flow

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.
**Schema:** codebase-mapping-schema.md § Data Flow
**Last updated:** 2026-05-03

---

## Overview

This document traces the major data flows through Atlasdraw's subsystems from end to end. Each flow section includes a diagram (Mermaid or ASCII), numbered steps, subsystems touched, and flow-basin identification.

[CONFIDENCE: high] marks flows derived directly from tech spec and phase plans. [CONFIDENCE: med] marks flows extrapolated from partial spec coverage.

---

## Flow Basins

A **flow basin** is a region of the system where data moves through a single coherent mechanism with a clear drainage divide separating it from adjacent basins. Basin boundaries are the points where data crosses subsystem APIs.

| Basin | Mechanism | Drainage Divide |
|---|---|---|
| **Scene Render** | Excalidraw `updateScene` → canvas paint | `excalidrawAPI.updateScene()` call site |
| **Camera Sync** | MapLibre `move` event → `CoordinateSync` → `updateScene` | `map.on("move")` listener |
| **Data Layer Style** | MapLibre `addSource`/`addLayer` → GL shader | `map.addSource()` / `map.addLayer()` call site |
| **Persistence** | Zustand store snapshot → `PersistenceStore` → IndexedDB/disk | `PersistenceStore.save()` |
| **Collaboration** | Local op → encrypt → Socket.IO → relay → peers | Socket.IO `emit` / `on` boundary |
| **Plugin Bridge** | `AtlasdrawAPI` call → postMessage → Worker → postMessage → response | `postMessage` boundary |
| **Share** | `AtlasdrawBundle` → encode → URL hash or server UUID | `encodeHashShare()` / `POST /maps/:id/share` |

---

## Flow 1 — Open Map → Render

**Subsystems:** `packages/data`, `packages/basemap`, `packages/geo`, `apps/atlas-app`
[CONFIDENCE: med — file format from Phase 3; load flow is extrapolated]

### Diagram

```
User action: open .atlasdraw file (or load from URL)
        │
        ▼
packages/data: read(blob)
  └─ unzip .atlasdraw bundle
  └─ parse manifest.json         → AtlasdrawManifest
  └─ parse scene.json            → ExcalidrawScene
  └─ parse layers/*.geojson      → GeoJSON FeatureCollection[]
  └─ read style.json             → MapLibreStyle
  └─ validate schemaVersion      → assert schemaVersion === 1
        │
        ▼
apps/atlas-app: document store hydrated (Zustand)
  ├─ excalidrawAPI.updateScene({ elements, appState, files })
  │         └─ Excalidraw canvas renders annotations
  ├─ LayerRegistry.hydrate(layers)   [packages/data LayerRegistry]
  │     └─ for each layer:
  │         map.addSource(id, { type: "geojson", data: fc })
  │         map.addLayer(buildMapLibreLayer(id, style))
  └─ BasemapRegistry.applyStyle(style)
            └─ map.setStyle(style)    → MapLibre re-renders basemap
                      │
                      ▼
              map "load" event fires
                      │
                      ▼
              CoordinateSync.syncMapToScene()    [see Flow 3]
                      │
                      ▼
              Editor "ready" state — user can interact
```

### Steps

1. User selects `.atlasdraw` file (drag-drop, FSA open dialog on Chromium, or `<input type=file>` fallback).
2. `packages/data/read()` unzips the bundle, parses `manifest.json`, `scene.json`, `style.json`, and all `layers/*.geojson` files.
3. `schemaVersion` assertion: if `schemaVersion !== 1`, migration logic runs (or an error is shown if migration is not available).
4. The Zustand document store is hydrated with the parsed document.
5. `excalidrawAPI.updateScene()` loads the annotation elements into Excalidraw's canvas.
6. `LayerRegistry.hydrate()` registers each data layer; for each, calls `map.addSource()` + `map.addLayer()`.
7. `BasemapRegistry.applyStyle()` sets the MapLibre style (which includes basemap source definitions).
8. MapLibre fires `load`; `CoordinateSync.syncMapToScene()` runs the first projection pass, placing all geo-anchored annotations at their correct pixel positions.
9. The editor enters "ready" state.

---

## Flow 2 — User Draws Annotation

**Subsystems:** `apps/atlas-app` (MapEditor, tool dispatch), `packages/geo` (CoordinateSync), `packages/tools`
[CONFIDENCE: high — from Phase 1 plan Flow B]

### Diagram

```
User pointer-down on MapEditor
        │
        ▼
isDrawingMode check (pointer-events gate)
  ├─ false: event passes through to MapLibre → pan/drag
  └─ true:  Excalidraw captures event
                    │
                    ▼
            Excalidraw tool dispatch
              │
              ├─ customType: "pin" → PinTool.onPointerDown(e, ctx)
              │     └─ ctx.map.unproject([e.clientX, e.clientY]) → LngLat
              │     └─ createPinElement(lngLat, ctx.appState)
              │           └─ GeoAnchor { kind: "point", lng, lat, zRef }
              │           └─ GeoCustomData { geo, scaleMode: "screen",
              │                              schemaVersion: 1, projection: "mercator" }
              │     └─ excalidrawAPI.updateScene({ elements: [...existing, newEl] })
              │
              ├─ customType: "polygon" → PolygonTool.onPointerMove/Up(...)
              │     └─ same pattern; GeoAnchor { kind: "polyline", coordinates }
              │
              └─ native "rectangle" → RectangleTool wraps Excalidraw default
                    └─ on commit: unproject corners → GeoAnchor { kind: "bbox" }
                    └─ excalidrawAPI.updateScene(...)
                                    │
                                    ▼
                        Flow 3 (camera sync) NOT triggered
                        (map "move" not fired)
                        Scene re-render: new element visible at correct position
```

### Steps

1. User selects a drawing tool; `isDrawingMode` is `true`.
2. Excalidraw captures the pointer event (the MapLibre layer is `pointer-events: none`).
3. The geo-aware tool handler calls `ctx.map.unproject()` to convert viewport pixels to geographic coordinates.
4. A new Excalidraw element is created with `customData.geo` populated as the correct `GeoAnchor` variant.
5. `excalidrawAPI.updateScene()` adds the element; Excalidraw re-renders the canvas.
6. **Invariant:** every element created by a geo-aware tool exits `onPointerDown` with a valid `GeoCustomData`. An element without a geo anchor is invisible to `syncMapToScene`.

---

## Flow 3 — Camera Change → Scene Re-projection

**Subsystems:** `packages/basemap` (MapLibre events), `packages/geo` (CoordinateSync), `apps/atlas-app` (Excalidraw API)
[CONFIDENCE: high — from Phase 1 plan Flow A, Tech Spec §3]

### Diagram

```
map.on("move" | "zoom" | "rotate" | "pitch")
        │
        ▼
[throttle: 16ms — ~60Hz max]
        │
        ▼
useCoordinateSync.handleCameraChange()
        │
        ▼
CoordinateSync.syncMapToScene()
        │
        ├─ for each geo-anchored element in scene:
        │     projectElement(el, map)
        │       ├─ kind: "point"
        │       │     → map.project([lng, lat]) → pixel {x, y}
        │       │     → apply scaleMode factor (geographic|screen|hybrid)
        │       │     → write el.x, el.y
        │       ├─ kind: "bbox"
        │       │     → map.project(nw) + map.project(se)
        │       │     → write el.x, el.y, el.width, el.height
        │       └─ kind: "polyline"
        │             → map.project each coordinate
        │             → offset to element-local space
        │             → write el.points
        │
        ▼
excalidrawAPI.updateScene({
  elements: updatedElements,
  captureUpdate: "never"    // do NOT push to undo stack
})
        │
        ▼
Excalidraw re-renders canvas
All geo-anchored elements at new positions
```

### Steps

1. MapLibre fires `move`, `zoom`, `rotate`, or `pitch` event on any camera change.
2. The event is throttled to 16ms to cap the projection rate at ~60Hz.
3. `CoordinateSync.syncMapToScene()` iterates all elements in the Excalidraw scene.
4. For each element with a `customData.geo` field, `projectElement()` calls `map.project()` for its anchor coordinates.
5. The element's `x`, `y`, `width`, `height`, or `points` fields are updated with the new pixel positions.
6. `excalidrawAPI.updateScene()` is called with `captureUpdate: "never"` — camera-sync updates must not pollute the undo stack.
7. Excalidraw re-renders all elements at their new positions.

**Performance constraint:** `syncMapToScene` must complete in <8ms for a scene of 5,000 elements (Tech Spec §8, Q8). This is an O(n) hot path at up to 60Hz. Phase 1 includes a benchmark gate; if the baseline misses by >2x, incremental projection (only elements whose anchor pixels changed) is added before Phase 1 closes.

**Invariant:** `syncMapToScene` never writes `customData.geo`. The geo anchor is the source of truth; pixel positions are always derived.

---

## Flow 4 — GeoJSON Drag-Drop

**Subsystems:** `apps/atlas-app` (MapEditor drop handler), `packages/data` (GeoJSON parser), `packages/basemap` (MapLibre), `LayerRegistry`
[CONFIDENCE: high — from Phase 2 plan Flow B, Task T13]

### Diagram

```
User drops .geojson file onto MapEditor
        │
        ▼
dragover + drop event on MapEditor
        │
        ▼
FileReader.readAsText(file)
        │
        ▼
packages/data/geojson.ts: parse(blob)
  └─ strict parse: reject on any GeoJSON spec violation
  └─ on error: actionable toast message shown; flow aborts
        │
        ▼
FeatureCollection validated
        │
        ▼
LayerRegistry.registerDataLayer({ id, fc, style: defaultLayerStyle })
  └─ id format: "dl:<nanoid>" (avoids collision with Excalidraw element IDs)
        │
        ├─ map.addSource(id, { type: "geojson", data: fc })
        └─ map.addLayer(buildMapLibreLayer(id, style))
                          [basemap/style-compiler.ts]
                    │
                    ▼
            LayerPanel updates
            (new data layer row appears)
```

### Steps

1. User drops a `.geojson`, `.json`, or `.kml`/`.csv` (Phase 3+) file onto the canvas.
2. `FileReader.readAsText()` reads the file asynchronously.
3. `packages/data/geojson.ts parse()` validates the JSON strictly; any GeoJSON spec violation aborts with a user-facing toast.
4. `LayerRegistry.registerDataLayer()` assigns a unique ID and stores the layer's `FeatureCollection` and initial style.
5. `map.addSource()` + `map.addLayer()` wire the data into MapLibre's rendering pipeline.
6. The `LayerPanel` component reflects the new layer in the sidebar.

---

## Flow 5 — Real-Time Collaborative Edit

**Subsystems:** `apps/atlas-app` (collab client), `apps/realtime` (relay), `packages/data` (Yjs)
[CONFIDENCE: high — from Tech Spec §5, Phase 5 plan]

### Diagram

```
Local edit (annotation or data layer)
        │
        ├─ Annotation edit (SCENE_UPDATE path):
        │     Excalidraw element changed
        │         → excalidrawAPI onChange fires
        │         → CollabClient.onSceneUpdate(elements)
        │         → encrypt(diff, roomKey)   [AES-GCM, key from URL fragment]
        │         → socket.emit("SCENE_UPDATE", { iv, ciphertext })
        │
        └─ Data layer edit (DATA_LAYER_OP path):
              YjsLayer.applyLocalOp(op)
                  → Y.Doc.transact(...)
                  → y-websocket sends binary Yjs update bytes
                  → (Phase 5: plaintext; Phase 6: encrypted per E-01 resolution)

                    ↓ network ↓

apps/realtime (relay):
  "SCENE_UPDATE" received
    → validate: has iv + ciphertext fields
    → relay to room members (skip sender)
    → relay DOES NOT decrypt

  Yjs binary frame received
    → y-websocket relays binary frames
    → relay treats as opaque bytes

                    ↓ network ↓

Peer browser:
  "SCENE_UPDATE" received
    → decrypt(ciphertext, roomKey)   [AES-GCM]
    → Excalidraw LWW merge:
        if incoming.version > local.version: apply
        elif equal: versionNonce tiebreak
    → excalidrawAPI.updateScene({ elements: merged })
    → canvas re-renders

  Yjs binary frame received
    → Y.Doc.applyUpdate(bytes)
    → CRDT merge (automatic)
    → LayerRegistry reflects updated FeatureCollection
    → map.getSource(id).setData(fc)
    → MapLibre re-renders data layer
```

### Steps

1. Local edit fires either Excalidraw's `onChange` (for annotations) or a Yjs transaction (for data layer ops).
2. Annotation diffs are encrypted client-side with AES-GCM using the room key from the URL fragment before being emitted.
3. The relay receives the payload, validates fields, and broadcasts to all room members except the sender. The relay never decrypts.
4. Peers receive the payload and decrypt it; Excalidraw LWW merge resolves conflicts by version number, with `versionNonce` as a tiebreak.
5. Data layer ops travel as Yjs binary frames; the relay treats them as opaque. The Yjs CRDT merge is automatic and conflict-free.
6. Camera and cursor updates (`MAP_CAMERA_UPDATE`, `CURSOR`) travel plaintext — they are not sensitive and the relay uses them for deduplication and throttling.

**E2EE gap (E-01):** In Phase 5, Yjs data layer ops are server-trusted (plaintext at the relay). Phase 6 must evaluate Option B (client-side Yjs encryption via `yjs-crypto.ts`). Until E-01 is resolved, the relay can read plaintext GeoJSON feature operations. See `decisions/0007-yjs-e2ee-threat-model.md`.

---

## Flow 6 — Save to Disk

**Subsystems:** `apps/atlas-app` (autosave hook, `PersistenceStore`), `packages/data` (serializer), `packages/sdk` (`AtlasdrawBundle`)
[CONFIDENCE: high — from Phase 3 plan Task 8]

### Diagram

```
Edit occurs
        │
        ▼
useAutosave debounce (5 second idle)
        │
        ▼
Zustand store snapshot → AtlasdrawDocument
        │
        ▼
packages/data: write(doc) → zip bundle
  ├─ manifest.json    (id, version, layers[], schemaVersion)
  ├─ scene.json       (Excalidraw elements + appState)
  ├─ style.json       (MapLibre style)
  └─ layers/          (one .geojson per data layer)
  └─ files/           (binary blobs: images, etc.)
        │
        ▼
PersistenceStore.save(doc)
  │
  ├─ Primary path (all browsers):
  │     IndexedDB write (idb library)
  │     → dirty flag cleared
  │
  └─ Enhancement (Chromium only, FSA available):
        File System Access API: write to user's open file handle
        (user must have previously granted access via "Save As")
```

### Steps

1. Any edit to the Zustand document store starts a 5-second debounce timer.
2. On timer expiry, `useAutosave` takes a Zustand snapshot as `AtlasdrawDocument`.
3. `packages/data/write()` serializes the document into a zip bundle: manifest, scene, style, layers, and binary files.
4. `PersistenceStore.save()` writes the zip blob to IndexedDB (universal path).
5. On Chromium with an open FSA file handle, the same blob is simultaneously written to disk.
6. Firefox and Safari users access saved maps via download-then-open; they never have a live file handle.

**Share button constraint:** The Share button must check `useAutosave().isDraining` before snapshotting. If the autosave write is in-flight, the share dialog shows a "Saving…" spinner and retries after drain completes.

---

## Flow 7 — Share via URL

**Subsystems:** `apps/atlas-app` (useShareLink), `apps/storage` (share endpoints), `packages/sdk` (AtlasdrawBundle)
[CONFIDENCE: high — from Phase 4 plan Tasks 8–9]

### Diagram

```
User clicks Share button
        │
        ▼
useShareLink:
  ├─ check useAutosave().isDraining
  │     → if true: show "Saving..." spinner, wait
  │
  ▼
snapshot AtlasdrawBundle = { scene, layers, style, manifest }
        │
        ▼
size check: serialized bundle < 32KB?
  │
  ├─ YES → Hash mode (zero-infrastructure path)
  │       encodeHashShare(bundle)
  │         → JSON.stringify(bundle)
  │         → lz-string compress → lz-base64 string
  │         → URL: <origin>/m#v1:<lz-base64>
  │       copy URL to clipboard
  │
  └─ NO  → UUID upload mode (server-required path)
          POST /api/maps/:id/share
            → server generates ShareToken { token: nanoid(21), ttl: 30d, mode: "read" }
            → server stores token in DB
            → returns { token, url: /share/:token }
          URL: <origin>/share/<token>
          copy URL to clipboard

        Recipient loads URL:
          Hash mode: decode lz-base64 → JSON.parse → load AtlasdrawBundle directly
          Token mode: GET /share/:token → StorageServer returns MapRecord → load
```

### Steps (hash mode)

1. Bundle is serialized and lz-string compressed to base64.
2. The resulting URL hash is typically ~17.5KB for a 32KB bundle (safe under Safari's ~50KB hash limit — Q2 resolution).
3. No server round-trip. Recipient's browser decodes and loads the bundle locally.

### Steps (UUID mode)

1. `POST /api/maps/:id/share` creates a `ShareToken` with 30-day TTL, `nanoid(21)` entropy, `mode: "read"`.
2. `GET /share/:token` returns the map record. Expired tokens return 410 Gone (not 404).
3. Revocation is MVP-deferred: delete the token row in DB. No revocation UI in v1.0.

---

## Flow 8 — Comment Thread (Phase 6)

**Subsystems:** `apps/atlas-app` (CommentsPanel, useComments), `apps/realtime` (comments-doc), `packages/data` (Yjs)
[CONFIDENCE: med — file structure from Phase 6; exact Yjs comment shape extrapolated]

### Diagram

```
User right-clicks element → "Add comment"
        │
        ▼
CommentComposer opens (anchored to element ID)
User types comment, submits
        │
        ▼
useComments.addComment({
  elementId, text, authorId, timestamp
})
        │
        ▼
Yjs comment Y.Doc (separate from data-layer Y.Doc):
  Y.Array.push({ id: nanoid(), elementId, text, author, ts, resolved: false })
        │
        ▼
y-websocket sends binary update to /yjs/:roomId-comments
        │
        ▼
apps/realtime: comments-doc.ts
  room-comments-handler.ts relays binary frames to room
        │
        ▼
Peers receive:
  Y.Doc.applyUpdate(bytes)
  → useComments subscription fires
  → CommentsPanel re-renders
  → CommentAnchor overlay updates on map
```

### Steps

1. Comment is anchored by Excalidraw element ID; a CommentAnchor overlay renders a pin at the element's screen position.
2. The comment document is a second `Y.Doc` per room, separate from the data-layer document. This keeps comment and data-layer CRDT logs independent.
3. Encrypted per `COMMENT` Socket.IO channel for text content. [CONFIDENCE: med — Phase 6 spec implies encryption but exact channel routing is extrapolated]

---

## Flow 9 — Plugin Install and Activation (Phase 7)

**Subsystems:** `packages/plugin-host`, `apps/atlas-app` (PluginManagerPanel), `apps/realtime` (optional)
[CONFIDENCE: high — from Phase 7 plan Tasks 1–4]

### Diagram

```
User opens Plugin Manager
        │
        ▼
User drops plugin .zip (or enters registry URL)
        │
        ▼
PluginRegistry.install(zipBlob):
  ├─ extract manifest.json
  ├─ validateManifest(manifest)
  │     → SPDX license check
  │     → known PermissionId check (unknown → throw)
  │     → fetch:* wildcard check (disallowed → throw)
  └─ static review: manifest.entry must be a relative path (no absolute URLs)
        │
        ▼
PluginPermissionDialog shown to user
  (lists requested permissions from manifest.permissions)
  User approves or denies
        │
        ▼
PluginRegistry stores plugin (granted permissions recorded)
        │
        ▼
User enables plugin
        │
        ▼
PluginWorkerHost.spawn(manifest, grantedPermissions):
  ├─ new Worker(manifest.entry, { type: "module" })
  ├─ inject prelude:
  │     self.fetch = permissionCheckedFetch(grantedPermissions)
  │     self.XMLHttpRequest = undefined
  │     self.WebSocket = undefined
  │     self.importScripts = () => throw
  └─ establish postMessage bridge
        │
        ▼
Plugin entry point runs inside Worker
  imports from plugin SDK bridge:
    registerTool({ ... })         → AtlasdrawAPI.registerTool relayed via postMessage
    registerLayerType({ ... })    → AtlasdrawAPI.registerLayerType relayed
    on("layers:change", cb)       → subscription relayed via postMessage
        │
        ▼
AtlasdrawAPI (in main thread):
  receives postMessage from Worker
  validates against granted permissions
  executes action or returns data
  serializes response (structured-clone-safe)
  postMessage back to Worker
```

### Steps

1. Manifest is extracted and validated: SPDX license, known permission IDs, no `fetch:*` wildcard, `entry` is a relative path.
2. User approves the permission request dialog before the plugin is registered.
3. On enable, a Worker is spawned and the prelude is injected before the plugin's entry module executes.
4. All plugin ↔ app communication goes through the `postMessage` bridge, which enforces the `AtlasdrawAPI` structured-clone contract (ADR `0005`).
5. `fetch` requests inside the Worker are routed through the permission-checked wrapper; unauthorized hosts get a rejection.
