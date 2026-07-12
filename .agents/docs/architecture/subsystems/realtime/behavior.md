# realtime — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §5.1, §4.8; Phase 5/6 plans; escalations E-01; cross-phase-audit 1.6; open-questions Q9.

---

## 1. Room Lifecycle State Machine

```
[NONEXISTENT]
  │
  ▼ First client sends `join { roomId }`
[CREATING]
  ├── socket-io-server.ts: creates room entry in `Map<roomId, Set<socketId>>`
  └── yjs-server.ts: creates Y.Doc + `lastActivity = now` entry
        │
        ▼
[ACTIVE]
  │  ─ Peers connect/disconnect; events flow
  │  ─ `lastActivity` updated on every inbound event to yjs-server
  │
  ├── All peers disconnect (Socket.IO side)
  │     ▼
  │   [IDLE] — Y.Doc still in memory; no socket connections; TTL countdown begins
  │     │
  │     ├── TTL expires (ROOM_TTL_MS, default 5 min):
  │     │     ▼
  │     │   [EVICTING]
  │     │     ├── Phase 5: doc dropped from memory (data lost if not persisted elsewhere)
  │     │     └── Phase 6+: yjs-server calls setPersistence.writeState(doc) before eviction
  │     │           ▼
  │     │         [EVICTED] — room gone from memory
  │     │
  │     └── New peer joins before TTL:
  │           ▼
  │         [ACTIVE] (resume)
  │
  └── Room evicted while peers are still connected (edge case):
        └── yjs-server reinitializes Y.Doc from setPersistence.bindState (Phase 6+)
```

**Endorheic basin**: In-memory rooms in `apps/realtime` are an accumulation point. In Phase 5, evicted rooms lose their Y.Doc state permanently (no persistence). This is the intended Phase 5 behavior — TTL eviction is the flush. Phase 6 wires `setPersistence` to fix this.

[CONFIDENCE: high — Phase 5 plan produces table, cross-phase-audit 1.6]

---

## 2. Concurrency: Yjs CRDT Merge Semantics

Yjs applies structural CRDT merge at the Y.Doc level. The relay server is the convergence point:

1. Client A sends Yjs update (binary frame) to `/yjs/:roomId`.
2. `yjs-server.ts` applies update to the in-memory `Y.Doc` via `Y.applyUpdate(doc, update)`.
3. The merged state is broadcast to all other clients in the room as a Yjs update frame.
4. Each client applies the update to its local `Y.Doc` — CRDT guarantees convergence.

Concurrent edits to different features in the same layer: clean merge (separate Y.Array/Y.Map entries).
Concurrent edits to the same feature's geometry: character-level Yjs merge — may produce non-geometric results (e.g. interleaved coordinate insertions). Accepted tradeoff per Phase 5 scope. [CONFIDENCE: high — OQ-3 resolution]

---

## 3. Socket.IO Message Ordering

Socket.IO guarantees in-order delivery per connection (TCP-backed). Events from the same client arrive in emission order. Events from different clients have no ordering guarantee relative to each other. The relay broadcasts events as received; no server-side sequencing.

`SCENE_UPDATE` uses `version + versionNonce` LWW: receiver keeps the element with higher `versionNonce` if two updates conflict on the same element. This is Excalidraw's native conflict resolution.

`MAP_CAMERA_UPDATE` and `CURSOR`: pure LWW. Last received wins on each client. Server does not enforce ordering — throttle is enforced client-side (30 Hz camera, 60 Hz cursor).

[CONFIDENCE: high — tech-spec §5.1]

---

## 4. Redis Split-Brain Failure Mode

When `REDIS_URL` is set and Redis becomes unavailable or partitions:

```
Redis unavailable
  │
  ├── Socket.IO adapter: pub/sub fails → events do not fan out across server instances
  │     Result: each server instance acts as an isolated island; peers on different
  │             instances cannot see each other's events
  │
  └── Yjs: not routed through Redis in Phase 5/6 (y-websocket is per-process)
            → Yjs per-process rooms are unaffected by Redis failure
```

Recovery: Redis reconnection is handled by `ioredis` reconnect strategy. On reconnect, Socket.IO rooms are re-joined from existing socket connections. In-flight events during partition are lost (no replay).

This is not a data-loss scenario for Yjs (CRDT state is in each client's local doc and the server's in-memory doc). It is a collab degradation: scene/cursor/camera events stop crossing server instances until Redis reconnects.

[CONFIDENCE: med — standard Redis adapter failure mode; ioredis reconnect behavior extrapolated]

---

## 5. Yjs Sync Catch-Up

When a client reconnects to an existing room:
1. Client sends its current state vector to the server.
2. `yjs-server.ts` computes the diff: `Y.encodeStateAsUpdate(doc, clientStateVector)`.
3. Server sends the diff to the client; client applies it.
4. Client sends its local updates not known to the server; server applies and broadcasts.

Result: both sides converge to the same state. This is standard y-websocket behavior.

When the server-side Y.Doc has been evicted (TTL):
- Phase 5: client receives an empty doc on reconnect. Data accumulated while disconnected is in the client's local doc and will be sent to the server as an update, repopulating the room.
- Phase 6+: server calls `setPersistence.bindState` to restore doc from storage before completing the handshake. Client and server converge including persisted history.

[CONFIDENCE: med — standard y-websocket reconnect semantics; Phase 6 persistence path from cross-phase-audit 1.6]

---

## 6. Encryption Boundary (E-01 Blocked)

The relay is currently **server-trusted**. The `yjs-server.ts` module sees plaintext Yjs update bytes. `yjs-crypto.ts` is a non-operational stub.

Phase 6 gate: E-01 must be resolved before Phase 6 ships.
- Option A selected: remove stub import, publish ADR confirming server-trusted model.
- Option B selected: wire `yjs-crypto.ts`; client encrypts Yjs updates before sending; relay becomes opaque binary forwarder.
- Option C: defer post-Phase 7; stub remains; threat model published.

No behavior change in this document until E-01 is resolved. See `escalations.md E-01`.

[CONFIDENCE: high — escalations.md E-01, Phase 5 plan scope limitation]

---

## 7. Failure Modes Summary

| Failure | Behavior | Recovery |
|---|---|---|
| Client disconnects ungracefully | Socket.IO `disconnect` event; peer removed from room membership; `room:peer-left` broadcast | Client reconnects; standard Socket.IO reconnect |
| Redis unavailable | Socket.IO events isolated to single server instance | Auto-reconnect by ioredis; events resume on reconnect |
| All peers disconnect | Room enters IDLE state; TTL countdown begins | New peer join resumes room |
| TTL eviction (Phase 5) | Y.Doc dropped from memory | Client local doc repopulates room on next connect |
| TTL eviction (Phase 6+) | Y.Doc written to storage before drop | `bindState` restores from storage on next connect |
| y-websocket server error | Node uncaught exception policy applies | Process restart (Docker `restart: always`) |
| Comments doc unavailable (Phase 6+) | `useComments.ts` on client receives no updates | Retry connect; comments show stale data with indicator |
