# Handoff

## Goal
> Continue the prior session: ship Phase 2 Wave 2 (T11–T14) and Wave 3 (T15+T16). User said "do as you recommend" four times across the session. Result: Wave 2 (4 commits) + Wave 3-T15 (1 commit) shipped clean. **T16 benchmark gate deferred** because the Phase 1 baseline + bench/ infrastructure don't exist (filed as atlasdraw-f1fa + atlasdraw-1315). Phase 2 is functionally complete; only the benchmark acceptance gate remains.

## Progress

### 6 commits this session

| SHA | Wave / Subject |
|---|---|
| `e741c71` | Wave 2a-DEPS: zustand+immer install + 244-line scrub doc |
| `b586fce` | Wave 2a-PARALLEL: T11 LayerRegistry + style-compiler + parseGeoCustomData |
| `598a4e9` | Wave 2b-Round1: T12 LayerPanel + T13 GeoJSON DnD import |
| `0032385` | Wave 2b-Round2: T14 Convert annotation→data layer |
| `bec04d9` | state: Wave 2 close + Wave 3 scrub + deferral seeds |
| `f77162d` | Wave 3-T15: composite PNG export pipeline |

### Verification at session close

- `yarn workspace @atlasdraw/atlas-app test` → **41/41 PASS** (was 15 at session start)
- `yarn workspace @atlasdraw/tools test` → **69/69 PASS** (was 58)
- `yarn workspace @atlasdraw/geo test` → **50/50 PASS** (was 31)
- `yarn workspace @atlasdraw/data test` → **6/6 PASS** (regression clean)
- `yarn build` → **PASS 14.50s**
- Tree clean, no uncommitted changes.

### Wave 2 deliverables (recap)

- **T11 LayerRegistry impl** — Zustand+immer slice on T01 ILayerRegistry; useLayerRegistry hook.
- **STYLE-COMPILER** — `compileLayer(id, style, "fill"|"line"|"circle")` + `defaultLayerStyle(fc)` + `LayerStyle` exported from `@atlasdraw/basemap`.
- **parseGeoCustomData + migrate** — deep parser throws `GeoCustomDataParseError`; migrate identity at v1 with v2+ scaffold. Closes atlasdraw-db43 + atlasdraw-072a.
- **T12 LayerPanel** — Excalidraw `<Sidebar name="layers" docked>` with two aria-labeled sections.
- **T13 GeoJSON DnD** — root-div `onDrop`+`onDragOver` → parse → registerDataLayer → addSource + addLayer.
- **T14 Convert** — right-click context menu on single-selected geo elements; mappings for rectangle/ellipse/polygon/freedraw/line/polyline; throws on text/arrow.

### Wave 3 deliverables

- **T15 PNG export** (`code/apps/atlas-app/src/lib/export.ts`) — `exportPNG(map, excalidrawAPI, opts?)` composites MapLibre canvas → Excalidraw canvas at 2× CSS-logical resolution. `preserveDrawingBuffer:true` added to MapCanvas.tsx:106. 6 colocated tests.
- **T16 DEFERRED** — see "What Didn't Work" below.

### Triage queue cleared

- 7 anti-pattern items (silent-catch gateway + 6 blocked) bulk-deferred behind `atlasdraw-d592` (anti-pattern detector unscoped). Each labeled `deferred-on:atlasdraw-d592`. `needs-triage` retained so they stay hidden from `sd ready` until the detector is scoped to atlasdraw packages only.

## What Worked

- **Pre-dispatch scrub paid off in every wave** — Wave 2 scrub caught 5 blockers (Zustand decision, store.ts absence, style-compiler.ts absence, ImportDialog.tsx drop, T11 file dependency); Wave 3 scrub caught the catastrophic T16 absence (no `bench/`, no baseline, no CI workflow). Convention `mx-e9dc63` validated three times across two waves.
- **Three-tier dispatch shape held** — Wave 2a-DEPS (1 worker) → Wave 2a-PARALLEL (3 workers, different packages) → Wave 2b-Round1 (2 workers, different files) → Wave 2b-Round2 (1 worker, serial after T13) → Wave 3-T15 (1 worker). 8 worker dispatches, 8 successful returns. Zero cross-worker conflicts.
- **Advisor caught T11-as-import-blocker pattern** — first scrub draft assumed plan's "fully parallel" claim. Saved a wave of broken typechecks.
- **Worker briefs pinned verified literals** — workers consumed verbatim, no re-grep, no drift across 8 dispatches.
- **`yarn workspace add` chained immediately with bare `yarn install`** per Wave 1 [SNAG]. No rebuilds wasted.
- **excalidraw-api.md rule satisfied four times** — T12 grep-verified `<Sidebar>` at index.tsx:342; T14 grep-verified `getSceneElements`/`getAppState`/`updateScene`/`selectedElementIds` at types.ts; T15 grep-verified `exportToCanvas` is top-level (NOT on ImperativeAPI), corrected plan literal accordingly; T15 grep-verified `getFiles` at types.ts:952.
- **Module-singleton convention correctly NOT applied** to LayerRegistry — recognized cross-component shared reactive state as different problem class. Picked Zustand+immer; recorded `mx-5ac6f6`.
- **Triage gateway insight** — `atlasdraw-1745` (silent-catch) is the gateway blocking 6 other anti-pattern issues; deferring it cascades. Layered `deferred-on` label is cleaner than closing-then-reopening when detector gets scoped.

## What Didn't Work / [SNAG]

- **[STRUCTURAL] T16 benchmark gate cannot dispatch** — `bench/` directory does not exist. `bench/results/phase-1-baseline.json` does not exist. `.github/workflows/` does not exist. Phase 1 was supposed to land the baseline; it didn't. Filed atlasdraw-f1fa (high; bench harness + Phase 1 baseline) and atlasdraw-1315 (high; gate run, blocked-by f1fa). Wave 3-T15 ships solo; Phase 2 functionally complete pending gate.
- **[SNAG] vitest `globals: false` defeats RTL automatic cleanup** — surfaced in T12 (LayerPanel) AND T14 (MapEditor.contextmenu). Two-workspace pattern. Recorded `mx-af40b4`. Fix: explicit `afterEach(cleanup)` in any RTL+vitest test file.
- **[SNAG] `@atlasdraw/data` barrel was Phase 0 stub even after Wave 1b T10 shipped** — T13 was first cross-package consumer; surfaced and fixed in Wave 2b Round 1. Convention recorded: barrel-export-as-stub signals scaffold-era omissions.
- **[SNAG] jsdom 22 has no OffscreenCanvas / convertToBlob** — T15 export.test.ts had to `vi.stubGlobal("OffscreenCanvas", …)` and stub `convertToBlob`. Production browsers unaffected.
- **Plan-literal drift, this session** (recorded `mx-619182`):
  1. T11: `store.ts` referenced as MODIFY but didn't exist.
  2. T13: `ImportDialog.tsx` referenced as MODIFY but didn't exist (dropped per scrub).
  3. T14: `customData.radiusKm` actually at `customData._data.radiusKm` (escape-hatch in seedToElement.ts:131).
  4. T14: `registry.convertAnnotationToDataLayer + map.addSource(id)` with same id was incoherent (registry mints id internally); pivoted to T13's pattern.
  5. T15: `excalidrawAPI.exportToCanvas(...)` not on ImperativeAPI in v0.18; pivoted to top-level `import { exportToCanvas } from "@excalidraw/excalidraw"`.
  6. T15: `preserveDrawingBuffer` plan said modify MapEditor.tsx but `new maplibregl.Map(...)` lives in `code/packages/basemap/src/MapCanvas.tsx`.
  7. T15: `apps/atlas-app/lib/` directory didn't exist; created under `code/apps/atlas-app/src/lib/`.
- **LSP phantom errors at `useAtlasdrawTool.ts:313+`** — never resolved across 8 worker dispatches. Confirmed phantom: builds + tests green throughout. Wave 1 [SNAG] convention vindicated repeatedly.

## Key Decisions

- **OQ-W2-1 Zustand+immer** for cross-component shared reactive state (LayerRegistry). Module-singleton stays the convention for tool-internal state. (`mx-5ac6f6`).
- **OQ-W2-2 ImportDialog dropped** — drop handler in MapEditor covers critical path; programmatic-trigger button deferred.
- **OQ-W2-3 Hardening seeds** db43+072a IN, 02f6+cdd3 OUT.
- **OQ-W2-4 T13+T14 serialized** on MapEditor.tsx (both modify same file).
- **OQ-W3-1 T16 deferred (Option B)** — Wave 3 ships T15 only. Filed atlasdraw-f1fa + atlasdraw-1315 for the deferred work. Phase 2 acceptance gate is its own seed now, not part of this wave.
- **OQ-W3-2 exportToCanvas is top-level import** — NOT a method on ImperativeAPI in v0.18.
- **OQ-W3-3 OffscreenCanvas mocked** in T15 tests (jsdom doesn't ship it).
- **`dl:` prefix mint at call site, NOT inside registry** — T11/T13/T14 all coordinate via `dl:${crypto.randomUUID()}` minted by caller (`mx-417b33`).
- **Triage bulk-deferral** — all 7 anti-pattern items labeled `deferred-on:atlasdraw-d592` instead of being individually decided. Detector scope fix unblocks them all.

## Trajectory

**How we got here:** User invoked check-handoff at session open against the prior Wave 1 ship handoff. Recommended path (a) (Wave 2 dispatch with detour to triage db43/072a). User confirmed "do as you recommend" four times across the session — first to fold hardening seeds + pick Zustand + drop ImportDialog, second to actually execute (Wave 2 ship), third for Wave 3 deferral (Option B), fourth for triage bulk-deferral. Wave 2a-DEPS shipped first (zustand@5.0.13 + immer@11.1.6, husky postinstall non-blocking). Wave 2a-PARALLEL dispatched 3 workers across different packages — all returned in 2-5 min with passing tests. Wave 2b-Round1 dispatched T12+T13 in parallel; T13 incidentally fixed `@atlasdraw/data`'s Phase-0 barrel stub. Wave 2b-Round2 ran T14 alone (it modified MapEditor which T13 had also modified — serial necessary). T14 caught two plan-literal drifts (radiusKm at `_data`, registry-id-coordination flaw). Bundled state commit (handoff + Wave 3 scrub + 2 new seeds) at bec04d9. Wave 3-T15 ran solo against the corrected scrub-doc literals. record-extractor dispatched in background after T14; appended 7 records across 3 mulch domains. Triage cleared 7 anti-pattern items via deferral label. Final HANDOFF + sidecar regenerated.

**Hard calls:**
- **Picking Zustand over module-singleton** — Wave 1's emergent convention was strong but the wrong shape for cross-component state.
- **Deferring T16 instead of fabricating baseline** — Option C (synthetic numbers) was on the table; rejected as bad-faith engineering.
- **NOT migrating atlas-app's inline `LayerStyle`** — would have collided with T11 in Wave 2a; deferred to a follow-up to keep the wave atomic.
- **Triage by label vs by close** — could have closed the 7 anti-pattern items as `outcome:rework`; chose label-deferral so they re-surface naturally when detector is scoped.
- **Skipping a second record-extractor pass** — small delta after the first run (only T15 + triage); skipped to avoid duplicate-record churn.

**Shaky ground:**
- **LayerPanel `<Sidebar>` invisible to user** without a SidebarTrigger. Tests mock the Sidebar; real Sidebar short-circuits to null unless `appState.openSidebar?.name === "layers"`. Wave 2 ships the component; opening-it UX is a follow-up (probably <30 min).
- **`map.addLayer(compileLayer(id, style, geometryType))` not regression-tested in browser** — tests mock addLayer; if MapLibre's actual paint props don't match `compileLayer`'s output, silent black layers. Recommend Playwright sanity check before declaring Phase 2 fully validated.
- **`convertAnnotationToDataLayer` registry method now never called by atlas-app code** — T14 pivoted to `registerDataLayer + remove` directly. Interface method is dead code at consumer level. Decide later: delete or keep for symmetry.
- **lng/lat domain bounds NOT enforced by `parseGeoCustomData`** — only finiteness. zRef has no min/max. atlasdraw-02f6 (deferred) covers this.
- **T15 export untested in browser** — vitest mocks OffscreenCanvas + exportToCanvas; if real MapLibre canvas doesn't drawImage cleanly into OffscreenCanvas (e.g., taint issues, CORS-backed tiles), export silently fails. Should ship with a manual smoke test before declaring complete.

**Invisible context:**
- This session's mulch records lean architecture-heavy (3 of 7 from extractor + similar pattern in Wave 3) because Wave 2/3 introduced state-management + export-pipeline decisions.
- `crypto.randomUUID()` used throughout requires secure-context (HTTPS or localhost). Vite dev server uses localhost so dev-time fine.
- Excalidraw v0.18's `<Sidebar>` lifecycle: must be mounted as a child of `<Excalidraw>` to be hooked up; ours isn't. Hooking it up is the SidebarTrigger follow-up.
- MapLibre's `preserveDrawingBuffer:true` has a small perf cost (browser keeps the framebuffer around). Acceptable for the export use case; Phase 2 perf gate (T16 deferred) will measure.

## Active Skills & Routing

- `check-handoff` (session entry).
- `dispatching-parallel-agents` (Wave 2a 3 + Wave 2b-Round1 2 + Wave 3-T15 1 workers).
- `executing-plans` (implicit — Wave 2a → Wave 2b-Round1 → Wave 2b-Round2 → Wave 3-T15).
- `verification-before-completion` (yarn build + workspace tests before each commit).
- `record-extractor` (foreground retro after Wave 2 ship; agentId `a0f9cf2894880f219`, completed).
- `triage` (bulk-deferred 7 anti-pattern items).
- `handoff` (current — second invocation this session).

**Skills NOT invoked this session that should be next:**
- `/dream detect-gaps` — 1407 uncategorized failures (was 1407 at session start; growing).
- `/dream integrate` — cross-project memories.
- `executing-plans` (eventually: bench harness + Phase 2 gate).

## Pending routing for next session

1. **Phase 2 declaring complete** — Phase 2 functional surface is done. Decide: declare Phase 2 done & start Phase 3 (`atlasdraw-25a5` File Format `.atlasdraw`) OR finish the benchmark gate first (atlasdraw-f1fa + atlasdraw-1315).
2. **High-priority polish** (≤30 min each, all reduce next-session risk):
   - Wire `<LayerPanel />` as a child of `<Excalidraw>` in MapEditor.tsx + add a sidebar-toggle button. Currently the panel is invisible.
   - Migrate atlas-app's inline `LayerStyle` to `import { type LayerStyle } from "@atlasdraw/basemap"` (closes atlasdraw-fc04).
   - Add `afterEach(cleanup)` to atlas-app + tools test files (mx-af40b4 prevention).
   - Manual browser smoke test of GeoJSON drop → render → convert → export pipeline (Playwright or by hand).
3. **Bench harness phase** (multi-session, blocks Phase 2 ship gate):
   - atlasdraw-f1fa: build code/bench/ harness + run Phase 1 scenario + write phase-1-baseline.json.
   - atlasdraw-1315: re-run with Phase 2 scenario + ci-gate.ts + .github/workflows/ci.yml.
4. **Anti-pattern detector scoping** (atlasdraw-d592) — unblocks the 7 deferred triage items.
5. **Skipped this session that may merit attention**:
   - `/dream detect-gaps` queue.
   - Push to a remote (currently local-only per `mx-8afd1a`).

## Infrastructure Delta

- **NEW** (committed, Wave 2 + Wave 3-T15): 12 source files + 6 test files + 2 scrub docs. Specifically: layerRegistry impl + useLayerRegistry hook, basemap style.ts + style-compiler.ts, geo parseGeoCustomData (+ test), tools convert (+ test), atlas-app LayerPanel.tsx + 3 test files, atlas-app lib/export.ts (+ test), Wave 2 + Wave 3 scrub decision docs.
- **MODIFIED**: layerRegistry.ts (Zustand augmentation), MapEditor.tsx (drop + context menu wiring), MapCanvas.tsx (preserveDrawingBuffer), basemap/geo/tools/data/index.ts barrels, atlas-app package.json (zustand+immer), yarn.lock.
- **NEW seeds**: atlasdraw-f1fa (P1 bench harness), atlasdraw-1315 (P1 acceptance gate, blocked-by f1fa).
- **CLOSED seeds**: atlasdraw-db43, atlasdraw-072a.
- **RE-LABELED**: atlasdraw-fc04 → `partial-followup`; 7 anti-pattern items → `deferred-on:atlasdraw-d592`.
- **NEW mulch records** (committed in bec04d9 from background extractor): 7 across architecture/infrastructure/meta domains.
- **NO**: hooks, plugin overrides, settings.json edits, no Phase 3+ work.

## Knowledge State

- **Indexed**: foxhound has Phase 1 + Wave 0 + Wave 1; Wave 2 + Wave 3-T15 commits not yet reindexed.
- **Productive tiers**: Read+Edit+Write absolute paths, 8 parallel/serial Agent dispatches (general-purpose subagent_type), Bash for git/yarn/sd, advisor for scrub validation, record-extractor for retro.
- **Gaps**:
  - atlasdraw-8a21: Cross-workspace tsc still broken (rootDir noise).
  - atlasdraw-fc04: PARTIAL — LayerStyle now exported from `@atlasdraw/basemap`; atlas-app inline copy migration deferred.
  - atlasdraw-d592: Anti-pattern detector unscoped; blocking 7 triage items.
  - atlasdraw-0c97: Husky postinstall expects code/.git (still non-blocking).
  - atlasdraw-dc84: atlas-app tsconfig paths:{} clobber.
  - atlasdraw-b733: atlas-app missing vitest devDep (hoisting fragile).
  - atlasdraw-5193: T06 TextLabelTool inline-editing UX deferred.
  - atlasdraw-02f6: zRef bounds at CoordinateSync (deferred Wave 2 hardening).
  - atlasdraw-cdd3: Phase 1 dropped sources.
  - **atlasdraw-f1fa**: NEW — bench harness + Phase 1 baseline establishment.
  - **atlasdraw-1315**: NEW — Phase 2 acceptance gate (blocked-by f1fa).

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — `ml prime` of architecture + infrastructure + meta domains (84+ records).
3. **`docs/decisions/wave3-pre-dispatch-scrub-2026-05-04.md`** — canonical example of catching a STRUCTURAL blocker (T16 baseline absence). Use as template if a future wave/phase has similar infrastructure gaps.
4. `docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md` — Wave 2 scrub for comparison.
5. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` lines **1078–1146** — T16 task definition (deferred this session).
6. `code/apps/atlas-app/src/components/MapEditor.tsx` — single-file home of drop + context-menu + atlas-tool overlay; all Wave 2/3 wiring lives here.
7. `code/apps/atlas-app/src/lib/export.ts` — Wave 3-T15 PNG export reference; future export surfaces (PDF, SVG, etc.) should mirror the composition pattern.
8. `code/packages/basemap/src/MapCanvas.tsx:106` — `preserveDrawingBuffer:true` line; T15 prerequisite.
9. `code/apps/atlas-app/src/state/layerRegistry.ts` — full Zustand store + ILayerRegistry impl.

## ⚠️ Critical reminders for next session

- **Phase 2 is functionally complete BUT acceptance gate (T16) is deferred** — don't declare Phase 2 "done" without surfacing this caveat. atlasdraw-3a5b (parent) stays open until f1fa+1315 resolve.
- **Plan literals continue to drift** — pre-dispatch scrub MANDATORY for any future wave (`mx-e9dc63`).
- **`yarn workspace add` is hoist-hostile** — chain bare `yarn install` after.
- **LSP diagnostics during background workers are unreliable** — phantom errors at non-existent line numbers. Source of truth: build + tests + git status.
- **vitest `globals: false` + RTL needs explicit `afterEach(cleanup)`** — apply to any new RTL test file (mx-af40b4).
- **`<LayerPanel />` is unrendered** — Wave 2 ships the component but the user never sees it without SidebarTrigger wiring. Easy 30-min follow-up.
- **T15 export untested in real browser** — recommend a manual or Playwright smoke test before declaring Phase 2 functional.
- **sd CLI flag inconsistency** — `sd create` uses `--labels` (plural, comma-separated); `sd list` uses `--label` (singular, repeatable). Don't confuse.
- **All work is local-only** — no remote push this session, per `mx-8afd1a`. Confirm with maintainer before pushing.
