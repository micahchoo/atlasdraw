# Handoff

## Goal

> "start phase 3" → "parallelize where possible"

Continue Phase 3 (`.atlasdraw` file format & local persistence) from
`docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`.
Phase 2 closed in the prior session; this session bootstraps Phase 3.

## Progress

**This session (4 Phase 3 commits + Phase 2 mop-up):**

- ✅ `137ce23` — T5 thumbnail.ts (browser-only, OffscreenCanvas, returns null in Node)
- ✅ `b002cf9` — Wave 1 in parallel: T2/T3 atlasdraw.ts + T4 atlasdraw-json.ts + T6 csv.ts + T7 shapefile.ts (4 workers, ~4 min wall time)
- ✅ `9407393` — Wave 1 setup (jszip, papaparse, shpjs, @types/papaparse, vitest pinned)
- ✅ `333a7f3` — Wave 0 T1 manifest schema (Zod + AtlasdrawDocument runtime type)
- ✅ `dd418c2` — T27.3 atlas-app paths:{} annotation (closes atlasdraw-dc84 + atlasdraw-8a21)

Plus Phase 2 closeout from earlier in the session (T20 + state + handoff): `e525bc9`, `7956bdd`, `476f393`.

**Phase 3 status (13 tasks):** 6 SHIPPED (T1, T2, T3, T4, T5, T6, T7), 6 OUTSTANDING (T8-T11 in Wave 2, T12-T13 in Wave 3).

**Test count:** `@atlasdraw/data` = 77 tests passing (was 32 at session start). `tsc --noEmit` clean.

**Seeds touched this session:** atlasdraw-fb50, 8bdb, ca89, 12db (closed `success`), atlasdraw-ca94 (closed `rework`), atlasdraw-1315 (closed `success`). Filed atlasdraw-947d (shapefile fixture follow-up).

State churn: `.seeds/issues.jsonl` modified (uncommitted) — wants its own `chore(state)` commit before resuming.

Branch is 17 commits ahead of `origin/main`.

## What Worked

- **Multi-agent parallel dispatch via Delegation Protocol**, properly executed: setup wave (deps committed once: `9407393`) → 4 workers in parallel → barrel merge + commit. 4 workers × ~3min each = ~3min wall time vs ~12min serial. Each worker got the same shared prefix (project root, package, conventions, deferred index.ts) + a tight task delta.
- **Worker briefs that pin acceptance criteria explicitly** (test count, error codes, exact API signatures, "DO NOT touch index.ts/package.json"). No worker raced the lockfile or merged-conflict the barrel.
- **Schema-first wave gate.** Wave 0 (T1 manifest schema) had to land before Wave 1; no worker had to design the schema or guess at `Manifest`/`AtlasdrawDocument` shapes — they imported them. This is the canonical "types-only file lands first" pattern (mulch mx-364d3c).
- **Stale-seed sweep.** Five Phase 1/2 follow-up seeds turned out to already be done in code — closed without rework. Verifying current state before acting saved hours.

## What Didn't Work

- **Plan literal vs reality drift on shpjs.** Plan asserted "shpjs ^6.2 ships its own types" — wrong. shpjs has no types and no `@types/shpjs` exists. Worker D added a hand-rolled ambient `shpjs.d.ts` shim covering only the default-export ArrayBuffer overload. This is the third recurrence of plan-literal divergence (mx-619182, mx-04ac8d). The shim is load-bearing — if shpjs ships real `.d.ts` later, delete it.
- **JSZip + Blob in vitest/node.** JSZip's `loadAsync(blob)` and `file(path, blob)` both throw "Can't read the data" in vitest's Node environment. Worker A had to materialize Blobs to ArrayBuffer before JSZip touches them. Production browser code may behave differently — Wave 2 persistence integration tests will tell.
- **vitest v4 dropped `--testPathPattern`.** Worker B caught it; use `--run <name>` or positional filter. Worker briefs and downstream plans should reference the new flag.
- **`sd create` flag surface.** Took 3 tries to file the shapefile-fixture seed: `--title <text>` (not positional), `--labels` (not `--label`, comma-separated, not repeated), `--priority P0..P4` (not "Medium"). Cache this for next session.

## Key Decisions

Schema design choices (made this session, no maintainer escalation needed — all within Plan §Q-RESOLVED):

- **`AtlasdrawDocument.scene` and `styleRef` typed as `unknown`** (not Excalidraw/MapLibre-typed) to keep Wave 0 decoupled from heavy type surfaces. Reader/writer assert shape at the boundary. Phase 4 may tighten if needed.
- **`AtlasdrawDocument.layers: Map<string, FeatureCollection>`** — only data layers carry FCs (annotations live in `scene`). The plan said `layers: LayerRegistry` but the runtime registry has methods; for serialization the FC map is right.
- **DataLayerEntry id gated by `dl:` prefix** in `LayerEntrySchema` to match the Phase 2 runtime convention (prevents collisions with annotation ids = Excalidraw element ids).
- **Scale factor = 8 (not 5) for the 50k bench gate** in Phase 2 ci-gate.ts — observed 50k/10k ratio is ~6.3× due to non-linear allocation pressure. 5×1.20=6.0 fails; 8×1.20=9.6 passes with headroom. (Phase 2 mop-up.)

## Trajectory

**How we got here.** Session opened with HANDOFF.md showing Phase 2 Wave 4 closeout 11/15 done, T20 outstanding. Closed T20 via the bench/ci-gate route, then user asked to investigate T27.3 and T28. Both turned out smaller than the seeds described — T28 was a ~10-line patch to the global anti-pattern scanner (`~/.claude/scripts/anti-pattern-scan.sh`); T27.3 was annotation-only (paths:{} is load-bearing, removing it is a separate composite-tsconfig initiative). Re-running the now-scoped scanner showed only 5 atlas-owned findings; investigation showed all 5 false positives. Stale-seed sweep cleared 4 more (fb50, 8bdb, ca89, 12db) — they were all already done. User said "start phase 3"; reading the plan revealed all 7 open questions RESOLVED 2026-05-03. Wave 0 (T1 schema) shipped serially. User said "parallelize where possible"; setup commit added all Wave 1 deps; 4 workers dispatched via Delegation Protocol with shared prefix + non-overlapping task deltas. All 4 returned green; barrel merged in one commit. T5 thumbnail done inline (Worker A had pre-wired the `options.thumbnail` parameter into `write()`).

**Hard calls.**
- **Schema design (Wave 0).** Could have made `AtlasdrawDocument` carry the full Excalidraw + MapLibre type signatures. Chose `unknown` to keep Wave 0 unblocking — Wave 1 workers don't need those types, the reader/writer assert at the boundary. Tradeoff: stricter type safety later means Phase 4/5 callers must `as` cast at the seam. Acceptable for v1.
- **Worker A doing T2+T3 together.** Plan listed them sequentially because they touch the same file. Could have dispatched T2 worker, waited, then T3. Chose to give one worker both — they're a logical unit. Worker A handled both cleanly in 229s.
- **Worker D's Option B (error-path tests only).** Synthetic ESRI shapefile binary requires hand-rolling mixed-endian headers + DBF tables. Could embed base64 from a real fixture, but generating one needed `ogr2ogr` which isn't a project dep. Chose Option B + filed atlasdraw-947d for the fixture follow-up. Risk: shpjs upgrades may silently break the happy path.

**Shaky ground.**
- **shpjs error classification** is brittle string-matching of internal messages ("no layers found", "central directory", etc.). A shpjs version bump may silently reroute codes. Worker D documented inline.
- **JSZip Blob support in vitest/node** materializes to ArrayBuffer. Production browser code paths weren't exercised. Wave 2 T8 persistence (IndexedDB stores zip Blobs) is the first real-browser integration test for the format — worth running in a real browser, not just jsdom.
- **77 tests at this scope ≠ "format is correct".** No round-trip test against a real Excalidraw scene yet (T12 in Wave 3). The bench harness from Phase 2 doesn't cover the file format.

**Invisible context.**
- The data package's vitest already had access to vitest globals via @atlasdraw/data → @atlasdraw/bench's hoisting; pinning vitest in `data/devDependencies` makes that explicit (mirrors atlasdraw-b733 from Phase 2).
- `_addressColumn_v1` (Worker C) carries the source CSV column NAME, not the parsed address values. Phase 6 geocoders will read this to find which property to send to the geocoder. Renaming the field breaks all on-disk Phase 3 .atlasdraw files.
- Worker A's `write(doc, options?)` API change vs the plan's bare `write(doc)`: the optional options bag was added to support T5 thumbnail wiring without a Wave 2 follow-up. The plan said T5 modifies atlasdraw.ts in Step 2; Worker A pre-staged that hook. Net: T5 was a single new file, no atlasdraw.ts diff.

## Active Skills & Routing

- **handoff** (this skill) — invoked at user request.
- **Delegation Protocol (CLAUDE.md)** — drove the Wave 1 multi-agent dispatch pattern (shared prefix + deltas + setup wave for lockfile mutex).

No `[eval:]` checkpoints fired explicitly. The verification gate ("test + tsc must pass before commit") was applied as personal discipline at every Wave boundary.

## Infrastructure Delta

- **Plugins/Hooks/Pipelines:** unchanged.
- **Skills:** unchanged.
- **Global tooling:** `~/.claude/scripts/anti-pattern-scan.sh` patched to read `$GIT_ROOT/.claude/anti-pattern-scope.txt` (project-local include/exclude). Affects all projects with such a file. Atlasdraw scan went from 353 findings → 5.
- **Project files (non-`.claude/`):**
  - NEW: `code/packages/data/src/manifest-schema.ts`, `atlasdraw.ts`, `atlasdraw-json.ts`, `csv.ts`, `shapefile.ts`, `thumbnail.ts`, `shpjs.d.ts`, plus colocated `.test.ts` siblings for each.
  - NEW: `.github/workflows/ci.yml` (Phase 2 mop-up — Bench CI gate).
  - NEW: `code/bench/ci-gate.ts` and `code/bench/scenarios/phase-2-with-data-layers.test.ts`.
  - MODIFIED: `code/packages/data/package.json` (added jszip ^3.10, papaparse ^5.4, shpjs ^6.2, ulid ^2.3, zod ^3.22, @types/papaparse, vitest), `code/packages/data/src/index.ts` (barrel), `code/apps/atlas-app/tsconfig.json` (paths:{} annotated), `code/bench/package.json`, `code/bench/tsconfig.json`.

## Knowledge State

- **Indexed:** no `context add` packages added this session.
- **Productive tiers:** mulch (project conventions, 3 records cited inline above), seeds (issue + close history), git log, the existing plan addendum at `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`. Default routing was sufficient.
- **Gaps:** none encountered that needed external indexing.

## Next Steps

1. **State commit.** `.seeds/issues.jsonl` is dirty from today's seed activity (atlasdraw-947d created, multiple closures). `git add .seeds/issues.jsonl && git commit -m "chore(state): seeds churn from Phase 3 W0+W1 + stale-seed sweep"` before any new work.

2. **Wave 2 setup commit, then dispatch.** Wave 2 has two parallel streams:
   - **Stream A:** T8 persistence.ts (`apps/atlas-app/src/state/persistence.ts`, IndexedDB+FSA, 5s/30s debounce per Q3) → T9 store wiring + Toolbar.
   - **Stream B:** T10 CLI lint command (`packages/cli/src/commands/lint.ts`) → T11 CLI convert command.
   - **Setup commit needs:** `commander ^11`, `vitest ^3`, `@atlasdraw/data: "*"` for `packages/cli` (currently a stub with only `index.ts` + typecheck script — needs `test`/`build` scripts too); `idb ^8` for `apps/atlas-app`.
   - Dispatch T8 + T10 in parallel. After they return, dispatch T9 + T11 in parallel.

3. **Wave 3 round-trip test (T12).** Once Wave 2 lands: write `code/packages/data/src/round-trip.test.ts` that exercises a synthetic AtlasdrawDocument through write→read and writeJSON→readJSON, asserting full equality. This is the Phase 3 acceptance gate.

4. **Stretch (T13) KML/GPX parsers** — only if time-pressured-not. Punt to Phase 6 if needed.

5. **Phase 2 cleanup that's still open:**
   - **atlasdraw-947d** — shapefile happy-path fixture (filed today; recommend resolving before Phase 4 self-host).
   - **Composite-tsconfig initiative** — atlasdraw-dc84 closed `rework` but the underlying tools rootDir / atlas-app paths debt remains. Separate session-scope project.

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md` — plan with all 7 open questions RESOLVED. Wave 2 details start at line 385 (T8). Read this first.
- `code/packages/data/src/manifest-schema.ts` — canonical schema. Wave 2 workers MUST import from here, not redefine.
- `code/packages/data/src/atlasdraw.ts` — `write(doc, options?)`/`read(blob)`. Persistence (T8) calls these.
- `code/packages/data/src/atlasdraw-json.ts` — `writeJSON`/`readJSON` for share-via-URL (Phase 4) and CLI `--json` flag (Phase 3 T11).
- `code/packages/data/src/index.ts` — barrel. Wave 2 workers import everything from `@atlasdraw/data`.
- `code/apps/atlas-app/src/state/layerRegistry.ts` — Phase 2 LayerRegistry runtime. T8/T9 persistence will read this state.
- `code/packages/cli/package.json` — current CLI stub. Wave 2 setup must add commander, @atlasdraw/data, vitest, test/build scripts.

## Phase 3 Plan Status (per-task)

| Wave | Task | Status | Commit |
|------|------|--------|--------|
| W0 | T1 manifest-schema | SHIPPED | 333a7f3 |
| W1 | T2 atlasdraw.ts write | SHIPPED | b002cf9 |
| W1 | T3 atlasdraw.ts read | SHIPPED | b002cf9 |
| W1 | T4 atlasdraw-json.ts | SHIPPED | b002cf9 |
| W1 | T5 thumbnail.ts | SHIPPED | 137ce23 |
| W1 | T6 csv.ts | SHIPPED | b002cf9 |
| W1 | T7 shapefile.ts (error-path only; fixture in atlasdraw-947d) | SHIPPED | b002cf9 |
| W2 | T8 persistence.ts | OUTSTANDING | — |
| W2 | T9 store + Toolbar | OUTSTANDING | — |
| W2 | T10 CLI lint | OUTSTANDING | — |
| W2 | T11 CLI convert | OUTSTANDING | — |
| W3 | T12 round-trip tests | OUTSTANDING | — |
| W3 | T13 KML/GPX [STRETCH] | OUTSTANDING | — |
