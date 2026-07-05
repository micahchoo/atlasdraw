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
