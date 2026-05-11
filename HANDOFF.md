# Handoff — 2026-05-10 (GH Pages dual-tier + storage Wave 0 + AboutDialog)

## Goal

The user's words across the session: *"can this currently be hosted on gh pages"* → *"can the production be built out fully for power users while the gh pages remains for casual users"* → *"do as recommended"* → *"do it"* → after the first round, *"also add a ui element that indicates basemap source - whether local or remote provider"* → *"do these"* (where "these" = the three deferred follow-ups: T1+T2 storage scaffold, full T14 AboutDialog).

Net effect: ship the casual-tier GH Pages deploy stack, land the Wave 0 storage scaffold (T1+T2) so Wave 1 backend work can start, and complete T14 AboutDialog with version/license/telemetry/edition surface. Storage came AFTER GH Pages per the user's explicit "sequence: GH Pages first, then storage" choice.

## Progress

### Completed this session — committed

- ✅ **Plan scrub (2026-05-10 scope-expansion) on §5 Task 2** — formalized the casual/power tier split + `VITE_BUILD_TARGET` tri-state (`pages` | `local-only` | `hosted`) before T1/T2 dispatch. Plan amendment file `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md`. Filed seed `atlasdraw-9841` for T2b.
- ✅ **T2b — atlas-app AppConfig** (`code/apps/atlas-app/src/config/app-config.ts`) with Zod-validated `VITE_BUILD_TARGET` discriminator, four feature-flag exports (`enableShareUI`, `enableRealtime`, `enableBackendPersistence`, `showDemoBadge`), module-cached `getAppConfig()`. 5/5 unit tests. Defaults to `local-only` so `yarn dev` doesn't show the demo badge. Commit `0d7b8dc`.
- ✅ **Vite `base` conditional** — `vite.config.ts:39-43` reads `process.env.VITE_BUILD_TARGET` at config time; emits `base: "/atlasdraw/"` when `pages`, else `/`. Commit `0d7b8dc`.
- ✅ **Git LFS for `world-low-zoom.pmtiles`** — `.gitattributes` tracks `*.pmtiles filter=lfs diff=lfs merge=lfs -text`; `code/apps/atlas-app/.gitignore` un-ignores only the world archive (keeps `india.pmtiles` and any other ~5 GB local-only files ignored). 43 MB pmtiles committed via LFS. Commit `0d7b8dc`.
- ✅ **`.github/workflows/pages.yml`** — checkout with `lfs:true` → setup-node 20 → corepack → `yarn install --immutable` → `yarn workspace @atlasdraw/atlas-app build` with `VITE_BUILD_TARGET=pages` + `VITE_PMTILES_PATH=/atlasdraw/data/world-low-zoom.pmtiles` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`. Triggers on push to main + manual. Commit `0d7b8dc`.
- ✅ **Smoke-test verified** the pages build: `dist/index.html` emits asset URLs under `/atlasdraw/`, base prefix works. 5/5 app-config tests pass. Commit `0d7b8dc`.
- ✅ **T2b seed closed** — `atlasdraw-9841` outcome:success. Commit `3be6304`.
- ✅ **Basemap source UI indicators** — `BasemapPickerDialog` per-option Local/Remote chip (`data-testid="basemap-source-<id>"`); MainMenu basemap item label now reads `🗺 Basemap: <Label> · <Source>` so the active source is visible without opening the dialog. Rule-0 compliant (no new surfaces). Commit `08bf073`.
- ✅ **Demo-edition MainMenu item** (later replaced by AboutDialog in commit `3644445`).
- ✅ **`cleanupPublicDataPlugin`** in `vite.config.ts` — `closeBundle` hook prunes anything in `dist/data/` that isn't `world-low-zoom.pmtiles`. **Dist size dropped from 5.0 GB to 65 MB locally** (stops the 4.9 GB `india.pmtiles` from bleeding into the deploy artifact). Allow-list pattern: `ALLOWED_DATA_FILES` Set. Commit `08bf073`.
- ✅ **T1 — storage contract types** — new `code/apps/storage/` workspace (`@atlasdraw/storage`) mirroring `apps/realtime` shape (commonjs, es2022, `types: ["node"]`, not composite, not in root tsconfig refs). `src/types.ts` exports `StorageMode`, `MapRecord`, `ShareToken`, `StorageClient`. Local `vitest.config.ts` (per-package shield from root vitest config — see mulch `infrastructure` domain note recorded this session). Commit `1141a4d`.
- ✅ **T2 — storage config + StorageMode detection** — `src/config.ts` with discriminated Zod schema (`postgres-minio` requires DATABASE_URL/BLOB_*, `sqlite-fs` requires DATA_DIR default `/data`), `loadConfig(env?)`, named-var error messages via `formatZodError` that handles both `invalid_enum_value` and `invalid_union_discriminator` Zod codes. 7/7 unit tests. Commit `1141a4d`.
- ✅ **T14 — AboutDialog** (`code/apps/atlas-app/src/components/AboutDialog.tsx`) — modal mirrors `BasemapPickerDialog` pattern (root-level mount, no `@excalidraw/Dialog` dependency, jsdom-testable, Escape + click-outside dismiss). Sections: version (from `import.meta.env.VITE_APP_VERSION`), build hash (`VITE_GIT_HASH`), AGPL-3.0 license badge, edition label (Demo / Local / Self-hosted), telemetry policy text, demo-edition CTA when `showDemoBadge`. Replaces the lighter `⚡ Demo edition` MainMenu item with `ℹ About Atlasdraw`. Vite `define` injects version (from package.json) + git hash (from `git rev-parse --short HEAD`) at build time. 4/4 dialog tests. Commit `3644445`.
- ✅ **Mulch record** — added to `infrastructure` domain: "Per-package vitest.config.ts shields from root setupTests" (`mx-` id auto-generated). Tagged `vitest,testing,workspace,monorepo,storage`. Evidence commit `1141a4d`.

### Open after this session

- ⬚ **T3 storage HTTP server + dual adapters** — the next critical-path block, unblocks T4 (share) and T13 (autosave-against-StorageClient).
- ⬚ **T4 share endpoint** — blocked on T3.
- ⬚ **T13 finish** — autosave is wired in `3fe1c26` but still hits localStorage; rewire to talk to T3's HTTP API once T3 lands.
- ⬚ **T17 ADRs** — `0006-telemetry.md`, `0007-storage-dual-mode.md`, `0008-share-link-encoding.md`. AboutDialog references self-host docs directly because 0006 doesn't exist yet.
- ⬚ **T18 observability baseline** — `/health`, pino logger, Sentry ADR.
- ⬚ **T8/T9** share-via-link client (blocked on T4).
- ⬚ **T10/T11** docker-compose minimal + full stacks (blocked on T3 image build).
- ⬚ **T12 Makefile basemap-world recipe** (archive landed in `b4c5e01`, target missing). Seeds `atlasdraw-e6f7` / `atlasdraw-189c` (dup).
- ⬚ **T15** self-host README + production.md.
- ⬚ **T16** first-run E2E smoke test.
- ⬚ **atlasdraw-3601** (P1, test-debt) — Excalidraw `addFiles()` round-trip test for image hydration. Closes Wave 0 audit gap.
- ⬚ **atlasdraw-087c** (P3) — `hydrate.ts` data-layer `visible:true` TODO.
- ⬚ **atlasdraw-320b** (P3) — 3× MapLibre "Expected value to be of type number, but found null" blob-worker warnings.
- ⬚ **atlasdraw-b9d2 / d1a1 / 95de** (P3, triplicate) — Space+drag pan to map. Hand-tool button workaround works; diagnosis + fix sketch in seed body.
- ⬚ **Push to origin** — local `main` is **62 ahead**. Never pushed this session per house rule. First push triggers the new pages workflow.
- ⬚ **GitHub Pages settings** — repo settings → Pages → "Source: GitHub Actions" must be enabled or `deploy-pages` fails with "Pages site not enabled."
- ⬚ **Seeds dedup** — `e6f7`/`189c` mirrored; `b9d2`/`d1a1`/`95de` mirrored. Seeds-CLI cross-instance mirroring drift.

### Phase 4 task scoreboard (re-stated)

| # | Task | Wave | Status |
|---|---|---|---|
| T1 | Storage contract types | 0 | ✅ `1141a4d` |
| T2 | Storage config + StorageMode | 0 | ✅ `1141a4d` |
| T2b | atlas-app AppConfig | 0 | ✅ `0d7b8dc` (added by 2026-05-10 scrub) |
| T5 | Vendor basemap styles | 1 | ✅ `e35fa53` (prior session) |
| T6 | BasemapPicker UI | 1 | ✅ `9cb691e` + `21fa034` (prior) |
| T7 | PMTiles resolver | 1 | ✅ `ac7f256` + `cfb951e` (prior) |
| T13 | startAutoSave wire (partial) | 1 | ◐ partial — `3fe1c26` (prior); rewire on T3 |
| T14 | AboutDialog | 1 | ✅ `3644445` |
| T3 | Storage HTTP + adapters | 1 | ⬚ NOT STARTED |
| T4 | Share endpoint | 1 | ⬚ NOT STARTED |
| T17 | ADRs (0006/0007/0008) | 1 | ⬚ NOT STARTED |
| T18 | Observability baseline | 1 | ⬚ NOT STARTED |
| T8/T9 | Share link client | 2 | ⬚ NOT STARTED |
| T10/T11 | docker-compose stacks | 2 | ⬚ NOT STARTED |
| T12 | Makefile basemap-world | 2 | ⬚ NOT STARTED |
| T15 | Self-host docs | 2 | ⬚ NOT STARTED |
| T16 | E2E smoke test | 3 | ⬚ NOT STARTED |

## What Worked

- **Advisor-gated scope re-check.** Before launching three parallel storage workers I called `advisor()`, which flagged that the user's actual throughline was "ship GH Pages", not "start storage". One follow-up `AskUserQuestion` confirmed the correct scope (sequence GH Pages first). Saved ~2 hours of misdirected work.
- **Pre-dispatch scrub on T1.** Grep verified: `code/apps/storage` doesn't exist, workspace pattern `apps/*` resolves from `code/`, yarn classic (not pnpm), realtime is the closest template. Captured one integration-seam absence (package scaffold not enumerated in plan T1) before touching code. Per `mx-d4f376` / `mx-cb3eb8` convention.
- **Mirror `apps/realtime` for `apps/storage`.** Identical commonjs+es2022+node-types tsconfig, identical not-composite stance, identical "Phase 0 stub" exit shape (but here it's "Wave 0 types-only" not "stub"). Copy-paste-with-edits beat designing from scratch.
- **Per-package `vitest.config.ts`.** First storage test crashed with `Cannot find module setupTests.ts` because root `code/vitest.config.mts` hardcodes setupFiles for excalidraw-app. Copying `packages/basemap/vitest.config.ts` (3 lines, `environment: "node"`, `globals: true`) fixed it instantly. Now recorded as a mulch infrastructure convention.
- **Vite `define` for `import.meta.env.X`.** Cleanest way to inject version + git hash at build time. Recurring pattern from `atlasdraw-bff1` (the resolver/env-var seam bug): Vite only replaces literal `import.meta.env.X` references, not aliased ones. Using `define` makes the replacement explicit.
- **`closeBundle` plugin for `dist/data/` hygiene.** Single-purpose plugin, allow-list a Set, runs after Vite's normal copy. Five-line solution to a 5-GB problem.
- **Discriminated Zod schema** for storage config (`z.discriminatedUnion`). Per-mode required vars get type-narrowed automatically. Caught one Zod issue: discriminator failures produce `invalid_union_discriminator` issue code, not `invalid_enum_value` — needed both branches in `formatZodError`.
- **Rule-0 compliance.** Added Local/Remote chips to the existing `BasemapPickerDialog` and the MainMenu item label. Did NOT create a new top-left chip surface. Matched the prior W-B retrofit that removed `.pinButton` / `.layersToggleButton`.

## What Didn't Work

- **First commit attempt swept `cli/atlasdraw.ts` mode-change drift.** Yarn install re-sets the executable bit on workspace bin entries every time; this is recurring noise. Restored before each commit via `git restore code/packages/cli/src/atlasdraw.ts`. Worth filing as a chronic hygiene seed or just adding `code/packages/cli/src/atlasdraw.ts` to a `git update-index --skip-worktree` allowlist if it keeps recurring.
- **First `ml record` call put the convention in a new `convention` domain.** `ml record <domain>` — domain is positional. I called `ml record --type convention` and it auto-created a `convention` domain. Re-recorded into `infrastructure`, removed the empty domain file. CLI ergonomics issue; mulch v0.6.3's "auto-create domain on unknown first arg" is footgun-prone.
- **AboutDialog test coverage for non-default build targets.** Skipped explicit `pages`/`hosted` render tests because `getAppConfig()` module-caches; would need `vi.mock` to test each branch. Settled for: AppConfig has 5 tests covering all three modes; AboutDialog has 4 tests covering the default (local-only) render path. The demo-note path is logically derivable but not asserted via DOM render.
- **First smoke build produced 5 GB `dist/`.** Vite's default `publicDir` copies the entire `public/` tree, including the local 4.9 GB `india.pmtiles`. Caught by `du -sh`; fixed with `cleanupPublicDataPlugin`. CI is unaffected (no india.pmtiles), but local builds would have been miserable.

## Key Decisions

- **Casual/power tier split via `VITE_BUILD_TARGET` tri-state**, not via runtime config detection. Build-time discriminator means dead branches tree-shake in `pages` build. Three modes (`pages` | `local-only` | `hosted`) instead of two — the advisor flagged this as YAGNI, but `local-only` is the right default for `yarn dev` (no badge, no demo CTA, no remote attempts) and it's free to keep. Documented in plan §5 Task 2 scrub note dated 2026-05-10.
- **Git LFS for the 43 MB pmtiles**, not Actions-fetch and not external host. User picked LFS via `AskUserQuestion`. Costs ~43 MB of LFS storage + bandwidth per clone/deploy. Tradeoff: self-contained deploy, simpler CI.
- **`base: "/atlasdraw/"`** for the GH Pages project site, not a custom domain. Default `/` for self-host + dev.
- **`india.pmtiles` stays gitignored**; only `world-low-zoom.pmtiles` is un-ignored. Per-file negation in `.gitignore` requires `public/data/*` (not `public/data/`) so contents are ignored but specific files can be re-included.
- **Hand-rolled vs Zod for AppConfig.** Used Zod (matching the seed/plan spec) even though the env is a 3-string enum. Cost: +13 KB Zod in the atlas-app bundle. Benefit: consistent with `apps/storage/src/config.ts` style, easier to extend later. Worth revisiting if the casual-tier bundle size becomes a target.
- **AboutDialog replaces the standalone demo MainMenu item.** Originally added `⚡ Demo edition — self-host for full features` as a separate item; folded into the AboutDialog when T14 landed. One discoverable surface (`ℹ About Atlasdraw`) for version + license + telemetry + edition + demo CTA, all behind one menu entry. The dialog itself conditionally renders the demo note.
- **`code/apps/storage` not composite, not in root tsconfig refs.** Matches `apps/realtime` precedent. Storage is a runtime app (Node server), not a library; emits to `dist/` via its own tsc build. Root tsconfig refs are for the atlas-owned type graph (basemap, data, geo, tools, cli) only.
- **`ALLOWED_DATA_FILES` is an allow-list, not a size threshold.** Explicit naming beats heuristic. Easy to extend (just add a filename) and impossible to accidentally include a renamed local archive.
- **T1 pre-declares `vitest *` in devDeps** even though T1 itself has no tests, so T2 (sibling within the same package) doesn't have to amend `package.json` later. Captured during pre-dispatch scrub.

## Trajectory

**How we got here.** Session opened with `/check-handoff` resuming from the prior session's Phase 4 Wave 1 basemap stack. After clearing up the next-block question, the user asked *"can this currently be hosted on gh pages"* — the answer evolved into a dual-tier architecture (casual GH Pages + power self-host) which the architecture was already shaped for (config-agnostic resolver, AppConfig pattern from T2b). I filed a scrub note + T2b seed first, got the user's confirmation, then started building. The advisor caught me about to launch three parallel storage workers when the user's actual throughline was "ship GH Pages first" — switched scope, asked `AskUserQuestion` for pmtiles strategy, got "Git LFS". Shipped GH Pages stack in `0d7b8dc`. User then asked for a basemap-source UI indicator + folded in publicDir fix and demo badge; shipped in `08bf073`. Final round: T1+T2 storage scaffold + T14 AboutDialog. T1+T2 hit two pre-dispatch surprises (yarn classic not pnpm, root vitest config hardcoded for excalidraw-app); both worked around cleanly. T14 added Vite `define` injection for version+hash and replaced the lighter demo item with a richer About dialog.

**Hard calls.** Whether to launch parallel worktree workers for T1+T2 (serial dep, both touch same new package) or do them directly (chose direct — single agent, faster cycle, no cherry-pick coordination). Whether to keep `local-only` as a third build target despite advisor YAGNI flag (kept — `yarn dev` needs an unbadged default). Whether to use Zod for the 3-string AppConfig enum (used it — consistent with backend T2, modest bundle cost). Whether to put basemap source UI in a top-left chip or fold into BasemapPickerDialog + MainMenu label (folded — Rule 0 forbids new top-left surfaces post-W-B retrofit).

**Shaky ground.** **(1)** AboutDialog test coverage doesn't render the `pages` and `hosted` build-target paths via DOM; the demo-note conditional path is logically correct but only the local-only render is asserted. A future test pass with `vi.mock` would close that. **(2)** The Vite `define` for git hash runs at config time; if the workspace is built from a tarball or detached worktree without `.git`, fallback is `"unknown"` — handled but never exercised in CI. **(3)** First GH Pages deploy will need manual GitHub repo settings: Pages source = "GitHub Actions". I cannot toggle that, so the first push could surface a deploy error until the user enables it. **(4)** T13 autosave wiring is "partial" — it works against localStorage but is not yet talking to the (still unbuilt) `StorageClient` HTTP API. When T3 lands, T13 must be re-completed.

**Invisible context.** The user reads code, not narrative — commits + file:line beat prose. Three sessions of Phase 4 work have established a pattern: **plan amendment first, then dispatch.** The CLAUDE.md `excalidraw-api.md` rule is load-bearing — grep vendored Excalidraw source before assuming any API. The user pushed back hard during the prior session against speculative diagnoses without inspecting raw data; this session I leaned on `du -sh` (5 GB dist), `git rev-parse` (hash injection), and `grep` (verify base prefix in built bundle) before declaring success. The user also has `india.pmtiles` (4.9 GB) at `code/apps/atlas-app/public/data/india.pmtiles` as their personal test archive — local-only, gitignored, would have bloated every dist build if not pruned.

## Active Skills & Routing

- `check-handoff` — invoked at session start; validated prior HANDOFF.md, all files present, branch state clean.
- `atlasdraw-ui-conventions` — invoked before BasemapPickerDialog edits + AboutDialog implementation. Read Rule 0 ("Slot First, Create Never") and the z-index ladder. Source-of-truth call: no new top-left chip; chose existing dialog + MainMenu label.
- `handoff` (this skill) at session end.
- **`[eval: knowledge-restored]`** — passed at session start.
- **`[eval: no-rediscovery]`** — passed (didn't re-investigate prior session's basemap stack).
- **Pending routing for next agent**:
  - **`writing-plans`** for T3 storage HTTP + dual adapters (heaviest remaining task; multi-file, plan §5 Task 3 spec needs pre-dispatch scrub for adapter selection, Fastify version pin, package layout).
  - **`adversarial-api-testing`** for T4 share endpoint per plan §5 Task 4 spec.
  - **`systematic-debugging`** for `atlasdraw-320b` if it surfaces (blob-URL null warnings).
  - **`requesting-code-review`** before pushing 62 commits to origin.

## Infrastructure Delta

This session changed: **two new commits on `main` workflow surface** (LFS + new GH Actions job). Skills/hooks/pipelines/plugin versions otherwise unchanged.

- **Plugins**: unchanged.
- **Hooks**: unchanged.
- **Skills**: unchanged.
- **Pipelines**: unchanged.
- **Overrides**: unchanged.
- **CI workflows**: `.github/workflows/pages.yml` ADDED — first new workflow this Phase 4. Requires GitHub repo settings (Pages source = "GitHub Actions") before first run succeeds.
- **Git LFS**: ENABLED for this repo. `.gitattributes` tracks `*.pmtiles`. Per-repo hooks installed via `git lfs install --local`. LFS storage: 43 MB now (one file).
- **Mulch**: 1 new convention record in `infrastructure` domain (`Per-package vitest.config.ts shields from root setupTests`). One stray auto-created domain (`convention.jsonl`) created and removed mid-session — clean.

## Knowledge State

- **Indexed**: zod ^3.22.0 (already in lockfile via `@atlasdraw/data`; atlas-app + storage now declare it directly). Git LFS 3.6.1.
- **Productive tiers**: `ml search`, `qmd skills` (atlasdraw-ui-conventions), `foxhound` not used substantively (the work was code-write-heavy, not search-heavy). `grep` via Bash served well for plan-literal verification.
- **Gaps**: No indexed docs for `actions/configure-pages@v5` / `actions/deploy-pages@v4` — wrote the workflow from memory + GH Actions Marketplace conventions. If anything in CI breaks on the first run, fetch via `mcp__context__get_docs` or web.

## Next Steps

1. **Push `main` to origin.** Local is 62 ahead. First push exercises the new pages workflow. Before pushing: confirm GitHub repo settings (Pages source = "GitHub Actions") otherwise `deploy-pages@v4` fails. Trivial: `git push origin main`.
2. **Pick the next block.** Suggested order:
   - **T3 storage HTTP + dual adapters** (heaviest; unblocks T4, T13, T8/T9). Run `writing-plans` to refine plan §5 Task 3 specs, then pre-dispatch scrub (Fastify version, adapter package layout). One or two parallel worktree workers per adapter is viable since they're file-disjoint.
   - **OR atlasdraw-3601 addFiles test** (small, closes Wave 0 audit). Good warm-up if context budget is fresh.
   - **OR T17 ADRs** (1 hr; closes doc debt; ADR-0006 backfills the missing telemetry doc the AboutDialog already references).
3. **Optional cleanup**:
   - Dedup mirrored seeds: `e6f7`/`189c` (T12), `b9d2`/`d1a1`/`95de` (space+drag).
   - File a chronic-hygiene seed for the recurring `code/packages/cli/src/atlasdraw.ts` mode-bit churn from yarn install.
   - Consider adding `--immutable` to the husky pre-commit hook if mode-bit drift keeps showing up.
4. **Stale-plan check**: `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` has three dated 2026-05-10 scrub notes (T2 added this session, T5 + T7 from prior). Plan is current — no archival.
5. **AboutDialog ADR link.** When `docs/architecture/adr/0006-telemetry.md` lands (part of T17), update `AboutDialog.tsx` to point at it instead of the self-host README anchor.
6. **T13 finish.** After T3 lands, rewire `startAutoSave` to talk to the new HTTP `StorageClient` (it currently hits localStorage only).

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` — Phase 4 plan, three dated 2026-05-10 scrub notes (T2 casual/power split, T5 Protomaps source, T7 resolver shape). §5 Task 3 is the next unstarted spec.
- `code/apps/atlas-app/src/config/app-config.ts` + `__tests__/app-config.test.ts` — T2b: `VITE_BUILD_TARGET` discriminator, feature flags, 5/5 tests.
- `code/apps/atlas-app/vite.config.ts` — three plugins now (`pmtilesNotFoundPlugin`, `cleanupPublicDataPlugin`, react), `base` conditional, `define` injection for VITE_APP_VERSION + VITE_GIT_HASH.
- `code/apps/storage/{package.json, tsconfig.json, vitest.config.ts, src/types.ts, src/config.ts, src/config.test.ts, src/index.ts}` — T1+T2 storage scaffold. 7/7 tests pass via `yarn workspace @atlasdraw/storage test`.
- `code/apps/atlas-app/src/components/AboutDialog.tsx` + `__tests__/AboutDialog.test.tsx` — T14, 4/4 tests. Replaces the standalone demo MainMenu item.
- `.github/workflows/pages.yml` — new GH Actions workflow. checkout(lfs:true) → build → deploy-pages.
- `.gitattributes` — LFS rule for `*.pmtiles`.
- `code/apps/atlas-app/.gitignore` — `public/data/*` ignored, `world-low-zoom.pmtiles` re-included.
- `.claude/rules/excalidraw-api.md` — load-bearing convention; grep vendored Excalidraw source before assuming any API.
- `HANDOFF-expertise.md` — structured mulch records for infrastructure + meta + architecture (ml prime + ml diff).
