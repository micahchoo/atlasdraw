# Handoff

## Goal

Continue Phase 2 Wave 4 closeout from the 2026-05-04 plan scrub:

> "read the phase 2 scrub and continue"
> "triage the decision-blocked items first" → "do as recommended"
> "continue"

Sequential close-out of decision-blocked Wave 4 tasks (T19–T28) from
`docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md`,
plus a sidebar-conventions retrofit precipitated by the just-landed
vendored `registerSidebarTab` API.

## Progress

10 commits across two sessions (newest first):

- ✅ `7956bdd` — chore(state): mulch + seeds auto-update churn
- ✅ `e525bc9` — T20 Phase 2 acceptance gate (`atlasdraw-1315` closed); bench scenario + ci-gate + CI workflow
- ✅ `07a8419` — T28 anti-pattern detector scope intent (`atlasdraw-d592` partial)
- ✅ `771a1ac` — T27 husky postinstall fix + atlas-app vitest devDep (`atlasdraw-0c97`, `atlasdraw-b733`)
- ✅ `b4b13f5` — T19 minimal Phase 2 bench harness + baseline (`atlasdraw-f1fa`); workspace at `code/bench/`
- ✅ `ed40fdb` — T25 TextLabelTool placeholder text (`atlasdraw-5193`, `atlasdraw-cc43`)
- ✅ `4ffea8c` — T21 defer dropped sources + T24 reject mixed-geometry FCs (`atlasdraw-cdd3`, `atlasdraw-4142`); forward seed `atlasdraw-2428` filed
- ✅ `b13101e` — T26.2 atlas-app LayerStyle import (`atlasdraw-fc04`)
- ✅ `a89e044` — T26.1 `MAX_ZREF` + zRef bounds at parser gate (`atlasdraw-02f6`)
- ✅ `b8bb015` — vendored `registerSidebarTab` + LayerPanel CSS module retrofit + UI conventions skill update (T31 / `atlasdraw-90a5`)

**Wave 4 ladder (15 tasks): ALL SHIPPED or PARTIAL — Phase 2 COMPLETE.**
12 SHIPPED (T17 T18 T19 T20 T21 T22 T23 T24 T25 T26 T29 T30 T31), 2 PARTIAL (T27, T28).

11 seeds closed; 1 forward seed (`atlasdraw-2428`) filed. State committed in `7956bdd`.

## What Worked

- **Maintainer-decision triage table BEFORE acting.** Surfaced T19/T21/T24/T25 options with my recommendation per item; user approved en bloc. Cut iteration count to 1 instead of 4 round-trips.
- **Sequential phases with verification between each commit.** Atlas-app tests + monorepo tsc were re-run after every edit batch — caught the `replace_all: true` indent miss on `parseGeoCustomData.ts:99` immediately instead of as a downstream regression.
- **Subagent for the bench-harness infrastructure spike.** Workspace registration + vitest config + yarn-install permutations were isolation-prone; delegating kept main-context clean.
- **Foreground advisor call at the start of T26.** Caught the seed's "fractional zRef rejected" claim as wrong (MapLibre uses continuous zoom), and pointed out that `geoToScene/sceneToGeo` are not real method names on `CoordinateSync` — saved chasing fictional surfaces.

## What Didn't Work

- **Dropping `paths: {}` from `apps/atlas-app/tsconfig.json` (T27.3).** Exposed 534 tsc errors — not just path resolution but also rootDir violations and missing `@excalidraw/excalidraw` re-exports. Reverted. `atlasdraw-dc84` + `atlasdraw-8a21` need a composite-project / per-package baseline refactor, not a one-line `paths` removal.
- **Configuring the global anti-pattern detector (T28 / `atlasdraw-d592`).** Detector is `~/.claude/scripts/anti-pattern-scan.sh` and uses hardcoded `EXCLUDES` from `~/.claude/scripts/lib/cache-utils.sh`; no project-local scope-file support yet. Filing the project-level intent doc at `.claude/anti-pattern-scope.txt` is documentation only until global tooling reads it. Did NOT modify global `~/.claude/` infrastructure.

## Key Decisions

Maintainer-approved 2026-05-05 (preserved in `4ffea8c`, `ed40fdb`, `b4b13f5`, `07a8419` commit messages):

- **T19 — bench harness:** ship minimal (synthetic FCs, 3-warmup + 20-iteration timing) over perf-investigation 10-phase rigor.
- **T21 — Phase 1 dropped sources:** Option B — defer to Phase 4 self-host; fix `basemap/package.json` description in v1.
- **T24 — mixed-geometry FCs:** Option B — reject at the gate, don't sub-layer per kind in v1. Sub-layers remains Phase 4+ direction.
- **T25 — TextLabelTool inline edit:** Option (b) — emit `text="Label"` placeholder, let Excalidraw native double-click handle editing. No imperative-API archaeology.
- **T26 zRef bounds:** validate at `parseGeoCustomData` only (the untrusted gate); `CoordinateSync` stays invariant-trusting. `MAX_ZREF=24` + finite + `>=0`; fractional accepted.
- **T28.2 — `compileLayer` API:** stays caller-supplied. T24's reject decision means sub-layers don't land in v1, so the API doesn't need to shift to `compileLayersForFC`.

## Trajectory

**How we got here:** Started with a sidebar-conventions audit driven by the just-landed vendored `registerSidebarTab` (background agent before this session). LayerPanel had been written pre-conventions; the audit found inline-style violations + emoji-in-buttons + missing data-testids. Retrofit + skill-doc update committed in `b8bb015`. User then asked for phase-2 status, then "continue" — kicking off a Wave 4 closeout sweep. Triage table presented decision-blocked items (T19/T21/T24/T25) with recommendations; en-bloc approval. Executed in dependency order: T26 first (parser gate touch was self-contained), then T21+T24 (data package extension), then T25 (one-liner), then T19 (bench harness via subagent), then T27 (husky + vitest), then T28 (detector scope intent only). Stopped at T20 (Phase 2 acceptance gate) because it's a separate scope (50k+5k scenario + ci-gate + workflow step) and at T27 typecheck-debt because `paths:{}` removal exposed a 534-error rabbit hole.

**Hard calls:**
- Putting `requireHomogeneousGeometry` in `@atlasdraw/data` *separately* from `parse()` instead of inside it. Tradeoff: parse() stays RFC-pure (no Atlas rendering coupling) at the cost of callers needing to remember two calls. Mitigated by colocating in the same source file with a comment explaining the split.
- Closing `atlasdraw-d592` as `outcome:partial` rather than blocking on a global tooling change. The intent doc is high-signal-low-cost; the global change is a separate session.
- Wrapping `prepare-husky.js` to silently exit 0 in non-git contexts vs failing loudly. Chose tolerant — rationale: the prior `husky install` was failing AND aborting yarn install for everyone; a quiet skip beats a noisy crash on tarball/sandbox installs.

**Shaky ground:**
- Bench baseline is 20 iterations on synthetic data. Real-world `large-us-roads.geojson` would have 100k+ features and fractional Polygon rings — current synthetic uses simple `[lng, lat]` Points. Baseline is a *starting point*, not a representative production target.
- The 5 atlas-side anti-pattern findings are NOT triaged. Three are almost-certainly false positives (rollback handlers, JSON.parse-then-throw) but I didn't run each through systematic-debugging.
- `atlasdraw-1315` (T20) seed still shows "Blocked by: atlasdraw-f1fa" even though `f1fa` is closed. seeds CLI doesn't auto-resolve blocker links on closure. A `sd update --remove-blocker` call may be needed.

**Invisible context:**
- Husky 7.0.4's `install` literally checks `fs.existsSync(cwd + '/.git')` — does NOT fall back to `git rev-parse --git-common-dir`. v9 fixes this but the upgrade was out of scope.
- `vitest run` from atlas-app currently hits the hoisted vitest@3.0.6 via workspace lift. Now that it's an explicit devDep, hoisting changes won't silently break atlas-app tests.
- The bench harness uses vitest's TS loader; no external `tsx` dep needed because vitest already handles `.ts` imports for the workspace.
- `code/.claude/` is gitignored. Project-local agent config that NEEDS to be tracked goes in repo-root `.claude/` (where `.claude/rules/`, `.claude/skills/atlasdraw-ui-conventions/`, and now `.claude/anti-pattern-scope.txt` live).

## Active Skills & Routing

- **atlasdraw-ui-conventions** (project-local skill) — invoked at start; drove the LayerPanel retrofit + identified the stale `renderSidebar` → `registerSidebarTab` reference in the skill itself. Skill body updated in commit `b8bb015`.
- **handoff** (this skill) — invoking now at user request.

No `[eval: ...]` checkpoints fired explicitly; the verification gate ("vitest + tsc must pass before commit") was applied as a personal discipline after each phase.

## Infrastructure Delta

- **Plugins/Hooks/Pipelines:** unchanged.
- **Skills:** `atlasdraw-ui-conventions/SKILL.md` — File Placement table swapped stale `renderSidebar` for `registerSidebarTab`; color table extended with row-separator, secondary-metadata, and the data/annotation kind-badge tokens.
- **Project files (non-`.claude/`):** `code/bench/` workspace created; `code/scripts/prepare-husky.js` added; `.claude/anti-pattern-scope.txt` added at project root (NOT under `code/.claude/` which is gitignored).
- **Vendored fork delta (`code/packages/excalidraw/`):** `App.tsx` + `DefaultSidebar.tsx` + `types.ts` extended with `registerSidebarTab` API. This is now the second vendored extension (alongside `registerContextMenuItem` from earlier). Maintenance reminder: any upstream Excalidraw v0.18+ rebase will need to re-apply these patches.

## Knowledge State

- **Indexed (foxhound/context-mode):** no new packages added via `context add` this session. Workspace mulch/seeds tiers were sufficient.
- **Productive tiers:** mulch (project conventions), seeds (issue + close history), git log (commit-message provenance), the existing plan addendum (per-task status block was already maintained).
- **Gaps:** none encountered that needed external indexing.

## Next Steps

1. ✅ **T20 — Phase 2 acceptance gate.** `atlasdraw-1315` closed `outcome:success`. Shipped in `e525bc9`.

2. **T27.3 — atlas-app typecheck debt** (`atlasdraw-dc84` + `atlasdraw-8a21`). The `paths: {}` clobber is real but a one-line fix exposes 534 errors. Options: (a) full per-package baseline file (allow current errors, block new ones), (b) composite-project tsconfig refactor, (c) leave `paths:{}` and accept that `yarn workspace @atlasdraw/atlas-app test:typecheck` fails — atlas-app relies on vite/vitest aliases for real type-checking. Recommend (a).

3. **T28 — global anti-pattern detector tooling.** Implement reading of `$PROJECT_DIR/.claude/anti-pattern-scope.txt` in `~/.claude/scripts/anti-pattern-scan.sh`. Tiny patch (~15 lines: parse `+`/`-` lines into ERE alternations, intersect with the file list). Cross-project benefit. Do this OUTSIDE atlasdraw — it's global infra. Then re-run scan; the 5 atlas-only findings can be triaged individually (likely 4/5 false positives).

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` — Wave 4 addendum + per-task status block (top of addendum, lines ~1357-1450). Read THIS first; it's the canonical source for task ↔ commit ↔ seed mapping.
- `.claude/anti-pattern-scope.txt` — project-local scope intent declared this session; not yet honored by the global detector.
- `code/bench/scenarios/phase-1.test.ts` — the bench harness; future scenarios extend the same pattern.
- `code/packages/data/src/geojson.ts` — `parse()` is RFC-pure; `requireHomogeneousGeometry()` is the Atlas-rendering layer. Don't merge.
- `code/packages/geo/src/types.ts` — `MAX_ZREF` + `isValidZRef` live here; the parser imports them. If a future scenario needs different bounds, edit here.
- `code/.husky/pre-commit` — currently a comment-only no-op. If you enable `yarn lint-staged`, the husky install path is now reliable thanks to `code/scripts/prepare-husky.js`.
