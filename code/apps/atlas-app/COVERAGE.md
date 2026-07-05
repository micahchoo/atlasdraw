# Coverage ledger — Issue 6 (ISSUES.md), story-driven coverage climb

Scope: `src/hooks/*` named in Issue 6 as zero/low-coverage, ranked by (app dependence × coverage gap). Baseline taken via `vitest run --coverage --coverage.include='src/hooks/**'` at the start of this pass (all 51 pre-existing test files green, 431 tests). **Status: all 10 files closed out** — see the table below.

**Verification note:** Issue 6's prose says these 10 hooks have "no test file" / are "zero-coverage." True for `useCoordinateSync.ts` and `useGeoJsonDrop.ts` in the strict sense (no dedicated `*.test.ts`), but the baseline run shows two of the ten already sit at 100% line coverage _indirectly_ (via other components' test suites) despite having no dedicated test file of their own: `useCollab.ts` (26 lines of real logic, exercised through `MapEditor.collab-presence.test.tsx`) and `useLayerRegistry.ts`. Both are marked **no new test needed** below rather than padded with redundant direct tests — see `.claude/rules/canonicalization-verify-first.md`'s spirit: verify before "consolidating"/duplicating.

| file | behavior under test | before | after | bug exposed | fix commit | retest |
| --- | --- | --- | --- | --- | --- | --- |
| `useCoordinateSync.ts` | null-safety (map/api absent), camera-event wiring (4 events, 1 handler ref), 16ms leading+trailing throttle, cleanup order (cancel → off → detach), memoization keyed on (map,api) tuple, `syncNow` bypasses throttle | 12.82% | **100%** | none | — | pass (9/9) |
| `useGeoJsonDrop.ts` | capture-phase drop/dragover wiring, extension routing (.geojson/.csv/other), map-null early return, happy path (source+layer+registry+toast), CSV geocoder-configured vs. not, GeoJSONParseError/CSVParseError toast paths incl. NO_COORD_COLUMNS hint (both branches), addLayer-failure rollback (`removeSource`, incl. rollback-itself-fails) now toasts instead of silently rejecting, unmount listener cleanup, ref-not-attached guard | 78.51% | **100%** | yes — fixed | `useGeoJsonDrop.ts` catch-all branch | pass (15/15) |
| `useCollab.ts` | — | 100% (indirect, via `MapEditor.collab-presence.test.tsx`) | 100% | — | — | **no new test needed** |
| `useLayerRegistry.ts` | — | 100% (indirect) | 100% | — | — | **no new test needed** |
| `useBasemapStyle.ts` | map-null early return, pmtiles registration + resolveStyle → setStyle happy path, `allowRemote` passthrough, `BasemapRemoteGatedError` swallow (console.warn, no setStyle), unexpected-error path now logs instead of silently rejecting, re-apply on `activeBasemapId` change | 70.58% | **100%** | yes — fixed | `useBasemapStyle.ts` catch-all branch | pass (6/6) |
| `useYjsLayer.ts` | inactive/no-doc → null features+mutate, YjsLayer construction + `getOrCreateLayer("default")`, synchronous initial snapshot from `observeLayer`, snapshot updates on later callback fires, all 5 mutators (`addFeature`/`deleteFeature`/`setProperty`/`appendVertex`/`deleteVertex`) curry the layer reference, unsubscribe+clear on deactivate, unsubscribe on unmount, re-subscribe on `yjsDoc` reference change | 41.17% | **100%** | none | — | pass (9/9) |
| `useExportPNG.ts` | null-safety (map/api absent), happy path (export → object URL → synthetic anchor click → revoke), `Error` vs. non-`Error` rejection → `window.alert` message shape, stable callback identity across unrelated re-renders | 33.33% | **100%** | none | — | pass (6/6) |
| `useMapRef.ts` | initial null map/mapRef, `onMapReady` sets both the ref and the reactive state, stable `onMapReady`/`mapRef` identity across renders | 20% | **100%** | none | — | pass (4/4) |
| `useMapWheelRouter.ts` | null container/map no-ops, canonical zoom-delta math (plain + `DOM_DELTA_LINE`), ctrl/meta passthrough (browser pinch-zoom), shift-wheel intercepted (atlasdraw semantic), listener cleanup on unmount, re-attach on (container,map) change | 10% | **100%** | none | — | pass (9/9) |
| `useToolState.ts` | default state when api is null, synchronous seed from `getAppState()` (drawing vs. map-interactive tool), `onChange` updates state on tool-type change, bails out (same object reference) when the type is unchanged mid-drag, unsubscribe on unmount, re-subscribe when the api instance changes | 8.57% | **100%** | none | — | pass (7/7) |

All ten Issue 6 hooks are now at 100% line/branch/function coverage (two of them, `useCollab.ts`/`useLayerRegistry.ts`, already were — see above). Full `src/hooks/**` coverage rose from 70.23% to 81.64% (the remaining gaps — `useAtlasdrawTool.ts`, `useCollabRoom.ts`, `useConvertToDataLayer.ts`, `useGeoAnchor.ts`, `useLayerRegistrySync.ts`, `usePersistenceWiring.ts`, `useShareLink.ts` — were not named in Issue 6 and are out of scope for this pass). Full suite: 431 → 496 tests, 51 → 59 test files, all green.

## Bug exposed and fixed: `useGeoJsonDrop.ts` swallowed non-parser errors as an unhandled promise rejection

**Symptom:** `processDataDrop`'s outer catch only handled `GeoJSONParseError` and `CSVParseError` (toast + return). Any other error — e.g. `addLayer` rejecting a geometry-type mismatch, or a future MapLibre style-validation error — fell through to a bare `throw err;`. Because the drop listener invokes `processDataDrop` as `void processDataDrop(file, ext)` (fire-and-forget), that rethrow became an **unhandled promise rejection**: no toast, no console message, the user saw nothing and had no way to know the import failed.

**Test:** `useGeoJsonDrop.test.ts` — "rolls back addSource via removeSource when addLayer throws, and surfaces a toast" and "swallows a removeSource failure during addLayer-failure rollback ... and still toasts" both originally documented the swallow-as-unhandled-rejection behavior (temporarily attaching a `process.on('unhandledRejection', ...)` listener to observe it without failing the run). After the fix below, both were rewritten to assert the new behavior directly via `findByTestId("toast-error")` — no more listener workaround needed.

**Fix applied:** replaced the bare `throw err;` at the end of the catch block with a generic catch-all — `console.error` + `toast.error( \`${file.name}: import failed unexpectedly\`)` — so no import failure is ever silent. Single-hook, single-branch change.

## Second instance of the same bug class: `useBasemapStyle.ts`

Writing the `useBasemapStyle.ts` tests surfaced the identical pattern: `apply()` is invoked fire-and-forget (`void apply()`), and its catch block only handled `BasemapRemoteGatedError` (console.warn + return) before falling through to a bare `throw err;` for anything else (e.g. `resolveStyle` rejecting on a network error, or `map.setStyle` rejecting an invalid style document) — another silent unhandled promise rejection with zero user or developer-facing signal.

**Fix applied:** replaced the bare `throw err;` with `console.error( \`[basemap] Failed to apply style '${activeBasemapId}':\`, err)`. No toast here (this hook isn't passed a toast handle, unlike `useGeoJsonDrop.ts`) — console-only is the pragmatic minimum so the failure is at least visible in devtools instead of vanishing.

## Baseline coverage (full `src/hooks/**`, for context)

Captured before any Issue 6 work in this pass:

```
useAtlasdrawTool.ts    65.94%   useMapEditorKeyboard.ts  100%
useBasemapStyle.ts     70.58%   useMapRef.ts              20%
useCollab.ts             100%   useMapWheelRouter.ts      10%
useCollabDataLayer.ts  93.44%   usePersistenceWiring.ts 79.56%
useCollabRoom.ts       76.92%   useShareLink.ts         88.54%
useConvertToDataLayer  76.47%   useToolState.ts         8.57%
useCoordinateSync.ts   12.82%   useYjsLayer.ts          41.17%
useExcalidrawChangeHandler.ts 97.16%
useExportPNG.ts        33.33%
useGeoAnchor.ts        63.92%
useGeoJsonDrop.ts      78.51%
useLayerRegistry.ts      100%
useLayerRegistrySync.ts 68.83%
```
