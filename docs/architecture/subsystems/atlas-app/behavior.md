# atlas-app — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.7, §5.1, §6; Phase 3–7 plans; open-questions-resolution Q9/Q11; cross-phase-audit; escalations E-01/E-02.

---

## 1. State Machines

### 1.1 Share-Link Redemption Flow

```
User clicks share URL (/m/:uuid)
  │
  ▼
[INIT] pages/share/[uuid].tsx mounts
  │
  ├─► GET /share/:uuid
  │     │
  │     ├─ 200 { map, mode: 'read' } ──► [LOADING_MAP]
  │     │                                    │
  │     │                                    ▼
  │     │                               fetch blob from storage
  │     │                                    │
  │     │                                    ▼
  │     │                               [RENDERING] — read-only Excalidraw + MapLibre
  │     │
  │     ├─ 404 ──────────────────────► [ERROR: never existed]
  │     └─ 410 ──────────────────────► [ERROR: link expired]
  │
  └─► (no auth required — mode: 'read' set server-side from ShareToken.mode)
```

Key invariants:
- `mode: 'read'` is set server-side; the viewer route must not accept `mode` from URL params.
- Shared URL is a snapshot: map as it was at share time. Subsequent edits to the source map do not update the share link.
- 410 Gone (expired) is distinct from 404 (never existed) — UI must render different messages.

[CONFIDENCE: high — Phase 4 plan Tasks 4/9]

---

### 1.2 Autosave / Persistence Flow

```
User edits scene (Excalidraw element or data layer op)
  │
  ▼
useScene.ts detects change (Excalidraw onChange callback)
  │
  ▼
[DIRTY] — debounce 2s (inferred)
  │
  ▼
state/persistence.ts.save(key, bundle)
  │
  ├─ FSA adapter available AND permission granted ──► write to file handle
  │
  └─ else ──────────────────────────────────────────► write to IndexedDB
         │
         └─ IndexedDB write fails ──► [SNAG: silent loss risk]
                                      emit error toast; retry 3× then warn user
```

**Endorheic basin**: The IndexedDB autosave queue is an in-app accumulation point. Data written to IndexedDB is never flushed to the server unless the user explicitly shares or saves to the storage backend. A user who relies solely on autosave and never shares or exports will lose data if they clear browser storage. UI must surface this risk (e.g., "unsaved to cloud" indicator).

[CONFIDENCE: med — tech-spec §4.7 persistence, Phase 3 plan; debounce value extrapolated]

---

### 1.3 FSA Permission Revocation Mid-Session

```
User has open file via File System Access (Chromium)
  │
  ▼
OS revokes FSA permission (e.g. file moved, user denied in OS dialog)
  │
  ▼
Next autosave attempt → FSA.write() throws NotAllowedError
  │
  ▼
persistence.ts catches error
  │
  ├─► Fall back to IndexedDB silently
  └─► Emit warning toast: "File access lost — saving to browser storage"
```

User can re-grant permission by clicking "Save to file" again (re-triggers FSA permission prompt).

[CONFIDENCE: med — standard FSA failure mode; behavior extrapolated from spec mention of fallback]

---

### 1.4 Plugin Install Flow (Phase 7)

```
User opens PluginManager
  │
  ▼
Browse / paste manifest URL
  │
  ▼
[VALIDATING]
  ├─► Fetch PluginManifest JSON
  ├─► Validate SPDX license field (per Q5 resolution)
  └─► Verify SHA-256 integrity of bundle against manifest hash
        │
        ├─ Mismatch ──► [ERROR: integrity check failed] — do not install
        └─ OK ────────► [INSTALLING]
                           │
                           ▼
                        Persist to PluginRegistry (Zustand + IndexedDB)
                           │
                           ▼
                        PluginHost.tsx instantiates Worker with bundle
                           │
                           ▼
                        Plugin calls registerTool / registerLayerType / registerStylingFn
                        via AtlasdrawAPI (postMessage bridge)
                           │
                           ▼
                        [ACTIVE] — tool appears in Toolbar, layer type in LayerPanel
```

Uninstall: Worker terminated, registry entry removed, tools/layer types deregistered from store.

[CONFIDENCE: med — Phase 7 plan Feature 1, Q11/Q5 constraints; exact states extrapolated]

---

### 1.5 Snapshot Creation Flow (Phase 7)

```
User clicks "Save snapshot" (VersionTimeline or keyboard shortcut)
  │
  ▼
SnapshotNameDialog.tsx — user enters optional name
  │
  ▼
SnapshotStore.save(mapId, name?)
  ├─► SnapshotSerializer: Yjs state → compact binary blob
  └─► POST /api/v1/maps/:id/snapshots (apps/storage)
        │
        ├─ 201 { snapshotId } ──► VersionTimeline adds node; toast "Snapshot saved"
        └─ error ───────────────► toast error; local IndexedDB fallback (inferred)
```

Auto-snapshots: triggered by `autoSnapshotIntervalHours` config (default: inferred hourly). Same path but no name prompt and `name` is omitted (auto-GC eligible).

[CONFIDENCE: high — Phase 7 plan Tasks 9/17/18/29]

---

## 2. Concurrency Semantics

### 2.1 Scene Element Conflicts (Yjs CRDT + versionNonce LWW)

Excalidraw elements use `version + versionNonce` last-write-wins per element. When two peers edit different properties of the same element simultaneously, the higher `versionNonce` wins. This is Excalidraw's native merge semantics; `atlas-app` does not override it.

Data layers (GeoJSON FeatureCollections) use Yjs CRDT merge — structural merge without LWW conflicts on individual features. Two peers editing different features in the same layer merge cleanly. Two peers editing the same feature's geometry simultaneously: Yjs character-level merge applies (may produce unexpected geometry; acceptable tradeoff per Phase 5 decision).

[CONFIDENCE: high — tech-spec §5.1, Phase 5 plan OQ-3 resolution]

### 2.2 Socket.IO Message Ordering

Socket.IO guarantees in-order delivery per connection. `SCENE_UPDATE` and `DATA_LAYER_OP` are separate channels (Socket.IO vs y-websocket) — relative ordering between them is not guaranteed. The app must tolerate receiving a `SCENE_UPDATE` referencing an element whose data layer op has not yet arrived. Yjs convergence handles eventual consistency.

[CONFIDENCE: med — tech-spec §5.1; ordering guarantee extrapolated from Socket.IO docs]

---

## 3. Failure Modes

### 3.1 Realtime Server Unavailable

```
CollabState: attempting to connect ──► WebSocket connection fails
  │
  ├─► Socket.IO exponential backoff reconnect (default: 1s, 2s, 4s, ... up to ~30s)
  ├─► Yjs y-websocket reconnects independently on /yjs/:roomId
  └─► Local edits continue (Yjs doc applies locally; will sync on reconnect)
      UI indicator: "Offline — changes saved locally"
```

On reconnect: Yjs sends full state vector; server applies merge. No edit loss expected for Yjs data layers. Excalidraw scene: `SCENE_UPDATE` broadcast on reconnect (standard excalidraw-room behavior).

[CONFIDENCE: med — standard Yjs/Socket.IO reconnect behavior; UI indicator extrapolated]

### 3.2 Storage Server Unavailable

- Share: `useShareLink.ts` upload fails → user sees error toast; can retry or use URL-hash fallback (if map < 32 KB after compression).
- Save: `StorageClient.updateMap()` fails → data stays in IndexedDB; retry on next manual save or periodic retry.
- Read-only viewer: `GET /share/:uuid` fails → error state with retry button.

[CONFIDENCE: med — extrapolated from Phase 4 plan]

### 3.3 Yjs Sync Catch-Up Timeout

When a client reconnects after a long offline period and the server has evicted the in-memory room (TTL 5 min), the client must request a full state snapshot from `apps/storage` via `setPersistence.bindState` (Phase 6 wiring). If `bindState` fetch fails (storage unavailable), the Yjs doc initializes empty — data layer ops made while offline are preserved in the local Yjs doc and will be merged once connectivity is restored.

[CONFIDENCE: med — Phase 5→6 contract, cross-phase-audit 1.6]

### 3.4 Plugin Worker Crash

If a plugin's Web Worker throws an uncaught error:
- `PluginHost.tsx` catches the `error` event on the Worker.
- Plugin is marked as `errored` in `PluginRegistry`.
- Plugin's registered tools are removed from Toolbar; layer types removed from LayerPanel.
- User sees toast: "Plugin <name> crashed — disabled."
- Main thread is unaffected (sandbox boundary).

[CONFIDENCE: med — standard Worker error handling; behavior extrapolated from Q11/Phase 7]

---

## 4. Endorheic Basins

| Basin | Description | Flush mechanism |
|---|---|---|
| IndexedDB autosave queue | Local edits accumulate; never pushed to server automatically | User explicitly shares or uploads map; or user exports file |
| Unsync'd Yjs ops (offline) | Local Y.Doc diverges from server while offline | Yjs CRDT merge on reconnect |
| Plugin registry (IndexedDB) | Installed plugins accumulate; no expiry | User uninstalls via PluginManager |
| Share token table (server) | See `storage/behavior.md` — token table grows; client has no insight | Server-side TTL (see storage behavior) |

---

## 5. Collab Room Lifecycle (Client-Side View)

```
[IDLE] — no collab session
  │
  ▼ User clicks "Collaborate" / opens shared collab URL
[JOINING]
  ├─► Socket.IO connect to /socket.io (port 4001)
  └─► y-websocket connect to /yjs/:roomId
        │
        ▼
[SYNCING] — Yjs initial sync (full state vector exchange)
        │
        ▼
[ACTIVE] — full collab; peers visible; CRDT ops flowing
  │
  ├─ Idle timeout (no local ops, no peer activity for ~5 min)
  │    ▼
  │  [IDLE_CONNECTED] — still connected; room may be evicted on server
  │
  └─ User leaves / closes tab
       ▼
     [DISCONNECTED] — sockets closed; local Y.Doc persists
```

Server-side room eviction (TTL 5 min of inactivity) does not affect the client directly — client remains connected as long as socket is open. If server evicts the room while client is connected, the server reinitializes from `setPersistence.bindState` (Phase 6+).

[CONFIDENCE: med — Phase 5 plan, cross-phase-audit 1.6; idle/eviction client behavior extrapolated]
