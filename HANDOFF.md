# Handoff

## Goal
> Continue prior session: ship Phase 2 Wave 2 (T11–T14) + Wave 3 (T15+T16). User said "do as you recommend" / "do all recommended" five times across the session. Result: Phase 2 functional surface complete (T01–T15 shipped), T16 deferred, post-T15 manual-smoke hotfix (drop hijack + convert atomicity) shipped, anti-pattern triage queue cleared via bulk deferral, **Wave 4 hardening sprint scoped and added to the plan** (12 tasks closing 18 deferred seeds).

## Progress

### 9 commits this session

| SHA | Wave / Subject |
|---|---|
| `e741c71` | Wave 2a-DEPS: zustand+immer install + 244-line scrub doc |
| `b586fce` | Wave 2a-PARALLEL: T11 LayerRegistry + style-compiler + parseGeoCustomData |
| `598a4e9` | Wave 2b-Round1: T12 LayerPanel + T13 GeoJSON DnD import |
| `0032385` | Wave 2b-Round2: T14 Convert annotation→data layer |
| `bec04d9` | state: Wave 2 close + Wave 3 scrub + deferral seeds |
| `f77162d` | Wave 3-T15: composite PNG export pipeline |
| `0a527e3` | state: Phase 2 functional ship + Wave 3-T15 + triage deferral |
| `d121188` | fix: drop hijack + convert atomicity (post-T15 manual smoke fixes) |
| `35d3765` | docs(phase-2): Wave 4 addendum — Phase 1+2 hardening sprint |

### Verification at session close

- `yarn workspace @atlasdraw/atlas-app test` → **41/41 PASS** (was 15)
- `yarn workspace @atlasdraw/tools test` → **69/69 PASS** (was 58)
- `yarn workspace @atlasdraw/geo test` → **50/50 PASS** (was 31)
- `yarn workspace @atlasdraw/data test` → **6/6 PASS**
- `yarn build` → **PASS 14.11s**
- Tree dirty only with one **unrelated** edit on `code/packages/geo/src/CoordinateSync.ts` (uppercase enum casing) — see "Shaky ground" below.

### Wave 2 deliverables

T11 LayerRegistry impl (Zustand+immer slice on T01 ILayerRegistry); STYLE-COMPILER (compileLayer + defaultLayerStyle + LayerStyle from `@atlasdraw/basemap`); parseGeoCustomData + migrate (closes db43+072a); T12 LayerPanel; T13 GeoJSON DnD; T14 Convert annotation→data layer.

### Wave 3 deliverables

T15 PNG export (`code/apps/atlas-app/src/lib/export.ts`); preserveDrawingBuffer added to MapCanvas.tsx:106. T16 deferred to atlasdraw-1315 (blocked-by atlasdraw-f1fa).

### Post-T15 manual-smoke hotfix (`d121188`)

User reported (manual browser test):
1. After GeoJSON drop, existing annotations stop tracking the basemap.
2. Convert-to-data-layer makes the annotation vanish AND no data layer appears.

Diagnosis + fix:
1. **Drop hijack**: Excalidraw's `handleAppOnDrop` (App.tsx:2147) lives on a deeper div than MapEditor's outer wrapper. React-bubble drop handlers fire deeper-first, so Excalidraw's `parseDataTransferEvent` consumed `dataTransfer.files` before ours saw it — drop silently no-op'd. Fix: native capture-phase `addEventListener("drop"/"dragover", h, { capture: true })` on rootRef. For `.geojson` files: `preventDefault` + `stopPropagation` so Excalidraw never sees the event. For other types: propagation continues.
2. **Convert atomicity**: handleConvert ran `registry.registerDataLayer + remove` BEFORE `map.addSource/addLayer`. If addSource/addLayer threw, registry was mutated and updateScene still ran in some paths → annotation deleted, no replacement. Fix: pure-compute → map mutations (with `removeSource` rollback if `addLayer` throws) → registry mutations → `updateScene` last.

### Wave 4 plan addendum (`35d3765`)

`docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` extended with new section "Wave 4 — Phase 1+2 Hardening (Addendum)" — 250 lines, 12 tasks across 3 sub-waves, closes 18 deferral seeds:

- **Wave 4a (Phase 1 unfinished business):** T17 Task 8 scaleMode override → T18 native auto-anchor extension; T19 bench harness + Phase 1 baseline → T20 Phase 2 acceptance gate; T21 Phase 1 dropped sources.
- **Wave 4b (Wave 2/3 visible polish + bug):** T22 LayerPanel SidebarTrigger; T23 PNG export UI button; T24 mixed-geometry FC handling (real bug); T25 TextLabelTool inline-editing.
- **Wave 4c (Hardening + cleanup):** T26 zRef bounds + LayerStyle migration; T27 build/dep quality debt; T28 architectural orphans.

### Wave 2 hardening seeds + triage state

- **Closed**: atlasdraw-db43, atlasdraw-072a (commit b586fce).
- **Deferred to Wave 4**: atlasdraw-{375a, f1fa, 1315, cdd3, fc04, 02f6, 5193, 0c97, dc84, b733, 8a21, d592} all gain `wave:4` label.
- **New seeds for Wave 4**: atlasdraw-{7748, ca89, 4142, cf62, 6e9a, cc43} (6 created).
- **Triage queue cleared** via bulk deferral: 7 anti-pattern items each labeled `deferred-on:atlasdraw-d592` (the underlying detector-scoping fix would unblock all 7).

## What Worked

- **Pre-dispatch scrub paid off three times** — Wave 2 scrub caught 5 blockers, Wave 3 scrub caught the catastrophic T16 absence (no `bench/` infra), and even the **Wave 4 plan addendum's own path drift was caught and corrected before commit** (mx-e9dc63 lesson is recursive).
- **Wave shape held under pressure**: Wave 2a-DEPS (1 worker) → Wave 2a-PARALLEL (3 workers) → Wave 2b-Round1 (2 workers) → Wave 2b-Round2 (1 worker) → Wave 3-T15 (1 worker). 8 dispatches, 8 successful returns, zero cross-worker conflicts.
- **Manual smoke testing exposed real bugs that mocks missed**: Excalidraw's drop hijack + convert atomicity were both invisible to vitest. The `[eval: regression-clean]` checkpoint can be expanded to require browser smoke before declaring "Wave shipped."
- **Capture-phase listener pattern** is the canonical fix for "Excalidraw eats my events" — should be reusable for any future event we want to handle BEFORE Excalidraw.
- **Convert-flow atomicity ordering** (pure-compute → map mutations with rollback → registry → scene-mutation last) generalizes to any multi-system-mutation flow.
- **Triage bulk-deferral via `deferred-on:<seed>` label** beat per-item decisions for 7 anti-pattern findings — keeps `needs-triage` for hidden-from-ready, but adds traceability + auto-unhide path when detector lands.
- **Wave 4 absorption pattern**: deferred work from Phase 1 (Task 8, baseline, dropped sources) merged with Phase 2 polish into a single hardening sprint instead of fragmenting across phases. Avoids "leftover work tax" repeating itself.

## What Didn't Work / [SNAG]

- **[STRUCTURAL] T16 benchmark gate cannot dispatch as-written** — `bench/` directory absent, Phase 1 baseline never measured. Filed atlasdraw-f1fa (high; bench harness) + atlasdraw-1315 (high; gate run, blocked-by f1fa). Wave 3 shipped T15 only.
- **[SNAG] Excalidraw drop hijack masked T13 entirely** — vitest tests passed because they fired `fireEvent.drop` on the bubble path; real browser routes drop through Excalidraw's deeper handler first. Capture-phase listener is the fix; documented in `d121188` commit body.
- **[SNAG] Convert atomicity** — registry mutation ran before risky map calls; partial state on failure. Fixed in `d121188` with reorder + `removeSource` rollback.
- **[SNAG] vitest globals:false defeats RTL automatic cleanup** — surfaced in T12 + T14, recorded `mx-af40b4`. Wave 4 T28 covers systematic remediation.
- **[SNAG] @atlasdraw/data barrel was Phase 0 stub even after Wave 1b T10 shipped** — T13 first cross-package consumer; surfaced and fixed in Wave 2b Round 1.
- **[SNAG] jsdom 22 has no OffscreenCanvas/convertToBlob** — T15 stub'd them. Production browsers unaffected.
- **Plan-literal drift** (recorded `mx-619182`):
  1. T11: `store.ts` MODIFY-but-absent.
  2. T13: `ImportDialog.tsx` MODIFY-but-absent (dropped per scrub).
  3. T14: `customData.radiusKm` actually at `customData._data.radiusKm`.
  4. T14: `registry.convertAnnotationToDataLayer + map.addSource(id)` with same id incoherent (registry mints id internally).
  5. T15: `excalidrawAPI.exportToCanvas(...)` not on ImperativeAPI; pivoted to top-level import.
  6. T15: `preserveDrawingBuffer` location wrong (MapCanvas.tsx not MapEditor.tsx).
  7. T15: `apps/atlas-app/lib/` directory didn't exist.
  8. **Wave 4 addendum**: T17/T18 paths under `apps/atlas-app/src/services/` but CoordinateSync lives in `code/packages/geo/src/`. Caught at commit prep.
- **LSP phantom errors at `useAtlasdrawTool.ts:313+`** — fired throughout 8 worker dispatches. Phantom; build + tests are truth (Wave 1 [SNAG] vindicated).

## Key Decisions

- **OQ-W2-1 Zustand+immer** for cross-component shared reactive state (`mx-5ac6f6`).
- **OQ-W2-2 ImportDialog dropped** — drop handler covers critical path.
- **OQ-W2-3 Hardening seeds**: db43+072a IN, 02f6+cdd3 OUT-of-Wave-2 (later folded into Wave 4).
- **OQ-W2-4 T13+T14 serialized** on MapEditor.tsx.
- **OQ-W3-1 T16 deferred (Option B)** — Wave 3 ships T15 only.
- **OQ-W3-2 exportToCanvas is top-level import**, NOT method on ImperativeAPI.
- **OQ-W3-3 OffscreenCanvas mocked** in T15 tests.
- **OQ-W4-0 Wave 4 absorbs Phase 1+2 hardening into single sprint** instead of fragmenting.
- **`dl:` prefix mint at call site** (`mx-417b33`).
- **Triage bulk-deferral** via `deferred-on:atlasdraw-d592` label.
- **Drop hijack fix is capture-phase + selective stopPropagation**, NOT bubble-phase — match the depth-first event flow Excalidraw expects.
- **Convert atomicity order** = pure-compute → map mutations (with rollback) → registry → scene mutation last.

## Trajectory

**How we got here:** Session started with a /clear + /check-handoff against the prior Wave 1 ship handoff. Recommended path (a) (Wave 2 dispatch with detour for db43/072a triage). User confirmed "do as you recommend" / "do all recommended" five times — first to fold hardening seeds + pick Zustand + drop ImportDialog, second to actually execute (Wave 2 ship), third for Wave 3 T16 deferral (Option B), fourth for triage bulk-deferral, fifth for Wave 4 plan addendum. Wave 2 ship was clean (4 commits). T15 ship was clean (1 commit). Then user manually browser-smoked and reported two real bugs (drop hijack + convert vanish). Fixed both in d121188. User then audited deferred items, triggered Wave 4 addendum scoping. Plan now has explicit closure path for Phase 1+2 leftovers.

**Hard calls:**
- **Picking Zustand over module-singleton** — Wave 1's emergent convention strong but wrong shape for this problem class.
- **Deferring T16 instead of synthetic baseline** — Option C (fake numbers) explicitly rejected as bad-faith.
- **Wave 4 as ONE sprint vs splitting across phases** — splitting would have left Phase 1 leftovers permanently floating; absorbing forces canonical close.
- **Capture-phase listener vs other drop-hijack fixes** — could have re-parented MapEditor to wrap Excalidraw differently, or used Excalidraw's own onDrop hook (if v0.18 exposes one). Capture-phase chosen as least-invasive + cleanest separation of concerns.
- **Letting Excalidraw still handle non-.geojson drops** — could have stopPropagation on ALL drops. Chose selective so png/svg/library drops still work (better UX).
- **Filing 6 NEW seeds for Wave 4** — could have hand-tracked them in the plan only. Filed seeds because they need `sd ready` visibility once Wave 4 dispatches.

**Shaky ground:**
- **An unrelated dirty diff** is sitting in working tree on `code/packages/geo/src/CoordinateSync.ts` — uppercase enum casing change (`"never"` → `"NEVER"`, etc., x2 occurrences). NOT mine; possibly editor auto-format or a hook. Build + tests still pass. Decide whether to keep or revert before Wave 4 dispatch touches that file.
- **LayerPanel `<Sidebar>` invisible to user** without SidebarTrigger — Wave 4 T22 fixes it. Browser smoke gated on this.
- **T15 export untested in real browser** — vitest mocks OffscreenCanvas + exportToCanvas. Tainted-canvas (CORS basemap tiles) is the highest silent-fail risk. Wave 4 T23 + manual smoke catches it.
- **Mixed-geometry GeoJSON FCs render only `features[0]`'s geometry style** — real bug, no regression yet because no user has tested mixed FCs. Wave 4 T24 fixes.
- **`convertAnnotationToDataLayer` registry method is dead code** — T14 pivoted away. Wave 4 T28 decides delete vs refactor.
- **Capture-phase listener test coverage** — `fireEvent.drop` works on capture-phase listeners (verified by tests still passing), but real-browser drop event flow may have edge cases not exercised.

**Invisible context:**
- **Excalidraw `handleAppOnDrop` lives at `code/packages/excalidraw/components/App.tsx:2147,11872`** — useful breadcrumb for any future event-handling conflicts.
- **Real Sidebar in v0.18 short-circuits to null** unless `appState.openSidebar?.name === "layers"` — Wave 4 T22 is more than just a button, it requires plumbing the appState.
- **`crypto.randomUUID()` requires secure context** — works on localhost dev but production HTTP would break. Note for Phase 4 self-host wave.
- **MapLibre `preserveDrawingBuffer:true` has small perf cost** (browser keeps framebuffer); T20 (Phase 2 perf gate) will measure.
- **The Wave 4 plan addendum's existence is a meta-signal** that this codebase has accumulated technical debt at a rate roughly equal to feature velocity — worth surfacing in retros.

## Active Skills & Routing

- `check-handoff` (session entry).
- `triage` (bulk-deferred 7 anti-pattern items mid-session).
- `dispatching-parallel-agents` (8 worker dispatches across the session).
- `executing-plans` (implicit — Wave 2a → Wave 2b-Round1 → Wave 2b-Round2 → Wave 3-T15).
- `verification-before-completion` (yarn build + workspace tests before each commit).
- `record-extractor` (foreground retro at Wave 2 close; agentId `a0f9cf2894880f219`, completed; not re-dispatched after the hotfix + Wave 4 plan).
- `systematic-debugging` (post-T15 hotfix root cause).
- `handoff` (current — third invocation this session).

**Skills NOT invoked this session that should be next:**
- `/dream detect-gaps` (1407 uncategorized failures; growing).
- `/dream integrate` (cross-project memories).
- `executing-plans` (Wave 4 dispatch; needs pre-dispatch scrub first per `mx-e9dc63`).

## Pending routing for next session

1. **Decide Wave 4 dispatch shape** — single multi-week sprint or split into 4a/4b/4c independent commits. Wave 4 plan addendum recommends parallel-where-possible.
2. **Pre-dispatch scrub for Wave 4** — mandatory per `mx-e9dc63`. Plan addendum literals will drift within 24h. Use `wave3-pre-dispatch-scrub-2026-05-04.md` as template.
3. **Decide on the unrelated CoordinateSync.ts diff** — stage or revert before any Wave 4 work touches it.
4. **Manual browser smoke test of fixed pipeline** — drop GeoJSON → see features → existing annotations still geopin → right-click polygon → Convert → see data layer. The d121188 hotfix needs in-browser verification.
5. **Recommend re-running record-extractor for the post-Wave-2 commits** — d121188 + 35d3765 weren't covered by the prior retro. New mulch-worthy patterns: drop hijack capture-phase fix, convert atomicity reorder, Wave 4 absorption pattern.
6. **Optional housekeeping**:
   - `/dream detect-gaps` (1407+ uncategorized).
   - SidebarTrigger 30-min UX win (Wave 4 T22).
   - Push to remote (currently local-only per `mx-8afd1a`; no push this session).

## Infrastructure Delta

- **NEW** (committed): 12 source files + 7 test files + 3 docs (Wave 2 + 3 scrub docs + Wave 4 addendum). All under `code/apps/atlas-app/src/`, `code/packages/{tools,geo,data,basemap}/src/`, `docs/decisions/`, `docs/superpowers/plans/`.
- **MODIFIED** (committed): layerRegistry.ts, MapEditor.tsx (drop + context menu + capture-phase + atomicity), MapCanvas.tsx (preserveDrawingBuffer), basemap/geo/tools/data/index.ts barrels, atlas-app package.json (zustand+immer), yarn.lock.
- **NEW seeds**: atlasdraw-{f1fa, 1315, 7748, ca89, 4142, cf62, 6e9a, cc43} (8 total).
- **CLOSED seeds**: atlasdraw-db43, atlasdraw-072a.
- **RE-LABELED**: 12 seeds gain `wave:4`; atlasdraw-fc04 → `partial-followup`; 7 anti-pattern items → `deferred-on:atlasdraw-d592`.
- **NEW mulch records** (commit bec04d9): 7 from background extractor across architecture/infrastructure/meta. Post-Wave-2 commits (d121188, 35d3765) not yet extracted.
- **NO**: hooks, plugin overrides, settings.json edits.

## Knowledge State

- **Indexed**: foxhound has Phase 1 + Wave 0 + Wave 1; Wave 2 + Wave 3-T15 + d121188 + 35d3765 not yet reindexed.
- **Productive tiers**: Read+Edit+Write absolute paths, 8 parallel/serial Agent dispatches (general-purpose subagent_type), Bash for git/yarn/sd, advisor for scrub validation, record-extractor for retro.
- **Gaps**:
  - atlasdraw-8a21: cross-workspace tsc broken (Wave 4 T27).
  - atlasdraw-fc04: PARTIAL — basemap LayerStyle exported; atlas-app inline copy migration deferred (Wave 4 T26).
  - atlasdraw-d592: anti-pattern detector unscoped; blocks 7 triage items (Wave 4 task NOT — scope decision orthogonal).
  - atlasdraw-0c97: husky postinstall (Wave 4 T27).
  - atlasdraw-dc84: paths:{} clobber (Wave 4 T27).
  - atlasdraw-b733: vitest devDep hoisting (Wave 4 T27).
  - atlasdraw-5193: TextLabelTool inline-editing (Wave 4 T25).
  - atlasdraw-02f6: zRef bounds (Wave 4 T26).
  - atlasdraw-cdd3: Phase 1 dropped sources (Wave 4 T21).
  - atlasdraw-375a: Task 8 scaleMode override (Wave 4 T17).
  - **atlasdraw-f1fa**: bench harness + Phase 1 baseline (Wave 4 T19).
  - **atlasdraw-1315**: Phase 2 acceptance gate (Wave 4 T20).
  - 6 new Wave 4 seeds (7748, ca89, 4142, cf62, 6e9a, cc43) covered by Wave 4 T22-T28.

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — `ml prime` of architecture + infrastructure + meta domains.
3. **`docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md`** lines **1354–1603** — Wave 4 addendum (12 tasks closing 18 seeds).
4. `docs/decisions/wave3-pre-dispatch-scrub-2026-05-04.md` — Wave 3 scrub (T16 deferral rationale).
5. `docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md` — Wave 2 scrub (template for Wave 4).
6. `code/apps/atlas-app/src/components/MapEditor.tsx` — single-file home of capture-phase drop + onContextMenu + atlas-tool overlay; ALL Wave 2/3 visible UX wiring lives here.
7. `code/apps/atlas-app/src/state/layerRegistry.ts` — full Zustand+immer store + ILayerRegistry impl.
8. `code/apps/atlas-app/src/lib/export.ts` — Wave 3-T15 PNG export reference.
9. Commit `d121188` body — drop hijack + convert atomicity diagnosis (capture-phase pattern + atomicity reorder principle worth re-using).

## ⚠️ Critical reminders for next session

- **Phase 2 functionally complete BUT acceptance gate (T16) is deferred** — atlasdraw-3a5b (Phase 2 parent) stays open until Wave 4-T20 lands.
- **Wave 4 plan literals will drift within 24h** — pre-dispatch scrub MANDATORY per `mx-e9dc63`. Even MY OWN plan addendum had path drift caught at commit prep.
- **Unrelated CoordinateSync.ts diff in working tree** — uppercase enum casing, not mine. Decide before Wave 4-T17 touches that file (T17 modifies `code/packages/geo/src/CoordinateSync.ts`).
- **Drop hijack capture-phase pattern** — re-usable for any event Excalidraw eats first. Documented in `d121188` body.
- **Convert atomicity ordering** — pure-compute → map (with rollback) → registry → scene-mutation last. Apply to any multi-system flow.
- **Manual browser smoke is the only way to catch UI bugs** — vitest mocks `<Sidebar>`, `OffscreenCanvas`, `map.addSource`/`addLayer`, `exportToCanvas`. The d121188 bugs were invisible to tests. Wave 4 T22+T23 ship visible UX surfaces; smoke after each.
- **`yarn workspace add` is hoist-hostile** — chain bare `yarn install` after.
- **LSP diagnostics during background workers are unreliable** — phantom errors at non-existent lines. Source of truth: build + tests.
- **vitest `globals: false` + RTL needs explicit `afterEach(cleanup)`** — Wave 4 T28 systematizes.
- **sd CLI flag inconsistency**: `sd create` uses `--labels` (plural, comma-separated); `sd list` uses `--label` (singular). `sd block <id> --by <blocker-id>`. Don't confuse.
- **All work is local-only** — no remote push this session, per `mx-8afd1a`.
