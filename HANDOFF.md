# Handoff

## Goal

> "/check-handoff then do a scrub for phase 3" → "do all 4" → "scrub the plans for phase 4" → "look at older phase plans and see what was not implemented in time for phase 4" → "do as you recommend" → "start the prereqs" → "9078: unify export menu via Excalidraw's existing place; e9db: A composite-tsconfig" → "what is the current visual smoke test of the demo expected" → "start testing with the playwright-cli" → "fix these"

Land Phase 4 Wave 0 prereqs to unblock the Phase 4 epic (`atlasdraw-4579`), expose the 1585 latent tsc errors via composite-project tsconfig refactor, then run a real-browser smoke test and fix what breaks.

## Progress

**This session — 16 commits.** All 6 Wave 0 prereqs closed; smoke-test surfaced 4 bugs and fixed 3 (last is open-debt).

- ✅ `05fdea0` — fix(tsconfig): `ignoreDeprecations 6.0 → 5.0` + Phase 3 closure scrub (filed atlasdraw-ad27/3601/9078/0403, closed 25a5)
- ✅ `7270c2a` — docs(phase-4): wave0 pre-dispatch scrub + plan amendments + seed DAG wiring (filed e9db; blocked 4579 by 6 prereqs)
- ✅ `d038fe2` — feat(excalidraw): T-50c0 barrel-export Dialog + DialogProps + DialogSize
- ✅ `d06ce90` — feat(basemap): T-2428 scaffold BasemapRegistry + pmtiles-protocol + style-builder (+12 tests)
- ✅ `9b734e0` — docs(spec): T-5cba update §4.2 + §10 to reflect hybrid-default basemap (Q3)
- ✅ `73642c2` — feat(state): T-ad27 data-layer FC registry — useDataLayerFCStore (+14 tests)
- ✅ `2f2d496` — feat(state): T-3601 hydrate scene + layers + FCs from persistence load() (+8 tests)
- ✅ `e2e99e8` — feat(state): T-9078 unify atlasdraw export menu via renderCustomUI (+4 tests)
- ✅ `daa59db` — chore(handoff): mid-session handoff at 82% context (e9db worker still running)
- ✅ `e69c91b` — chore(handoff): mulch sidecar + 4 session conventions captured
- ✅ `f0df8af` — refactor(tsconfig): T-e9db composite-project references — replace atlas-app paths:{} clobber (worker output salvaged from working tree after watchdog timeout; 539 latent tsc errors now visible vs hidden)
- ✅ `87735b7` — chore(seeds): unblock atlasdraw-4579 — all 6 Phase 4 Wave 0 prereqs closed
- ✅ `7624a9b` — chore(seeds): file 4 issues from playwright smoke test of HEAD (27d8/12f0/8ae2/320b)
- ✅ `ae1a15c` — fix(atlas-app): smoke-test bugs — Pin tool (P0), dirty-on-init, stale title

**Wave 0 status (6 prereqs):** ALL CLOSED.

| Seed | Status | Commit |
|---|---|---|
| `atlasdraw-50c0` Dialog barrel | ✅ closed | `d038fe2` |
| `atlasdraw-2428` BasemapRegistry | ✅ closed | `d06ce90` (+12 tests) |
| `atlasdraw-5cba` tech-spec doc-debt | ✅ closed | `9b734e0` |
| `atlasdraw-ad27` FC registry | ✅ closed | `73642c2` (+14 tests) |
| `atlasdraw-3601` scene hydration | ✅ closed | `2f2d496` (+8 tests) |
| `atlasdraw-9078` MainMenu unification | ✅ closed | `e2e99e8` (+4 tests) |
| `atlasdraw-e9db` composite-tsconfig | ✅ closed | `f0df8af` (worker salvage; 539 latent errors visible) |

**Smoke-test follow-up (4 seeds filed in `7624a9b`, 3 closed in `ae1a15c`):**

| Seed | Status | Resolution |
|---|---|---|
| `atlasdraw-27d8` (P0) Pin tool `InvalidFractionalIndexError` | ✅ closed | `syncInvalidIndices` wrap in `addElement` + `applyElementPatch` + `hydrate.ts` step 3 |
| `atlasdraw-12f0` (P2) `● Unsaved` indicator on first load | ✅ closed | `prevElementsRef` gates `markDirty` so initial mount doesn't trip dirty |
| `atlasdraw-8ae2` (P3) stale "Phase 1 Demo" title + overlay | ✅ closed | title now "Atlasdraw"; demo overlay deleted from `App.tsx` |
| `atlasdraw-320b` (P3) blob-URL number-null warnings | ⏳ open | Needs source-map sleuthing on `blob:http://...` URL — deferred |

**Test counts at handoff:**
- `@atlasdraw/data`: 83 (unchanged contract; SceneElement structural alias added).
- `@atlasdraw/cli`: 11.
- `@atlasdraw/basemap`: 0 → **12** (BasemapRegistry + pmtiles-protocol + style-builder).
- `@atlasdraw/atlas-app`: 113 → **139** (+26 from ad27 + 3601 + 9078; smoke-test fixes preserved baseline).
- atlas-app `yarn build`: green (11.90s).
- `tsc -b` from `code/`: 0 errors in atlas-owned graph; 539 latent atlas-app errors now visible (Phase 4+ task).

**Smoke-test verification (real browser via playwright-cli):**
- Page loads, title "Atlasdraw" ✓
- MainMenu opens with full item list (Open, Save to..., Export composite PNG, Pin to map, Layers panel, Find on canvas, Help, Reset, Canvas BG, Dark mode) — no stale Unsaved item ✓
- Save-to-... dialog shows 4 cards: Save to disk → Save .atlasdraw → Open .atlasdraw → GeoJSON (smartly disabled with "No geo-anchored annotations in scene" helper text) ✓
- Pin tool placement no longer throws `InvalidFractionalIndexError` ✓
- Console: only 1 favicon 404 (cosmetic) + the open `atlasdraw-320b` blob-URL number-null warnings.

**Known broken / incomplete (post-smoke-test reality check):**

| Issue | Symptom | Tracker |
|---|---|---|
| No basemap picker | Can't switch styles in UI yet (registry exists but no `BasemapPicker` component) | Phase 4 T6 |
| Mixed-geometry GeoJSON | A FeatureCollection with both points AND lines renders only the FIRST feature's geometry style | `atlasdraw-4142` (HIGH severity, demo-blocking) |
| Binary scene assets | Paste an image into the canvas → save → refresh → image is GONE. `addFiles()` was deferred from 3601 | tracked in 3601 closure note |
| IDB stderr noise | Component tests log `indexedDB is not defined` but pass | `atlasdraw-0403` (low; non-functional) |
| No share-link, no storage server, no docker | Phase 4 T1+ work; not yet implemented | Phase 4 epic `atlasdraw-4579` |
| `atlasdraw-320b` blob-URL warnings | 3× console "Expected value to be of type number, but found null instead" from `blob:http://...` URL — needs source-map sleuthing | `atlasdraw-320b` (P3) |
| `cli/src/atlasdraw.ts` chmod drift | Mode-only 644→755 in working tree across all sessions; correct mode for shebang CLI but `git status` keeps showing it. Cannot `git checkout --` without explicit auth | benign cosmetic |

**Branch:** main, **36 ahead** of origin/main. Working tree dirty: `code/packages/cli/src/atlasdraw.ts` (chmod 644→755 mode-only — benign, CLI bin file with shebang). Untracked: `.claude/scheduled_tasks.lock` (runtime).

## What Worked

- **Pre-dispatch scrub before Wave 0.** `wave0-pre-dispatch-scrub-2026-05-06.md` consolidated 12 plan-literal drifts + 5 missing prereq gates BEFORE any worker dispatch. Workers consumed verified literals from the scrub doc, not the raw plan; zero plan-literal drift in 4 worker outputs.
- **Seed DAG via `sd block`.** Wired `atlasdraw-4579` (Phase 4 epic) blocked by all 6 prereqs. `sd ready` immediately surfaced the right next-up issues without needing prose interpretation. Survives handoff loss.
- **Parallel worker dispatch with explicit non-overlap matrix.** Wave A: 2428 (basemap) + ad27 (atlas-app state) ran concurrent, zero file overlap, both green on first return. Wave B: 9078 + e9db ran concurrent (different surfaces — atlas-app components vs tsconfig). 4 workers total, 4 commits.
- **Worker pivots when given context.** 9078 worker discovered `UIOptions.canvasActions.export.renderCustomUI` (Excalidraw's official extension point) AFTER seeing the brief's "build a parallel dialog" suggestion — pivoted to extending the existing dialog. Strictly better outcome. 3601 worker chose structural `SceneElement` alias instead of importing `OrderedExcalidrawElement` to avoid polluting CLI deps.
- **Closure-loop discipline.** Each closed seed has a per-commit `outcome:success` rationale recorded; HANDOFF prose isn't load-bearing.

## What Didn't Work

- **`code/packages/cli/src/atlasdraw.ts` chmod drift** appears in `git status` after every worker that touches the workspace. Mode-only 644→755 (correct for shebang CLI entry). Tried `git checkout --` to discard; auth denial blocked it. Left dirty across all 5 commits — harmless but ugly.
- **`paths:{}` clobber root-cause TBD.** e9db worker's first task is to investigate `dd418c2`'s "intentional" annotation. If the intent invalidates composite-project, the worker will surface back rather than force.
- **Phase 4 plan path drift NOT bulk-fixed.** All `apps/…` references in the plan still miss `code/` prefix; atlas-app paths still miss `src/`. Workers consult the scrub doc instead. A future bulk sed-replace is low-leverage (banner caught everything that needed catching this session) but should happen before any non-AI human reads the plan.

## Key Decisions

- **`SceneElement` structural alias** (3601) — `{ id, type, version, [key:string]: unknown }`. Excalidraw's `OrderedExcalidrawElement` is structurally assignable to it. Avoids circular dep between `@atlasdraw/data` (currently excalidraw-free) and the vendored Excalidraw.
- **FC store wiring via LayerRegistry actions, not `useLayerRegistrySync`** (ad27) — the hook never sees FC payloads (MapEditor.tsx does, but brief forbade touching it). Registry actions already receive FC as a parameter. Cleanest seam.
- **`hydrate.ts` factored as pure function** (3601, advisor recommendation) — `hydrate(loaded, excalidrawAPI)` callable from both load-on-mount and MainMenu Open. Tests use it directly without React mount.
- **`queueMicrotask` for `isDirty=false` after hydration** (3601) — handles the autosave race where `markDirty` could fire mid-hydration. Tested explicitly.
- **`renderCustomUI` extension point** (9078) — Excalidraw's `UIOptions.canvasActions.export.renderCustomUI` injects React into JSONExportDialog Card grid. atlas-app already wired it for GeoJSON. Extended with 2 cards for `.atlasdraw` save/open. Zero vendored-fork changes needed.
- **Composite-project for ALL packages including vendored** (e9db brief) — partial composite is messier than full composite. Vendored Excalidraw packages get `composite: true` even though they don't publish d.ts independently.

## Trajectory

**How we got here.** Session opened on `26cdbc9` (Phase 3 W2+W3 closure handoff). User asked for /check-handoff + Phase 3 scrub. Scrub found tsc broken in data + cli (`tsconfig.base.json:3 "ignoreDeprecations": "6.0"` invalid for TS 5.9.3 — but handoff claimed "tsc clean") + atlasdraw-25a5 still open + 3 Phase 4 prereqs stranded as `[NOTE]` markers in MapEditor.tsx. Fixed all 4 in `05fdea0`. User said "scrub the plans for phase 4" — found 12 drifts; "look at older phase plans" — found 5 inherited prereqs. User said "do as you recommend" → `7270c2a` consolidated everything as durable artifact + plan amendments + seed DAG wiring. User said "start the prereqs" — dispatched workers in waves: Dialog barrel (direct), 2428 + ad27 parallel, 3601 sequential after ad27 closed (consumes FC store), then 9078 + e9db parallel after maintainer decisions. e9db still in flight at handoff write.

**Hard calls.**
- **Sequential vs parallel for 3601.** ad27 created the FC store; 3601 hydrates from it. Parallel would have left 3601 worker guessing the API shape. Cost: ~8 minutes serial; benefit: zero rework.
- **Defer GeoJSON export card to follow-up seed?** Brief allowed deferring if scope ballooned. 9078 worker found the card was already in atlas-app (T15 wired GeoJSON renderCustomUI before this session). Just added 2 more cards next to it. No deferral.
- **`renderCustomUI` over parallel dialog.** Brief's first option was vendored-fork in-place; second was atlas-app-owned dialog mimicking the visual pattern. Worker found a third (and best) option after orienting. Surface the lesson: brief should mention `renderCustomUI` if it exists; advisor caught it on second look.

**Shaky ground.**
- **e9db result unknown at handoff time.** If composite-project surfaces 100+ NEW errors (vs. the existing 1585), the migration broke something subtle. Re-investigate before merging.
- **`addFiles()` deferred** in 3601 hydration. `loaded.files` is `Map<string,Blob>` but `addFiles` wants `BinaryFileData[]` with `dataURL`. Inverse-of-`dataUrlToBlob` conversion untested. Tracked as known-deferred. First user with binary scene assets (images pasted into the canvas) hits a hydration miss.
- **Phase 2 `dd418c2` intent.** If `paths:{}` was intentional for a vendored package quirk that composite-project doesn't address, the e9db migration may need a partial revert. Watch the worker's commit body for the intent finding.

**Invisible context.**
- **`code/apps/realtime/` is a Phase 5 stub** (commit `2026-05-03` per file mtime) with `package.json` declaring `@atlasdraw/realtime` AGPL-3.0. Plan T11 references `docker-compose.realtime.yml` but never acknowledges the prior scaffold. Don't re-scaffold.
- **Excalidraw `UIOptions.canvasActions.export.renderCustomUI`** is the ONLY extension point that injects into a vendored dialog without a vendored-fork patch. atlas-app's MapEditor.tsx wires it via `buildExportOpts` (added by 9078 worker). Future Phase 4 dialog work should route through this seam, not build parallel dialogs.
- **`SceneElement` structural alias** in `@atlasdraw/data/manifest-schema.ts` — Excalidraw type changes that break this contract will only surface as `tsc -b` errors AFTER e9db lands composite-project.
- **Test count baselines after this session:** data 83, cli 11, basemap 12 (NEW), atlas-app 139 (was 113 before session). Phase 4 T1+ baselines off these counts.

## Active Skills & Routing

- **check-handoff** (this session, opening) — invoked at `/check-handoff` user request.
- **handoff** (this skill) — invoked proactively at 82% context per CLAUDE.md PROACTIVE rule.
- **Delegation Protocol (CLAUDE.md)** — drove 4 worker dispatches across 2 parallel waves. Shared prefix discipline: each worker brief opened with `## SHARED_CONTEXT` block of verified literals so workers didn't re-grep.
- **`docs/decisions/wave0-pre-dispatch-scrub-2026-05-06.md`** — durable artifact workers consume INSTEAD of raw plan. Same convention as `wave1/2/3-pre-dispatch-scrub-2026-05-04.md`. Phase 5+ should follow this pattern.
- **`.claude/rules/excalidraw-api.md`** — fired during 9078 brief drafting, drove the `renderCustomUI` discovery.
- **`atlasdraw-ui-conventions`** skill — invoked by 9078 worker before adding cards to JSONExportDialog.

## Infrastructure Delta

- **Plugins/Hooks/Pipelines:** unchanged.
- **Skills:** unchanged.
- **Mulch domains:** unchanged this session (no new records). Suggest record-extractor at next pipeline close to capture: `renderCustomUI` extension point (would have saved 9078 worker's pivot time); composite-project topology decision (e9db); SceneElement structural-alias pattern (3601); FC store mirror via registry actions not sync hook (ad27).
- **Project files (non-`.claude/`):**
  - NEW: `docs/decisions/wave0-pre-dispatch-scrub-2026-05-06.md`.
  - NEW: `code/packages/basemap/src/{BasemapRegistry,pmtiles-protocol,style-builder}.ts` + `src/__tests__/*` + `vitest.config.ts`.
  - NEW: `code/apps/atlas-app/src/state/{useDataLayerFCStore,hydrate}.ts` + matching `__tests__`/.test files.
  - NEW: `code/apps/atlas-app/src/components/__tests__/MapEditor.atlasdraw-export.test.tsx` (and `MapEditor.hydration.test.tsx`).
  - MODIFIED: `code/packages/tsconfig.base.json` (ignoreDeprecations 6.0→5.0); `code/packages/excalidraw/index.tsx` (Dialog barrel); `code/apps/atlas-app/src/components/MapEditor.tsx` (hydration wiring + atlasdraw export cards + removed adjacent MainMenu items); `code/apps/atlas-app/src/state/{layerRegistry,selectDocument}.ts` (FC mirror); `atlasdraw-tech-spec.md` (§4.2 + §10); `code/packages/data/src/manifest-schema.ts` (SceneElement) + dependent test fixtures + barrel re-export.
  - MODIFIED: `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` (top banner; Pre-Work Checklist rewrite; T5 wording; T13 re-scope).
  - DIRTY (intentional, do not commit): `code/packages/cli/src/atlasdraw.ts` chmod 644→755.

## Knowledge State

- **Indexed:** no `context add` packages this session.
- **Productive tiers:** scrub doc + plan + seeds + mulch records (cited inline). `mulch-prime-cache.sh` not run; meta domain stayed warm.
- **Gaps:** none encountered that needed external indexing.

## Next Steps

1. **Phase 4 T1 dispatch** — Wave 0 complete. T1 (`code/apps/storage/` scaffold + `StorageMode`/`StorageClient` types) is the first dispatch target. Plan §T1 lines 202-236. Verify against `docs/decisions/wave0-pre-dispatch-scrub-2026-05-06.md` Section A path-mapping table BEFORE briefing the worker.
2. **Visible-UX bug triage** (`atlasdraw-4142` mixed-geometry GeoJSON, `atlasdraw-76b2` polyline geo-anchor zoom break). Both flagged demo-blocking severity. Decide: fix in P4 or accept as known issues with "Known Limitations" README entry.
3. **Binary scene asset hydration** — `excalidrawAPI.addFiles(loaded.files)` deferred from `atlasdraw-3601`. Needs blob→BinaryFileData conversion. File a fresh seed and schedule before any image-paste demo path.
4. **`atlasdraw-320b` blob-URL warnings** — open. Investigate via Chrome DevTools sourcemap on the `blob:http://...:2460` warning. Likely MapLibre style spec fed null for a numeric field; could be from BasemapRegistry style-builder or selectDocument FC reads.
5. **Push to origin.** Branch is 42 ahead at handoff write. `git push origin main` is the trivial next step.

## Context Files

- `docs/decisions/wave0-pre-dispatch-scrub-2026-05-06.md` — Phase 4 launch checklist; verified literals; Section A drift table.
- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` — amended plan; Pre-Work Checklist rewritten with corrected literals + 6 prereq gates.
- `code/apps/atlas-app/src/state/hydrate.ts` — Phase 4 hydration entry point; round-trip identity tested against `selectDocument`.
- `code/apps/atlas-app/src/state/useDataLayerFCStore.ts` — FC store keyed by `dl:` id; consumed by selectDocument + hydrate.
- `code/apps/atlas-app/src/components/MapEditor.tsx` lines ~470 and ~250 — `buildExportOpts` (renderCustomUI cards) + load-on-mount hydration wiring.
- `code/packages/basemap/src/{BasemapRegistry,pmtiles-protocol,style-builder}.ts` — Phase 1 deferral landed.
- `code/packages/data/src/manifest-schema.ts` line 102 — `SceneElement` structural alias.
- `HANDOFF.md` (this file) — agent-to-agent continuity.
- `HANDOFF-expertise.md` — structured mulch records for meta + architecture + excalidraw-api domains + session deltas (`ml prime` + `ml diff --since HEAD~12`); 4 new conventions captured this session: `mx-58c357` (renderCustomUI extension point), `mx-4b9e4e` (SceneElement structural alias), `mx-fcce7f` (FC mirror via registry actions), `mx-cb3eb8` (per-wave re-scrub recurrence rule).
