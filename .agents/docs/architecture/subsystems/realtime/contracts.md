# realtime — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §5.1, §4.8; Phase 5/6 plans; escalations E-01; cross-phase-audit 1.6; open-questions Q9.

---

## 1. Socket.IO Wire Protocol (`/socket.io`)

All events flow through Socket.IO 4.x rooms. Clients join a room identified by `roomId`. Events are broadcast to all room members except the sender unless noted.

### Events: Client → Server

| Event | Payload | Notes |
|---|---|---|
| `join` | `{ roomId: string; userId: string; color: string }` | Join a room; server adds to room membership |
| `SCENE_UPDATE` | `{ roomId: string; payload: EncryptedSceneDiff }` | Encrypted Excalidraw element diff; LWW per element via `version + versionNonce` |
| `MAP_CAMERA_UPDATE` | `{ roomId: string; lng: number; lat: number; zoom: number; bearing: number; pitch: number }` | LWW; throttle enforced client-side at 30 Hz |
| `CURSOR` | `{ roomId: string; userId: string; lngLat: [number, number]; color: string }` | LWW; throttle enforced client-side at 60 Hz |
| `COMMENT` | `{ roomId: string; payload: EncryptedCommentPayload }` | Versioned LWW comment event |

### Events: Server → Client (Broadcast)

| Event | Payload | Semantics | Throttle |
|---|---|---|---|
| `SCENE_UPDATE` | `{ userId: string; payload: EncryptedSceneDiff }` | LWW per element | None server-side (client throttles) |
| `MAP_CAMERA_UPDATE` | `{ userId: string; lng: number; lat: number; zoom: number; bearing: number; pitch: number }` | LWW | 30 Hz enforced |
| `CURSOR` | `{ userId: string; lngLat: [number, number]; color: string }` | LWW | 60 Hz enforced |
| `COMMENT` | `{ userId: string; payload: EncryptedCommentPayload }` | Versioned LWW | None |
| `room:joined` | `{ peers: PeerDescriptor[] }` | Sent to joining client only | — |
| `room:peer-joined` | `{ peer: PeerDescriptor }` | Broadcast to room | — |
| `room:peer-left` | `{ userId: string }` | Broadcast to room | — |

### Encryption Status

| Channel | Encryption | Phase |
|---|---|---|
| `SCENE_UPDATE` payload | Encrypted (Excalidraw's existing per-room key) | 5 |
| `COMMENT` payload | Encrypted | 5 |
| `MAP_CAMERA_UPDATE` | Plaintext | 5 |
| `CURSOR` | Plaintext | 5 |
| Yjs data-layer ops | **Server-trusted plaintext (Phase 5)**; E-01 governs Phase 6+ | 5 (stub), 6 (decision) |

[CONFIDENCE: high — tech-spec §5.1]

---

## 2. y-websocket Protocol (`/yjs/:roomId`)

Native y-websocket binary protocol. Not Socket.IO — separate WebSocket upgrade.

| Aspect | Detail |
|---|---|
| Path | `/yjs/:roomId` |
| Protocol | y-websocket binary frames (msgpack-like internal encoding) |
| Semantics | Yjs CRDT: full state vector on first connect; incremental updates thereafter |
| Encryption | Server-trusted plaintext (Phase 5); `yjs-crypto.ts` stub only |
| Persistence | In-memory `Y.Doc` with TTL eviction (Phase 5); `setPersistence` wired to storage (Phase 6) |
| Room TTL | `ROOM_TTL_MS` env var (default 300,000 ms = 5 min of inactivity) |
| Redis key prefix | `atlasdraw:yjs:*` (reserved; not colliding with `atlasdraw:sio`) |

### Comments Doc Sub-channel (Phase 6+)

| Aspect | Detail |
|---|---|
| Key | `comments:${roomId}` |
| Doc | Second `Y.Doc` per room, managed by `comments-doc.ts` |
| Protocol | y-websocket binary frames |
| Consumer | `atlas-app/hooks/useComments.ts` |

[CONFIDENCE: high — Phase 5 plan, Phase 6 Feature 3, cross-phase-audit 1.6]

---

## 3. Redis Adapter Configuration

When `REDIS_URL` is set:

| Key | Purpose |
|---|---|
| `atlasdraw:sio` | `@socket.io/redis-adapter` channel prefix for Socket.IO pub/sub |
| `atlasdraw:yjs:*` | Reserved for Phase 6 Yjs persistence channels |

No collision possible between `atlasdraw:sio` (Socket.IO adapter) and `atlasdraw:yjs:*` (Yjs persistence) by prefix design.

[CONFIDENCE: high — Phase 5 plan Task 15, OQ-4 resolution]

---

## 4. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4001` | HTTP/WebSocket listen port |
| `REDIS_URL` | unset | If set, activates `@socket.io/redis-adapter` |
| `ROOM_TTL_MS` | `300000` | In-memory room eviction TTL (milliseconds) |
| `CORS_ORIGIN` | `*` (dev) | CORS allowed origins; restrict in production |

[CONFIDENCE: med — TTL value from cross-phase-audit 1.6; PORT from Phase 5 contract table; others extrapolated]

---

## 5. Phase Boundary: Produces for Phase 6

| Artifact | Consumer | Shape |
|---|---|---|
| `/socket.io` endpoint (port 4001) | `apps/atlas-app` collab client | Socket.IO 4.x events per §1 above |
| `/yjs/:roomId` endpoint (port 4001) | `packages/data` YjsLayer client | y-websocket binary frames |
| `CollabState` type in `apps/atlas-app/state/collab.ts` | Phase 6 multi-tenant auth | Typed collab context + room lifecycle hooks |
| Redis adapter pattern | Phase 6 hosted deployment | `REDIS_URL` env var wires adapter in prod |
| `yjs-crypto.ts` stub API | Phase 6 E-01 resolution | Wire (Option B) or drop (Option A/C) |
| `setPersistence` hook stub | Phase 6 storage wiring | Phase 6 must wire `bindState`/`writeState` to `/api/maps/:id` |
| ADR `0007-yjs-e2ee-threat-model.md` | Phase 6 E-01 gate | Must exist before Phase 5 ships |

[CONFIDENCE: high — cross-phase-audit 1.6, Phase 5 plan produces table]
