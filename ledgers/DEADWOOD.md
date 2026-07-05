# DEADWOOD — deletion sweep, ISSUES.md Issue 4

Run started 2026-07-04, branch `tend/deadwood-sweep`, base commit 5b037c7.
Scope: every non-test module in `code/apps/atlas-app/src` (66 modules; test
files, `test-setup.ts`, `vite-env.d.ts` excluded from rows but counted as
inbound references). Method: per module, grep for the basename in import
position across `src`, split into non-test vs test-only referencers; every
1-reference row re-verified as a real import statement (zero comment-only
matches); dynamic imports checked (`import(` — one hit, idb, type-only);
entry points resolved via `index.html` (→ `main.tsx`) and `package.json`
(no `main`/`exports` field). Repo-wide grep confirmed no external consumers
of the candidates.

Classes: **dead** (no non-test inbound path from an entry point),
**healthy** (real consumers), **god** (complexity hub needing a split plan —
plans written, not executed, per the loop contract).

Done-when: zero dead rows; every god row holds a plan or a recorded reason
to stay.

## Dead / verdict rows

| module | inbound references | class | action | commit | test run |
|---|---|---|---|---|---|
| src/index.ts | 0 src, 0 test. Not the app entry (`index.html` → `main.tsx`); package.json has no `main`/`exports`; nothing imports `@atlasdraw/atlas-app`; no directory-style (`from ".."`) or dynamic imports resolve to it. A Phase-1 "demo entry" barrel re-exporting App + a roadmap comment. | dead | deleted, merged to `tend/deadwood-sweep` | ae87a66 on `tend/deadwood-deletions`, merged bbf6424 (first attempt 16ce333 was unintentionally reverted by concurrent-session commit 180b839 — see run notes) | post-merge on `tend/deadwood-sweep`: vitest 44/44 files exit 0; `yarn test:typecheck` exit 0 |
| src/hooks/useAutosave.ts | 0 src, 1 test (its own `__tests__/useAutosave.test.tsx`). Header names ShareDialog/useShareLink as consumers; both now read `usePersistenceStore` directly (`useShareLink.ts:25,95,100`). Superseded facade. | dead | deleted (with its test file; also unstaled the `useAutosave().forceSave` comment at MapEditor.tsx:656), merged to `tend/deadwood-sweep` | e906f1e on `tend/deadwood-deletions`, merged bbf6424 | post-merge on `tend/deadwood-sweep`: vitest 44/44 files exit 0; `yarn test:typecheck` exit 0 |
| src/components/CursorOverlay.tsx | 0 src → now 1 src (MapEditor.tsx), 1 test. Complete 139-line collab cursor UI consuming `useCollab`; built Phase 5 Wave 3 (bd233e3, T11 "cursor UI"). Root cause of the never-mounted state: `CollabWrapper.tsx`, the original Task 11 mount point, was deleted 2026-05-25 (`d1310cb`, "conditional collab UI gateway no longer used") when collab wiring moved into MapEditor directly — but the mount itself never migrated. | **verdict: pursue** — mounted | 4b954e5-series (this commit) | vitest 45/45 files exit 0; `yarn test:typecheck` exit 0; new `MapEditor.collab-presence.test.tsx` (5 cases) |
| src/components/PresenceList.tsx | 0 src → now 1 src (MapEditor.tsx), 1 test (shared file with CursorOverlay). Complete 92-line presence UI, same T11/d1310cb history as CursorOverlay — same cluster, same verdict. | **verdict: pursue** — mounted, gated on `collab.active`; offset below WorkspaceSwitcher's identical top-right z:10 slot in managed mode (`topOffset` prop, `PresenceList.tsx`) to avoid visual collision — flagged via the atlasdraw-ui-conventions skill before implementing. | 4b954e5-series (this commit) | same test run as CursorOverlay row |

**⚠ Follow-up bug found while wiring, NOT fixed here (out of this row's scope — queued as ISSUES.md Issue 9):** `useCollab()` has no `CollabContext.Provider` mounted anywhere in the real app (confirmed: zero matches for `CollabContext.Provider` outside a stale comment). MapEditor's own `collab` variable (line 458, `= useCollab()`) is therefore always the hook's **fallback** branch — a *second*, disconnected `CollabState` instance, never `connect()`-ed by anyone. The REAL, connected instance is `collabState` (line 469, `useMemo(() => new CollabState(), [])`), wired by `useCollabRoom` and `ShareDialog`. Both `useYjsLayer(collab)` (line 504 — the data-layer CRDT sync) and now `CursorOverlay`/`PresenceList` (via `useCollab()` internally) read the wrong, always-empty instance. Practical effect: the mount added here is safe and inert (both components already no-op at zero peers/no data), but **will show no real peer cursors or presence until this Provider gap is closed** — and the same gap may mean the Yjs data-layer sync has never carried live remote data either. This needs its own investigation (including whether `CollabState`'s peers Map needs a reactivity bridge — plain mutation won't re-render React on its own) before anyone relies on Phase 5 collab UI as functional.

## God rows

| module | inbound references | class | action | commit | test run |
|---|---|---|---|---|---|
| src/components/MapEditor.tsx | 1 src (App.tsx), 6 test files. 1,719 lines, 65 imports, 16 useState / 17 useEffect / 7 useCallback. | god | split plan below — not executed | — | — |
| src/state/collab.ts | 4 src, 3 test. 585-line class; two live connections (Socket.IO + raw WebSocket), peers, cursor, room key, comments layer, hand-rolled snapshot-retry state machine. | god | split plan below — not executed | — | — |

## Healthy rows

Inbound = non-test / test-only referencing files.

| module | inbound | class | action |
|---|---|---|---|
| src/App.tsx | 2 / 1 (main.tsx entry chain) | healthy | keep |
| src/main.tsx | Vite entry (`index.html:14`) | healthy | keep |
| src/collab/scene-crypto.ts | 1 / 1 | healthy | keep (Issue 5 canonicalization candidate — different loop) |
| src/components/AboutDialog.tsx | 1 / 1 | healthy | keep |
| src/components/AriaAnnouncer.tsx | 4 / 2 | healthy | keep |
| src/components/AssetLibraryPanel.tsx | 1 / 1 | healthy | keep |
| src/components/BasemapPickerDialog.tsx | 1 / 1 | healthy | keep |
| src/components/BillingPage.tsx | 1 / 2 | healthy | keep |
| src/components/ColorRampPicker.tsx | 1 / 1 | healthy | keep |
| src/components/CommentAnchor.tsx | 1 / 1 | healthy | keep |
| src/components/CommentAnchorsOverlay.tsx | 1 / 0 | healthy | keep |
| src/components/CommentsPanel.tsx | 1 / 1 | healthy | keep |
| src/components/CommentsPanelHost.tsx | 1 / 0 | healthy | keep |
| src/components/ErrorBoundary.tsx | 1 / 0 | healthy | keep |
| src/components/ExportDialog.tsx | 1 / 0 | healthy | keep |
| src/components/FocusTrap.tsx | 8 / 1 | healthy | keep (high fan-in utility, not god — interface far simpler than its use sites) |
| src/components/KeyboardShortcuts.tsx | 1 / 0 | healthy | keep |
| src/components/LayerPanel.tsx | 1 / 3 | healthy | keep (602 lines — watch; below god threshold, one clear responsibility) |
| src/components/MaputnikDialog.tsx | 1 / 2 | healthy | keep |
| src/components/OnboardingTips.tsx | 1 / 0 | healthy | keep |
| src/components/PrintDialog.tsx | 1 / 1 | healthy | keep |
| src/components/QuickActions.tsx | 1 / 0 | healthy | keep |
| src/components/SettingsDialog.tsx | 1 / 0 | healthy | keep (Issue 7 covers its fake status — different loop) |
| src/components/ShareDialog.tsx | 1 / 1 | healthy | keep |
| src/components/ShareView.tsx | 1 / 2 | healthy | keep |
| src/components/StatusBar.tsx | 1 / 0 | healthy | keep |
| src/components/StylePanel.tsx | 1 / 1 | healthy | keep (606 lines — watch) |
| src/components/ToastProvider.tsx | 1 / 0 | healthy | keep |
| src/components/ToolOptionsBar.tsx | 1 / 0 | healthy | keep |
| src/components/WorkspaceSwitcher.tsx | 1 / 1 | healthy | keep |
| src/config/app-config.ts | 7 / 4 | healthy | keep |
| src/hooks/useAtlasdrawTool.ts | 1 / 5 | healthy | keep |
| src/hooks/useBasemapStyle.ts | 1 / 0 | healthy | keep |
| src/hooks/useCollab.ts | 5 / 0 | healthy | keep (2 of its 5 consumers are the verdict-pending overlay components) |
| src/hooks/useCollabRoom.ts | 1 / 1 | healthy | keep |
| src/hooks/useCoordinateSync.ts | 1 / 4 | healthy | keep |
| src/hooks/useExportPNG.ts | 1 / 0 | healthy | keep |
| src/hooks/useGeoAnchor.ts | 1 / 5 | healthy | keep |
| src/hooks/useGeoJsonDrop.ts | 1 / 0 | healthy | keep |
| src/hooks/useLayerRegistry.ts | 3 / 0 | healthy | keep (16-line shallow wrapper — fold into layerRegistry if ever touched; not worth a deletion commit while 3 consumers exist) |
| src/hooks/useLayerRegistrySync.ts | 1 / 5 | healthy | keep (469-line hook — first extraction target in the MapEditor split plan's layer seam) |
| src/hooks/useMapRef.ts | 1 / 4 | healthy | keep |
| src/hooks/useMapWheelRouter.ts | 1 / 4 | healthy | keep |
| src/hooks/useShareLink.ts | 1 / 1 | healthy | keep |
| src/hooks/useToolState.ts | 1 / 4 | healthy | keep |
| src/hooks/useYjsLayer.ts | 1 / 0 | healthy | keep |
| src/lib/export.ts | 1 / 1 | healthy | keep |
| src/lib/print-pdf.ts | 2 / 2 | healthy | keep |
| src/services/createHttpStorageClient.ts | 7 / 8 | healthy | keep |
| src/state/comments-anchor-picker.ts | 2 / 0 | healthy | keep |
| src/state/comments.ts | 7 / 4 | healthy | keep |
| src/state/hydrate.ts | 1 / 2 | healthy | keep |
| src/state/layerRegistry.ts | 8 / 13 | healthy | keep (highest fan-in state module; healthy interface, watch) |
| src/state/persistence.ts | 2 / 3 | healthy | keep (551 lines; cohesive persistence engine — Issue 7 owns its silent-failure fix) |
| src/state/selectDocument.ts | 2 / 3 | healthy | keep |
| src/state/useDataLayerFCStore.ts | 4 / 5 | healthy | keep |
| src/state/usePersistenceStore.ts | 4 / 6 | healthy | keep |
| src/state/workspace.ts | 3 / 1 | healthy | keep |
| src/tools/seedToElement.ts | 1 / 1 | healthy | keep |

## Run notes — concurrent-session incident (2026-07-04/05)

A second agent session (the Issue 3 journey walk, ledger `JOURNEY.md`) was
active in the same checkout during this run, committing onto whatever branch
was checked out — including this run's branch (`86ee294`, `180b839`,
`2210352` are its commits). Consequences, recorded so the history makes
sense:

- **16ce333 (this run's first index.ts deletion) was silently reverted** by
  `180b839`: that session's `commit -a` swept the shared git index, which
  held this run's diagnostic restore of the file.
- A storm of 18 test failures mid-run ("useToast must be used within a
  ToastProvider") was **not** caused by either deletion — it was the other
  session's half-landed Issue 7 fix (useToast added to MapEditor before its
  tests were wrapped in ToastProvider). Deleting/restoring index.ts appeared
  correlated only because the tree kept changing between runs.
- Fix phase therefore moved to an isolated worktree
  (`tend/deadwood-deletions`, cut from `2210352`), where both deletions were
  re-verified against a quiescent tree.
- **Merged 2026-07-05 (`bbf6424`)** — the journey-walk branch had only
  touched `MapEditor.tsx`'s comment text near the deletion sites, so the
  merge auto-resolved with no conflicts (confirmed via `git merge-tree`
  dry run first). Re-verified post-merge: vitest 44/44 files exit 0,
  `yarn test:typecheck` exit 0. Worktree and its branch removed.
- Process lesson (also harvested): `vitest run | tail` gates on tail's exit
  code, not vitest's — the first "test run: pass" entry for index.ts was
  unverified. All worktree runs captured real exit codes.

## Split plans (god rows)

Plans only — execution is future work, one extraction per PR-sized change.
Line references are as of commit `86ee294` (the tree the analysis read);
re-anchor with grep before executing, since MapEditor.tsx gained ~90 lines
in `180b839`.

### MapEditor.tsx (1,719 lines → hub component + 5 hooks)

Structure: component body 364–1719; JSX 1247–1717; `excalidrawAPI` is the
universal dependency nearly every concern reads — it stays in MapEditor and
is passed down. Much of the file is already thin hook wiring
(useCoordinateSync, useGeoAnchor, useLayerRegistrySync, useToolState…); the
split extracts the five concerns whose logic still lives inline. Cut order,
cheapest/safest first:

1. **`useCollabDataLayer(map, features)`** — move lines 794–858 (two
   effects: MapLibre source/layer add/remove + data push) plus
   `COLLAB_DATA_ID`/`hasCollabFeatures`; import or move `inferGeometryType`
   (132–141). Self-contained lifecycle, no shared refs. No existing test —
   add a characterization test, but blast radius is small.
2. **`useConvertToDataLayer(map, excalidrawAPI, registry)`** — move
   `currentConvertibleSelection` (879–903), `handleConvert` (905–945), the
   `registerContextMenuItem` effect (1022–1064). Best-covered inline concern:
   `MapEditor.contextmenu.test.tsx` exercises registration, predicate, the
   full perform pipeline, and unregister-on-unmount.
3. **`usePersistenceWiring(excalidrawAPI)`** — move the 587–679 effect
   (PersistenceStore creation, remoteSave, forceSave registration, IDB
   load+hydrate, startAutoSave, teardown); relocate the remote-id IndexedDB
   cache (module scope 179–237) to `state/remoteMapIdCache.ts`. Indirect
   coverage via `MapEditor.atlasdraw-export.test.tsx`; the autosave
   debounce/forceSave path is untested — add coverage first (overlaps
   Issue 6's climb).
4. **`useMapEditorKeyboard(...)`** — move the space-held effect (517–534)
   and main shortcut effect (726–779). Caveat: `spaceHeldRef` is read by
   `handleExcalidrawChange`, so either keep the ref in MapEditor and pass it
   in, or do 4+5 together. No keyboard test exists — characterization first.
5. **`useExcalidrawChangeHandler(...)`** — hardest, last: the 1109–1238
   mega-callback fuses five concerns (background intercept + scroll-lock +
   space-pan, coord-sync consumer, autosave markDirty, aria announce) and
   owns six refs (490–515). Entirely uncovered today — write
   characterization tests per sub-concern before touching it.

Coupling to respect (the expensive seams): `mapBg` (bg-intercept ↔
useExportPNG), `syncNow` (coordinate sync ↔ change handler),
`activeWorkspaceIdRef` (workspace ↔ share client), `spaceHeldRef` (keyboard
↔ change handler).

### state/collab.ts (585-line CollabState → 3 channels + thin facade)

Field/method groups and their coupling: the Socket.IO channel is the spine —
`connect()` (276–493) alone wires sockets, Yjs, crypto, comments, undo, and
the snapshot-retry machine. Presence is pure Socket.IO handler state;
comments are nearly independent; undo needs both `_socket.id` and
`_yjsLayer.doc` at connect time (305–308) — that handoff is the one
cross-module wire to design deliberately.

Extraction order:

1. **`CommentsChannel`** — `_commentsLayer`, the lazy `get commentsLayer`
   factory (213–266), create/destroy in connect (477–482) / disconnect
   (539–540). Near-zero coupling; depends only on `getAppConfig`,
   `localStorage`, and roomId/workspaceId args. No existing coverage — add a
   small characterization test.
2. **`YjsChannel`** — `_yjsWs`, `_yjsLayer`, `_undoManager`; the Yjs half of
   connect (465–492), `yjsDoc`/`undoManager` getters, teardown (533–537).
   Resolve the undo coupling by passing the origin id in
   (`attachUndo(originId)`) from the facade after socket connect.
3. **`SceneChannel`** — everything else: `_socket`, `_currentRoomId`,
   `_roomKey`, `_peers`, `_localCursor`, the scene-update passthrough, and
   the whole snapshot state machine (88–97, 557–583). Keep crypto + snapshot
   + presence together — they're entangled through `_socket`/`_roomKey`;
   peeling presence into a `PresenceTracker` is an optional later step.
   **`state/collab.test.ts` covers exactly this piece end-to-end** (snapshot
   pull, retries, joining window, disconnect idempotency) — retarget those
   tests at SceneChannel and extract against a green suite.
4. **`CollabState` stays as a thin facade** — `active` + constructor, owns
   the three channels, fans out connect/disconnect, re-exposes the read
   getters. Consumers (MapEditor, useCollabRoom, useYjsLayer, ShareDialog,
   useCollab context) see no interface change.

Bonus finding (method-level deadwood, logged not fixed): `emitSceneUpdate`
(503), the `onSceneUpdate` setter (161), and the `undoManager` getter (151)
have **zero non-test consumers** anywhere in src — confirmed by full-src
grep. The split can drop them instead of carrying them; decide at execution
time.
