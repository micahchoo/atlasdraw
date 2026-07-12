# Phase 5 Realtime — Open Questions Research Notes

**Resolved by:** open-questions-resolver agent  
**Date:** 2026-05-03  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md`  
**Companion:** `docs/decisions/open-questions-resolution.md`

---

## Research sources indexed

| Source | URL | Notes |
|---|---|---|
| y-protocols PROTOCOL.md | `raw.githubusercontent.com/yjs/y-protocols/master/PROTOCOL.md` | Wire format spec — messageType bytes, awareness encoding |
| y-protocols awareness.js (src/) | `raw.githubusercontent.com/yjs/y-protocols/master/src/awareness.js` | `Awareness` class, `encodeAwarenessUpdate`, `applyAwarenessUpdate` |
| y-websocket client src (y-websocket.js) | `raw.githubusercontent.com/yjs/y-websocket/master/src/y-websocket.js` | `messageSync=0`, `messageAwareness=1`, `messageHandlers` array, server interaction |
| y-websocket-server README | `raw.githubusercontent.com/yjs/y-websocket-server/main/README.md` | `setPersistence({bindState, writeState})` API; `writeState` fires on last-client-disconnect |
| Excalidraw Portal.tsx | `raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/collab/Portal.tsx` | `_broadcastSocketData`: encrypts full scene payload with `encryptData(roomKey, encoded)` |
| Excalidraw data/reconcile.ts | `raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/data/reconcile.ts` | `shouldDiscardRemoteElement`: `version > remote.version` wins; same-version tiebreak by `versionNonce` (lower wins) |
| Excalidraw excalidraw-app/data/index.ts | `raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/data/index.ts` | `generateCollaborationLinkData` → `generateRoomId()` (random bytes) + `generateEncryptionKey()` |
| Socket.IO Redis adapter docs | `socket.io/docs/v4/redis-adapter/` | Default `key` prefix is `"socket.io"`; configurable via `createAdapter(pub, sub, { key: "..." })` |
| Hocuspocus intro | `hocuspocus.dev/guide/introduction` | Feature list: persistence, webhooks, Redis scaling, auth, TypeScript-native |

---

## Locked Decisions (Phase 5 collab-integration plan, 2026-05-15)

These decisions are minted post-Wave-4 for the
`2026-05-15-atlasdraw-phase-5-collab-integration.md` plan. They constrain the
wire protocol and capability model; downstream work cites them by Q-P5-N.

### Q-P5-1 — SCENE_SNAPSHOT via joiner-pull election preserves dumb-relay invariant

**Recorded:** 2026-05-15

**Decision.** Late joiners get an empty canvas because `SCENE_UPDATE` is an
event stream, not a state replica. To catch up, the joiner emits
`REQUEST_SNAPSHOT` once after `JOIN_ROOM` is acknowledged. The relay
deterministically elects a single existing room member (lowest `socket.id`
lexicographic order) and routes the request via `io.to(senderId).emit(...)`.
The elected peer encrypts its current Excalidraw scene with the room key and
emits `SCENE_SNAPSHOT { targetId, data: EncryptedPayload }`. The relay forwards
that envelope to `targetId` only, never broadcast. If the joiner receives no
snapshot within 2 s, it re-emits `REQUEST_SNAPSHOT`; the relay picks the next
eligible peer. Joiner applies the snapshot only during a 5 s "joining" window
post-connect, after which incoming snapshots are dropped to avoid clobbering
SCENE_UPDATEs already in flight.

**Why this shape (not sender-push on PEER_JOINED).** Sender-push has every
existing peer broadcast on `PEER_JOINED` → N concurrent snapshots per join
(storm); silent failure if the picked sender disconnects mid-encrypt; race
between snapshot and live SCENE_UPDATE on the joiner side. Joiner-pull with
relay-elected responder eliminates the storm, gives a deterministic single
sender, and provides a retry path. Election logic lives in the relay (already
trusted per ADR-0010 to route ciphertext); it operates on `socket.id` only and
never inspects payload.

**Constrains.**
- New event types: `SceneSnapshotEvent` and `RequestSnapshotEvent` in
  `packages/protocol/src/realtime-events.ts`.
- `targetId: string` lives on `SceneSnapshotEvent` only — **not** on
  `BaseEvent`; the addressing field is opt-in per variant, not union-wide.
- Relay change in `apps/realtime/src/socket-io-server.ts`: handle
  `REQUEST_SNAPSHOT` and emit `SCENE_SNAPSHOT` via `io.to(targetSocketId)`.
- Joiner-side timer + 5 s acceptance window in
  `apps/atlas-app/src/state/collab.ts`.

**Preserves.** ADR-0010 dumb-relay invariant — the relay routes ciphertext
between sockets; it never decrypts. Snapshot payload is AES-GCM with the same
room key used for `SCENE_UPDATE`, reusing `scene-crypto.ts` (`encryptScene` /
`decryptScene`).

---

### Q-P5-2 — URL room-key fragment grants write capability; existing share URLs remain read-only

**Recorded:** 2026-05-15

**Decision.** Possession of a valid `#room:<roomId>,<base64urlKey>` URL is the
write gate for Phase 5 collab — anyone with the link can edit. The existing
share-URL families remain read-only viewers:

| URL family | Path | Hash | Capability |
|---|---|---|---|
| Hash-mode shared map | `/m` | `#v1:<encoded>` | Read-only viewer (ShareView) |
| Token-mode shared map | `/m/<token>` | (any) | Read-only viewer (ShareView) |
| Collab room | `/` | `#room:<roomId>,<key>` | **Read-write editor (MapEditor + collab)** |

The `room:` prefix is retained even though `#v1:` and `#room:` live on
different paths (`/m` vs `/`) and would not collide on routing alone. Rationale:
(a) forward-compat — adding additional hash-rooted modes (e.g. comment-anchor,
deep-link) on the editor path stays cleanly disambiguated; (b) defensive — a
copy-paste accident that strips the path but keeps the hash still parses
unambiguously; (c) the prefix is cheap to add and removes a class of "is this a
share fragment or a room key" ambiguity at the parser boundary.

**Why this shape (not server-side auth).** Phase 5 ships the collab MVP. Auth
adds: user identity store, ACL model, invite flow, revocation. Capability-by-URL
is the same model Excalidraw upstream uses and Figma uses for "anyone with link
can edit." The URL key never reaches the server (it's the fragment; browsers
don't transmit `#...`); the relay is trusted to route, not to authorize. Phase 6
revisits if a multi-tenant deployment surfaces.

**Constrains.**
- `packages/protocol/src/room-key.ts` — `parseRoomFragment` MUST accept (and
  prefer) the `room:` prefix. The legacy un-prefixed shape (currently the only
  shape the parser accepts) is removed; no production callers exist yet.
- `packages/protocol/src/room-key.ts` — add `generateRoomKey()` and
  `buildRoomFragment(roomId, keyB64)` that emit the `room:`-prefixed shape.
- `apps/atlas-app/src/App.tsx` — `pickView` routes `#room:` on `/` to
  `MapEditor`; `#v1:` and `/m/` continue to route to `ShareView`.
- `apps/atlas-app/src/components/ShareView.tsx` — must NOT honor `#room:` even
  if reached by a malformed URL; if `#room:` is observed on `/m`, fail closed
  (render read-only with a hint that the URL was malformed).

**Phase 6 obligation.** When auth lands, write-capable URLs must either embed
a revocable token or be replaced by a server-side capability check. The URL-key
model from Phase 5 is provisional, not permanent.

---

## OQ-1 — Yjs awareness encryption boundary

### Wire format (verified from PROTOCOL.md + y-websocket client)

Every y-websocket frame is a flat binary buffer:

```
[0, ...]  → messageSync (type=0): wraps syncStep1/syncStep2/update
[1, ...]  → messageAwareness (type=1): wraps awareness update
[2, ...]  → messageAuth (type=2)
[3, ...]  → messageQueryAwareness (type=3)
```

First byte is `varUint(messageType)`. y-websocket server `setupWSConnection` reads this byte and dispatches to a handler. The sync handler calls `syncProtocol.readSyncMessage(decoder, encoder, serverDoc, ...)`, which applies the inner update bytes directly to the server's `Y.Doc`.

### Why "encrypt only inner payload, leave messageType plaintext" does NOT work with standard `setupWSConnection`

The server-side `setupWSConnection` does not just relay bytes — it actively applies Yjs updates to a shared `Y.Doc` (to produce correct SyncStep2 catch-up for late joiners). If the inner payload is encrypted ciphertext, `Y.applyUpdate` receives garbage → server Y.Doc corrupts → late joiners receive corrupted state.

**This is a structural conflict** between the plan's Task 6 ("relay is dumb, let y-websocket manage Y.Doc lifecycle") and Task 8 ("Yjs AES-GCM encryption layer on Yjs binary updates"). These two tasks are mutually exclusive as written.

### Three options (surfaced for project-level decision)

| Option | Description | Task 6 impact | Task 8 impact | Phase 5 scope |
|---|---|---|---|---|
| **(A) Server trusted, no layer E2EE** | Yjs updates flow plaintext to relay; only scene/comment encrypted via Socket.IO. Awareness is always plaintext (by protocol design — it routes cursor/presence only). | No change | Task 8 scope reduces to scene-crypto only (already Task 10) | Simplest; matches Hocuspocus/y-sweet production practice |
| **(B) Custom log-replay relay** | Replace `setupWSConnection` with a custom handler that stores opaque update blobs (no server Y.Doc); replays stored blobs to late joiners without decrypting. Client applies updates to local Y.Doc. | Task 6 Step 1 rewritten — no `setupWSConnection`, custom upgrade handler | Task 8 implemented as specified | Preserves E2EE on data layer; adds ~1 week implementation risk; no SyncStep1/SyncStep2 — must implement own catch-up |
| **(C) Defer layer E2EE to Phase 6** | Phase 5 ships server-trusted Yjs (Option A). ADR documents threat model explicitly: relay sees plaintext layer ops. Phase 6 evaluates Option B or encrypted-at-rest persistence. | No change | Task 8 deferred; yjs-crypto.ts still created but not wired into y-websocket path | Practical for Phase 5 schedule; honest about threat model |

### Awareness specifically

Awareness messages (`messageType=1`) contain user state JSON (cursor, username, viewport). `setupWSConnection` on the server side broadcasts these to room peers without applying to Y.Doc — the server does not accumulate awareness state. Encrypting awareness is technically possible (encrypt JSON payload inside the awareness update bytes), but breaks the y-protocols `applyAwarenessUpdate` call on receiving clients unless they decrypt first. **Per spec §5.3: cursor and camera are left plaintext — this is consistent and acceptable** (not sensitive data). Awareness encryption is not required.

### Recommendation

Option (C) for Phase 5 + schedule Option (B) evaluation in Phase 6 backlog. Document threat model in `decisions/` ADR. This is a project-level decision that must be taken by the maintainer before Task 8 is executed.

---

## OQ-2 — Yjs relay-side GC and room eviction

### Verified from y-websocket-server README (2026-05-03)

`y-websocket-server` is explicitly documented as a **development server / starting point** (not production). The persistence API is:

```js
import { setPersistence } from '@y/websocket-server/utils'

setPersistence({
  bindState: async (docName, ydoc) => { /* load from store on first access */ },
  writeState: async (docName, ydoc) => { /* flush on last-client-disconnect */ }
})
```

`writeState` fires "when the last connected client disconnects from this document." This is the correct hook for flush-on-last-leave behavior (plan Option (a)).

The default (no `setPersistence`) keeps Y.Doc in-memory indefinitely — confirmed as a leak vector at scale.

### For Phase 5 (in-memory relay, no persistence)

A lightweight TTL wrapper is implementable without replacing `setupWSConnection`:
- Listen for last-disconnect event (or poll `getDoc(docName).connsCount === 0`).
- Schedule `setTimeout` for TTL (default 5 min).
- On TTL expiry: call `Y.Doc.destroy()` and remove from docs map.
- Log a WARN: `[realtime] room ${docName} evicted after TTL (no persistence wired)`.

For Phase 6 / production: wire `setPersistence` to storage API (Phase 4 `/api/maps/:id` PUT) via `bindState`/`writeState`.

---

## OQ-3 — Excalidraw scene LWW on concurrent-create of same element id

### Verified from `packages/excalidraw/data/reconcile.ts` (2026-05-03)

`shouldDiscardRemoteElement` algorithm:
```ts
if (
  local &&
  (local.id === localAppState.editingTextElement?.id ||   // currently editing
   local.id === localAppState.resizingElement?.id ||
   local.id === localAppState.newElement?.id ||
   local.version > remote.version ||                       // local is newer
   (local.version === remote.version &&
    local.versionNonce <= remote.versionNonce))            // tiebreak: lower nonce wins
) { return true /* discard remote */ }
```

### Concurrent-create same-id behavior

Both clients create a new element. Elements start at `version=1`, `versionNonce=random`. Each broadcasts `SCENE_UPDATE`. Each client receives the other's broadcast:

- `local.version === remote.version` (both = 1) → tiebreak by `versionNonce`.
- Both clients independently compute `local.versionNonce <= remote.versionNonce`.
- Since nonces are random, both clients discard the element with the higher nonce and keep the lower one.
- **Result: one element survives, the other is silently dropped. Both clients converge to the same element (deterministic). No data corruption, no loop.**

Room IDs generated by `generateRoomId()` use `crypto.getRandomValues` on `ROOM_ID_BYTES` bytes, returned as a hex string. This generates 20+ byte random IDs — collision probability is negligible. versionNonce collision (same nonce on both ends) would use `local.versionNonce <= remote.versionNonce` → local wins; both clients agree, no divergence.

### Conclusion for plan

Upstream handles this correctly. No patch required. Document in `decisions/upstream-patches.md` as "verified — no patch needed, reconcile.ts versionNonce tiebreak is deterministic." The "second writer's element silently replaces the first" statement in the plan is incorrect: it's deterministic tiebreak by versionNonce, not last-write-wins by arrival order.

---

## OQ-4 — Redis channel namespace collision

### Verified from Socket.IO Redis adapter docs (2026-05-03)

Default adapter channel prefix is `"socket.io"` (configured via `key` option in `createAdapter`). The plan's proposed prefix `atlasdraw:sio:` correctly overrides the default.

### Naming convention (confirmed safe)

```
atlasdraw:sio:*   → @socket.io/redis-adapter (Task 15)
atlasdraw:yjs:*   → reserved for future Yjs persistence Redis channels (Phase 6)
```

No collision is possible if both prefixes are explicitly configured. The plan's Task 15 code must pass `{ key: "atlasdraw:sio" }` to `createAdapter(pubClient, subClient, { key: "atlasdraw:sio" })`. This is a one-line addition to the Task 15 step; no scope change needed.

---

## OQ-5 — MAP_CAMERA_UPDATE LWW vs per-client camera

### Analysis

Two models:
- **Relay LWW (current plan):** relay broadcasts camera to all room members including sender; clients apply camera state from any peer. All 4 users see each other's camera jumps. 4 users panning simultaneously produces chaotic camera thrashing.
- **Per-client (remote indicator):** client does NOT apply remote camera to its own viewport. Remote cameras are displayed as mini-map indicators (ghost viewports). Each user controls only their own camera. This matches how Google Docs, Figma, and Miro handle multi-user camera — you follow another user explicitly, not implicitly.

### Recommendation

Per-client camera (UX decision). Relay still broadcasts `MAP_CAMERA_UPDATE` to other room members — the event is useful for presence (show where peers are looking). But each client should NOT update its own camera position from a remote event. The relay handler in Task 5 remains unchanged; the client-side handler in `collab.ts` (Task 7) must NOT call `map.jumpTo()` on receiving a remote `MAP_CAMERA_UPDATE`.

### Task 5 impact

Task 5 Step 2 (`MAP_CAMERA_UPDATE`: LWW by timestamp; relay to room) — relay behavior unchanged. The LWW "last writer wins" applies only to what the relay *stores and deduplicates* before forwarding. The client-side application is the change: receive = display peer viewport overlay, do not apply to own camera.

---

## Hocuspocus vs y-websocket-server (considered, not a new OQ)

Hocuspocus (from Tiptap team) is a production-grade y-websocket-compatible server with built-in persistence, webhooks, Redis scaling, auth, TypeScript-native. `y-websocket-server` README itself recommends Hocuspocus for production.

**Why the plan should stay with y-websocket-server for Phase 5:**
- Phase 5 is in-memory relay; persistence is Phase 6 scope.
- Hocuspocus adds a dependency on Tiptap's infrastructure and a more complex plugin model.
- Switching to Hocuspocus is a Phase 6 decision once persistence requirements are concrete.

**Flagged for Phase 6 backlog:** evaluate Hocuspocus as persistence backend for Task 6's y-websocket path, given `y-websocket-server` README's own recommendation. This is not a blocker for Phase 5.
