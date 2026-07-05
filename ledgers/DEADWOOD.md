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
| src/index.ts | 0 src, 0 test. Not the app entry (`index.html` → `main.tsx`); package.json has no `main`/`exports`; nothing imports `@atlasdraw/atlas-app`. A Phase-1 "demo entry" barrel re-exporting App + a roadmap comment. | dead | deleted | `chore(deadwood): delete dead demo barrel src/index.ts` | vitest 45 files / 369 pass; root tsc clean |
| src/hooks/useAutosave.ts | 0 src, 1 test (its own `__tests__/useAutosave.test.tsx`). Header names ShareDialog/useShareLink as consumers; both now read `usePersistenceStore` directly (`useShareLink.ts:25,95,100`). Superseded facade. | dead | delete (with its test file) | — | — |
| src/components/CursorOverlay.tsx | 0 src, 0 test. Complete 139-line collab cursor UI consuming `useCollab`; built Phase 5 Wave 3 (bd233e3, T11 "cursor UI"); `MapEditor.tsx:412-413` comment plans to render it, no mount ever landed. `protocol/realtime-events.ts:132` still documents it as the consumer of cursor events. | dead (feature-shaped) | **verdict required** — pursue (mount it) / reject (delete). Not auto-deleted per sweep rule: feature-shaped dead is a capability-reach row first. | — | — |
| src/components/PresenceList.tsx | 0 src, 0 test. Complete 92-line presence UI consuming `useCollab`; same T11 commit, same never-mounted state as CursorOverlay. | dead (feature-shaped) | **verdict required** — same cluster as CursorOverlay (one verdict covers both). | — | — |

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

## Split plans (god rows)

_(filled in during this run — plans only, execution is future work)_
