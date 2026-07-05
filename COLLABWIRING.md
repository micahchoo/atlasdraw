# CollabContext.Provider gap — ISSUES.md Issue 9

## Finding 1 — confirmed via forced test, not just grep

`grep -rn 'CollabContext.Provider' code/apps/atlas-app/src` (excluding tests)
returned zero hits before this fix — `MapEditor.tsx` never mounted one. Every
`useCollab()` call (in `MapEditor` itself, `CursorOverlay`, `PresenceList`)
took the no-provider fallback branch in `hooks/useCollab.ts`, which lazily
built its **own** `CollabState` — separate from the real, connected instance
`MapEditor` built at its own `useMemo(() => new CollabState(), [])` and wired
via `useCollabRoom`/`ShareDialog`. Two live `CollabState` objects existed per
mount; `useYjsLayer`, `CursorOverlay`, and `PresenceList` all read the
disconnected one.

**Forced proof, not assumption:** a new test
(`MapEditor.collab-presence.test.tsx`, "re-renders PresenceList when a peer
arrives on the live CollabState instance") mocks `CollabState` with a
test-controllable fake, captures the instance `MapEditor` actually
constructs, and mutates its peers the same way a real `PEER_JOINED`/`CURSOR`
socket event would. Before the fix in this pass, this assertion would have
failed — the mutation landed on an instance nothing downstream read.
`practical effect confirmed`: the Yjs CRDT data-layer sync (`useYjsLayer`)
and the cursor/presence UI had never carried live remote data since Phase 5,
masked because nothing visually surfaced `collab.peers` until Issue 4's
CursorOverlay/PresenceList mount made the gap observable.

## Finding 2 — the Provider alone would not have been enough

Even with a `<CollabContext.Provider>` mounted from the real instance,
`peers` is a mutable `Map` mutated in place by `SceneChannel`'s socket
handlers (`Map.set`/`.delete`), and `yjsDoc`/`commentsLayer` are plain
getters. None of these mutations are visible to React by default — passing
the live `CollabState` (or a value object built from its getters) straight
into a Provider's `value` prop would re-render on `MapEditor`'s OWN
re-renders, but not when a peer joins/leaves/moves between them, since
nothing would trigger `MapEditor` to re-render in the first place.

## Fix

1. **`SceneChannel`/`YjsChannel`/`CommentsChannel`** each now accept an
   optional `onChange?: () => void` constructor callback, invoked at every
   mutation point (peer join/cursor/camera/leave for `SceneChannel`;
   connect/disconnect doc transitions for the other two).
2. **`CollabState`** wires `() => this._notify()` into all three channels,
   and exposes `subscribe(listener): unsubscribe` + a cached
   `getSnapshot(): CollabSnapshot` (peers/localCursor/yjsDoc/commentsLayer) —
   the cache is invalidated on `_notify()` and rebuilt lazily, satisfying
   `useSyncExternalStore`'s "stable reference until real change" contract.
3. **`MapEditor.tsx`**: `useSyncExternalStore(collabState.subscribe,
   collabState.getSnapshot)` builds a reactive `collabValue`, which is now
   what `useYjsLayer` reads directly AND what's passed to a newly-mounted
   `<CollabContext.Provider value={collabValue}>` wrapping the component's
   entire return tree. `CursorOverlay`/`PresenceList` (rendered inside that
   tree) now read the real, connected, reactive session through the same
   `useCollab()` call as before — no call-site changes needed there.
4. **`hooks/useCollab.ts`**: the no-Provider fallback path (used by isolated
   hook tests, and as a defensive default) is upgraded the same way —
   `useSyncExternalStore` against its own fallback `CollabState`'s
   `subscribe`/`getSnapshot` — for contract symmetry with the Provider path,
   and to fix a pre-existing conditional-hook-call (`useRef` behind an early
   `if (ctx) return ctx`) along the way.

## Retest

- `state/collab.test.ts`: 5 new tests directly exercising `subscribe`/
  `getSnapshot` — stable reference until change, peers updated + listener
  fired on `CURSOR`/`PEER_LEFT`, `yjsDoc` transitions null↔non-null across
  connect/disconnect, unsubscribe stops notification. 21/21 pass.
- `hooks/useCollab.test.ts` (new file): Provider path returns the exact
  context value; fallback path is reactive to a driven peer change; connect/
  disconnect remain safe across renders. 4/4 pass.
- `MapEditor.collab-presence.test.tsx` (rewritten — its old approach of
  wrapping `MapEditor` in an outer fake Provider is now shadowed by
  MapEditor's own inner one, so it no longer tests anything real): drives a
  mocked `CollabState` instance captured mid-construction, forces a peer to
  arrive, and asserts `PresenceList` mounts. 5/5 pass.
- Full atlas-app suite: 62 files, 515 tests, all green.

## Done

A real connected peer's presence data (peers Map mutation) is observed
reaching `CursorOverlay`/`PresenceList` in a forced test — the two live
`CollabState` instances collapsed to one, and that one instance's mutations
now trigger a re-render.
