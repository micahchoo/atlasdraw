# Silence audit — ISSUES.md Issue 7

Full sweep of `code/apps/atlas-app/src` for error-handling sites: every
`catch` block and `.catch(` chain (28 non-test hits), plus a grep for
`window.alert`. ISSUES.md's original seed findings (MapEditor.tsx:275-323,
persistence.ts:531) turned out to already be fixed by Issue 3's journey-walk
pass (`saveAtlasDocument`/`openAtlasDocument` both already toast; auto-save
failure already reaches `documentNotify.error` via `usePersistenceWiring.ts`)
— the line numbers in ISSUES.md predate the Issue 4 god-module split that
moved this code into hooks. The sweep found the real remaining gaps by
reading every site fresh rather than trusting the seed line numbers.

Classification: **unhandled** (throws uncaught) / **swallowed** (silently
dropped) / **logged-and-lost** (reaches a log, never a user or an operator)
/ **surfaced** (reaches the user, e.g. toast) / **reported** (reaches an
operator-visible channel). Fixed rows read *before → after*.

| # | site | trigger | disposal today | should be | fix commit | forced check |
|---|------|---------|-----------------|-----------|------------|---------------|
| 1 | `MapEditor.tsx` `saveAtlasDocument` catch | `store.saveToDisk()` rejects | surfaced (toast) | — | already fixed, Issue 3 (`86ee294`) | pre-existing tests green |
| 2 | `MapEditor.tsx` `openAtlasDocument` catch | `store.openFromDisk()`/`hydrate()` rejects | surfaced (toast) | — | already fixed, Issue 3 | pre-existing tests green |
| 3 | `usePersistenceWiring.ts` initial `load()` | IDB load rejects on mount | swallowed → **surfaced** | `documentNotify.error("Couldn't load your saved map…")` | this pass | `usePersistenceWiring.test.ts` — "calls documentNotify.error when the initial load() rejects" ✅ |
| 4 | `usePersistenceStore.remoteSaveFailed` | `persistence.ts` `save()`'s remoteSave rejects | logged-and-lost — flag tracked, zero UI consumers | **surfaced**, edge-triggered (ok→failed transition only, not every autosave tick) | this pass | `usePersistenceWiring.test.ts` — "notifies once on the ok->failed transition…" ✅ |
| 5 | `persistence.ts` `setStoredFileHandle` failure (~373) | IDB put fails while retaining FSA handle | logged (console.warn), documented best-effort | accepted — save still proceeds, correctly non-fatal | — | — |
| 6 | `persistence.ts` `markDirty()` listener catch (~225) | a dirty-listener callback throws | swallowed intentionally | accepted — internal invariant ("listeners must not break the producer") | — | — |
| 7 | `persistence.ts` `writeChain.catch(()=>undefined)` (~215) | any queued write rejects | chain-poison prevention | accepted — caller still sees the rejection via `next` | — | — |
| 8 | `persistence.ts` `openFromDisk` rethrow (~419) | picker/file-read error, non-cancel | rethrown to caller | surfaced downstream (both callers catch + notify) | — | — |
| 9 | `useGeoJsonDrop.ts` catch-all | non-parser error mid-import | fixed in Issue 6 (toast) | — | Issue 6 | Issue 6 tests |
| 10 | `useShareLink.ts` `generate()` catch | share-link generation fails | surfaced (`setError`, rendered by `ShareDialog`) | — | — | — |
| 11 | `useCollabRoom.ts` connect catch | room-key parse/connect fails | surfaced (banner in `MapEditor`, `data-testid="collab-room-error"`) | — | — | — |
| 12 | `PrintDialog.tsx` export catch | PDF export fails | surfaced (`setError`) | — | — | — |
| 13 | `ShareDialog.tsx` `startCollab` catch | collab room creation fails | surfaced (`setView({kind:"error"})`) | — | — | — |
| 14 | `ShareDialog.tsx` `handleCopy` catch | clipboard write fails | reported via alternate affordance (selects the text for manual copy) | accepted | — | — |
| 15 | `useConvertToDataLayer.ts` rollback catch (~110) | `removeSource()` fails during addLayer rollback | swallowed intentionally, matches `useGeoJsonDrop`'s established best-effort-rollback pattern | accepted | — | — |
| 16 | `useConvertToDataLayer.ts` outer catch | `UnsupportedConvertElementError` → `window.alert`; anything else → unguarded rethrow inside a vendored context-menu `onClick` (uncaught, nothing shown) | unhandled / window.alert → **surfaced** (toast, both branches) | folded into `ToastProvider` via new `notify` param | this pass | new `useConvertToDataLayer.test.ts` — 2 tests ✅ |
| 17 | `useLayerRegistrySync.ts` `applyVisibilityToMap` (~329) | `setLayoutProperty` fails on a stale layer id | logged (console.warn), documented edge case | accepted — rare devtools-drift case, low severity | — | — |
| 18 | `remoteMapIdCache.ts` id-load/id-persist (~48, 68) | IDB unavailable (private mode/quota) | logged (console.warn), documented "observably lossy but never throws" | accepted — self-healing (mints a fresh remote id), no data loss | — | — |
| 19 | `useExportPNG.ts` export catch | PNG export fails | `window.alert` → **surfaced** | folded into `ToastProvider` via new `notify` param | this pass | `useExportPNG.test.ts` updated — 2 tests ✅ |
| 20 | `useBasemapStyle.ts` apply catch | style apply fails (non-gated error) | fixed in Issue 6 (console.error) | — | Issue 6 | Issue 6 tests |
| 21 | `ShareView.tsx` load catch (×2) | share-link decode/fetch fails | surfaced (`setState({kind:"error"})`) | — | — | — |
| 22 | `BillingPage.tsx` `handleUpgrade` catch | checkout session creation fails | surfaced (`setError`) | — | — | — |
| 23 | `AssetLibraryPanel.tsx` `updateLibrary` `.catch` | malformed bundled library fixture | logged-and-lost (console.warn only) → **surfaced** | `toast.error(...)` added, console.warn kept for devtools | this pass | `AssetLibraryPanel.test.tsx` — "toasts an error when updateLibrary rejects…" ✅ |
| 24 | `WorkspaceSwitcher.tsx` `listWorkspaces` catch | workspace list fetch fails | surfaced (`setLoadError`, rendered) | — | — | — |
| 25 | `SettingsDialog.tsx` `StorageTab` | reads `VITE_STORAGE_MODE` (doesn't exist in `app-config.ts`'s schema) and hardcodes `Status: Connected` regardless of reality | fabricated | reads real `enableBackendPersistence`/`storageBaseUrl`; live `fetch(storageBaseUrl + "/health")` reports checking/connected/unreachable; honest "Local-only (IndexedDB) — no backend configured" when disabled | this pass | new `SettingsDialog.test.tsx` — 5 tests ✅ |
| 26 | `SettingsDialog.tsx` `CollaborationTab` | reads `VITE_REALTIME_URL` (doesn't exist; real vars are `VITE_REALTIME_ENABLED`/`VITE_REALTIME_WS_URL`) | fabricated | reads real `getAppConfig().realtime.enabled`/`.wsUrl` | this pass | same test file |

## `window.alert` fold-into-ToastProvider

ISSUES.md named 4 sites (`useExportPNG.ts:30`, `useGeoJsonDrop.ts:68`,
`MapEditor.tsx:938,1096`). Re-checked fresh: `useGeoJsonDrop.ts`'s was already
folded into a toast by Issue 6; `MapEditor.tsx`'s two were the fake
`.atlasdraw` export dialog's placeholder alert, removed when Issue 3 wired
the real export. Net new in this pass: `useExportPNG.ts` (row 19) and one
**not** in the original list, found during the fresh sweep —
`useConvertToDataLayer.ts` (row 16). After this pass, `grep -rn
"window.alert" src` (excluding tests) returns zero hits — one notification
path (`ToastProvider`), not two.

## Forced checks

Every fix above landed with a test that forces the failure path directly
(rejected promise / mocked fetch failure / thrown error) and asserts the
user-visible outcome — this stood in for a manual dev-server run (no browser
tool available this session): `usePersistenceWiring.test.ts` (2 new),
`useConvertToDataLayer.test.ts` (new file, 2 tests), `useExportPNG.test.ts`
(2 rewritten), `AssetLibraryPanel.test.tsx` (1 new), `SettingsDialog.test.tsx`
(new file, 5 tests). Full atlas-app suite: 61 files / 506 tests, all green.

## Done

Every row above reads **surfaced**, **reported**, or **accepted** (with a
documented reason). Zero rows read unhandled/swallowed/logged-and-lost
without an accompanying rationale. A fresh `grep` for `catch (`/`.catch(`
across `src` (excluding tests) turns up nothing not already in this table.
