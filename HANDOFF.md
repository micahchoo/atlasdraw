# Handoff — 2026-05-10 (Phase 4 Wave 1 basemap stack ↔ working end-to-end)

## Goal

The user's words at session start: *"the last phase was a botched job, check its work, the phase with pmtiles integration"*. After the audit confirmed Phase 4 Wave 0 was botched and partially mislabeled-complete, the user directed:
1. revert the uncommitted churn and reopen the seeds
2. file new seeds for all and reiterate where we are in the phased plan
3. commit this and dispatch wave 1 with T5+T7 first
4. continue as recommended (smoke-test → T3/T4 storage)

Net effect: get Phase 4 Wave 1 basemap stack (T5/T6/T7) actually working end-to-end, with honest seeds capturing what was botched and what's still pending.

## Progress

### Completed this session — committed

- ✅ **Audit of Phase 4 Wave 0 botched dispatch** — code-reviewer agent produced punch list; reverted 4 unstaged files (style-builder.ts churn, hardcoded /data/india.pmtiles in MapEditor.tsx, chmod +x on cli/atlasdraw.ts, toy-stub styles in basemap/src/styles/); reopened `atlasdraw-3601` (`+test-debt`) — original close was premature, `addFiles` later landed in e33c257 without test coverage. Commit `3be3d90`.
- ✅ **Plan amendments (pre-dispatch scrub) for T5 + T7** — caught two plan-literal-drift cases before dispatching. T5 Step 1+2 named the wrong source for Protomaps styles (releases don't ship JSON; use `protomaps-themes-base@^4.5.0` npm package). T7 Step 1 wrongly said add a base-path arg to `pmtiles-protocol.ts` (would conflate protocol registration with substitution). Both have dated 2026-05-10 scrub notes at the section header. Commit `213a1a5`.
- ✅ **T5 dispatched in worktree** — real Protomaps light/dark (68 layers each) via `protomaps-themes-base@^4.5.0` devDep + `code/packages/basemap/scripts/build-styles.mjs` generator. OpenFreeMap bright fetched verbatim from `tiles.openfreemap.org/styles/bright`. Three style JSONs committed (242KB / 242KB / 120KB). Commit `e35fa53`. Seed closed: `atlasdraw-bdf9`.
- ✅ **T7 dispatched in worktree** — `code/packages/basemap/src/resolver.ts` with `resolveStyle(id, {allowRemote, pmtilesPath})` + `BasemapRemoteGatedError`. MapEditor.tsx now calls resolveStyle. 6 new tests. Commit `ac7f256`. Seed closed: `atlasdraw-e088`.
- ✅ **Wave-misorder cleanup** — T6 BasemapPicker (commit 9cb691e from prior session) shipped during Wave 0 ahead of T5/T7. With T5 + T7 now landed, option (a) "keep T6 as is" applies. Seed closed: `atlasdraw-ea96`.
- ✅ **`.env.example`** documenting `VITE_PMTILES_PATH` for new contributors. Commit `a4cc35d`.
- ✅ **Smoke-test discovered 3 real seam bugs** (unit tests were green; runtime broken):
   - `atlasdraw-bff1` — VITE_PMTILES_PATH wasn't picked up; Vite's textual `import.meta.env.X` replacement only fires on the literal pattern, and the resolver had aliased it through a local var. Refactored resolver to be config-agnostic: `pmtilesPath` is required in `ResolveStyleOptions`; caller (MapEditor.tsx) reads env directly.
   - `atlasdraw-4607` — Vite SPA fallback returned 200/HTML for missing `/data/*.pmtiles`, causing MapLibre "Wrong magic number". Added `pmtilesNotFoundPlugin` (configureServer middleware) that returns true 404 + helpful message.
   - `atlasdraw-7899` — MapCanvas hardcoded `openfreemap liberty` as default styleUrl; replaced with inline empty MapLibre style (no network fetch).
   All three commits: `cfb951e`, closures `6d38f9b`.
- ✅ **Post-smoke followups** — BasemapPickerDialog moved out of `<MainMenu>` (auto-close was unmounting it). `transparentAppliedRef` gate prevents Excalidraw's mount-time default-vbg (#ffffff or #121212) from leaking into `mapBg`. `MapCanvas` now uses `requestAnimationFrame(map.resize)` + `ResizeObserver`. MapCanvas placeholder bg → `rgba(0,0,0,0)`. Commit `21fa034`.
- ✅ **World-low-zoom pmtiles archive** — Extracted zoom 0-6 from build `20260510.pmtiles` via `pmtiles extract` (CLI v1.30.2) using HTTP range requests. 2.17 seconds, 42.5 MB output at `code/apps/atlas-app/public/data/world-low-zoom.pmtiles` (gitignored). Resolver default already targets this path. Seed closed: `atlasdraw-1a95`. Commit `b4c5e01`.
- ✅ **INITIAL_VIEW → India** (78.5°E, 22°N @ z=4) instead of San Francisco @ z=12 (zoom 12 outside world-low-zoom's max-zoom range). Commit `3fe1c26`.
- ✅ **Autosave now clears `● Unsaved` indicator** — Added optional `onSaved` callback to `startAutoSave` (5th param, trailing optional). MapEditor passes `usePersistenceStore.clearDirty`. The previous behavior left isDirty stuck `true` forever after first mutation. Commit `3fe1c26`.

### Open after this session

- ⬚ `atlasdraw-3601` (P1, `+test-debt`) — Excalidraw `addFiles()` round-trip test for image hydration.
- ⬚ `atlasdraw-320b` (P3) — 3× MapLibre "Expected value to be of type number, but found null" warnings from blob-URL worker context. Smoke-test residue.
- ⬚ `atlasdraw-087c` (P3) — `hydrate.ts` data-layer `visible:true` TODO comment in production path.
- ⬚ `atlasdraw-b9d2` / `atlasdraw-d1a1` / `atlasdraw-95de` (P3, duplicates across instances) — Space+drag pan doesn't reach the map. Hand-tool button workaround. Diagnosis + fix sketch in seed body.
- ⬚ `atlasdraw-e6f7` / `atlasdraw-189c` (P2, duplicates) — Plan §5 T12 Makefile basemap-world recipe (archive landed in `b4c5e01`, but Makefile target itself was never written).
- ⬚ **T1 + T2 storage scaffold** — Plan calls these Wave 0 tasks but they were never executed. No `code/apps/storage/` dir exists. Blocks T3/T4 dispatch. No seed filed yet for these.

### Wave 1 task scoreboard

| Task | Status |
|---|---|
| T3 storage HTTP + adapters | NOT STARTED (blocked on T1+T2) |
| T4 share endpoint          | NOT STARTED (blocked on T3) |
| T5 real basemap styles     | ✅ landed (e35fa53) |
| T6 BasemapPicker UI        | ✅ landed (9cb691e + 21fa034 fixed positioning bug) |
| T7 pmtiles resolver        | ✅ landed (ac7f256 + cfb951e refactored for Vite env transform) |
| T13 useAutosave hook       | partially landed — autosave wired in `3fe1c26` |
| T14 AboutDialog            | NOT STARTED |
| T17 ADRs                   | NOT STARTED |
| T18 observability baseline | NOT STARTED |

## What Worked

- **Pre-dispatch scrub before worker dispatch.** Caught two plan-literal-drift bugs (Protomaps source URL, pmtiles-protocol arg shape) before workers could ship the wrong thing. Lesson reinforced from `mx-d4f376` / `mx-cb3eb8`.
- **Worktree isolation for parallel workers.** Dispatched T5 + T7 in `isolation: "worktree"` subagents simultaneously; both rebased onto main, returned commits, cherry-picked into main cleanly (no merge conflicts because file ownership was clean).
- **Read PMTiles header before further code iteration.** The 1-hour "dark rectangle" rabbit hole ended the moment I read 127 bytes of the india.pmtiles header. Diagnosis: bbox restricted to South Asia.
- **pmtiles CLI HTTP range-request extract.** 135 GB world archive → 42.5 MB zoom 0-6 extract in 2.17 seconds, no full download. Recipe: `pmtiles extract https://build.protomaps.com/<key>.pmtiles --maxzoom=6 OUTPUT`.

## What Didn't Work

- **Three speculative diagnoses for the "dark rectangle" symptom** before reading the pmtiles header: (a) MapCanvas placeholder #f0f0f0 bleed, (b) Excalidraw default `viewBackgroundColor` leak into `mapBg`, (c) MapLibre canvas resize lag. The vbg-leak and resize fixes WERE real bugs (kept), but they didn't fix the symptom because the symptom was about pmtiles bbox. Lesson: **inspect data shape before iterating on code**.
- **Playwright daemon kept crashing on `playwright-cli open`.** Lightpanda doesn't run React fully. Live DOM inspection from this session was effectively impossible — relied on the user to share screenshots + console logs.
- **First commit attempt swept the 4.9 GB `india.pmtiles` binary into staged tree.** Caught immediately, reset, added `code/apps/atlas-app/.gitignore` rule for `public/data/`. **Don't `git add <directory>` when the directory could contain large binaries.**

## Key Decisions

- **Resolver is config-agnostic.** `@atlasdraw/basemap` does not read env vars. Atlas-app reads `import.meta.env.VITE_PMTILES_PATH` and passes the resolved path into `resolveStyle()`. Rationale: Vite's textual env replacement only fires on the literal `import.meta.env.X` pattern; cross-package source files where the access is aliased through a local var get missed. The package boundary stays clean and the env semantics stay where Vite can see them.
- **Vite middleware for `/data/*.pmtiles` returns true 404, not SPA HTML fallback.** Anything else would hide config errors behind cryptic MapLibre `Wrong magic number` errors.
- **MapCanvas default style is now inline empty MapLibre style (`name: "atlasdraw-empty"`), with `rgba(0,0,0,0)` background.** No network fetch; works offline; nothing visible until the real basemap style is applied.
- **BasemapPickerDialog renders at the root level, not inside `<MainMenu>`.** State stays on MapEditor; MainMenu auto-close on item click doesn't unmount the dialog.
- **`transparentAppliedRef` gate.** Excalidraw v0.18 emits an `onChange` with its default `viewBackgroundColor` ("#ffffff" or "#121212") on mount before `initialData` applies. The watchdog now only captures user color picks AFTER seeing `transparent` once — proof the reset has been applied.
- **INITIAL_VIEW = India, not SF.** Matches the maintainer's interest area AND the world-low-zoom archive (zoom 0-6 only; SF at zoom 12 would have no tile data).
- **`startAutoSave` takes optional `onSaved` callback (5th param).** Threaded `usePersistenceStore.clearDirty` from MapEditor. Awaits `store.save()` before firing the callback — durability-honest.

## Trajectory

**How we got here.** Session started with the user calling out that the prior Phase 4 phase was a botched job. The code-reviewer audit confirmed Wave 0 was misrepresented as complete (6 prereqs closed; plan actually had 8 tasks; atlasdraw-3601 was prematurely closed with a deferred addFiles gap quietly patched in a later "bug triage" commit). The session then pivoted to repair: revert uncommitted churn, reopen 3601, file 4 follow-up seeds (T5/T7/T6-misorder/hydrate-TODO). Then dispatched T5 + T7 in worktree workers after a pre-dispatch scrub that caught two plan-literal-drift bugs (Protomaps source not GitHub releases JSON; pmtiles-protocol parameterless by design). Cherry-picked both commits clean. Then smoke-tested the running dev server, surfaced 3 new bugs (env-var seam, pmtiles SPA fallback, MapCanvas liberty leak), fixed and shipped them. THEN spent ~hour chasing speculative code diagnoses for a "dark rectangle covers most of viewport" symptom — wrong about MapCanvas placeholder, wrong about Excalidraw vbg leak, wrong about canvas resize. The user finally asked "is this happening because the protomap file is only for india", which was the actual answer (bbox 68°E-97°E, 6°N-37°N). Extracted a 42.5 MB world-low-zoom archive via `pmtiles extract` HTTP range requests, switched INITIAL_VIEW to India, fixed the autosave dirty-flag-stuck bug, and filed seeds for the open issues.

**Hard calls.** Whether to dispatch parallel workers vs serial for T5+T7 — went parallel via worktrees, paid off (no conflict, faster). Whether to amend the plan vs just bake corrections into the worker brief — amended the plan (per publish-or-audit-ready), takes more effort but keeps the durable artifact correct. Whether to silently fold T1+T2 storage scaffold into a T3 dispatch — surfaced to user instead, correctly identified as scope creep that the prior session would have done quietly.

**Shaky ground.** The `transparentAppliedRef` gate fix assumes Excalidraw's mount-time emit is the FIRST emit and that we'll see `vbg === "transparent"` shortly after on the watchdog's reset cycle. If Excalidraw skips the transparent emit (e.g., consecutive non-transparent emits), `transparentAppliedRef` stays false forever and user color-picks won't propagate. Probably works in practice but not formally verified.

**Invisible context.** The user has `india.pmtiles` (4.9 GB) at `code/apps/atlas-app/public/data/india.pmtiles` — that's their personal test data, gitignored. They have a deep familiarity with the codebase and limited patience for chase-the-rabbit diagnostics; multiple `?` responses signaled to keep updates terse and direct. The user reads the code itself, not summary prose — pointing them to specific commits + file:line is more useful than narrative descriptions. The Excalidraw v0.18 vendored fork is heavily customized; the `.claude/rules/excalidraw-api.md` rule is load-bearing — **grep the vendored source before assuming any API shape**.

## Active Skills & Routing

- `playwright-cli` was loaded but its daemon crashed repeatedly on `open`. Avoid for live-DOM inspection in this environment.
- `handoff` (this skill) at session end.
- `dispatching-parallel-agents` implicitly used for T5+T7 dual worktree dispatch.
- Pending routing for next agent:
  - **`writing-plans`** before any T1/T2 storage scaffold work (multi-file, fresh package layout)
  - **pre-dispatch scrub** convention (mx-d4f376, mx-cb3eb8, mx-04ac8d) applies to T1/T2 — they're claimed Wave 0 but plan-spec quality is unverified
  - **`adversarial-api-testing`** for T4 share endpoint per plan §5 Task 4
  - **`systematic-debugging`** for `atlasdraw-320b` (blob-URL warnings — need sourcemap sleuthing)

## Infrastructure Delta

No infrastructure changes this session. Skills/hooks/pipelines unchanged. Plugin versions unchanged.

## Knowledge State

- **Indexed**: protomaps-themes-base@4.5.0 (probed via npm install, not via foxhound `context add`); pmtiles header layout (manually decoded in this session — could be a candidate for mulch convention record).
- **Productive tiers**: default routing sufficient. `ctx_search` after `ctx_batch_execute` was used productively for plan section retrieval. `ml search` was light this session.
- **Gaps**: No indexed docs for go-pmtiles CLI; recipes had to be discovered by `--help`. Plausible to add via `foxhound context add` if T12 Makefile work continues.

## Next Steps

1. **Smoke-test verification after restart.** Hard-refresh http://localhost:5174/. Verify: world basemap renders (India centered at z=4), pan works, hand-tool works, "● Unsaved" clears 5-30s after a mutation, basemap picker opens from menu without closing menu.

2. **File T1 + T2 seeds explicitly** (atlasdraw planning). Without these, T3/T4 storage dispatch is blocked. Plan §3 Task 1 (StorageMode + StorageClient + MapRecord + ShareToken types) and Task 2 (Zod schema + AppConfig detection) are both still "Wave 0" in the plan but were never executed.

3. **Pick the next block**:
   - **T1+T2** to unblock T3+T4 (heaviest remaining; needs pre-dispatch scrub of plan §3 sections)
   - **atlasdraw-3601** addFiles round-trip test (small bite, finishes Wave 0 audit trail)
   - **atlasdraw-b9d2** space+drag bridge (P3, hand-tool workaround works; fix sketch in seed)
   - **T13 useAutosave**, **T14 AboutDialog**, **T17 ADRs**, **T18 observability baseline** (lighter Wave 1 tasks)

4. **Push to origin.** Local main is 62 ahead at handoff write. `git push origin main` is the trivial next step; not done autonomously per house rule.

5. **Consolidate duplicate seeds.** `atlasdraw-1a95` (closed) was mirrored across instances as `e6f7` and `189c` (still open). Same for space+drag (`b9d2` / `d1a1` / `95de`). The seeds CLI cross-instance mirroring is creating drift. Decide: dedup manually, or accept as cross-instance copies.

6. **Stale-plan check**: `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` has two dated 2026-05-10 scrub notes from this session — plan is current, no archival needed.

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` — Phase 4 plan with 2026-05-10 scrub notes on Task 5 + Task 7. The §3 Task 1/2 sections describe the still-unbuilt storage scaffold.
- `code/packages/basemap/src/resolver.ts` — config-agnostic resolver; required `pmtilesPath` shape.
- `code/apps/atlas-app/src/components/MapEditor.tsx` — basemap-style effect (line ~410), Excalidraw onChange watchdog (line ~810, vbg gate + scroll lock), autosave wiring (line ~511, onSaved callback).
- `code/apps/atlas-app/vite.config.ts` — `pmtilesNotFoundPlugin` middleware (atlasdraw-4607).
- `code/apps/atlas-app/.env.example` — VITE_PMTILES_PATH documentation; `.env.local` is gitignored.
- `code/packages/basemap/scripts/build-styles.mjs` — T5 generator script for vendoring Protomaps + OpenFreeMap styles.
- `.claude/rules/excalidraw-api.md` — load-bearing; grep before assuming Excalidraw v0.18 API shape.
- `HANDOFF-expertise.md` — structured mulch records (ml prime + ml diff). Not regenerated this session; meta domain still authoritative as of 5h-ago marker.
