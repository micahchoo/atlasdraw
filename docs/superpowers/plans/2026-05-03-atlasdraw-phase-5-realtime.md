# Atlasdraw Phase 5 — Real-time Collaboration
**Plan date:** 2026-05-03
**Schedule:** Weeks 12–15 (shifted +1 from spec's Weeks 11–14 per Q7 chain)
**Status:** Ready to execute

---

## Goal

Add optional 4-user real-time collaborative editing to Atlasdraw without breaking the single-player deployment path. Two independent WebSocket connections per client room (per Q9): Socket.IO on `/socket.io` for lightweight, high-frequency events (scene diffs, camera, cursor, comments) and a native y-websocket connection on `/yjs/:roomId` for Yjs CRDT binary state (data layer ops). Yjs is the chosen CRDT per Q2 (not Automerge). Real-time is disabled by default; `[realtime] enabled = true` in `config.toml` activates it (Q1). Single-player mode with no relay in the compose stack remains a first-class deployment target.

<!-- shape-incorporated 2026-05-03: add explicit Phase 5 scope limitation — server-trusted relay; see E-01 in escalations.md -->
> **Phase 5 Scope Limitation — Server-Trusted Layer Ops:** The Yjs relay in Phase 5 operates server-trusted. The relay process can read plaintext Yjs data-layer ops. End-to-end encryption of Yjs updates (Option B in E-01) is deferred to Phase 6 evaluation. `yjs-crypto.ts` ships as a stub only; it is not wired into the y-websocket path. The threat model is documented in `decisions/0007-yjs-e2ee-threat-model.md` (see Wave 0, Task 0). This is a deliberate, bounded decision pending maintainer confirmation of Option C — see `docs/decisions/escalations.md` E-01.

---

## Tech Stack Additions

| Package | Role |
|---|---|
| `yjs` | CRDT document; `Y.Map` for features, `Y.Array` for geometry coords |
| `y-websocket` | y-websocket server handler in `apps/realtime` |
| `y-protocols` | sync + awareness protocol encode/decode |
| `socket.io` 4.x | existing; adds `MAP_CAMERA_UPDATE`, `CURSOR`, `COMMENT` event types |
| `@socket.io/redis-adapter` | optional multi-instance pub/sub bridge (off by default) |
| `ioredis` | Redis client for optional adapter |

All packages are MIT-licensed and compatible with the AGPL apps / MIT SDK split established in Q5.

---

## Phase Boundary Contracts

### Consumes (from Phases 1–4)

| Artifact | Source | Shape |
|---|---|---|
| Excalidraw scene element type (`ExcalidrawElement`) | Phase 1, `packages/excalidraw` | JSON, includes `customData.geo` anchor |
| `LayerRegistry` | Phase 2, `packages/data/layer-registry.ts` | Map of `LayerId → LayerDescriptor` |
| `GeoAnchor` type | Phase 1/2, `packages/geo/types.ts` (exported via `packages/geo/geo-anchor.ts`) | discriminated union: `{ kind: "point"; lng: number; lat: number; zRef: number }` \| `{ kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }` \| `{ kind: "polyline"; coordinates: Array<[number, number]>; zRef: number }` <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-5, per E-03): was flat `{lng,lat,zoom,bearing}`; `bearing` has no provenance in Phase 1 or Phase 2 type definitions; correct shape is Phase 1 discriminated union; Yjs schema in Tasks 4 and 8 must use `kind` discriminant, not flat fields --> |
| Storage API (`/api/maps/:id` GET/PUT) | Phase 4, `apps/storage` | JSON scene blob + S3/minio backing |
| `docker-compose.yml` (5-svc with `profiles: ["realtime"]` guard) | Phase 4, `infra/` | Existing services: web, storage, minio, postgres, caddy — Phase 5 adds `realtime` service under `profiles: ["realtime"]` guard so plain `docker compose up` stays 5-svc Phase 4 shape <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-4): was "5 static services" with no mention of profiles guard; Phase 4 Task 11 establishes the profiles guard explicitly --> |
| `docker-compose.minimal.yml` (3-svc) | Phase 4, `infra/` | web, storage, minio — no realtime |

### Produces (for Phase 6)

<!-- shape-incorporated 2026-05-03: add Phase 5→6 contract rows for setPersistence wiring and yjs-crypto.ts wiring (pending E-01 resolution) -->
| Artifact | Consumer | Shape |
|---|---|---|
| `/socket.io` endpoint (port 4001) | `apps/atlas-app` collab client | Socket.IO 4.x events: `SCENE_UPDATE`, `MAP_CAMERA_UPDATE`, `CURSOR`, `COMMENT` |
| `/yjs/:roomId` endpoint (port 4001) | `packages/data` YjsLayer client | y-websocket binary frames |
| `CollabState` in `apps/atlas-app/state/collab.ts` | Phase 6 multi-tenant auth | Typed collab context + room lifecycle hooks |
| Redis adapter pattern | Phase 6 hosted flagship | Documented `REDIS_URL` env var wires `@socket.io/redis-adapter` in prod |
| `yjs-crypto.ts` stub API (`encryptUpdate`/`decryptUpdate`) | Phase 6 E-01 resolution | Stub exists and is tested; Phase 6 must wire if Option B selected; drop if Option A confirmed |
| `setPersistence` hook stub (comment in `yjs-server.ts`) | Phase 6 storage wiring | Phase 6 must wire `setPersistence({ bindState, writeState })` to storage API `/api/maps/:id`; in-memory TTL eviction in Phase 5 is the placeholder |
| Threat-model ADR (`decisions/0007-yjs-e2ee-threat-model.md`) | Phase 6 E-01 gate | Must be written and reviewed before Phase 5 ships; Phase 6 closes E-01 gate on reading it |

---

## Flow Map Preamble

The critical path through a collaborative session:

```
User opens room URL
  → Fragment parser extracts roomId + AES key from `#room=ROOM_ID,KEY`
  → collabState.connect(roomId, key) called
      ├── Socket.IO connection to ws://host:4001/socket.io
      │     joins room, receives SCENE_UPDATE (encrypted), applies LWW merge
      └── y-websocket connection to ws://host:4001/yjs/ROOM_ID (separate TCP)
            → y-protocols sync: server sends state vector, client sends diff
            → catch-up completes (potentially MB — isolated from Socket.IO)
  → Both connections live
      ├── Socket.IO: CURSOR events at 60Hz (plaintext, relay dedupes)
      │             MAP_CAMERA_UPDATE at 30Hz (plaintext)
      │             SCENE_UPDATE on Excalidraw mutations (AES-GCM encrypted)
      │             COMMENT on annotation writes (AES-GCM encrypted)
      └── y-websocket: DATA_LAYER_OP as Yjs binary updates (AES-GCM encrypted)
  → Concurrent edits
      ├── Excalidraw channel: LWW on element id — last writer wins per element
      └── Yjs channel: CRDT merge — both ops preserved; geometry Y.Array handles
                       concurrent vertex edits without data loss
  → User A undoes after User B edits
      → Yjs UndoManager scope: per-user origin — A's undo reverts A's ops only
      → Socket.IO scene: undo issues a new SCENE_UPDATE; B's elements untouched
  → `[realtime] enabled = false` path
      → collabState never calls connect(); collab UI components hidden via feature flag
      → Single-player functions identically to Phase 4
```

Two connections per client, same Node process, same port. Head-of-line blocking between Yjs catch-up and cursor events is eliminated by the TCP split (Q9).

---

## File Structure

<!-- shape-incorporated 2026-05-03: annotate yjs-crypto.ts as stub; add ADR file; note persistence-bindstate.ts is Phase 6 scope not Phase 5 -->
```
apps/realtime/
  src/
    index.ts                  — Entry: creates http.Server, mounts Socket.IO + y-websocket handler
    socket-io-server.ts       — Socket.IO setup: room join/leave, event handlers per §5.1
    yjs-server.ts             — y-websocket server: setupWSConnection per roomId path param; TTL eviction wrapper
                                  // TODO Phase 6: replace TTL eviction with setPersistence({ bindState, writeState }) wired to /api/maps/:id
    redis-adapter.ts          — Optional: loads @socket.io/redis-adapter when REDIS_URL is set
    rate-limit.ts             — Per-connection message-size cap + event-rate limiter
    health.ts                 — GET /health → {"status":"ok","connections":N}
  Dockerfile
  package.json

packages/protocol/
  src/
    realtime-events.ts        — Canonical event-type union + payload shapes (consumed by relay + client)
    room-key.ts               — Fragment parser: extracts roomId + base64 AES key from URL hash

packages/data/
  src/
    yjs-layer.ts              — YjsLayer class: Y.Doc, Y.Map<FeatureId, Y.Map<...>>, Y.Array geometry
    yjs-crypto.ts             — [STUB — Phase 5] AES-GCM encrypt/decrypt API (encryptUpdate/decryptUpdate);
                                  NOT wired into y-websocket path; pending E-01 maintainer decision.
                                  Phase 6 wires if Option B selected; drops if Option A confirmed.
    yjs-snapshot.ts           — Projection: YjsLayer → GeoJSON FeatureCollection (read-only snapshot)
    ~~persistence-bindstate.ts~~ — [OUT OF PHASE 5 SCOPE] Phase 6 deliverable only; do not create in Phase 5.

apps/atlas-app/
  src/
    state/
      collab.ts               — Connection lifecycle: connect/disconnect, room key, feature-flag guard
    components/
      CollabWrapper.tsx        — Renders collab UI (cursor overlays, presence list) or null when disabled
      CursorOverlay.tsx        — SVG cursor layer: username label + colored dot + bounce animation
      PresenceList.tsx         — Sidebar panel: connected users, colors, last-active
    hooks/
      useCollab.ts             — React hook: exposes collabState, peers, localCursor from context
      useYjsLayer.ts           — React hook: binds YjsLayer to React state, triggers re-render on update

infra/
  docker-compose.yml          — Add `realtime` service (port 4001), depends_on web+storage (full stack)
  docker-compose.minimal.yml  — Unchanged — no realtime (Q1: single-player first-class)
  config.toml.example         — Adds [realtime] enabled/ws_url stanza

docs/decisions/
  0007-yjs-e2ee-threat-model.md — [NEW — Wave 0, Task 0] Threat-model ADR: server-trusted relay scope,
                                    E-01 Option C rationale, Phase 6 evaluation commitment.
                                    Must be written before Phase 5 ships.

tests/
  e2e/
    collab-convergence.spec.ts — Two browser contexts, concurrent vertex edits, assert convergence
    collab-stress.spec.ts      — 5MB Yjs initial state, assert cursor frame rate >30fps during catch-up
```

---

## Tasks

---

<!-- shape-incorporated 2026-05-03: new Task 0 — write threat-model ADR before any Phase 5 code ships; constraint-setting deliverable for E-01 Option C -->
<!-- scrub-note 2026-05-11: ADR shipped at docs/architecture/adr/0010-yjs-e2ee-threat-model.md (NOT docs/decisions/0007-...). Path drift: plan was authored 2026-05-03 before Phase 4 established docs/architecture/adr/ as the ADR home (ADRs 0006-0009 land there). Numbering bumped to 0010 to avoid collision with ADR-0007 (storage-dual-mode). Task 0 Step 1 substantively complete; remaining Task 0 follow-ups: review-before-Phase-5-dispatch, Task 2's [realtime] config block needs an ADR-0010 reference comment, and self-host README + production.md need "What the relay can see" disclosure paragraph. E-01 closed Option C 2026-05-11; E-02 unblocked. -->
### Task 0: decisions/ — Yjs E2EE Threat-Model ADR [CHANGE SITE]

**Orient:** Write the ADR documenting the server-trusted relay scope for Phase 5 and committing Phase 6 to evaluate Option B. This is a constraint-setting deliverable — it must exist before Phase 5 ships so the threat model is honest and on record. Required by E-01 gate condition (see `docs/decisions/escalations.md`).
**Flow position:** Step 0 of Wave 0 (serial, before all code tasks)
**Upstream contract:** None — this is a founding document.
**Downstream contract:** Produces `decisions/0007-yjs-e2ee-threat-model.md`; unlocks Task 8 stub execution; forms the Phase 6 gate reference for E-01 resolution.
**Skill:** `none`
**Files:**
- Create: `docs/decisions/0007-yjs-e2ee-threat-model.md`

- [ ] **Step 1: Write ADR** documenting:
  - Context: `setupWSConnection` conflict with Yjs payload encryption (E-01 finding).
  - Decision: Option C — Phase 5 ships server-trusted Yjs relay; `yjs-crypto.ts` stub only; Option B deferred.
  - Scope statement: relay process can read plaintext Yjs data-layer ops in Phase 5. `SCENE_UPDATE` and `COMMENT` remain E2EE via Socket.IO (Task 10).
  - Consequences: Phase 6 must evaluate Option B; if selected, replace `setupWSConnection` with custom log-replay handler and wire `yjs-crypto.ts`; if rejected, close E-01 with explicit ADR amendment.
  - Gate: ADR reviewed and merged before Phase 5 ships. Task 8 may proceed as stub; wiring requires E-01 gate closure.

- [ ] **Step 2: Verify file exists**

Run: `ls docs/decisions/0007-yjs-e2ee-threat-model.md`
Expected: file present, non-empty

---

### Task 1: Wire Protocol — Event Type Contracts [CHANGE SITE]

**Orient:** Define the canonical wire-protocol types that every other Phase 5 task imports; without these, relay and client diverge on payload shape.
**Flow position:** Step 1 of 1 in wire-protocol-contracts (entry point → **event-types** → all downstream tasks)
**Upstream contract:** None; this is the root of the dependency tree.
**Downstream contract:** Produces `CollabEvent` union + payload interfaces consumed by Tasks 3, 5, 6, 7, 8.
**Skill:** `none`
**Files:**
- Create: `packages/protocol/src/realtime-events.ts`
- Create: `packages/protocol/src/room-key.ts`
- Modify: `packages/protocol/package.json` (add exports)

- [ ] **Step 1:** Define `CollabEvent` discriminated union in `realtime-events.ts`: `SCENE_UPDATE`, `MAP_CAMERA_UPDATE`, `CURSOR`, `COMMENT`. Each payload typed with roomId, senderId, timestamp, and data field. `SCENE_UPDATE` data is `{ iv: string; ciphertext: string }` (AES-GCM). `MAP_CAMERA_UPDATE` data is `{ lng: number; lat: number; zoom: number; bearing: number }` (plaintext). `CURSOR` data is `{ x: number; y: number; color: string; username: string }` (plaintext). `COMMENT` data is `{ iv: string; ciphertext: string; version: number }` (versioned LWW, AES-GCM).

- [ ] **Step 2:** Define `RoomKey` type in `room-key.ts`: `{ roomId: string; key: CryptoKey }`. Add `parseRoomFragment(hash: string): RoomKey | null` — splits on comma, decodes base64url, imports as `CryptoKey` via Web Crypto API.

- [ ] **Step 3:** Add `[realtime]` config schema type `RealtimeConfig = { enabled: boolean; wsUrl?: string }`. Export from `realtime-events.ts`.

- [ ] **Step 4: Verify types compile**

Run: `pnpm -F @atlasdraw/protocol tsc --noEmit`
Expected: 0 errors, 0 warnings

---

### Task 2: Config Schema — Realtime Feature Flag [CHANGE SITE]

**Orient:** Wire the `[realtime] enabled` flag into atlas-app's config reader so every UI component has a single boolean to branch on (Q1).
**Flow position:** Step 1 of 2 in config-load (config.toml → **config-reader** → collab.ts)
**Upstream contract:** Receives `RealtimeConfig` type from Task 1.
**Downstream contract:** Produces `getRealtimeConfig(): RealtimeConfig` used by Task 7 (`collab.ts`).
**Skill:** `none`
**Files:**
- Modify: `apps/atlas-app/src/config.ts` (add `realtime` field)
- Modify: `infra/config.toml.example` (add `[realtime]` stanza)

- [ ] **Step 1:** Add `realtime: RealtimeConfig` to the existing `AppConfig` type. Default: `{ enabled: false }`. When `VITE_WS_URL` is absent, `wsUrl` is `undefined`.

- [ ] **Step 2:** Update `config.toml.example` with commented-out `[realtime]` block:
```
# [realtime]
# enabled = true
# ws_url = "ws://localhost:4001"
```

- [ ] **Step 3:** Verify config loads without ws_url set

Run: `pnpm -F @atlasdraw/atlas-app vitest run config.test.ts`
Expected: PASS — `getRealtimeConfig().enabled === false` and no crash on missing wsUrl

---

### Task 3: apps/realtime — Server Skeleton [CHANGE SITE]

**Orient:** Bootstrap the `apps/realtime` Node process (forked from excalidraw-room) with health endpoint and two mount points: `/socket.io` and `/yjs/:roomId` — the structural skeleton that Tasks 5 and 6 fill in.
**Flow position:** Step 1 of 3 in relay-server (fork → **skeleton** → handlers)
**Upstream contract:** Receives `CollabEvent` types from Task 1.
**Downstream contract:** Produces a running Node process on port 4001 with `GET /health` responding `{"status":"ok"}`.
**Skill:** `none`
**Files:**
- Create: `apps/realtime/src/index.ts`
- Create: `apps/realtime/src/health.ts`
- Create: `apps/realtime/package.json`
- Create: `apps/realtime/Dockerfile`

- [ ] **Step 1:** Create `index.ts` — `http.createServer()`, mount Socket.IO and register the y-websocket upgrade handler on the same `httpServer`. Port from `PORT` env, default `4001`. Import `@atlasdraw/protocol` for event types.

- [ ] **Step 2:** Create `health.ts` — plain HTTP route on `/health`, returns `{"status":"ok","connections":N}` where N is current Socket.IO connected count.

- [ ] **Step 3:** Create minimal `package.json` declaring `name: "@atlasdraw/realtime"`, dependencies: `socket.io`, `ws`, `y-websocket`, `y-protocols`, `ioredis`, `@socket.io/redis-adapter`.

- [ ] **Step 4:** Create `Dockerfile` — `node:20-alpine`, copy and install, `CMD ["node", "dist/index.js"]`.

- [ ] **Step 5: Start server and ping health**

Run: `pnpm -F @atlasdraw/realtime dev & sleep 2 && curl -s http://localhost:4001/health`
Expected: `{"status":"ok","connections":0}`

---

### Task 4: packages/data — YjsLayer Type Model [CHANGE SITE]

**Orient:** Define the Yjs document structure so every data-layer feature is a CRDT-native `Y.Map` and every polygon's coordinate ring is a `Y.Array` — the canonical mutable layer type (Q2).
**Flow position:** Step 1 of 3 in data-layer-crdt (type-model → **YjsLayer** → snapshot-projection)
**Upstream contract:** Receives `LayerRegistry` shape from Phase 2 and `GeoAnchor` from `packages/geo`.
**Downstream contract:** Produces `YjsLayer` class exported from `@atlasdraw/data` consumed by Tasks 8, 9, and convergence test.
**Codebooks:** `distributed-state-sync`
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/yjs-layer.ts`
- Create: `packages/data/src/yjs-snapshot.ts`
- Create: `packages/data/tests/yjs-layer.test.ts`

- [ ] **Step 1: Write failing test — YjsLayer basic structure**

Run: `pnpm -F @atlasdraw/data vitest run yjs-layer.test.ts`
Expected: FAIL — "YjsLayer is not defined"

- [ ] **Step 2: Implement YjsLayer**
  - `Y.Doc` as root. Top-level map: `ydoc.getMap<Y.Map<...>>('layers')`.
  - Per-layer `Y.Map<string, Y.Map<...>>` keyed by `FeatureId`.
  - Per-feature `Y.Map`: `type` (string), `properties` (nested `Y.Map`), `geometry` (`Y.Map` with `type` string + `coordinates` as `Y.Array<Y.Array<[number, number]>>`).
  - Exported helpers: `addFeature`, `deleteFeature`, `setProperty`, `appendVertex`, `deleteVertex`.

- [ ] **Step 3: Implement YjsSnapshot**
  - `toGeoJSON(layer: Y.Map<...>): FeatureCollection` — read-only projection, does not mutate.
  - Subscribe: `layer.observe(handler)` → calls `toGeoJSON` and emits update event.

- [ ] **Step 4: Run test to verify passes**

Run: `pnpm -F @atlasdraw/data vitest run yjs-layer.test.ts`
Expected: PASS — addFeature creates feature; deleteFeature removes; concurrent appendVertex on same array from two Y.Doc replicas merges without data loss

---

### Task 5: apps/realtime — Socket.IO Event Handlers [CHANGE SITE]

**Orient:** Implement the four Socket.IO event handlers — `SCENE_UPDATE` (LWW), `MAP_CAMERA_UPDATE` (throttled 30Hz LWW), `CURSOR` (throttled 60Hz LWW), `COMMENT` (versioned LWW) — relay-only, never decrypts.
**Flow position:** Step 2 of 3 in relay-server (skeleton → **socket-io-handlers** → encryption-layer)
**Upstream contract:** Receives `CollabEvent` union from Task 1; runs on skeleton from Task 3.
**Downstream contract:** Produces relay that broadcasts each event to room members minus sender; enforces rate limits.
**Codebooks:** `flow-control-backpressure`
**Skill:** `adversarial-api-testing`
**Files:**
- Create: `apps/realtime/src/socket-io-server.ts`
- Create: `apps/realtime/src/rate-limit.ts`

- [ ] **Step 1: Write rate-limit.ts**
  - Per-socket message counter, reset every 100ms.
  - `CURSOR` max 60/s; `MAP_CAMERA_UPDATE` max 30/s; `SCENE_UPDATE` max 10/s; `COMMENT` max 5/s.
  - Max message payload: 256KB for `SCENE_UPDATE`; 1KB for `CURSOR`/`MAP_CAMERA_UPDATE`; 64KB for `COMMENT`.
  - Silently drop out-of-rate messages; log at WARN level with socket id and event type.

- [ ] **Step 2: Implement socket-io-server.ts**
  - `io.on('connection', socket)` — socket joins named room on `JOIN_ROOM` event.
  - `SCENE_UPDATE`: validate payload has `iv` + `ciphertext` fields; relay to room, skip sender.
  - `MAP_CAMERA_UPDATE`: LWW by timestamp; relay to room.
  - `CURSOR`: relay immediately to room, no LWW needed.
  - `COMMENT`: LWW by `version` field; relay to room.
  - `LEAVE_ROOM` / `disconnect`: remove from room, emit `PEER_LEFT` with peerId.
  - Never inspect encrypted payloads — relay is dumb (§4.8).

- [ ] **Step 3: Verify handler wiring with integration test**

Run: `pnpm -F @atlasdraw/realtime test:integration`
Expected: PASS — two connected sockets; socket A emits `SCENE_UPDATE`; socket B receives it; socket A does not receive its own broadcast; rate-limit drop on 70 rapid CURSOR events emits only 60

---

<!-- shape-incorporated 2026-05-03: verify OQ-2 TTL eviction remains folded into Task 6 Step 1 — confirmed; no split needed -->
### Task 6: apps/realtime — y-websocket Integration [CHANGE SITE]

**Orient:** Mount the y-websocket `setupWSConnection` handler on the HTTP server's upgrade event for paths matching `/yjs/:roomId`, creating a separate TCP stream for Yjs binary sync (Q9).
**Flow position:** Step 3 of 3 in relay-server (skeleton → **yjs-server** → yjs-layer-client)
**Upstream contract:** Receives `http.Server` from Task 3; `y-websocket` package provides `setupWSConnection`.
**Downstream contract:** Produces `/yjs/:roomId` endpoint that handles y-protocols sync + awareness; rooms are in-memory by default.
**Codebooks:** `distributed-state-sync`
**Skill:** `none`
**Files:**
- Create: `apps/realtime/src/yjs-server.ts`

- [ ] **Step 1: Implement yjs-server.ts**
  - Import `setupWSConnection` from `y-websocket/bin/utils`.
  - On `httpServer.on('upgrade', ...)`, check `req.url` matches `/yjs/` prefix.
  - Extract `roomId` from URL path; pass as `docName` to `setupWSConnection`.
  - Let y-websocket manage the `Y.Doc` lifecycle per room (in-process map, no persistence at relay level — relay is dumb).
  - **OQ-2 (TTL eviction):** After `setupWSConnection`, register a last-disconnect callback. On last client leaving, schedule `setTimeout(evict, ROOM_TTL_MS)` (env default `300_000`). On expiry: `ydoc.destroy()`, remove from docs map, log `WARN [realtime] room ${docName} evicted after TTL=${ROOM_TTL_MS}ms (no persistence wired)`.
  - // TODO Phase 6: replace TTL eviction with `setPersistence({ bindState, writeState })` from `@y/websocket-server/utils` wired to storage API `/api/maps/:id`.

- [ ] **Step 2: Verify two clients sync via y-websocket**

Run: `pnpm -F @atlasdraw/realtime test:yjs-integration`
Expected: PASS — client A inserts into `Y.Map`; client B observes the mutation within 100ms; no Socket.IO events involved

---

### Task 7: apps/atlas-app — CollabState Lifecycle [CHANGE SITE]

**Orient:** Implement `collab.ts` — the single gatekeeper that opens/closes both WS connections, reads the room key from the URL fragment, and degrades gracefully when `[realtime] enabled = false` (Q1).
**Flow position:** Step 1 of 3 in client-collab (config → **collab-state** → UI components)
**Upstream contract:** Receives `RealtimeConfig` from Task 2; `RoomKey` parser from Task 1; `YjsLayer` from Task 4.
**Downstream contract:** Produces `CollabState` context consumed by `CollabWrapper`, `useCollab`, `useYjsLayer` (Tasks 10–12).
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/src/state/collab.ts`
- Create: `apps/atlas-app/src/hooks/useCollab.ts`

- [ ] **Step 1: Implement CollabState class**
  - Constructor reads `RealtimeConfig`; if `enabled === false`, sets `active = false` and returns immediately.
  - `connect(roomId, key)`: opens `io(wsUrl)` Socket.IO client; opens `new WebSocket(wsUrl + '/yjs/' + roomId)` for Yjs.
  - `disconnect()`: closes both connections, destroys `Y.Doc`.
  - Exposes: `peers: Map<string, PeerMeta>`, `localCursor: CursorState`, `yjsDoc: Y.Doc | null`.
  - On `PEER_LEFT` event from Socket.IO: remove from `peers`.
  - **OQ-5 (per-client camera):** On receiving `MAP_CAMERA_UPDATE`: store remote camera in `peers.get(senderId).camera` for overlay rendering. Do NOT call `map.jumpTo()` or equivalent on the local map. Comment: `// MAP_CAMERA_UPDATE: update peer viewport overlay only; do NOT apply to local camera.`

- [ ] **Step 2: Implement useCollab hook** — wraps `CollabState` in React context; returns `{ active, peers, localCursor, connect, disconnect }`.

- [ ] **Step 3: Verify opt-in guard**

Run: `pnpm -F @atlasdraw/atlas-app vitest run collab.test.ts`
Expected: PASS — with `enabled: false`, `CollabState.active === false`, no WebSocket constructor called; with `enabled: true` and `VITE_WS_URL` set, Socket.IO client constructed

---

<!-- shape-incorporated 2026-05-03: confirm Task 8 BLOCKED on E-01 gate; stub-only scope confirmed under provisional Option C; no wiring into y-websocket path in Phase 5 -->
### Task 8: packages/data — Yjs AES-GCM Encryption Layer [CHANGE SITE]

> **BLOCKED — OQ-1 project-level decision required.** See OQ-1 RESOLVED note above.
> Executing this task as originally scoped (wiring `yjs-crypto.ts` into the y-websocket update path) **breaks server-side Y.Doc state** because `setupWSConnection` applies inner update bytes to a server `Y.Doc`. Encrypted bytes corrupt the server doc. The task must not be executed until the maintainer selects Option (A), (B), or (C) from OQ-1. Recommended: Option (C) — defer wiring; implement `yjs-crypto.ts` as a stub only.

**Orient:** Encrypt Yjs binary updates with AES-GCM on the same room key used for scene payloads, so the relay never sees plaintext layer data (§5.3).
**Flow position:** Step 2 of 3 in data-layer-crdt (YjsLayer → **yjs-crypto** → yjs-server relay)
**Upstream contract:** Receives `CryptoKey` from `RoomKey` (Task 1); Yjs `Uint8Array` updates from `YjsLayer` (Task 4).
**Downstream contract (Option C — deferred):** Creates `yjs-crypto.ts` with `encryptUpdate`/`decryptUpdate` API; does NOT wire into y-websocket path in Phase 5. Wiring is Phase 6 scope (contingent on OQ-1 Option B selection) or dropped (if Option A).
**Downstream contract (Option B — if selected):** Produces encrypted `{ iv: string; ciphertext: string }` blob sent to relay; custom relay handler stores opaque blobs; decrypts on receive before applying to local `Y.Doc`.
**Skill:** `none`
**Files:**
- Create: `packages/data/src/yjs-crypto.ts`
- Create: `packages/data/tests/yjs-crypto.test.ts`

- [ ] **Step 0: GATE — confirm OQ-1 decision with maintainer before proceeding.**

- [ ] **Step 1: Write failing test**

Run: `pnpm -F @atlasdraw/data vitest run yjs-crypto.test.ts`
Expected: FAIL — "encryptUpdate is not defined"

- [ ] **Step 2: Implement yjs-crypto.ts (stub — not wired into y-websocket path under Option C)**
  - `encryptUpdate(update: Uint8Array, key: CryptoKey): Promise<{iv: string; ciphertext: string}>` — uses `crypto.subtle.encrypt` with AES-GCM, random 12-byte IV, base64url encodes both fields.
  - `decryptUpdate(payload: {iv: string; ciphertext: string}, key: CryptoKey): Promise<Uint8Array>` — inverse.
  - File is created and tested but NOT imported by `yjs-server.ts` or `CollabState` in Phase 5 (Option C).

- [ ] **Step 3: Run test to verify passes**

Run: `pnpm -F @atlasdraw/data vitest run yjs-crypto.test.ts`
Expected: PASS — round-trip: encrypt then decrypt returns original Uint8Array; wrong key throws DOMException

---

### Task 9: apps/atlas-app — useYjsLayer Hook [CHANGE SITE]

**Orient:** Bind `YjsLayer` to React state so that CRDT mutations (local or remote) trigger re-renders and the map re-projects the updated GeoJSON snapshot.
**Flow position:** Step 3 of 3 in data-layer-crdt (YjsLayer → **useYjsLayer** → map render)
**Upstream contract:** Receives `Y.Doc` from `CollabState` (Task 7); `toGeoJSON` from `yjs-snapshot.ts` (Task 4).
**Downstream contract:** Produces `{ features: FeatureCollection; mutate: LayerMutators }` consumed by existing map components.
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/src/hooks/useYjsLayer.ts`
- Modify: `apps/atlas-app/src/components/MapEditor.tsx` (swap layer source to useYjsLayer when collab active)

- [ ] **Step 1: Implement useYjsLayer**
  - Subscribe to `ydoc.getMap('layers').observe(...)`.
  - On each observe event, call `toGeoJSON(layerMap)` and `setState`.
  - Return memoized `mutate` object wrapping `addFeature`, `deleteFeature`, `setProperty`, `appendVertex`, `deleteVertex`.

- [ ] **Step 2: Wire into MapEditor.tsx**
  - When `collabState.active === true`, use `useYjsLayer` as the layer data source.
  - When `collabState.active === false`, use existing local `LayerRegistry` source.
  - No behavior change for single-player deployments.

- [ ] **Step 3: Verify GeoJSON updates on remote Yjs op**

Run: `pnpm -F @atlasdraw/atlas-app vitest run useYjsLayer.test.ts`
Expected: PASS — simulate remote Y.Doc update via `Y.applyUpdate`; hook state updates within one render cycle; snapshot contains inserted feature

---

### Task 10: apps/atlas-app — Scene Encryption Adapter [CHANGE SITE]

**Orient:** Wrap the existing Excalidraw `SCENE_UPDATE` emit/receive path with AES-GCM encryption using the room key, matching Excalidraw's existing E2EE model (§5.3).
**Flow position:** Step 1 of 2 in encryption-layer (room-key → **scene-crypto** → scene-relay)
**Upstream contract:** Receives `CryptoKey` from `RoomKey` (Task 1); Excalidraw scene diff bytes.
**Downstream contract:** Produces `{iv, ciphertext}` payload on emit; decrypts to `ExcalidrawElement[]` on receive; camera/cursor bypass encryption.
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/src/collab/scene-crypto.ts`
- Modify: `apps/atlas-app/src/state/collab.ts` (integrate scene-crypto on emit/receive)

- [ ] **Step 1: Implement scene-crypto.ts**
  - `encryptScene(elements: ExcalidrawElement[], key: CryptoKey): Promise<{iv: string; ciphertext: string}>` — JSON serialize, then AES-GCM encrypt.
  - `decryptScene(payload: {iv: string; ciphertext: string}, key: CryptoKey): Promise<ExcalidrawElement[]>` — inverse.
  - `MAP_CAMERA_UPDATE` and `CURSOR` pass through unencrypted (per §5.3 limitation).

- [ ] **Step 2: Verify round-trip**

Run: `pnpm -F @atlasdraw/atlas-app vitest run scene-crypto.test.ts`
Expected: PASS — encrypted payload is opaque binary; decrypt with same key returns equal element array; decrypt with wrong key throws

---

### Task 11: apps/atlas-app — Cursor Presence UI [CHANGE SITE]

**Orient:** Render other users' cursors as colored SVG dots with username labels, animating a brief bounce on draw events, so collaborators have spatial awareness without intrusive UI.
**Flow position:** Step 2 of 3 in client-collab (collab-state → **cursor-presence** → presence-list)
**Upstream contract:** Receives `peers: Map<string, PeerMeta>` with `{x, y, color, username, lastDrawAt}` from `CollabState` (Task 7).
**Downstream contract:** Produces `CursorOverlay` and `PresenceList` components consumed by `CollabWrapper`.
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/src/components/CursorOverlay.tsx`
- Create: `apps/atlas-app/src/components/PresenceList.tsx`
- Create: `apps/atlas-app/src/components/CollabWrapper.tsx`

- [ ] **Step 1: Implement CursorOverlay.tsx**
  - Absolutely positioned `<svg>` layer, `pointer-events: none`, covers the canvas.
  - Per peer: colored `<circle>` at `{x, y}`, `<text>` label above.
  - Bounce animation: CSS keyframe `collab-cursor-bounce` triggered when `lastDrawAt` changes within 500ms.

- [ ] **Step 2: Implement PresenceList.tsx**
  - Compact sidebar widget: colored avatar dot + truncated username per peer.
  - Shows "N collaborators" header; collapses to icons at ≥4 peers.

- [ ] **Step 3: Implement CollabWrapper.tsx**
  - Returns `null` when `collabState.active === false` (Q1: collab UI entirely hidden when disabled).
  - When active: renders `<CursorOverlay>` + `<PresenceList>`.

- [ ] **Step 4: Visual smoke test**

Run: `pnpm -F @atlasdraw/atlas-app storybook -- --ci`
Expected: CursorOverlay story renders two cursors; PresenceList story renders two users; CollabWrapper returns null when `active=false`

---

### Task 12: Undo Behavior Under Distributed State [CHANGE SITE]

**Orient:** Define and implement the correct undo semantics when User A undoes after User B has edited — Yjs UndoManager must scope to local-origin ops only so A's undo never silently removes B's work.
**Flow position:** Step 3 of 3 in client-collab (collab-state → **undo-behavior** → user action)
**Upstream contract:** Receives `Y.Doc` + `YjsLayer` mutators from Tasks 4 and 7.
**Downstream contract:** Produces `CollabUndoManager` with `undo()`/`redo()` wired into Excalidraw's existing undo stack; specifies behavior contract for `SCENE_UPDATE` undo.
**Codebooks:** `undo-under-distributed-state`
**Skill:** `none`
**Files:**
- Create: `packages/data/src/collab-undo-manager.ts`
- Modify: `apps/atlas-app/src/state/collab.ts` (register undo manager on connect)
- Create: `packages/data/tests/collab-undo-manager.test.ts`

- [ ] **Step 1: Write failing tests for undo scoping**
  - Test A: User A mutates, User B mutates, User A undoes → A's mutation gone, B's mutation present.
  - Test B: User A undoes with empty local stack → no-op, no error.
  - Test C: User A redoes after undo → A's mutation restored without touching B's state.

Run: `pnpm -F @atlasdraw/data vitest run collab-undo-manager.test.ts`
Expected: FAIL — "CollabUndoManager is not defined"

- [ ] **Step 2: Implement CollabUndoManager**
  - Wrap `Y.UndoManager` with `trackedOrigins: [localOrigin]` where `localOrigin` is the client's socket id.
  - All local mutations tagged with `ydoc.transact(fn, localOrigin)`.
  - Remote updates (from relay) arrive without origin tag — UndoManager ignores them automatically.
  - Expose `undo()`, `redo()`, `canUndo: boolean`, `canRedo: boolean`.
  - For `SCENE_UPDATE` channel (Excalidraw LWW): undo issues a new forward `SCENE_UPDATE` reverting only local elements; any element last-written by a remote peer is untouched.

- [ ] **Step 3: Run tests to verify**

Run: `pnpm -F @atlasdraw/data vitest run collab-undo-manager.test.ts`
Expected: PASS — all three scoping scenarios pass

---

### Task 13: apps/realtime — Adversarial Relay Hardening [CHANGE SITE]

**Orient:** Harden the relay against rate-abuse, oversized messages, and room ID hijacking before any E2E or stress tests run, so security properties are verified in isolation.
**Flow position:** Step 1 of 2 in security (relay-handlers → **hardening** → integration-test)
**Upstream contract:** Receives Socket.IO handlers from Task 5 and rate-limit.ts.
**Downstream contract:** Produces a relay that survives automated adversarial probes with no memory leak, no crash, and correct rejection codes.
**Skill:** `adversarial-api-testing`
**Files:**
- Modify: `apps/realtime/src/rate-limit.ts` (add size-enforcement + room-ownership check)
- Create: `apps/realtime/tests/adversarial.test.ts`

- [ ] **Step 1: Add message-size enforcement**
  - On each Socket.IO `data` event, check `Buffer.byteLength(JSON.stringify(payload))` against per-type caps.
  - Exceeds cap: disconnect socket with code `4008 MESSAGE_TOO_LARGE`, log socket id + size.

- [ ] **Step 2: Add room hijacking guard**
  - Room IDs are UUIDs generated client-side; the relay does not validate ownership.
  - Mitigation: max 4 concurrent sockets per room (configurable `MAX_ROOM_SIZE`, default 4).
  - 5th join attempt receives `ROOM_FULL` error event, not silent admission.

- [ ] **Step 3: Run adversarial test suite**

Run: `pnpm -F @atlasdraw/realtime test:adversarial`
Expected: PASS — 1MB `SCENE_UPDATE` causes disconnect with `4008`; room with 5 joiners rejects 5th with `ROOM_FULL`; 200 rapid `CURSOR` events from one socket: 60 relayed, 140 dropped, no crash; server still responds `{"status":"ok"}` on `/health`

---

### Task 14: infra — Docker Compose Realtime Service [CHANGE SITE]

**Orient:** Add the `realtime` service to `docker-compose.yml` (full stack) only; leave `docker-compose.minimal.yml` unchanged, preserving the single-player deployment path (Q1, Q10).
**Flow position:** Step 1 of 1 in infra-wiring (existing compose → **add-realtime** → integration test)
**Upstream contract:** Receives `apps/realtime/Dockerfile` from Task 3.
**Downstream contract:** Produces full-stack compose with realtime on port 4001; minimal compose unchanged.
**Skill:** `none`
**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `infra/config.toml.example`

- [ ] **Step 1:** Add `realtime` service to `docker-compose.yml`:
  - Build from `../apps/realtime`
  - Port `4001:4001`
  - `depends_on: [web, storage]`
  - Environment: `PORT=4001`, `REDIS_URL` defaulting to empty string (adapter only loads when non-empty)

- [ ] **Step 2:** Verify `docker-compose.minimal.yml` is unchanged

Run: `grep -c realtime infra/docker-compose.minimal.yml`
Expected: `0`

- [ ] **Step 3:** Verify full stack starts

Run: `docker compose -f infra/docker-compose.yml up --build --detach && sleep 5 && curl -s http://localhost:4001/health`
Expected: `{"status":"ok","connections":0}`

---

### Task 15: apps/realtime — Optional Redis Adapter [CHANGE SITE]

**Orient:** Wire `@socket.io/redis-adapter` as an opt-in adapter loaded only when `REDIS_URL` is present in env, enabling multi-instance horizontal scaling for the Phase 6 hosted flagship without changing single-instance behavior.
**Flow position:** Step 1 of 1 in redis-adapter (relay-server → **redis-optional** → Phase 6 multi-tenant)
**Upstream contract:** Receives `io: Server` from Task 3's `socket-io-server.ts`.
**Downstream contract:** Produces relay that behaves identically with and without `REDIS_URL`; when set, Socket.IO rooms fan out across instances via Redis pub/sub.
**Skill:** `none`
**Files:**
- Create: `apps/realtime/src/redis-adapter.ts`
- Modify: `apps/realtime/src/index.ts` (call `attachRedisAdapterIfConfigured(io)`)

- [ ] **Step 1: Implement redis-adapter.ts**
  - `attachRedisAdapterIfConfigured(io: Server): void`
  - If `process.env.REDIS_URL` is falsy, return immediately (logs `[realtime] Redis adapter disabled`).
  - Otherwise: `createClient({ url })` with ioredis, create pub/sub pair, `io.adapter(createAdapter(pubClient, subClient, { key: 'atlasdraw:sio' }))`.
  - **OQ-4 (resolved):** Channel prefix `atlasdraw:sio` is set via the `key` option on `createAdapter` (default would be `socket.io`). `atlasdraw:yjs:*` is reserved for Phase 6 Yjs persistence channels on the same Redis instance — no collision possible with this configuration.

- [ ] **Step 2: Verify no-Redis path is default**

Run: `REDIS_URL= pnpm -F @atlasdraw/realtime dev & sleep 2 && curl -s http://localhost:4001/health`
Expected: `{"status":"ok","connections":0}` with log line `[realtime] Redis adapter disabled`

---

### Task 16: E2E — Concurrent Vertex Edit Convergence Test [CHANGE SITE]

**Orient:** Prove CRDT correctness by having two browser contexts concurrently edit different vertices of the same polygon and asserting that both edits survive the merge — the primary no-data-loss guarantee.
**Flow position:** Step 1 of 2 in e2e-tests (full-stack → **convergence-test** → stress-test)
**Upstream contract:** Requires full stack from Task 14; `YjsLayer` from Task 4; collab client from Task 7.
**Downstream contract:** Produces a passing Playwright spec that CI can gate on.
**Codebooks:** `distributed-state-sync`
**Skill:** `none`
**Files:**
- Create: `tests/e2e/collab-convergence.spec.ts`

- [ ] **Step 1: Write convergence spec**
  - `browserContextA` and `browserContextB` each open the same room URL with a shared room key.
  - Wait for both clients to emit `PEER_JOINED`.
  - `contextA` calls `appendVertex` at index 2 of a test polygon.
  - Concurrently (no await between), `contextB` calls `appendVertex` at index 5 of same polygon.
  - Both contexts await their own Yjs observe callbacks.
  - Assert: polygon in `contextA` has both vertices; polygon in `contextB` has both vertices.
  - Assert: no vertex appears twice (no duplication).

- [ ] **Step 2: Run convergence test against full stack**

Run: `docker compose -f infra/docker-compose.yml up -d && pnpm playwright test tests/e2e/collab-convergence.spec.ts`
Expected: PASS — both vertices present in both clients' final state; test completes in <10s

---

### Task 17: E2E — 5MB Yjs Stress Test (Cursor Frame Rate) [CHANGE SITE]

**Orient:** Verify that a large Yjs initial state catch-up (5MB) on the `/yjs/:roomId` connection does not stall cursor events on the Socket.IO connection, validating the Q9 TCP split decision.
**Flow position:** Step 2 of 2 in e2e-tests (convergence-test → **stress-test**)
**Upstream contract:** Requires full stack from Task 14; rate-limit from Task 5.
**Downstream contract:** Produces a passing Playwright spec asserting ≥30fps cursor delivery during Yjs catch-up.
**Codebooks:** `flow-control-backpressure`
**Skill:** `none`
**Files:**
- Create: `tests/e2e/collab-stress.spec.ts`

- [ ] **Step 1: Write stress spec**
  - Generate a synthetic 5MB `Y.Doc` state (e.g., 50k features with 10-vertex polygons), encode via `Y.encodeStateAsUpdate`.
  - Pre-load this state into the relay's in-memory doc for room `stress-test-room` before browser opens.
  - `contextA` joins the room — triggers full Yjs state catch-up on `/yjs/stress-test-room`.
  - Concurrently, `contextB` sends 100 `CURSOR` events at 60Hz to Socket.IO.
  - `contextA` records timestamps of received `CURSOR` events during catch-up period.
  - Assert: minimum inter-event gap among received cursors is ≤33ms (>30fps equivalent).

- [ ] **Step 2: Run stress test**

Run: `docker compose -f infra/docker-compose.yml up -d && pnpm playwright test tests/e2e/collab-stress.spec.ts`
Expected: PASS — cursor delivery ≥30fps throughout 5MB Yjs catch-up window

---

### Task 18: packages/protocol — Awareness Types for y-protocols [CHANGE SITE]

**Orient:** Define the typed awareness state that y-protocols encodes and broadcasts — username, color, viewport bounds — so all clients have a shared schema for presence data.
**Flow position:** Step 2 of 2 in wire-protocol-contracts (event-types → **awareness-types** → cursor-ui)
**Upstream contract:** Receives `y-protocols` encode/decode API.
**Downstream contract:** Produces `AwarenessState` type consumed by `CursorOverlay` (Task 11) and `CollabState` (Task 7).
**Skill:** `none`
**Files:**
- Modify: `packages/protocol/src/realtime-events.ts` (add `AwarenessState` type)

- [ ] **Step 1:** Add `AwarenessState` to protocol:
  - `user: { name: string; color: string }` — set once on connect.
  - `cursor: { x: number; y: number } | null` — null when tab inactive.
  - `viewport: { lng: number; lat: number; zoom: number; bearing: number } | null` — for mini-map awareness.
  - `lastDrawAt: number | null` — epoch ms, drives cursor bounce animation.

- [ ] **Step 2: Verify types compile**

Run: `pnpm -F @atlasdraw/protocol tsc --noEmit`
Expected: 0 errors

---

## Execution Waves

<!-- shape-incorporated 2026-05-03: add Task 0 (ADR write) as serial-first in Wave 0; must complete before any code task ships -->
```
Wave 0 (serial — foundation):
  Task 0  Yjs E2EE Threat-Model ADR (decisions/0007-yjs-e2ee-threat-model.md)
  Task 1  Wire Protocol Event Type Contracts
  Task 2  Config Schema Realtime Feature Flag
  Rationale: Task 0 is a constraint-setting document; must exist before Phase 5 ships (E-01 gate).
             Tasks 1 and 2 provide types and config all subsequent tasks import.
  Gate: ADR file present; both tsc --noEmit checks pass.

Wave 1 (parallel — server skeleton + data layer types):
  Task 3  apps/realtime Server Skeleton       [parallel]
  Task 4  packages/data YjsLayer Type Model   [parallel]
  Task 18 Awareness Types for y-protocols     [parallel]
  Rationale: Task 3 and Task 4 have no mutual dependency; both need Wave 0 types only.
  Gate: /health responds {"status":"ok"}; YjsLayer tests pass; protocol compiles.

Wave 2 (parallel — handlers + client state):
  Task 5  Socket.IO Event Handlers            [parallel]
  Task 6  y-websocket Integration             [parallel]
  Task 7  CollabState Lifecycle               [parallel]
  Task 8  Yjs AES-GCM Encryption Layer        [parallel]
  Rationale: Task 5 and 6 depend on Task 3 skeleton; Tasks 7 and 8 depend on Tasks 1+4.
             Within-wave tasks are independent.
  Gate: Integration tests pass for relay; opt-in guard test passes; crypto round-trip passes.

Wave 3 (parallel — encryption + UX + undo):
  Task 9   useYjsLayer Hook                   [parallel]
  Task 10  Scene Encryption Adapter           [parallel]
  Task 11  Cursor Presence UI                 [parallel]
  Task 12  Undo Behavior Under Distributed State [parallel]
  Rationale: All depend on Wave 2 outputs; all are independent of each other.
  Gate: Storybook smoke test passes; undo scoping tests pass; useYjsLayer hook test passes.

Wave 4 (serial-within-wave — infra then tests):
  Task 13  Adversarial Relay Hardening        [first — hardening before tests]
  Task 14  Docker Compose Realtime Service    [parallel with 13]
  Task 15  Optional Redis Adapter             [parallel with 13+14]
  Task 16  E2E Convergence Test               [after 13+14]
  Task 17  E2E Stress Test                    [after 16 — needs same stack]
  Gate: All adversarial probes pass; convergence test passes; stress test passes.
```

Total waves: 5 (Wave 0–4).

---

## Open Questions

<!-- shape-incorporated 2026-05-03: collapse OQ-1 body to escalations.md pointer — full analysis lives in E-01; maintainer decision pending -->
**OQ-1 — Yjs awareness encryption boundary**

**Escalated to project level — see `docs/decisions/escalations.md` E-01.**

Finding: `setupWSConnection` applies Yjs update bytes directly to a server `Y.Doc`; encrypting the inner payload corrupts the server doc and breaks late-joiner SyncStep2 catch-up. Tasks 6 and 8 are mutually exclusive as originally written.

Provisional scope (Option C, pending E-01 gate closure): Phase 5 ships server-trusted Yjs relay. `yjs-crypto.ts` is a stub (API + tests, not wired). Threat model documented in `decisions/0007-yjs-e2ee-threat-model.md` (Task 0). Task 8 blocked on maintainer confirmation. Phase 6 evaluates Option B.

Full options analysis, gate conditions, and Phase 6 contract: `docs/decisions/escalations.md` § E-01.

**OQ-2 — Yjs relay-side GC and room eviction**
The relay is dumb: it holds an in-memory `Y.Doc` per room via y-websocket's default `docs` map. When the last client disconnects, the room doc remains in memory indefinitely. At moderate scale this leaks. Options: (a) y-websocket provides a `persistence` callback — wire it to the storage API (Phase 4) to flush on last-leave and reload on first-join; (b) evict after a configurable TTL (default 5 minutes). Neither is in-scope for Phase 5, but the plan should note it and log a warning on eviction. Affects Phase 6 multi-tenant.

**RESOLVED:** Source: `y-websocket-server` README (2026-05-03). `@y/websocket-server` exposes `setPersistence({ bindState, writeState })` from `@y/websocket-server/utils`. `writeState(docName, ydoc)` fires **when the last connected client disconnects** — this is the canonical flush hook for Option (a). The default (no `setPersistence`) keeps Y.Doc in memory indefinitely, confirmed as a leak.

For Phase 5 (in-memory relay): implement a TTL eviction wrapper. On last-client-disconnect, schedule `setTimeout(evict, TTL_MS)` (default `300_000` = 5 min, configurable via `ROOM_TTL_MS` env). On expiry, call `ydoc.destroy()` and remove from docs map. Log `WARN [realtime] room ${docName} evicted (no persistence; TTL=${TTL_MS}ms)`. No `setPersistence` wired in Phase 5.

For Phase 6: wire `setPersistence({ bindState: load from /api/maps/:id, writeState: PUT /api/maps/:id })`. Evaluate Hocuspocus as the persistence backend (`y-websocket-server` README recommends it for production over rolling your own). Task 6 Step 1 should add a comment: `// TODO Phase 6: replace TTL eviction with setPersistence({ bindState, writeState }) wired to storage API`.

**OQ-3 — Excalidraw scene LWW on concurrent-create of same element id**
Excalidraw's collab assigns element ids client-side. If two clients create an element within the same sync window, both broadcast `SCENE_UPDATE` with their new element. The relay broadcasts both; each client merges by element id. If ids collide (extremely unlikely with nanoid but not impossible), the second writer's element silently replaces the first. Confirm Excalidraw upstream handles this case; document behavior in `decisions/upstream-patches.md`.

**RESOLVED:** Source: `packages/excalidraw/data/reconcile.ts` `shouldDiscardRemoteElement` (2026-05-03).

Excalidraw's reconcile algorithm on same-id concurrent create:
1. Both clients create element at `version=1`, `versionNonce=random`.
2. Each receives the other's `SCENE_UPDATE`. Merge: `local.version === remote.version` → tiebreak by `versionNonce` (lower wins: `local.versionNonce <= remote.versionNonce` → discard remote).
3. Both clients compute the same comparison (random nonces are fixed per element). **Both converge to the same surviving element.** No corruption, no loop, no silent divergence.

The plan's description ("second writer's element silently replaces the first") is inaccurate — it is a deterministic versionNonce tiebreak, not arrival-order LWW. One element is dropped, but both clients drop the same one. This is acceptable behavior; no upstream patch needed.

Document in `decisions/upstream-patches.md`: "OQ-3 concurrent same-id create — resolved; versionNonce tiebreak in `reconcile.ts:shouldDiscardRemoteElement` is deterministic; no patch required." Room IDs use `crypto.getRandomValues`, making id collision negligible in practice.

**OQ-4 — Redis channel namespace collision between Socket.IO adapter and y-websocket**
`@socket.io/redis-adapter` publishes on `atlasdraw:sio:*` (prefixed in Task 15). If a future y-websocket Redis persistence backend (from OQ-2) is added on the same Redis instance, channel names must not overlap. Establish a naming convention now: `atlasdraw:yjs:*` for any future Yjs persistence channels. Document in `infra/config.toml.example`.

**RESOLVED:** Source: Socket.IO Redis adapter docs v4 (2026-05-03). Default `key` prefix is `"socket.io"`. Configurable via `createAdapter(pubClient, subClient, { key: "atlasdraw:sio" })`.

No collision risk with the proposed naming. Task 15 Step 1 must pass `{ key: "atlasdraw:sio" }` to `createAdapter`. Reserved convention:
- `atlasdraw:sio:*` — `@socket.io/redis-adapter` (Task 15, Phase 5)
- `atlasdraw:yjs:*` — future Yjs persistence Redis channels (Phase 6, `setPersistence` integration)

No task edits needed beyond the one-line `key` option addition in Task 15 Step 1. Add the naming convention comment to `infra/config.toml.example` under `[realtime]`.

**OQ-5 — Concurrent-create LWW stability for `MAP_CAMERA_UPDATE`**
`MAP_CAMERA_UPDATE` uses LWW by timestamp. Two clients panning simultaneously produce alternating wins. Is this acceptable UX for 4 simultaneous users, or should the map camera be "last-touch wins only for the user touching it" (i.e., each client owns its own camera)? The spec says relay LWW; if camera is per-client, we do not broadcast `MAP_CAMERA_UPDATE` to the sender's own room at all — only to _other_ clients as a "remote camera indicator." This is a UX call, not a technical one, but it affects the event handler in Task 5.

**RESOLVED:** Per-client camera model. Each user controls their own map viewport; remote `MAP_CAMERA_UPDATE` events are displayed as peer viewport overlays (ghost viewports / mini-map indicators) but do NOT update the local camera position. This matches Figma/Miro/Google Maps collaboration UX conventions and eliminates camera thrashing for 4 simultaneous users.

Task 5 impact: relay behavior unchanged (`MAP_CAMERA_UPDATE` is relayed to room at 30Hz LWW by timestamp). Task 7 impact: `CollabState.connect()` must NOT register a `MAP_CAMERA_UPDATE` listener that calls `map.jumpTo()` or equivalent. The handler receives remote camera events → stores in `peers` map for overlay rendering only. Add a comment in Task 7 Step 1: `// MAP_CAMERA_UPDATE: store in peers for overlay; do NOT apply to local map camera.`

---

## Artifact Manifest

<!-- shape-incorporated 2026-05-03: add ADR row; tighten yjs-crypto.ts status to stub/provisional; mark persistence-bindstate.ts out of Phase 5 scope -->
<!--MANIFEST:START-->
| Artifact | Type | Path | Status |
|---|---|---|---|
| Yjs E2EE threat-model ADR | Create | `docs/decisions/0007-yjs-e2ee-threat-model.md` | Planned (Wave 0, Task 0) — must ship before Phase 5 closes |
| Wire protocol event types | Create | `packages/protocol/src/realtime-events.ts` | Planned |
| Room key fragment parser | Create | `packages/protocol/src/room-key.ts` | Planned |
| Awareness state types | Modify | `packages/protocol/src/realtime-events.ts` | Planned |
| Realtime config schema | Modify | `apps/atlas-app/src/config.ts` | Planned |
| config.toml.example realtime stanza | Modify | `infra/config.toml.example` | Planned |
| apps/realtime server entry | Create | `apps/realtime/src/index.ts` | Planned |
| Health endpoint | Create | `apps/realtime/src/health.ts` | Planned |
| Socket.IO event handlers | Create | `apps/realtime/src/socket-io-server.ts` | Planned |
| Rate limiter + size cap | Create | `apps/realtime/src/rate-limit.ts` | Planned |
| y-websocket server handler | Create | `apps/realtime/src/yjs-server.ts` | Planned |
| Redis adapter (optional) | Create | `apps/realtime/src/redis-adapter.ts` | Planned |
| apps/realtime Dockerfile | Create | `apps/realtime/Dockerfile` | Planned |
| apps/realtime package.json | Create | `apps/realtime/package.json` | Planned |
| YjsLayer CRDT model | Create | `packages/data/src/yjs-layer.ts` | Planned |
| YjsLayer → GeoJSON snapshot | Create | `packages/data/src/yjs-snapshot.ts` | Planned |
| Yjs AES-GCM crypto | Create | `packages/data/src/yjs-crypto.ts` | Stub only (Phase 5, provisional Option C) — wiring blocked on E-01 gate; wire in Phase 6 if Option B selected |
| persistence-bindstate.ts | Out of scope | `packages/data/src/persistence-bindstate.ts` | Phase 6 only — do NOT create in Phase 5 |
| CollabUndoManager | Create | `packages/data/src/collab-undo-manager.ts` | Planned |
| CollabState lifecycle | Create | `apps/atlas-app/src/state/collab.ts` | Planned |
| useCollab hook | Create | `apps/atlas-app/src/hooks/useCollab.ts` | Planned |
| useYjsLayer hook | Create | `apps/atlas-app/src/hooks/useYjsLayer.ts` | Planned |
| Scene AES-GCM crypto | Create | `apps/atlas-app/src/collab/scene-crypto.ts` | Planned |
| CursorOverlay component | Create | `apps/atlas-app/src/components/CursorOverlay.tsx` | Planned |
| PresenceList component | Create | `apps/atlas-app/src/components/PresenceList.tsx` | Planned |
| CollabWrapper component | Create | `apps/atlas-app/src/components/CollabWrapper.tsx` | Planned |
| MapEditor.tsx wire to YjsLayer | Modify | `apps/atlas-app/src/components/MapEditor.tsx` | Planned |
| docker-compose.yml realtime service | Modify | `infra/docker-compose.yml` | Planned |
| docker-compose.minimal.yml unchanged | No-op | `infra/docker-compose.minimal.yml` | Planned |
| E2E convergence test | Create | `tests/e2e/collab-convergence.spec.ts` | Planned |
| E2E Yjs stress test | Create | `tests/e2e/collab-stress.spec.ts` | Planned |
| Adversarial relay test | Create | `apps/realtime/tests/adversarial.test.ts` | Planned |
<!--MANIFEST:END-->

---

## Shape Changes Summary

*Appended by shape-incorporator agent 2026-05-03. Lists every structural edit made to this plan, with the Q/E citation that drove it.*

| # | Section edited | Change | Citation |
|---|---|---|---|
| 1 | Goal | Added "Phase 5 Scope Limitation" blockquote — server-trusted relay scope, stub-only `yjs-crypto.ts`, pointer to E-01 and Task 0 ADR | E-01 (OQ-1) |
| 2 | Phase Boundary Contracts → Produces (for Phase 6) | Added three new rows: `yjs-crypto.ts` stub wiring contract, `setPersistence` wiring contract, threat-model ADR handoff | E-01, OQ-2 |
| 3 | File Structure | Annotated `yjs-crypto.ts` as `[STUB — Phase 5]`; added `yjs-server.ts` Phase 6 TODO comment; added `docs/decisions/0007-yjs-e2ee-threat-model.md` entry; added `persistence-bindstate.ts` as out-of-scope with explicit note | E-01 (OQ-1), OQ-2 |
| 4 | Tasks | Inserted Task 0 (write `decisions/0007-yjs-e2ee-threat-model.md`) as new serial-first Wave 0 task | E-01 gate condition |
| 5 | Task 6 | Added `shape-incorporated` marker confirming OQ-2 TTL eviction stays folded into Step 1 (no split) | OQ-2 |
| 6 | Task 8 | Added `shape-incorporated` marker confirming BLOCKED status and stub-only scope under provisional Option C | E-01 (OQ-1) |
| 7 | Execution Waves → Wave 0 | Added Task 0 (ADR) as serial-first; updated gate condition to include ADR file-present check | E-01 gate condition |
| 8 | Open Questions → OQ-1 | Collapsed full analysis body (was ~20 lines) to a 5-line pointer to `escalations.md` E-01; full options table lives there | E-01 (escalations.md) |
| 9 | Artifact Manifest | Added ADR row; added `persistence-bindstate.ts` out-of-scope row; tightened `yjs-crypto.ts` status to "Stub only (Phase 5, provisional Option C)" with Phase 6 wiring condition | E-01, OQ-2 |

**Note on ADR filename:** `escalations.md` cites `decisions/0007-yjs-e2ee-threat-model.md`; the task description used `0007-yjs-encryption-threat-model.md`. This plan uses the escalations.md name to keep cross-references valid. The divergence is flagged here.

---

### Audit Incorporation 2026-05-03

*Applied by audit-incorporator agent. Each entry cites the finding ID from `docs/decisions/cross-phase-audit.md`.*

| # | Section edited | Change | Finding ID |
|---|---|---|---|
| 1 | Consumes table — `GeoAnchor` row | Fixed shape: flat `{lng,lat,zoom,bearing}` (bearing has no provenance) → discriminated union `{kind:"point"\|"bbox"\|"polyline",...,zRef}` per Phase 1 `packages/geo/types.ts`; also corrected source attribution to Phase 1/2 | MISMATCH-5 (HIGH), per E-03 |
| 2 | Consumes table — `docker-compose.yml` row | Added `profiles: ["realtime"]` guard note — Phase 4 Task 11 establishes this guard so plain `docker compose up` stays 5-svc; was listed as "5 static services" with no mention of guard | MISMATCH-4 (LOW) |
