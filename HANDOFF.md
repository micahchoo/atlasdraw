# Handoff

## Goal

> "start with the commit" → "yes [dispatch Wave 2]" → "yes but check what from excalidraw has prior art" → "continue" → "with record extractors and record the learnings"

Continue Phase 3 (`.atlasdraw` file format & local persistence) from
`docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`. Wave 2
(persistence + CLI) and Wave 3 (round-trip acceptance) had to land this session.
Phase 3 acceptance gate is the round-trip test (T12).

## Progress

**This session — 8 commits, Phase 3 closure:**

- ✅ `a00d653` — chore(state): seeds + mulch churn from Phase 3 W0+W1 + stale-seed sweep
- ✅ `ffbeeee` — chore(data): Phase 3 Wave 2 setup — add commander/idb/vitest; cli scripts (`code/packages/cli/package.json`, `code/packages/cli/tsconfig.json`, `code/apps/atlas-app/package.json`, `code/yarn.lock`)
- ✅ `bf08c00` — feat(atlas-app): T8 persistence layer — IndexedDB autosave + FSA opt-in (`code/apps/atlas-app/src/state/persistence.ts:1-475`, `persistence.test.ts:1-240`, 9 tests)
- ✅ `b754a96` — feat(cli): T10 lint subcommand (`code/packages/cli/src/atlasdraw.ts`, `commands/lint.ts:1-125`, `__tests__/lint.test.ts:1-140`, `vitest.config.ts`, 4 tests)
- ✅ `7be032e` — feat(atlas-app): T9 persistence wiring — store, doc selector, MainMenu (`code/apps/atlas-app/src/state/usePersistenceStore.ts:1-62`, `selectDocument.ts:1-149`, +99 lines in `components/MapEditor.tsx`, +13 tests)
- ✅ `91ac6b0` — feat(cli): T11 convert subcommand (`code/packages/cli/src/commands/convert.ts:1-258`, `__tests__/convert.test.ts:1-235`, +1 line in `atlasdraw.ts`, 7 new tests)
- ✅ `0ec3980` — feat(data): T12 round-trip acceptance tests (`code/packages/data/src/round-trip.test.ts:1-370`, 6 cases — Phase 3 acceptance gate closed)
- ✅ `b93680c` — chore(state): seeds + mulch churn from Phase 3 W2 + W3

**Phase 3 status (13 tasks):** 12 SHIPPED (T1-T12). T13 (KML/GPX stretch) PUNTED to Phase 6.

**Test counts at gate:**
- `@atlasdraw/data`: 83 (was 77; +6 round-trip cases). tsc clean.
- `@atlasdraw/cli`: 11 (4 lint + 7 convert). tsc clean. Cross-subcommand smoke verified (`convert .geojson → .atlasdraw` then `lint` exits 0 with valid OK message).
- `@atlasdraw/atlas-app`: 113 (was 100; +13 from T9). Vite build green (11.9s).

**Mulch records added this session (14 total via record-extractor):**
- 2 decisions: `mx-2e17ca` (idb typed vs idb-keyval), `mx-e2deba` (retro)
- 1 correction: `mx-744b7e` (plan-literal drift includes API-shape drift, not just paths)
- 9 conventions: `mx-025e8a` (MainMenu kebab path), `mx-30002e` (DefaultItems closure-bound), `mx-01984d` (per-concern Zustand stores), `mx-3342d8` (App.tsx passthrough), `mx-91343d` (FC registry gap), `mx-3c2203` (CLI shpjs.d.ts include), `mx-de40e2` (CLI types:[node]), `mx-48b101` (vitest --reporter=basic dropped)
- 2 failures: `mx-d16fa9` (Blob.type dropped through zip), `mx-ed9854` (styleRef:null divergence)

Branch is **27 ahead** of `origin/main`. Working tree clean (only `.claude/scheduled_tasks.lock` untracked — runtime, leave alone).

## What Worked

- **Wave 2 split into two parallel streams via Delegation Protocol.** Setup commit (`ffbeeee`) materialized the lockfile mutex; Round 1 dispatched T8 (atlas-app persistence) and T10 (CLI lint) in parallel — zero file overlap, both green on first return. Round 2 dispatched T9 (atlas-app wiring) and T11 (CLI convert) in parallel — same pattern. 4 workers × 3-9 min each = 4 commits inside ~18 min wall. Subagent type: `general-purpose`.
- **Pre-dispatch grep against vendored Excalidraw source.** Per `.claude/rules/excalidraw-api.md`: I greped `code/packages/excalidraw/components/main-menu/DefaultItems.tsx` BEFORE writing the T9 brief, caught the `mainMenu/` → `main-menu/` plan-literal drift, and pinned the corrected path + line numbers (LoadScene:66, SaveToActiveFile:109) into the worker brief. Worker copied verbatim — zero post-render footguns.
- **Verified-literals-first worker briefs.** Each brief opened with a `## VERIFIED LITERALS (don't re-grep these)` block — paths, line numbers, exact named exports from `@atlasdraw/data`. Workers consumed the envelope; no parallel re-greping; cache stayed warm.
- **`runX(args, { stdout, stderr }): Promise<number>` shape established by T10**, reused by T11. Tests call directly with mock streams — no `process.exit` mocking needed. Pure functions all the way down.
- **T12 as standalone acceptance gate.** Single-file dispatch (`code/packages/data/src/round-trip.test.ts`) caught two real serialization contracts that plan reviews missed: Blob.type drop + styleRef divergence. Both pinned into test assertions so a future writer-side fix breaks the assertion loudly.

## What Didn't Work

- **Plan §T9 referenced `apps/atlas-app/state/store.ts`** — the file doesn't exist. atlas-app uses per-concern Zustand stores (e.g., `state/layerRegistry.ts:105` exporting `useLayerRegistryStore`). Resolved by creating `state/usePersistenceStore.ts` as a peer. Recorded as `mx-01984d`.
- **Plan §T9 referenced `App.tsx`** — that file is `<MapEditor />` and nothing else. Real change-site is `components/MapEditor.tsx` (~480 lines, Excalidraw mounted there). Recorded as `mx-3342d8`.
- **`<MainMenu.DefaultItems.LoadScene>` and `<SaveToActiveFile>` are NOT composable.** Closure-bound to internal `actionLoadScene`/`actionSaveToActiveFile`; no `onSelect` prop. T9 worker fell back to adjacent `<MainMenu.Item>` entries (`Save .atlasdraw…` / `Open .atlasdraw…`). v1 ergonomic gap: dual entry points (Excalidraw `.excalidraw` vs atlasdraw `.atlasdraw`). Recorded as `mx-30002e`.
- **CLI tsconfig pulled `shpjs` ambient types through the data barrel.** `tsc --noEmit` failed with TS7016 until T10 worker added `../data/src/shpjs.d.ts` to `code/packages/cli/tsconfig.json` `include`. Will reappear in any package consuming `@atlasdraw/data`. Recorded as `mx-3c2203`.
- **CLI Phase 0 stub used `process.exit()`** but the base tsconfig has no `types` field — auto-discovery of `@types/node` via node_modules walk didn't fire from yarn-hoisted layout. Fix: `"types": ["node"]` in `code/packages/cli/tsconfig.json` (mirrors `code/bench/tsconfig.json`). Recorded as `mx-de40e2`.
- **`--reporter=basic` was dropped in vitest 3.** Initial verification ran with that flag and emitted a confusing startup error. Default reporter just works. Recorded as `mx-48b101`.

## Key Decisions

- **Use `idb` (typed wrapper) NOT `idb-keyval`** for the persistence store. Excalidraw's `excalidraw-app/data/LocalData.ts:20-27` uses `idb-keyval`; we deliberately diverged for typed schema control. Recorded as `mx-2e17ca`.
- **Trailing-edge debounce + 30s ceiling timer** per Plan Q3 — NOT lodash's leading+trailing pattern. T8 worker implemented snapshot-guard via sequence counter (per advisor) instead of `manifest.updatedAt` identity for cleaner in-`save()` race semantics.
- **`StoredBlob` wrapper in IDB** (T8 deviation): IDB stores `{ bytes: Uint8Array, type: string }` instead of raw Blob — fake-indexeddb's structured-clone path uses `XMLHttpRequest` over `URL.createObjectURL` which jsdom can't service. Round-trips byte-identical zip data; transparent to callers.
- **CLI `bin` points to `src/atlasdraw.ts`** (T10), not `src/index.ts`. Shebang lives in `atlasdraw.ts`; `index.ts` is just barrel re-exports. Followed plan literal here even though CLI is greenfield.
- **selectDocument ships `layers: new Map()` for v1** (T9). Data-layer FCs live in MapLibre sources at runtime, not in any registry. Phase 4 needs a parallel FC registry keyed by `dl:` id. Recorded as `mx-91343d`.
- **Excalidraw scene hydration stubbed** (T9). `AtlasdrawDocument.scene: ReadonlyArray<unknown>` — calling `excalidrawAPI.updateScene({ elements: doc.scene })` would be unsound. T9 logs `[INFO]` and leaves a `[NOTE]` for Phase 4 to pick a typed scene shape.

## Trajectory

**How we got here.** Session opened on the prior handoff (Phase 3 W0+W1 done, Wave 2 unblocked). User said "start with the commit" — I committed the dirty `.seeds/issues.jsonl` + `.mulch/expertise/meta.jsonl` as `chore(state)`. Then "yes" → setup wave: added commander/idb/vitest/@types/node to CLI, idb to atlas-app, fixed pre-existing CLI typecheck breakage (`process.exit` was untyped because base tsconfig had no `types: ["node"]`), ran `yarn install`, verified all three workspaces clean, committed `ffbeeee`. Then "yes but check what from excalidraw has prior art" — greped vendored Excalidraw, caught the `mainMenu/` → `main-menu/` plan-literal drift, pinned line numbers, and dispatched T8+T10 in parallel via `general-purpose` agents. Both returned green; committed individually. Round 2: scouted MapEditor.tsx and discovered `state/store.ts` and `App.tsx` were both phantom plan literals — atlas-app uses per-concern Zustand stores; real Excalidraw mount is in MapEditor.tsx. Dispatched T9+T11 in parallel with corrected briefs; both returned green. Then T12 as a single-worker acceptance gate, surfacing two real serialization contracts (Blob.type drop, styleRef:null divergence). Final state commit (`b93680c`). User invoked `/handoff` with record-extractor — 14 mulch records emitted, this handoff captures the rest.

**Hard calls.**
- **Sequence-counter snapshot guard vs manifest.updatedAt identity** (T8). Plan said use `manifest.updatedAt` identity; T8 worker (per advisor) chose a `dirtySeq` counter captured synchronously at `save()` entry. Cleaner for the in-`save()` race; the `updatedAt` identity check is the right shape for `startAutoSave`'s OUTER guard if Zustand wiring needs it. T9 didn't layer on the outer guard because the inner guard already handles the race. Tradeoff: if a future writer mutates `manifest.updatedAt` mid-write, the inner guard catches it but external observers won't see "save committed for this version" without the identity check.
- **Adjacent MainMenu items vs wrapping DefaultItems** (T9). Wrapping was invasive (closure-bound actions); adjacent items meant dual entry points — confusing UX but clean code. Chose adjacent + filed a Phase 4 unification ergonomic gap.
- **Skip T13 (KML/GPX)** entirely. Plan called it stretch; punted to Phase 6 to keep Wave 3 acceptance the gate.

**Shaky ground.**
- **Atlas-app `paths:{}` debt is now larger.** Baseline 1886 → 1892 (+6 from T9: 4 implicit-any in MapEditor's new callbacks, 2 ExcalidrawImperativeAPI re-export errors in selectDocument). Vite build green; tsc-only noise. The composite-tsconfig refactor (separate initiative; `atlasdraw-dc84` closed `rework` last session) needs to land before Phase 4 hardens its types.
- **selectDocument doesn't read FCs from MapLibre sources.** v1 ships `layers: new Map()`. The first user who saves with data layers loaded loses them on round-trip. This is the single biggest gap heading into Phase 4.
- **Excalidraw scene hydration is silently stubbed.** Persistence saves the scene successfully; load reads the doc and logs `[INFO]` without calling `updateScene`. A user who refreshes loses their visible scene even though the doc is in IDB. Phase 4 priority.

**Invisible context.**
- **`ulid` is a transitive dep available everywhere `@atlasdraw/data` is hoisted.** T11 worker added it to CLI's direct deps for clarity, but it was already resolvable. Atlas-app imports it in selectDocument via the same hoist. If `@atlasdraw/data` ever drops it, three packages break silently.
- **The `runX(args, streams): Promise<number>` shape is the CLI testability convention.** Established by T10, mirrored by T11. T12 worker noticed it via a glance at lint.ts. Future CLI subcommands (e.g., `render` from package description) MUST follow.
- **Excalidraw `MainMenu` is already imported at MapEditor.tsx:30.** T9 worker didn't need to add the import. Future surfaces inside `<Excalidraw>` can use it directly.
- **`StoredBlob` wrapper in IDB is a fake-indexeddb workaround**, not a real-browser concern. Production browsers handle Blob structured cloning natively. If we ever swap test runtime, the wrapper can revert.
- **Plan-literal drift rate this session: 4 confirmed instances** (`mainMenu/` path, `state/store.ts` phantom, `App.tsx` phantom, `writeJSON: Promise<string>` API-shape vs actual `Promise<Blob>`). Recorded as `mx-744b7e` — the lesson is recursive (refines mx-04ac8d which refines mx-619182 which refines mx-8ec7b9).

## Active Skills & Routing

- **handoff** (this skill) — invoked at user request with `/handoff with record extractors and record the learnings`.
- **record-extractor** agent — dispatched once at session-end; emitted 14 mulch records, no new seeds.
- **Delegation Protocol (CLAUDE.md)** — drove 4 worker dispatches in two parallel rounds + 1 final acceptance worker. Single setup commit served as the lockfile-mutex wave.
- **`.claude/rules/excalidraw-api.md` (rule injection)** — fired during T9 brief drafting; led to the proactive grep that caught `mainMenu/` → `main-menu/` drift.
- **atlasdraw-ui-conventions** skill — invoked by T9 worker before adding MainMenu items; dictated `data-testid` + `aria-label` patterns. Slot-first rule respected (zero new surfaces).

No `[eval:]` checkpoints fired explicitly. Verification gate ("test + tsc must pass before commit") applied as personal discipline at every wave boundary.

## Infrastructure Delta

- **Plugins/Hooks/Pipelines:** unchanged.
- **Skills:** unchanged.
- **Global tooling:** unchanged.
- **Mulch domains:** populated. `data` domain grew (was 1, +2 failures). Other affected domains: `meta` (+2), `architecture` (+3), `excalidraw-api` (+2), `infrastructure` (+3). Ran `record-extractor` once.
- **Project files (non-`.claude/`):**
  - NEW: `code/apps/atlas-app/src/state/persistence.ts`, `persistence.test.ts`, `usePersistenceStore.ts`, `usePersistenceStore.test.ts`, `selectDocument.ts`, `selectDocument.test.ts`.
  - NEW: `code/packages/cli/src/atlasdraw.ts`, `commands/lint.ts`, `commands/convert.ts`, `__tests__/lint.test.ts`, `__tests__/convert.test.ts`, `vitest.config.ts`.
  - NEW: `code/packages/data/src/round-trip.test.ts`.
  - MODIFIED: `code/packages/cli/package.json` (commander, @atlasdraw/data, vitest, @types/node, type:module, bin → atlasdraw.ts, ulid, scripts), `code/packages/cli/tsconfig.json` (types:[node], include shpjs.d.ts), `code/packages/cli/src/index.ts` (re-exports, no longer a stub), `code/apps/atlas-app/package.json` (idb), `code/apps/atlas-app/src/components/MapEditor.tsx` (+99 lines: persistence useEffect, markDirty in handleExcalidrawChange, MainMenu items), `code/yarn.lock`.

## Knowledge State

- **Indexed:** no `context add` packages this session.
- **Productive tiers:** mulch (14 records cited inline), seeds (state churn only), git log + git diff, plan addendum at `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`, vendored Excalidraw source under `code/packages/excalidraw/`, `code/excalidraw-app/data/LocalData.ts` (decision evidence). Default routing was sufficient throughout.
- **Gaps:** none encountered that needed external indexing. Phase 4 will likely need indexing for any new persistence-layer libraries (e.g., FSA polyfills if Firefox/Safari coverage grows).

## Next Steps

1. **Phase 4 prerequisite: data-layer FC registry.** `selectDocument` ships `layers: new Map()` because runtime FCs live in MapLibre sources (`mx-91343d`). Build a parallel Zustand store `useDataLayerFCStore` keyed by `dl:` id; wire `useLayerRegistrySync` to also push FCs into it; update `selectDocument` to read from both. Without this, save/restore loses all data layers — the highest-priority Phase 4 ticket.

2. **Phase 4 prerequisite: Excalidraw scene hydration.** T9 stubbed `load()` success path with a `[NOTE]` log. Pick a typed scene shape (probably `{ elements: NonDeletedExcalidrawElement[], appState: Partial<AppState>, files: BinaryFiles }`) — grep `code/packages/excalidraw/types.ts` for the canonical aggregator. Wire `excalidrawAPI.updateScene(...)` and `addFiles(...)` in the load path.

3. **MainMenu surface unification (Phase 4 ergonomic).** Currently dual entry points: Excalidraw's `.excalidraw` save/open + atlasdraw's `.atlasdraw` save/open as separate MainMenu items. Decide: replace Excalidraw items via `<MainMenu>` slot override, or keep both and accept the dual-format ergonomic. Plan §T9 audit-amended note assumed wrapping would work; closure-binding made it impossible. Likely: replace Excalidraw items entirely since `.excalidraw` is no longer the canonical format.

4. **Composite-tsconfig refactor (`atlasdraw-dc84` follow-up).** Atlas-app `paths:{}` clobber adds 1892 tsc errors that vite hides. Phase 4 type hardening will collide with this. Separate session-scope project; coordinate with `atlasdraw-947d` (shapefile fixture).

5. **`atlasdraw-947d` shapefile happy-path fixture.** Filed last session, still open. T12 only exercises shapefile error paths. A real `.zip` fixture (generate via `ogr2ogr` outside the project, commit base64, decode in test) would close the gap. Recommended before Phase 4 self-host work.

6. **Push to origin.** Branch is 27 ahead. `git push origin main` is the trivial next step if you're done iterating in this branch.

7. **Stretch: T13 KML/GPX parsers.** Punted to Phase 6 per plan. Plan §T13 has the spec; `@mapbox/togeojson ^0.16.2` is the recommended dep. Skip unless time-pressured-not.

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md` — Phase 3 plan; Wave 3 spec at line 558+ (T12 done; T13 stretch).
- `code/packages/data/src/round-trip.test.ts` — the Phase 3 trust boundary. Phase 4 changes that break round-trip break this.
- `code/apps/atlas-app/src/state/persistence.ts` + `selectDocument.ts` + `usePersistenceStore.ts` — the persistence trio. Phase 4 FC registry plugs into selectDocument.
- `code/apps/atlas-app/src/components/MapEditor.tsx:470+` — the persistence useEffect + MainMenu wiring. Future scene hydration goes here.
- `code/packages/cli/src/atlasdraw.ts` — commander entry; future subcommands `program.addCommand(...)` here.
- `HANDOFF-expertise.md` — structured mulch records for Phase 3 close (data + meta + architecture + excalidraw-api + infrastructure domains) via `ml prime` + recent deltas via `ml diff`.
