# Atlasdraw Phase 5 — Collab Integration (Fragment → Connect → Snapshot)

**Plan date:** 2026-05-15
**Status:** Ready to execute (amended 2026-05-15 post review — see §10)
**Depends on:** Phase 5 Waves 0–4 (all 18 tasks shipped)
**Q-decisions:** Q-P5-1 (snapshot wire protocol), Q-P5-2 (URL-key write capability) — see `docs/decisions/phase-5-research-notes.md`

## Goal

Wire the missing integration seams so the collab workflow is testable end-to-end:
generate a room key → share a URL → joiners connect and see the existing scene.

## Three gaps this plan closes

| Gap | Root cause |
|---|---|
| No room key generation | `parseRoomFragment` exists but nothing creates the fragment |
| Fragment never read on mount | `App.tsx` routes `#v1:` and `/m/` but not `#room:` |
| Late joiners get empty canvas | `SCENE_UPDATE` is an event stream, not state — joining clients miss prior edits |

## Design decisions (citations: Q-P5-1, Q-P5-2)

**1. Fragment convention (Q-P5-2).** `#room:<roomId>,<base64urlKey>`. The
`room:` prefix is forward-compat against additional hash-rooted modes on the
editor path. `parseRoomFragment` is amended to **require** the prefix; the
legacy un-prefixed shape is removed (no production callers).

**2. URL distinguishes read-only from read-write (Q-P5-2).** Existing share
links (`#v1:` on `/m`, `/m/<token>`) remain read-only ShareView. `#room:` on
`/` is read-write MapEditor — the presence of a room key on the URL is the
write capability. No server-side auth in Phase 5; Phase 6 reconsiders.

**3. Scene catch-up via joiner-pull peer snapshot (Q-P5-1).** Joiner emits
`REQUEST_SNAPSHOT` once after `JOIN_ROOM` acknowledgement. The relay
deterministically elects the lowest-`socket.id` existing room member and
routes the request to that one peer via `io.to(senderId).emit(...)`. The
elected peer encrypts its scene with the room key and emits
`SCENE_SNAPSHOT { targetId, data }`; the relay forwards to `targetId` only.
If the joiner receives no snapshot within 2 s, it re-emits; the relay picks
the next eligible peer. The joiner applies the snapshot only during the first
5 s post-connect to avoid clobbering live `SCENE_UPDATE`s. Preserves ADR-0010
dumb-relay model — the relay routes ciphertext, never decrypts.

**4. ShareDialog gains an explicit mode picker.** The current dialog
auto-fires `generate()` on mount (hash/upload picked by size heuristics). To
add Collaborate as opt-in, the dialog opens to a 3-button mode picker (Share
read-only / Share via upload / Collaborate). The hash/upload paths still
auto-pick by size *after* the user picks "Share read-only." Collaborate is a
separate code path; it does not extend `useShareLink`'s `ShareMode` union —
collab state lives on `CollabState`, not on the share hook.

## Touch points (10 files, ~400 lines total)

> Realistic count — supersedes the earlier "5 files, ~200 lines" estimate. The
> earlier estimate omitted MapEditor wiring, relay-side handlers, and the
> `parseRoomFragment` shape change.

### Step 1 — `packages/protocol/src/room-key.ts` — Room key generation + parser amendment

- **Add** `generateRoomKey(): Promise<{ roomId, key, fragment }>`:
  - `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"])`
  - Export raw key bytes, base64url-encode (no padding).
  - `roomId = crypto.randomUUID()`.
  - `fragment = "#room:" + roomId + "," + keyB64`.
- **Add** `buildRoomFragment(roomId: string, keyB64: string): string` —
  utility for ShareDialog.
- **Amend** `parseRoomFragment(hash: string)` to require the `room:` prefix.
  Drop the legacy un-prefixed shape. Update the docstring to reference Q-P5-2.
- **Tests** in `room-key.test.ts`: generate→parse round-trip; legacy shape
  rejected; malformed base64 rejected; wrong-length key rejected.

### Step 2 — `packages/protocol/src/realtime-events.ts` — Snapshot event types

- **Add** `SceneSnapshotEvent`:
  ```ts
  export interface SceneSnapshotEvent extends BaseEvent {
    type: "SCENE_SNAPSHOT";
    /** Socket.IO id of the joiner this snapshot is addressed to. */
    targetId: string;
    data: EncryptedPayload;
  }
  ```
- **Add** `RequestSnapshotEvent`:
  ```ts
  export interface RequestSnapshotEvent extends BaseEvent {
    type: "REQUEST_SNAPSHOT";
  }
  ```
- **Extend** `CollabEvent` union with the two new variants.
- `targetId` lives on `SceneSnapshotEvent` only — **not** on `BaseEvent`.
  Adding it to the base would pollute every event type with an optional
  addressing field that's only meaningful for snapshots.

### Step 3 — `apps/realtime/src/socket-io-server.ts` — Election + targeted forward

- **Add** `REQUEST_SNAPSHOT` handler:
  - Look up the room members via `io.sockets.adapter.rooms.get(roomId)`.
  - Exclude the requester. Pick the lexicographically-smallest remaining
    `socket.id` (deterministic election; cheap; survives churn).
  - `io.to(electedId).emit("REQUEST_SNAPSHOT", { roomId, senderId: requester.id, timestamp })`.
  - If no eligible peer, do nothing (joiner is alone — empty scene is correct).
- **Add** `SCENE_SNAPSHOT` handler:
  - Validate `data.iv`, `data.ciphertext` (string), `targetId` (string).
  - Verify `targetId` is in the same room as the sender (no cross-room
    leakage). `io.to(targetId).emit("SCENE_SNAPSHOT", { roomId, senderId, timestamp, data })`.
  - Apply the same rate-limit / size cap as `SCENE_UPDATE`.
- **Tests** in `apps/realtime/tests/adversarial.test.ts` (or new
  `snapshot.test.ts`): election picks lowest id; cross-room targetId rejected;
  request from non-room-member rejected; oversized payload rate-limited.

### Step 4 — `apps/atlas-app/src/state/collab.ts` — Snapshot pull on join

- **Add** `setSceneAccessor(fn: () => ExcalidrawElement[]): void` —
  MapEditor registers a getter that returns the current scene elements.
- **Add** `setSceneReceiver(fn: (elements: ExcalidrawElement[]) => void): void`
  — MapEditor registers a setter that replaces the local scene.
- **Wire** these accessors to:
  - On socket `connect`: after emitting `JOIN_ROOM`, emit `REQUEST_SNAPSHOT`.
    Start a 2 s timer; on timeout, re-emit (max 3 attempts). Start a 5 s
    "joining window" — incoming snapshots after the window are dropped.
  - On `REQUEST_SNAPSHOT` received: if scene accessor present, encrypt the
    accessor's output via `encryptScene` and emit `SCENE_SNAPSHOT { targetId: event.senderId, data }`.
  - On `SCENE_SNAPSHOT` received: if still inside joining window and
    `targetId === this._socket.id`, decrypt via `decryptScene` and invoke the
    receiver callback. Outside window → drop silently.
- **Failure modes** to handle inline:
  - Decrypt fail → silent discard per ADR-0010 (AES-GCM auth tag catches
    tampering / key mismatch).
  - Elected sender disconnects mid-encrypt → joiner's 2 s timer re-fires;
    relay re-elects.
  - Joiner already drew something locally before snapshot arrives →
    receiver merges by element id (LWW via existing reconcile path) rather
    than blind replace; reuse the SCENE_UPDATE merge logic.

### Step 5 — `apps/atlas-app/src/hooks/useCollabRoom.ts` — Fragment → connect bridge

- New hook. Called once on mount by `MapEditor`:
  - Reads `window.location.hash`.
  - If it starts with `#room:`, calls `parseRoomFragment(hash)` (async).
  - On success: calls `collabState.connect(roomId, key)`. Returns
    `{ isConnecting: boolean, error: string | null }`.
  - Does nothing if not a room fragment or if `collabState.active === false`.
- **Tests** in `useCollabRoom.test.tsx`: valid `#room:` → connect called;
  malformed fragment → error state; realtime disabled → no-op.

### Step 6 — `apps/atlas-app/src/components/MapEditor.tsx` — Wire CollabState

- Instantiate `CollabState` once (module-level singleton or `useRef`).
- Call `collabState.setSceneAccessor(() => excalidrawAPI.getSceneElements())`
  when the Excalidraw API becomes available.
- Call `collabState.setSceneReceiver(elements => excalidrawAPI.updateScene({ elements }))`
  symmetrically.
- Mount `useCollabRoom(collabState)`.
- Pass `collabState` into `ShareDialog` via prop so the dialog reuses the
  same instance (avoids two sockets to the same room).

### Step 7 — `apps/atlas-app/src/components/ShareDialog.tsx` — Mode picker UX restructure

- Replace the auto-fire `useEffect` with an initial mode-picker view:
  ```
  ┌─ Share map ─────────────────────────────┐
  │  ○ Share read-only  (auto hash/upload)  │
  │  ○ Collaborate      (live editing)      │
  └─────────────────────────────────────────┘
  ```
- "Share read-only" → existing `useShareLink.generate()` path (unchanged).
- "Collaborate" → calls `generateRoomKey()`, then `collabState.connect()`,
  then renders the success view with the collab URL and the existing
  "Copy link" button. Add a hint: "Collaborative — anyone with this link
  can edit." Cite Q-P5-2 in a code comment.
- The success view is shared between modes — only the hint text and the
  generated URL differ.
- **Tests** in `ShareDialog.test.tsx`: mode picker renders; clicking
  Collaborate triggers `generateRoomKey` + connect; URL displayed has the
  `#room:` prefix; existing read-only flow unchanged.

### Step 8 — `apps/atlas-app/src/App.tsx` — Route `#room:` fragments

- Amend `pickView()`:
  - Existing: `(/m + #v1:)` and `/m/...` → `ShareView`.
  - New: `(/) + #room:...` → `<MapEditor initialView={INITIAL_VIEW} />`.
  - Default: `<MapEditor initialView={INITIAL_VIEW} />` (unchanged for
    non-collab editor sessions).
- Defensive: if `#room:` appears under `/m`, route to `ShareView` (read-only,
  malformed) — never grant write capability via a path mismatch.

### Step 9 — `packages/protocol/src/index.ts` — Re-export new surface

Add to public exports:
- `SceneSnapshotEvent`, `RequestSnapshotEvent` types.
- `generateRoomKey`, `buildRoomFragment` functions.

### Step 10 — Tests (Playwright E2E for the smoke flow)

New file `tests/e2e/collab-integration.spec.ts`:
- Spin up `apps/realtime` + `apps/atlas-app` (reuse existing E2E harness from
  `collab-convergence.spec.ts`).
- Tab A opens `/`, clicks Share → Collaborate, captures the URL.
- Tab B opens the captured URL.
- Assert: tab B sees tab A's pre-existing rectangle (the snapshot path).
- Tab A draws a circle; assert tab B receives it via SCENE_UPDATE.
- Tab B draws a triangle; assert tab A receives it.
- Move cursor in tab A; assert peer cursor renders in tab B.

## What this does NOT do

- Room lifecycle UI (empty room warning, reconnect prompt, "you're alone" indicator) — deferred.
- Room access control (anyone with the link can edit) — explicit design choice
  for v0 per Q-P5-2; Phase 6 may add auth.
- Excalidraw element conflict resolution changes — existing LWW per element id remains.
- Yjs data-layer encryption — still server-trusted per ADR-0010 Option C.
- Multi-relay Redis scaling — adapter exists (T15) but this plan doesn't test it.

## Smoke test (manual)

After implementation:

```
Terminal 1: yarn workspace @atlasdraw/realtime dev
Terminal 2: yarn workspace @atlasdraw/atlas-app dev
  (with VITE_REALTIME_ENABLED=true in .env.local)

1. Open http://localhost:5174
2. Draw a rectangle (so tab 1 has scene state)
3. Click Share → Collaborate → copy URL
4. Open URL in a second tab — should see the rectangle (via SCENE_SNAPSHOT)
5. Draw a circle in tab 1 → it appears in tab 2 (via SCENE_UPDATE)
6. Draw in tab 2 → it appears in tab 1
7. Move cursor in either tab → peer cursor visible in the other
8. Close tab 1 (the snapshot sender); open a third tab on the same URL —
   should still receive a snapshot (relay re-elects from remaining peers)
```

## §9 Q-Reference Summary

| ID | Title | Recorded | Scope of constraint |
|----|-------|----------|---------------------|
| Q-P5-1 | SCENE_SNAPSHOT via joiner-pull election preserves dumb-relay invariant | 2026-05-15 | Wire protocol (Steps 2, 3, 4) |
| Q-P5-2 | URL room-key fragment grants write capability; existing share URLs remain read-only | 2026-05-15 | Fragment shape + routing (Steps 1, 7, 8) |

Full records: `docs/decisions/phase-5-research-notes.md` §"Locked Decisions".

## §11 Plan Manifest (drift-detection anchors)

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `code/packages/protocol/src/room-key.ts` | patch | `export async function parseRoomFragment` |
| `code/packages/protocol/src/realtime-events.ts` | patch | `export type CollabEvent` |
| `code/packages/protocol/src/index.ts` | patch | `export { parseRoomFragment }` |
| `code/apps/realtime/src/socket-io-server.ts` | patch | `socket.to(roomId).emit("PEER_JOINED"` |
| `code/apps/atlas-app/src/state/collab.ts` | patch | `connect(roomId: string` |
| `code/apps/atlas-app/src/components/MapEditor.tsx` | patch | `onExcalidrawAPI` |
| `code/apps/atlas-app/src/components/ShareDialog.tsx` | patch | `useShareLink` |
| `code/apps/atlas-app/src/App.tsx` | patch | `function pickView()` |
| `code/apps/atlas-app/src/hooks/useCollabRoom.ts` | create | — |
| `code/tests/e2e/collab-integration.spec.ts` | create | — |
<!-- PLAN_MANIFEST_END -->

## §10 Shape Changes Summary

<!-- SHAPE_CHANGES_START -->
| Date | Role | Finding | Summary |
|------|------|---------|---------|
| 2026-05-15 | reviewer | review-2026-05-15 | Amended: room: prefix made mandatory in parseRoomFragment; joiner-pull snapshot election (Q-P5-1) replaces sender-push; targetId moved to SceneSnapshotEvent only; touchpoints expanded to 10 files (MapEditor + relay handlers + tests); ShareDialog restructured to explicit mode picker; Q-P5-1/Q-P5-2 minted and cited |
| 2026-05-15 | scrub-incorporator | scrub-2026-05-15 | Pre-dispatch scrub: 8/10 PASS (all patch markers verified, no drift). 2 FAIL are create-rows for files-to-be-created (useCollabRoom.ts, collab-integration.spec.ts) — structural post-condition, not blocking. Dispatch proceeds. |
<!-- SHAPE_CHANGES_END -->
