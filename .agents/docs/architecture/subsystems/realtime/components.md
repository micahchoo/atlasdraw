# realtime — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.8, §5.1; Phase 5/6 plans; escalations E-01; cross-phase-audit 1.6; open-questions Q9.

---

## Overview

`apps/realtime` is the WebSocket relay server. It forks `excalidraw/excalidraw-room` (Phase 5). Node.js process hosting two independent protocols on port 4001:

- `/socket.io` — Socket.IO 4.x for lightweight, high-frequency events (scene diffs, camera, cursor, comments).
- `/yjs/:roomId` — native y-websocket for Yjs CRDT binary state (data layer ops).

Both protocols run on a single Node process but are logically separate namespaces. A single client room spawns two concurrent WebSocket connections.

[CONFIDENCE: high — tech-spec §4.8, Phase 5 plan, Q9 resolution]

---

## File Structure

```
apps/realtime/
  src/
    index.ts                  # Entry: HTTP server, mounts Socket.IO + y-websocket
    socket-io-server.ts       # Socket.IO server setup, room lifecycle
    yjs-server.ts             # y-websocket server, Y.Doc store, TTL eviction
    redis-adapter.ts          # Optional @socket.io/redis-adapter (REDIS_URL env)
    comments-doc.ts           # Second Y.Doc per room for comments (Phase 6+)
    room-comments-handler.ts  # WebSocket routing for comments doc (Phase 6+)
    yjs-crypto.ts             # STUB: encryptUpdate/decryptUpdate (Phase 5 stub, Phase 6 wire)
    types.ts                  # Shared message type definitions
  Dockerfile
  package.json
```

[CONFIDENCE: high — Phase 5 plan file structure, Phase 6 plan Feature 3]

---

## Component Details

**`index.ts`**
- HTTP server entry point. Creates Node HTTP server; mounts Socket.IO and y-websocket handler.
- Reads config: `PORT` (default 4001), `REDIS_URL` (optional), `ROOM_TTL_MS` (default 300,000 ms = 5 min), `CORS_ORIGIN`.
- Phase: 5.
- Deps: `socket-io-server.ts`, `yjs-server.ts`, `redis-adapter.ts`.
- Complexity: low (wiring only).
- [CONFIDENCE: high]

**`socket-io-server.ts`**
- Socket.IO 4.x server instantiation.
- Handles room join/leave, event routing (`SCENE_UPDATE`, `MAP_CAMERA_UPDATE`, `CURSOR`, `COMMENT`) to all room members.
- Room membership: in-memory `Map<roomId, Set<socketId>>`.
- Throttle enforcement (see contracts.md for per-event rates).
- Phase: 5.
- Deps: `socket.io`, `redis-adapter.ts` (opt-in).
- Complexity: medium.
- [CONFIDENCE: high — Phase 5 plan Tasks 3/15]

**`yjs-server.ts`**
- y-websocket server. Manages one `Y.Doc` per room. Handles binary frame relay and CRDT merge.
- In-memory `Map<roomId, { doc: Y.Doc, lastActivity: number }>`.
- TTL eviction: sweeper runs on interval; evicts rooms where `Date.now() - lastActivity > ROOM_TTL_MS`.
- `setPersistence({ bindState, writeState })`: stub in Phase 5 (comment placeholder); wired to `apps/storage` API in Phase 6.
- Phase: 5 (in-memory), Phase 6 (persistence wired).
- Deps: `yjs`, `y-websocket`, `@y/websocket-server`.
- **Perf-sensitive**: binary frame relay; Y.Doc merge on every inbound update.
- Complexity: medium-high.
- [CONFIDENCE: high — Phase 5 plan, cross-phase-audit 1.6]

**`redis-adapter.ts`**
- Loads `@socket.io/redis-adapter` when `REDIS_URL` env var is set; no-op otherwise.
- Attaches to Socket.IO server: `io.adapter(createAdapter(pub, sub, { key: 'atlasdraw:sio' }))`.
- Channel prefix `atlasdraw:sio` isolates from Yjs Redis keys (`atlasdraw:yjs:*`).
- Phase: 5 (introduced), Phase 6 (used in hosted deployment).
- Deps: `@socket.io/redis-adapter`, `ioredis`.
- Complexity: low.
- [CONFIDENCE: high — Phase 5 plan Task 15]

**`comments-doc.ts`** (Phase 6+)
- Manages a second `Y.Doc` per room dedicated to comment threads.
- Keyed separately from the data-layer doc: `comments:${roomId}`.
- Exposes `getCommentsDoc(roomId): Y.Doc`.
- Phase: 6.
- Deps: `yjs`.
- Complexity: low-medium.
- [CONFIDENCE: high — Phase 6 plan Feature 3]

**`room-comments-handler.ts`** (Phase 6+)
- WebSocket message routing for the comments doc channel.
- Connects the comments Y.Doc to its own y-websocket upgrade path or piggybacks on `/yjs/:roomId` with a sub-key.
- Phase: 6.
- Complexity: low-medium.
- [CONFIDENCE: med — Phase 6 plan Feature 3; sub-key vs separate path is extrapolated]

**`yjs-crypto.ts`**
- **STUB in Phase 5.** Not wired into the y-websocket path.
- API: `encryptUpdate(update: Uint8Array, key: CryptoKey): Promise<Uint8Array>` and `decryptUpdate(ciphertext: Uint8Array, key: CryptoKey): Promise<Uint8Array>`.
- Phase 6: wire if E-01 resolves to Option B (client-side encryption). Drop stub if Option A (server-trusted) confirmed.
- See escalations.md E-01 for decision tree.
- [CONFIDENCE: high — Phase 5 plan scope limitation block, cross-phase-audit 1.6, E-01]

**`types.ts`**
- Shared TypeScript interfaces: `SocketRoom`, `SceneUpdatePayload`, `CameraUpdatePayload`, `CursorPayload`, `CommentPayload`.
- Phase: 5.
- Complexity: low.
- [CONFIDENCE: med — inferred from usage]

---

## E-01 Encryption Boundary

The relay in Phase 5 operates **server-trusted**: the relay process can read plaintext Yjs data-layer ops. `yjs-crypto.ts` is a stub. Phase 6 must resolve E-01 by selecting one of:

- **Option A**: Accept server-trusted model. Document in threat model ADR `0007-yjs-e2ee-threat-model.md`. Drop `yjs-crypto.ts` stub.
- **Option B**: Client-side encryption before Yjs update leaves browser. Wire `yjs-crypto.ts`; relay becomes opaque bytes.
- **Option C**: Deferred post-Phase 7. Keep stub; publish threat model; add to backlog.

Until E-01 is resolved, `yjs-crypto.ts` is a non-operational stub and must not be referenced in production code paths.

[CONFIDENCE: high — escalations.md E-01, Phase 5 plan scope limitation]
