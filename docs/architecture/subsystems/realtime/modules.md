# realtime — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.8; Phase 5/6 plans; escalations E-01; open-questions Q9.

---

## Internal Module Dependency Graph

```
index.ts  (entry)
  ├── socket-io-server.ts
  │     ├── types.ts
  │     └── redis-adapter.ts
  │           └── @socket.io/redis-adapter (conditional, REDIS_URL)
  │               └── ioredis
  ├── yjs-server.ts
  │     ├── yjs
  │     ├── y-websocket / @y/websocket-server
  │     ├── yjs-crypto.ts  [STUB — not in production path, Phase 5]
  │     └── types.ts
  └── comments-doc.ts  (Phase 6+)
        ├── yjs
        ├── room-comments-handler.ts
        └── types.ts
```

---

## Namespace Separation: Socket.IO vs Yjs

The two protocols share a single TCP port (4001) but are separated at the HTTP upgrade level:

| Namespace | Path | Protocol | Handler |
|---|---|---|---|
| Socket.IO | `/socket.io` | WebSocket (Socket.IO framing) | `socket-io-server.ts` |
| Yjs data | `/yjs/:roomId` | Native WebSocket (y-websocket binary) | `yjs-server.ts` |
| Yjs comments | `/yjs/comments:${roomId}` or sub-key | Native WebSocket (y-websocket binary) | `room-comments-handler.ts` (Phase 6+) |

Routing: the HTTP server (in `index.ts`) routes based on URL prefix. Requests to `/socket.io/*` are handled by Socket.IO's built-in upgrade handler. Requests to `/yjs/*` are handled by the y-websocket server upgrade handler.

These two upgrade paths must be registered in order: y-websocket first, then Socket.IO's default upgrade handler, or vice versa with explicit path matching. The exact registration pattern is an implementation detail.

[CONFIDENCE: high — Q9 resolution ("separate WebSocket for Yjs"), Phase 5 plan]

---

## Module Responsibilities

| Module | Responsibility | Stateful? |
|---|---|---|
| `index.ts` | Wire-up; config reading; process lifecycle | No |
| `socket-io-server.ts` | Room membership map; event fan-out; throttle | Yes — in-memory `Map<roomId, Set<socketId>>` |
| `yjs-server.ts` | Y.Doc store; TTL eviction; binary relay; `setPersistence` | Yes — in-memory `Map<roomId, YDocEntry>` |
| `redis-adapter.ts` | Conditional adapter attach; no state of its own | No |
| `comments-doc.ts` | Comments Y.Doc store per room | Yes — in-memory `Map<roomId, Y.Doc>` (Phase 6+) |
| `yjs-crypto.ts` | Encrypt/decrypt Yjs updates | No (pure functions, stub) |
| `types.ts` | TypeScript type definitions | No |

---

## External Dependencies

| Package | Purpose | Phase |
|---|---|---|
| `socket.io` | WebSocket event server | 5 |
| `yjs` | CRDT Y.Doc | 5 |
| `y-websocket` / `@y/websocket-server` | y-websocket server handler | 5 |
| `@socket.io/redis-adapter` | Multi-instance scaling adapter | 5 (conditional) |
| `ioredis` | Redis client for adapter | 5 (conditional) |

---

## Process Isolation Note

`apps/realtime` is a standalone Node process. It does not share memory with `apps/storage` or `apps/atlas-app`. The only cross-process communication is:
- Via Redis (when `REDIS_URL` set) for Socket.IO fan-out.
- Via HTTP to `apps/storage` for Yjs `setPersistence.bindState`/`writeState` (Phase 6+).

No shared module imports across process boundaries.

[CONFIDENCE: high]
