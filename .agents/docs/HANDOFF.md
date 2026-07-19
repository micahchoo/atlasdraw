# Handoff — 2026-07-18 (IA restructure: menu regroup, export unification, basemap-as-layer, pin-to-toolbar — UNCOMMITTED)

## State: large uncommitted change in `code/apps/atlas-app/` (working tree, no branch/commit — user has not asked to commit).

Session: drew a UI-surface wireframe on the tldraw board (`atlasdraw-ui-wireframe`),
reviewed the ideal IA, then built phases 1–4 of the restructure. All verified:
**595 atlas-app tests green, `yarn test:typecheck` exit 0**, plus a live Playwright
smoke against the user's dev server (port 5175) — menu regroup, dark-basemap switch
from LayerPanel, unified Export PDF pane, toolbar pin drop, and StatusBar "unsaved"
all confirmed rendering/working.

### What changed (all in code/apps/atlas-app/src/)
1. **Menu = document + app scope only** (`MapEditor.tsx`): Open/Save/Import/Export/
   Share · Reset canvas · Settings/Shortcuts/About/Theme. Ejected: Pin (→ toolbar
   `PinToolButton` via `renderToolbarExtras`, new component + css), "● Unsaved"
   (→ `StatusBar` `dirty` prop, amber `dotWarn` + "unsaved" text), Layers panel /
   Find-on-canvas / Asset library (→ ⌘K palette; `quick-action-<id>` testids added
   to `QuickActions.tsx`), basemap items (→ see 3). Emoji stripped from labels.
   OnboardingTips copy updated to match.
2. **Export unification**: `PrintDialog.tsx` DELETED; its real PDF machinery
   (letter/a4/tabloid, orientation, title, error state, `exportPDFImpl` seam)
   absorbed into `ExportDialog.tsx` as a wired PDF pane (the old pane was
   decorative unwired selects). `initialFormat` prop; ⌘K "Export PDF" opens it
   preselected. ExportDialog gained Escape-to-close (was a gap). Tests ported to
   `__tests__/ExportDialog.test.tsx`; keyboard-nav tests re-pointed at ExportDialog.
3. **Basemap-as-layer**: new `state/basemap.ts` Zustand store (`activeBasemapId`,
   `styleEditorOpen`). `LayerPanel.tsx` gained a Basemap section (bottom of stack):
   active row + Local/Remote badge, expandable picker (`basemap-option-<id>`),
   "Edit style" → raises store flag → MapEditor mounts MaputnikDialog.
   `BasemapPickerDialog.tsx` DELETED. SettingsDialog Basemap tab unchanged
   (props now bound to the store via MapEditor).
4. Tests reworked: `MapEditor.layers-toggle.test.tsx` (palette-driven layers tests
   + new Basemap-section tests; mock gained `listBasemaps`), `MapEditor.maputnik.test.tsx`
   (store-driven). `QuickActions.tsx` `scrollIntoView` now optional-called (jsdom).

### Scale modes: GEOGRAPHIC IS NOW THE ONLY CREATION MODE (final state, 2026-07-19)
Journey (same session, three decisions): (1) diagnosed "Geo and Screen behave
the same" — the ToolOptionsBar toggle was display-only; `buildGeoCustomData`
hardcoded "geographic" and atlas tools hardcoded their defaults; built a
shared anchor-mode store + toggle-for-all-tools (toolbar merge). (2) Maintainer
switched the default to hybrid — this made the geo-op fuzzer surface UNKNOWN
signatures (hybrid→geographic toggleScale re-base drift + class G re-keyed
|hybrid) — triage interrupted by (3) maintainer decision: **geo is the only
way to make annotations.** A subagent then removed the whole mode-selection
surface (verified independently after):

- `state/anchorMode.ts` + its test DELETED; `ToolContext.getAnchorMode` removed
  (types.ts + useAtlasdrawTool back to byte-identical with HEAD).
- `buildGeoCustomData` stamps "geographic" unconditionally (3-param again).
- All `packages/tools` seeds + `defaultScaleMode` → "geographic" (Pin was
  "screen" per spec §3.4 — overridden by maintainer decision; Arrow/Freehand
  were "hybrid"; CircleTool's companion text was "screen").
- ToolOptionsBar = label + Escape hint only (no toggle); mounts for atlas
  tools only. PinToolButton on the toolbar unchanged.
- Screen/hybrid REMAIN render-supported (CoordinateSync/scaleMode.ts
  untouched) for legacy documents — creation-side removal only.

**Verified:** atlas-app 596 + tools 77 tests, typecheck all exit 0 (run
directly, not trusted from the subagent); fuzzer green again (creation back
to geographic keys). Live: pin stamped geographic, 16→64px over zoom 4→6 (2²).

**Latent bug parked (no repro committed):** the fuzzer-found
hybrid→geographic toggleScale re-base drift (width jump when toggling out of
hybrid while its ±2-zoom clamp is active) is now UNREACHABLE from the UI but
still real at the reanchor-protocol level — minimal repros are in this
session's fuzz output (seeds 20/35 at SEED_COUNT=500 with hybrid-stamped
creation). If scale-mode editing ever returns, run the geo-op-idempotency-hunt
skill and triage these first.

### Deliberately deferred (next session candidates)
- Toolbar merge core is DONE (see above). Remaining polish: the other atlas
  tools (Rect/Circle/Polygon/Polyline/Arrow/Freehand/TextLabel) still aren't
  reachable from any UI (only Pin is); wire them or delete them.
- StylePanel fold into the Layers tab (still a floating dialog).
- Geo-search vs canvas-search merge; AssetLibraryPanel fold into Library tab;
  collab chrome capability-cluster gating.

### Landmines
- The IA review + wireframe live on tldraw board `atlasdraw-ui-wireframe`.
- `.claude/skills/run-atlas-app/` is a new untracked skill (created by another
  session today) — not mine, don't delete.
- Editor tsserver may still show `@atlasdraw/common` .d.ts noise; CLI gate is green.

---

# Handoff — 2026-07-06 (typecheck gate resurrected + geo-search shipped + TS unified + hygiene — ALL COMMITTED & PUSHED)

## State: clean. `origin/main` == local `main` == `feat/map-embed` at `8f68d4d`.

Session opened on `/tend`, got redirected to a series of ship-it tasks. Everything
below is committed and pushed; working tree carries only background-noise churn
(`.mulch`, `.seeds`, `code/bench/results`, `.claude/skills/librarian`) + gitignored
build output (`dist/`).

### What shipped (main, in order)
- `9c9861b` **geocoder place-search toolbar control** — a parallel session's
  uncommitted WIP; committed on request (via new first-class `renderToolbarExtras`
  prop on the owned Excalidraw fork). 107 tests verified before commit.
- `b7a426f` background tracking-artifact churn (chore).
- `04c1051` **fix(build): resurrect the repo-wide typecheck gate** — the big one.
  `yarn test:typecheck` was a no-op (`tsc` on `files:[]`) and `tsc -b` was dead
  (invalid `ignoreDeprecations`). Now: `build:types` → `tsc -b` → per-app
  `tsc --noEmit`, all green. New `packages/tsconfig.vendored-built.json` makes
  consumers resolve the vendored engine to `dist/types` (not source). Fixed ~40
  real type errors the dead gate hid (incl. missing `@atlasdraw/excalidraw` barrel
  re-exports, `ScaleMode` from geo-not-tools, storage `Database`-as-type). See
  memory `[[typecheck-gate-and-ts-version-skew]]`.
- `3499271` **pin all workspaces to TypeScript 5.9.3** — 10 workspaces declared
  `typescript:"*"` and floated to 6.0.x, skewing the deprecation silencer. `yarn
  install` deduped to one hoisted 5.9.3; reverted the app tsconfig `"6.0"` →
  inherit base `"5.0"`. Gate re-verified exit 0.
- `8f68d4d` **gitignore leaked vendored .d.ts + stray caches** — deleted 403 stale
  co-located `.d.ts` + `node-compile-cache/` + `Et6ZJ_xdtT9_0ghOD3LnM/`; added
  targeted ignores (5 vendored packages' `*.d.ts`, hand-written ones negated).

### Verified
Full `yarn test:typecheck` exit 0 (all workspaces, single TS 5.9.3). atlas-app 592
tests, storage 122 tests green. Every commit through lint-staged.

### Landmines / notes
- **LSP/tsserver is stale** — showed `Cannot find name 'Promise'/'window'` all
  session after the build/install/tsconfig churn. The CLI `tsc` is authoritative
  and green; **restart the TS server** to clear the editor.
- **Root disk `/` is 100% full** (npm/npx cache). Git + builds work (repo on
  `/mnt/Ghar`; TMPDIR=/tmp). `npx` fails with ENOSPC — invoke local
  `node_modules/.bin/tsc`, not npx.
- CI (`test.yml`) runs `yarn test:typecheck` → now really builds+checks (adds
  build time; catches type errors going forward). No workflow-file change needed.

### Still open (unchanged)
- **46 Dependabot vulns** (13 critical) — untriaged.
- The `/tend` pass this session interrupted: prior ISSUES.md all closed; fresh
  backlog would be Dependabot triage + (dead-gate now DONE).

---

# Handoff — 2026-07-06 (geo-op idempotency: skill + fuzzer built, 6 bug classes fixed, UNCOMMITTED)

## State: working tree carries a complete, verified, uncommitted change set

Session goal (met): build a hunting prompt for non-idempotent drawing↔map
operations, fuzz the layer, fix what it found. All work is in the working
tree on branch `feat/map-embed` (NOT this session's branch choice — tree is
shared with a parallel embed session; commit geo work separately).

### Deliverables

- `.claude/skills/geo-op-idempotency-hunt/` — new project skill (+ evals/).
- `code/apps/atlas-app/src/hooks/geoOpFuzz.harness.ts` — deterministic
  sequence fuzzer vs real buildGeoAnchorHandler + CoordinateSync.
- `.../geoOpSequence.fuzz.test.ts` — 500 seeds; KNOWN_FAILURES contract
  (only class G parked). `.../geoOpKnownHazards.repro.test.ts` — 12 tests:
  A–F regression repros (green) + class G `it.fails` (open).
- **Fixed (classes A–F)** in `useGeoAnchor.ts` (reanchorIfMoved protocol
  overhaul: polyline x/y compare, point w/h compare, style rebase via sw/fs,
  mode-toggle zRef rebase, coherent snapshots instead of clearing _lastSync,
  captureUpdate NEVER) and `CoordinateSync.ts` (full screen-arm snapshots,
  mode/sw/fs fields). Two assertions updated in `CoordinateSync.test.ts`
  (+ fixed its dead `./types.js` type-import).
- Verified: 166 tests green across basemap/geo/atlas-app hook suites incl.
  500-seed fuzz. tsc: basemap clean; atlas-app's 537 errors are the embed
  session's pre-existing churn, none in these files.

### Seeds

- Closed: atlasdraw-c1d6/720b/311a/e58e/6623/fa09/8500 (classes A–F+umbrella).
- Open: atlasdraw-7f0a (class G world-wrap at ±180 — needs world-edge policy;
  bbox west<east schema can't represent dateline straddle). atlasdraw-0697
  (skill eval run).

### Next steps

1. Commit the geo work (2 prod files, 3 test files, skill dir, rule cross-ref
   in `.claude/rules/canonicalization-verify-first.md`) separately from embed.
2. User-reported symptom "stroke changes differently than object on resize"
   matches fixed classes C/D; repro'd green post-fix in
   geoOpKnownHazards.repro.test.ts ("C/D user-report" tests). If still seen
   live, the running build predates the fix — reload dev server / rebuild.
3. Fuzzer expansion roadmap (deferred until A–F fixes verified live): atlas
   tool channel, redo/delete, second onChange writer, stale-camera op,
   adversarial value profile (confirms hazards 4/5). In SKILL.md Phase 2b.

---

# Handoff — 2026-07-05 (ISSUES.md fully closed: 9/9 Issues + 5/5 Directions verdicted and built)

## Goal

Session opened mid-stream on `tend/deadwood-sweep` (a branch already carrying
Issues 1-5 done from prior sessions, plus uncommitted Issue 6 coverage-climb
work sitting in the working tree). User asked me to check dangling branches,
merge to main, then work through what remained in `ISSUES.md`. Net effect
across the session: merged and pushed all outstanding branch work, closed
Issues 6-9, resolved all 5 "Directions" (surplus-capability decision items)
with maintainer verdicts, then ran full `/grill-with-docs` design interviews
for the two commissioned specs and **built both** on explicit "proceed".

## Progress

### Completed this session — main pushed once (`origin/main` at `62c19ec`), then 4 more local commits not yet pushed

| # | Commit | What |
|---|--------|------|
| 1 | (branch merge) | Fast-forwarded `main` through 14 pre-existing `tend/deadwood-sweep` commits (Issue 4/5 god-module splits, CollabContext gap surfacing). |
| 2 | `2a7cebc`/`b5296d3` | Two small pre-existing fixes found sitting uncommitted: `@atlasdraw/excalidraw` barrel wasn't re-exporting `ExcalidrawImperativeAPI`; `MapCanvas.tsx` missing `renderWorldCopies: false`. |
| 3 | `5a99d4c`+`f8841e1` | **Issue 6 closed** — coverage climb for 10 zero/low-coverage hooks (`COVERAGE.md`), 431→496 tests. Two real bugs fixed along the way. |
| 4 | `ec5fdd8`+`7f1d5b4` | **Issue 7 closed** — silence audit (`SILENCE.md`, 27 rows). Fixed a tracked-but-never-rendered `remoteSaveFailed` flag, unsurfaced initial-load failure, mixed alert/uncaught-rethrow, fake "Connected" status in `SettingsDialog`. |
| 5 | `4bbea59`+`d73803a` | **Issue 8 closed** — realtime operational parity (`NEGSPACE.md`). Real `/health` check, graceful shutdown, structured logging. Found and fixed a `pg.Pool` missing `error` listener that crashed the whole storage process on a dropped connection. |
| 6 | `c8f07f5`+`62c19ec` | **Issue 9 closed** — `CollabContext.Provider` gap (`COLLABWIRING.md`). Added `subscribe`/`getSnapshot` reactivity via `useSyncExternalStore` so peer-map mutations actually re-render. |
| 7 | (push) | Pushed `main` to `origin/main` at `62c19ec`. Moved this working directory's checkout from `tend/deadwood-sweep` to `main`. |
| 8 | `bd38381`+`5175fbb` | **All 5 ISSUES.md Directions resolved** with maintainer verdicts (`pursue pursue park pursue reject`). Two verdicts changed after verification (Direction 1 rescoped, Direction 2 flipped to reject). `pro_25` billing tier actually removed from code. |
| 9 | `2726900` | **Direction 1 built**: `feat(atlas-app,data): implement Direction 1 — Shapefile import + file-picker UI`. See below. |
| 10 | `e67786c` | **Direction 4 built**: `feat(basemap,tools): implement Direction 4 — plugin registration API`. See below. |
| 11 | `8f7b333` | `docs(issues): mark Directions 1 and 4 built, not just specced` — `ISSUES.md`/`CAPABILITY.md`/`HEADROOM.md` status blocks updated to match. |

### ISSUES.md final state

- **Issues 1-9: all done.**
- **Directions 1-5: all verdicted, and every "pursue" is now built** (not just specced):
  - **Direction 1 (built)** — Shapefile import + file-picker. `useGeoJsonDrop.ts` renamed to `useDataFileImport.ts`, widened to a `"zip"` ext, `parseShapefile` wired through the same drop pipeline, a new "Import…" `MainMenu.Item` opens a native file picker (reusing `state/persistence.ts`'s `fallbackOpen` hidden-`<input type="file">` pattern), explicit toast for unsupported file types on deliberate picks, `ShapefileParseError` per-code toasts. Closed `shapefile.test.ts`'s long-standing no-happy-path-test gap with a real fixture (`packages/data/__fixtures__/point.zip`, built via Python's `pyshp` since `ogr2ogr` wasn't available here).
  - **Direction 4 (built)** — plugin registration API. `registerBasemap`/`listBasemaps` added to `packages/basemap/src/BasemapRegistry.ts`; `registerTool`/`getTool`/`listTools` added to `packages/tools/src/index.ts`. Both are a private, duplicated `Registry<T>` factory — **not** shared via `@atlasdraw/common`, because that package is deliberately excluded from the root tsconfig's composite project graph that `basemap`/`tools` belong to (discovered via a real `tsc` rootDir violation mid-implementation, not up front). `SettingsDialog.tsx`'s `getBasemap("__all__")` sentinel-string hack replaced with real `listBasemaps()`.
  - Direction 2 (graduated style method) rejected — false premise on verification, nothing to build.
  - Direction 3 (Yjs E2EE stub) parked — `docs/decisions/escalations.md` E-01 gets a "RE-OPENED, not closed" status block.
  - Direction 5 (Pro+ tier) rejected and executed — `pro_25` fully removed from `WorkspacePlan`/config/quota/billing.

### Test counts after Direction 1 + 4

atlas-app 63 files/525 tests, packages/data 13 files/144 tests, packages/basemap 7 files/76 tests, packages/tools 12 files/77 tests, packages/storage 13 files/122 tests — all green.

## What Worked

- **Verifying ISSUES.md premises before acting, every time** — caught two false/stale premises this session (Direction 2's "always linear" claim, Direction 1's "CSV unreachable" claim) before commissioning wasted work.
- **Running a real research subagent before the grilling interview started**, so every recommended answer was grounded in actual file contents (parser signatures, existing conventions, wiring patterns) rather than assumption. Per the `grilling` skill's own instruction to explore the codebase instead of guessing wherever possible.
- **Correcting the design mid-implementation rather than silently deviating or blindly following a stale plan.** The grilling interview's own recommendation for Direction 4 — share one `Registry<T>` via `@atlasdraw/common` — didn't survive contact with the actual composite-graph boundary. Reverted that path fully (verified via `git diff --stat packages/common/` showing zero diff), duplicated the ~15-line primitive instead, and documented the discovery transparently in both code comments and the ledger (`HEADROOM.md`'s "Interview outcome vs. what actually shipped" section) rather than pretending the original plan shipped as designed.
- **Bisecting a real OOM crash in a new test file** (`MapEditor.import.test.tsx`) down to an unstable mock-object reference feeding a `useEffect` whose own dep was itself unstable — fixed by hoisting the mock to a stable module-level const, matching an already-working sibling test's pattern.
- **AskUserQuestion for premise-mismatch cases** rather than silently picking a side. Both resolved in one round with the recommended option.

## What Didn't Work / Known Friction

- **`tsc --build` is still broken repo-wide** on a pre-existing `"ignoreDeprecations": "6.0"` value incompatible with installed TypeScript 5.9.3 — pre-existing, not fixed, not touched this pass either. All new work verified via `vitest` + direct runtime checks instead.
- **`apps/storage`'s own `tsc -p tsconfig.build.json` build script is separately broken** on real, pre-existing type errors — also pre-existing, also not fixed.
- Initial attempt at Direction 4 (shared `@atlasdraw/common` registry) cost a full create-then-revert cycle before landing on the per-package duplication — see Key Decisions below for why that wasn't avoidable without violating the plan-then-build order the user asked for (interview first, verify only surfaces at implementation time for a boundary this specific).

## Key Decisions

- **CollabState needed a full `subscribe`/`getSnapshot` reactive contract, not just a mounted Provider** (Issue 9).
- **Direction 2 verdict flipped from "pursue" to "reject"** after verification — `StylePanel.tsx` already computes genuinely distinct quantile breakpoints; equal-interval is correctly identical to linear by definition; the compiler's `["linear"]` is MapLibre's interpolation-curve parameter, not a break-selection shortcut.
- **Direction 1 verdict kept "pursue" but rescoped** — CSV import + Photon geocoding were already wired; only Shapefile import was genuinely orphaned. Scoped interview and build accordingly.
- **Direction 5 got executed, not just decided** — `pro_25` removed end-to-end, not deprecated-in-place.
- **Direction 3 got "park," not "pursue" or "reject."** Not pursue: the real fix (Option B, a custom log-replay relay) is a week-scale rewrite. Not reject: permanently closing E2EE is a bigger call than park commits to.
- **Direction 4's shared-registry plan was abandoned mid-implementation, not mid-design.** The grilling interview did ask about "different enough shapes" for basemap vs. tool registries, but the actual blocker (the composite tsconfig graph excluding `@atlasdraw/common`) only surfaced as a real `tsc` error once code existed — a case where the codebase-grounded interview still couldn't fully substitute for building it. Documented in `HEADROOM.md` rather than silently reverted.
- **Direction 1's file input covers all three formats in one `.accept` string** (`.geojson,.csv,.zip`) via one unified `MainMenu.Item`, not per-format pickers — matches how drag-drop already dispatches by extension through the same `processDataDrop` pipeline.

## Trajectory

**How we got here.** Session opened with dangling-branch cleanup + a merge to `main`, then a fast walk through Issues 6-9 (each its own sweep-triage-fix-resweep loop), a push to `origin/main`, a branch-to-main directory move, then all 5 Directions verdicted in one line ("pursue pursue park pursue reject") — two of which got corrected after verification before being acted on. That left two commissioned-but-unbuilt spec interviews sitting in `CAPABILITY.md`/`HEADROOM.md`. User asked to run `/grill-with-docs` against both. That invoked the `grilling` skill: a real `Explore` research pass grounded every question in actual code before asking; user answered "do as recommended" through most of Direction 1's four questions, then said "do as recommended for the rest" to bulk-confirm everything remaining (rest of Direction 1 plus all of Direction 4) rather than continuing one-at-a-time. Final "proceed" authorized implementation. Both Directions were built, tested green, and committed as two focused commits; Direction 4's implementation immediately surfaced the `@atlasdraw/common` composite-graph boundary the interview's own recommendation hadn't accounted for, corrected transparently. Ledger docs (`ISSUES.md`, `CAPABILITY.md`, `HEADROOM.md`) then updated from "commissioned" to "built" language and committed.

**Hard calls.** Whether to keep the `@atlasdraw/common` sharing attempt as a "future TODO" comment versus fully reverting and duplicating: fully reverted, since the boundary is a *documented, deliberate* architectural choice (root tsconfig's own comment), not a bug to route around — duplicating ~15 trivial lines twice is cheaper than fighting that boundary or leaving a half-built shared package no one imports yet.

**Shaky ground.**
1. **`main` is 4 commits ahead of `origin/main` (`62c19ec`), not pushed** — the Directions-resolution, Direction 1 build, Direction 4 build, and doc-update commits. Not requested this round.
2. **GitHub flagged 52 Dependabot vulnerabilities** on the last push (13 critical, 9 high, 22 moderate, 8 low) — still completely untriaged.
3. **The uncommitted noise files persist**: `.mulch/expertise/meta.jsonl`, `.seeds/issues.jsonl`, `.claude/skills/librarian/SKILL.md`, `code/bench/results/*.json`, plus untracked `Et6ZJ_xdtT9_0ghOD3LnM/` and `node-compile-cache/`. Still unexplained — read as background/concurrent-session artifacts, never investigated to confirm.
4. **Repo-wide broken `tsc --build`** and `apps/storage`'s separately-broken build script both remain unfixed, worked around via `vitest`+`tsx` all session.

**Invisible context.** User gives terse, high-density prompts ("pursue pursue park pursue reject" = five verdicts in Direction order; "do as recommended for the rest" = bulk-confirm and stop the one-at-a-time interview) and expects them mapped precisely, but wants a pause via AskUserQuestion when execution would contradict verified reality, and expects transparent correction (not silent deviation, not blind adherence) when an already-confirmed design turns out wrong at implementation time. Ledger files (`SILENCE.md`, `NEGSPACE.md`, `COLLABWIRING.md`, `CAPABILITY.md`, `HEADROOM.md`, `DARKDATA.md`, `ISSUES.md`) are the real audit trail, each meant to stand alone for a future reader — chat prose is not.

## Active Skills & Routing

- **`grilling`** (invoked via the user typing `/grill-with-docs`, which internally routes to `grilling` + `domain-modeling`) ran to completion for both commissioned specs this session. Its own rule ("do not enact the plan until confirmed") was honored — no code was written until the user said "proceed" after the bulk-confirm.
- **AskUserQuestion** used twice for Direction premise mismatches, both resolved in one round.
- No further skill routing pending — both commissioned specs from the prior handoff are now closed out.

## Infrastructure Delta

This session changed (cumulative, including this final phase):

- **New ledger files (repo root)**: `SILENCE.md`, `NEGSPACE.md`, `COLLABWIRING.md`, `CAPABILITY.md`, `HEADROOM.md`, `DARKDATA.md`.
- **Docs updated**: `ISSUES.md` (all Issues/Directions carry Status/Verdict blocks, Directions 1+4 now say "built"), `CAPABILITY.md`/`HEADROOM.md` (interview-outcome sections added), `docs/decisions/escalations.md` (E-01 re-opened), `CHANGELOG.md` (Pro+ tier removal).
- **Renamed**: `apps/atlas-app/src/hooks/useGeoJsonDrop.ts` → `useDataFileImport.ts` (+ test file).
- **New files**: `apps/atlas-app/src/components/__tests__/MapEditor.import.test.tsx`, `packages/data/__fixtures__/point.zip`, `packages/tools/src/registry.test.ts`.
- **New API surface**: `registerBasemap`/`listBasemaps` (`@atlasdraw/basemap`), `registerTool`/`getTool`/`listTools` (`@atlasdraw/tools`), `importFile` (returned from `useDataFileImport`), `StorageClient.ping()`, `CollabState.subscribe`/`getSnapshot`.
- **Removed API surface**: `WorkspacePlan`'s `"pro_25"` member, `STRIPE_PRICE_PRO_25`, `QuotaLimits.pro_25`, `BillingRoutesOptions.stripePricePro25`, `SettingsDialog.tsx`'s `getBasemap("__all__")` sentinel hack.
- **Dockerfiles**: all three app Dockerfiles gained `RUN corepack enable`.
- **Git**: `tend/deadwood-sweep` branch is stale (safe to delete, not yet asked to). `main` is 4 commits ahead of `origin/main`, unpushed.

## Knowledge State

- **Productive tools this session**: `Bash` + real docker containers (found the `pg.Pool` crash bug), an `Explore` subagent run before the grilling interview to ground every recommendation in real code, `AskUserQuestion` for premise-mismatch pauses, bisection-via-`it.skip()` for the OOM crash root-cause.
- **Gaps**: repo-wide broken `tsc --build` and `apps/storage`'s separately-broken build script both still block normal typecheck-based verification; every fix this session was verified via `vitest` + direct `tsx`/runtime execution instead. A future session should either fix these or explicitly route around them the same way.

## Next Steps

1. **Decide whether to push `main`** (4 commits ahead of `origin/main`). Not yet requested.
2. **Triage the 52 Dependabot alerts** — still completely untouched.
3. **Consider fixing the repo-wide broken `tsc --build`** and `apps/storage`'s separately-broken build script.
4. **Optional cleanup**: delete the now-redundant `tend/deadwood-sweep` branch; investigate whether the persistent uncommitted noise files are safe to discard or belong to an active concurrent session.
5. **Phase 7 proper** (the actual Worker-sandboxed plugin loader with integrity hashing) sits on top of the registration primitive Direction 4 just shipped — a separate, much larger piece of work, explicitly out of scope for this pass.
