# Handoff

## Goal
> Continue the prior session: ship Phase 2 Wave 2 (T11–T14: LayerRegistry impl + LayerPanel + GeoJSON DnD import + Convert annotation→data layer). User said "do as you recommend" twice — first to fold hardening seeds into Wave 2 + pick Zustand, second to drop ImportDialog and continue. Wave 2 shipped clean; Wave 3 (T15 PNG export + T16 benchmark) remains.

## Progress

### 4 commits this session — Phase 2 Wave 2 SHIPPED

| SHA | Subject |
|---|---|
| `e741c71` | Wave 2a-DEPS: zustand+immer install + 244-line pre-dispatch scrub |
| `b586fce` | Wave 2a-PARALLEL: T11 LayerRegistry + style-compiler + parseGeoCustomData |
| `598a4e9` | Wave 2b-Round1: T12 LayerPanel + T13 GeoJSON DnD import |
| `0032385` | Wave 2b-Round2: T14 Convert annotation→data layer |

### Verification at session close

- `yarn workspace @atlasdraw/atlas-app test` → **35/35 PASS** (was 25 at session start)
- `yarn workspace @atlasdraw/tools test` → **69/69 PASS** (was 58)
- `yarn workspace @atlasdraw/geo test` → **50/50 PASS** (was 31)
- `yarn workspace @atlasdraw/data test` → **6/6 PASS** (regression clean)
- `yarn build` → **PASS 14.00s**
- Tree dirty only with mulch deltas + seeds churn (record-extractor's appended records, uncommitted).

### Wave 2 deliverables

- **T11 LayerRegistry impl** (`code/apps/atlas-app/src/state/layerRegistry.ts:80+`) — Zustand+immer slice on T01 ILayerRegistry interface. ID-prefix `dl:` enforcement throws on `registerDataLayer`. `convertAnnotationToDataLayer` is no-op when id absent (T14 caller stays simple).
- **`useLayerRegistry` hook** (`code/apps/atlas-app/src/hooks/useLayerRegistry.ts`) — pass-through; selectors deferred.
- **STYLE-COMPILER** (`code/packages/basemap/src/style-compiler.ts`, `…/style.ts`) — `compileLayer(id, style, "fill"|"line"|"circle")` returns MapLibre LayerSpecification. `defaultLayerStyle(_fc)` returns teal palette. `LayerStyle` exported from `@atlasdraw/basemap` (partial close on atlasdraw-fc04).
- **parseGeoCustomData + migrate** (`code/packages/geo/src/parseGeoCustomData.ts`) — deep parser throws `GeoCustomDataParseError`. `migrate` identity at v1, scaffold for v2+. Throw convention applied (matches GeoJSONParseError); plan literal `Result<T,E>` rejected.
- **T12 LayerPanel** (`code/apps/atlas-app/src/components/LayerPanel.tsx`) — Excalidraw `<Sidebar name="layers" docked>` with two aria-labeled sections. DataLayerRow has visibility/reorder/style editors; AnnotationLayerRow has visibility + "A" badge. Plan literal verified at `code/packages/excalidraw/index.tsx:342`.
- **T13 GeoJSON DnD** (`code/apps/atlas-app/src/components/MapEditor.tsx`) — `onDrop`+`onDragOver` on root div; geometry-aware via `inferGeometryType`. Mocks `@atlasdraw/basemap` in tests to avoid maplibre-gl IIFE under jsdom.
- **T14 Convert** (`code/packages/tools/src/convert.ts`, `MapEditor.tsx` context-menu) — right-click context menu on single-selection geo elements. Maps rectangle→Polygon (bbox), ellipse→Polygon (turf/circle), polygon/freedraw→Polygon (auto-close), line/polyline→LineString, text/arrow→`UnsupportedConvertElementError`.

### Wave 2 hardening seeds

| Seed | Status |
|---|---|
| `atlasdraw-db43` parseGeoCustomData | ✅ closed (commit b586fce) |
| `atlasdraw-072a` schemaVersion migrate shim | ✅ closed (commit b586fce) |
| `atlasdraw-02f6` zRef bounds at CoordinateSync | 🔄 deferred to post-Wave-2 |
| `atlasdraw-cdd3` Phase 1 dropped sources | 🔄 deferred (Phase 1 cleanup, not Wave 2) |

## What Worked

- **Pre-dispatch scrub paid off massively** — `docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md` caught 5 blockers (Zustand-vs-singleton decision, store.ts absence, style-compiler.ts absence, ImportDialog.tsx absence, T11→T12/T13/T14 file dependency) BEFORE any worker dispatched. Zero cross-worker conflicts shipped to disk. Convention `mx-e9dc63` validated yet again — and `mx-d4f376` (scrub catches integration-seam absence) earned its second confirmation.
- **Three-wave dispatch shape held under pressure** — Wave 2a-DEPS (1 worker, serial) → Wave 2a-PARALLEL (3 workers, different packages, no conflict) → Wave 2b-Round1 (2 workers, different files) → Wave 2b-Round2 (1 worker, serial after Round 1 because T13+T14 both modify MapEditor.tsx). 7 worker dispatches, 7 successful returns.
- **Advisor caught the T11-as-blocker pattern early** — first scrub draft assumed plan's "fully parallel T11–T14" claim. Advisor pointed out that import-path resolution requires the file to exist regardless of interface-only coupling. Saved a wave of broken typecheck.
- **Worker briefs included verified pre-state literals** — e.g. "useMapRef returns `{mapRef, map: maplibregl.Map | null, onMapReady}` (line 22-26)" — workers consumed verbatim, no re-grep, no drift.
- **Module-singleton convention from Wave 1 was correctly NOT applied to LayerRegistry** — recognized the cross-component shared reactive state as a different problem class than tool-internal singletons. Picked Zustand+immer; recorded the decision rationale (mx-5ac6f6).
- **`yarn workspace add` chained with bare `yarn install` immediately** per Wave 1 [SNAG] — no rebuilds wasted.
- **excalidraw-api.md rule satisfied twice** — T12 grep-verified `<Sidebar>` at `code/packages/excalidraw/index.tsx:342`; T14 grep-verified `getSceneElements`/`getAppState`/`updateScene` at `code/packages/excalidraw/types.ts:933,950,936`.

## What Didn't Work / [SNAG]

- **[SNAG] vitest `globals: false` defeats RTL automatic cleanup** — surfaced in T12 (LayerPanel) AND T14 (MapEditor.contextmenu); two-workspace pattern. Recorded in mulch as `mx-af40b4` (failure, infrastructure domain). Fix: explicit `afterEach(cleanup)` in any RTL+vitest test file in this monorepo.
- **[SNAG] `@atlasdraw/data` barrel was Phase 0 stub even after Wave 1b T10 shipped** — T13 was the first cross-package consumer importing from the package root; surfaced and fixed inside Wave 2b Round 1 (`code/packages/data/src/index.ts` re-exports `parse` + `GeoJSONParseError`). Convention recorded: barrel-export-as-stub signals scaffold-era omissions.
- **Plan-literal drift, three new instances**:
  1. T11 plan said "Modify: store.ts" — store.ts didn't exist (no Zustand store yet).
  2. T13 plan said "Modify: ImportDialog.tsx" — file didn't exist; dropped from scope per scrub §3.3.
  3. T14 plan said `customData.radiusKm` — actually at `customData._data.radiusKm` (escape-hatch in `seedToElement.ts:131`). Convert.ts reads both shapes for forward compatibility.
  4. T14 plan said `registry.convertAnnotationToDataLayer + map.addSource(id)` with same id — but registry method mints id internally; T14 pivoted to T13's pattern (registerDataLayer + remove + addSource).
  Recorded as `mx-619182` (correction, meta domain).
- **LSP phantom errors at `useAtlasdrawTool.ts:313+`** — never went away across the entire session (the file is 312 lines; LSP keeps reporting line 313 syntax errors). Confirmed phantom: build PASSed, all tests green. Wave 1 [SNAG] convention vindicated again.
- **jsdom 22's File polyfill omits `Blob.prototype.text()`** — T13 test had to use a minimal file-like object cast to File. Production browsers unaffected. [NOTE] for any future drop tests in this workspace.

## Key Decisions

- **OQ-W2-1 (Zustand vs module-singleton vs Context)**: **Zustand+immer**. LayerRegistry is cross-component shared reactive state; module-singleton (Wave 1's emergent convention) was right for tool-internal state but the wrong shape for this. Recorded as `mx-5ac6f6` architectural decision.
- **OQ-W2-2 (ImportDialog.tsx)**: **drop**. T13's drop handler in MapEditor.tsx covers file→FC→registry. ImportDialog adds a programmatic-trigger button (nice-to-have, not critical-path); deferred to a post-Wave-2 polish task.
- **Hardening seeds in/out of Wave 2**: db43+072a IN (data-layer correctness blocks T13 trust); 02f6+cdd3 OUT (not blocking T11–T14).
- **Wave 2b shape**: T12 parallel with (T13 → T14 serial), NOT 3-way parallel — T13 + T14 both modify MapEditor.tsx (would merge-conflict).
- **`dl:` prefix mint at call site, NOT inside registry** — T11 + T13 + T14 all coordinate via `dl:${crypto.randomUUID()}` minted by the caller. Recorded as `mx-417b33` convention.
- **STYLE-COMPILER does NOT migrate atlas-app's inline LayerStyle this wave** — avoids cross-worker conflict with T11. atlasdraw-fc04 stays open; cleanup task post-Wave-2.

## Trajectory

**How we got here:** User said "do as you recommend" twice. First triggered the recommendation: fold db43+072a into Wave 2a, drop ImportDialog, pick Zustand. Second time pivoted to execution. Wave 2a-DEPS shipped first (zustand@5.0.13 + immer@11.1.6, husky postinstall failure non-blocking per atlasdraw-0c97). Wave 2a-PARALLEL dispatched 3 workers — T11 + STYLE-COMPILER + DATA-PARSE — each touching a different package. All returned with passing tests in 2-5 min. Wave 2b-Round1 dispatched T12 + T13 in parallel (LayerPanel.tsx + MapEditor.tsx drop handler — different files). T13 worker also fixed an incidental bug: `@atlasdraw/data` barrel was still a Phase 0 stub even though T10 had shipped `parse`/`GeoJSONParseError` in Wave 1b. Wave 2b-Round2 dispatched T14 alone — convert.ts + MapEditor.tsx context menu. T14 caught two plan-literal drifts (radiusKm at `_data.radiusKm`, registry-id-coordination flaw) and pivoted both. Bundled commits per wave. Build PASSed throughout. record-extractor dispatched in background after T14 commit; appended 7 records across 3 mulch domains.

**Hard calls:**
- **Picking Zustand over module-singleton** — Wave 1's emergent convention was strong, and "no new deps" is a real value. But LayerRegistry's shape (multiple readers, multiple mutators, mutation-heavy) is exactly Zustand's sweet spot. Reinventing its wheel via `useSyncExternalStore` would have shipped slower with more bugs. Module-singleton stays the convention for tool-internal state.
- **Dropping ImportDialog** — plan literal said MODIFY but the file didn't exist. Could have CREATED it as a programmatic-trigger surface. Drop handler in MapEditor covers the critical path; ImportDialog is post-Wave-2 polish.
- **NOT migrating atlas-app's inline LayerStyle to `@atlasdraw/basemap`** — STYLE-COMPILER could have done it, but that would have collided with T11 on `layerRegistry.ts`. Two LayerStyle definitions co-exist temporarily; cleanup task tracked as atlasdraw-fc04 with `partial-followup` label.
- **Shipping T14 with `[NOTE]` cleanup-needed in tests instead of bottoming out** — T12 + T14 both need `afterEach(cleanup)`; recorded as a failure pattern (mx-af40b4) but not refactored this wave. The wave's value is in the user-facing convert flow, not test hygiene.

**Shaky ground:**
- **LayerPanel <Sidebar> is currently invisible to the user** — real `<Sidebar>` short-circuits to null unless `appState.openSidebar?.name === "layers"`. Tests mock the Sidebar. End-to-end, the user sees neither the sidebar nor a trigger button to open it. Wave 2 ships the component; opening-it UX is a follow-up (probably <30 min: render LayerPanel as Excalidraw children + add a button that calls `excalidrawAPI.toggleSidebar({ name: "layers" })` or equivalent).
- **`map.addLayer(compileLayer(id, style, geometryType))` not regression-tested in browser** — vitest mocks `addLayer`; if MapLibre's actual paint props don't match `compileLayer`'s output (e.g. wrong key name, missing required field), it'd manifest as silent black layers. PNG export (T15) and benchmark (T16) would catch it indirectly; consider a quick Playwright sanity check before Wave 3 ship.
- **`convertAnnotationToDataLayer` registry method is now never called by atlas-app code** — T14 ended up calling `registerDataLayer` + `remove` directly per the pivot. The interface method is dead code at the consumer level. Decide post-Wave-2: delete it or keep for symmetry with T01's interface contract.
- **lng/lat domain bounds NOT enforced by parseGeoCustomData** — only finiteness. zRef has no min/max. atlasdraw-02f6 (deferred) covers this.

**Invisible context:**
- The mulch records added this session lean architecture-heavy (3 of 7) because Wave 2 introduced state-management decisions; future waves shipping more code-style work (Wave 3 = export rendering + benchmark) will pull more from infrastructure/skills.
- `crypto.randomUUID()` is used throughout T11/T13/T14 — assumed secure-context (HTTPS or localhost). Production builds running over HTTP would break. The Vite dev server uses `localhost` so dev-time is fine.
- Excalidraw's `<Sidebar>` can be docked or floating via the `docked` prop. Floating is the default. Plan literal `<Sidebar name="layers" docked>` ships docked.

## Active Skills & Routing

- `check-handoff` (session entry; reconciled prior handoff against current state).
- `triage` (NOT invoked this session — anti-pattern needs-triage queue still has 5 items).
- `dispatching-parallel-agents` (Wave 2a 3 + Wave 2b-Round1 2 workers).
- `executing-plans` (implicit — Wave 2a → Wave 2b-Round1 → Wave 2b-Round2 sequence per scrub doc).
- `verification-before-completion` (yarn build + workspace tests before each commit).
- `record-extractor` (foreground retro at session close; agentId `a0f9cf2894880f219`, completed).
- `handoff` (current).

**Skills NOT invoked this session that should be next:**
- `/dream detect-gaps` — 1407 uncategorized failures (was 1407 at session start; growing).
- `/dream integrate` — cross-project memories.
- `/triage` — 5 anti-pattern items still labeled `needs-triage`.
- `executing-plans` (Wave 3 dispatch: T15 + T16).

## Pending routing for next session

1. **Phase 2 Wave 3 dispatch decision**:
   - **T15 PNG Export Pipeline** (plan §990, line 990) — depends on MapEditor having `preserveDrawingBuffer: true` per plan note. May need MapCanvas.tsx modification.
   - **T16 Phase 2 Benchmark Re-gate** (plan §1078) — runs after T15.
   - **Suggested dispatch**: T15 first (single worker), then T16 (single worker, depends on T15).
2. **Pre-dispatch scrub for Wave 3** — same playbook as Wave 1 + Wave 2 (mandatory per `mx-e9dc63`). Plan literals stale by ~36h; Wave 2 ship may have changed canonical paths.
3. **Optional pre-Wave-3 housekeeping**:
   - Commit the uncommitted mulch deltas (`.mulch/expertise/{architecture,infrastructure,meta}.jsonl`).
   - Wire `<LayerPanel />` into MapEditor + add a sidebar trigger button (Wave 2 polish, ~30 min).
   - Migrate atlas-app inline `LayerStyle` to import from `@atlasdraw/basemap` (closes atlasdraw-fc04).
   - Add `afterEach(cleanup)` to existing RTL+vitest test files (mx-af40b4 prevention).
   - `/triage` to clear anti-pattern needs-triage backlog (5 items).
   - `/dream detect-gaps` (1407 uncategorized failures).
4. **Skipped this session that may merit attention**:
   - `dream` queue.
   - Triage backlog.

## Infrastructure Delta

- **NEW** (committed): `code/apps/atlas-app/src/hooks/useLayerRegistry.ts`, `code/apps/atlas-app/src/state/__tests__/layerRegistry.test.ts`, `code/packages/basemap/src/style.ts`, `code/packages/basemap/src/style-compiler.ts`, `code/packages/geo/src/parseGeoCustomData.ts` (+ `.test.ts`), `code/packages/tools/src/convert.ts` (+ `.test.ts`), `code/apps/atlas-app/src/components/LayerPanel.tsx`, `code/apps/atlas-app/src/components/__tests__/{LayerPanel,MapEditor.drop,MapEditor.contextmenu}.test.tsx`, `docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md`.
- **MODIFIED** (committed): `code/apps/atlas-app/src/state/layerRegistry.ts` (Zustand slice augmentation), `code/apps/atlas-app/src/components/MapEditor.tsx` (onDrop/onDragOver/onContextMenu wiring), `code/packages/basemap/src/index.ts` (LayerStyle + style-compiler exports), `code/packages/geo/src/index.ts` (parser exports), `code/packages/tools/src/index.ts` (convert exports), `code/packages/data/src/index.ts` (Phase 0 stub → real parse/GeoJSONParseError barrel), `code/apps/atlas-app/package.json` (zustand+immer deps), `code/yarn.lock`.
- **NEW seeds this session**: none (all items addressed in-line; deferrals re-labeled).
- **CLOSED seeds this session**: atlasdraw-db43, atlasdraw-072a.
- **RE-LABELED**: atlasdraw-fc04 → `partial-followup`.
- **NO**: hooks, plugin overrides, settings.json edits.

## Knowledge State

- **Indexed**: foxhound has Phase 1 + Wave 0 + Wave 1; Wave 2 commits not yet reindexed.
- **Productive tiers**: Read+Edit+Write absolute paths, parallel Agent dispatch (3 + 2 + 1 workers), Bash for git/yarn ops, advisor for scrub validation, record-extractor for retro.
- **Gaps** (carry from prior session, mostly unchanged):
  - atlasdraw-8a21: Cross-workspace tsc still broken (rootDir noise).
  - atlasdraw-fc04: PARTIAL — LayerStyle now exported from `@atlasdraw/basemap`; atlas-app inline copy migration deferred.
  - atlasdraw-d592: Anti-pattern detector unscoped.
  - atlasdraw-0c97: Husky postinstall expects code/.git (still non-blocking, fired again this session).
  - atlasdraw-dc84: atlas-app tsconfig paths:{} clobber.
  - atlasdraw-b733: atlas-app missing vitest devDep (hoisting fragile).
  - atlasdraw-5193: T06 TextLabelTool inline-editing UX deferred.
  - atlasdraw-02f6: zRef bounds at CoordinateSync (deferred Wave 2 hardening).
  - atlasdraw-cdd3: Phase 1 dropped sources.

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — `ml prime` of architecture + infrastructure + meta domains (84 records).
3. **`docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md`** — canonical Wave 2 scrub doc; use as template for Wave 3 scrub.
4. `docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md` — Wave 1 scrub for comparison.
5. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` lines **990–1130** — T15 (PNG export) and T16 (benchmark) task definitions.
6. `code/apps/atlas-app/src/state/layerRegistry.ts` — full Zustand store + ILayerRegistry impl.
7. `code/apps/atlas-app/src/components/MapEditor.tsx` — single-file home of drop + context-menu + atlas-tool overlay; all Wave 2 wiring lives here.
8. `code/packages/basemap/src/style-compiler.ts` — current style compilation surface; Wave 3 PNG export may need to call this for layer paint props.
9. `code/packages/tools/src/convert.ts` — annotation→FeatureCollection mapping reference for any future export surfaces.

## ⚠️ Critical reminders for next session

- **Plan literals continue to drift** — Phase 2 plan was authored 2026-05-03; Wave 2 ship is 2026-05-04. Wave 3 (T15/T16) literals likely have similar drift. **Pre-dispatch scrub MANDATORY** per `mx-e9dc63`.
- **Wave 3 may need MapEditor.tsx changes** — T15 PNG export likely requires `preserveDrawingBuffer: true` on the MapLibre canvas init. That lives in `MapCanvas.tsx` (`@atlasdraw/basemap`), not MapEditor. Verify before brief authoring.
- **`yarn workspace add` is hoist-hostile** — any Wave 3 task that adds deps must run `yarn install` after, then verify build (Wave 1 [SNAG] + Wave 2 confirmation).
- **LSP diagnostics during background workers are unreliable** — phantom errors at non-existent line numbers. Source of truth: `git status`, `yarn build`, `yarn test`. Convention vindicated again this session.
- **`useCoordinateSync` is the implicit re-projection layer** — Wave 3 PNG export reads the live scene; coordinate-sync interaction is read-only (snapshot via getSceneElements). Should not need to touch the camera loop.
- **vitest `globals: false` + RTL needs explicit `afterEach(cleanup)`** — apply to any new test file in atlas-app or tools (mx-af40b4).
- **Mulch deltas (.mulch/expertise/*.jsonl) are uncommitted at session close** — orchestrator-level decision pending: bundle into a `mulch:` commit or hand off to next session.
