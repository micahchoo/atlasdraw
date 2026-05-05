# Handoff

## Goal
> Continue prior session: ship Wave 4 (Phase 1+2 hardening sprint) per the addendum at `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` lines 1354–1603. User said "do it" referring to the proposed session plan, then "do as you recommend" to continue, then "prepare for 4b and 4c", then audit-flagged the Pin + Convert buttons against the new UI conventions skill. Result: **Wave 4a-tools sub-wave shipped (T17 + T18), full Wave 4 scrub + 4b/4c pre-spike pack written, atlasdraw-4ad2 filed for Rule-0 retrofit.**

## Progress

### 6 commits this session

| SHA | Subject |
|---|---|
| `c984f01` | chore(geo): align CoordinateSync captureUpdate literal with v0.18 enum |
| `801c518` | docs(phase-2): Wave 4 pre-dispatch scrub — DISPATCHABLE |
| `8579bc6` | feat(phase-2): Wave 4a-T17 — scaleMode helpers + CoordinateSync wire |
| `7054ef0` | feat(phase-2): Wave 4a-T18 — useGeoAnchor extension to all native tools |
| `609896f` | chore(state): Wave 4a-tools complete + 4b/4c pre-spike + UI conventions skill |
| `c194726` | docs(phase-2): Wave 4c — UI conventions retrofit (3 Rule-0 violations) |

### Verification at session close

- ✅ `yarn workspace @atlasdraw/geo test` → **72/72 PASS** (was 50/50 + 22 new in T17).
- ✅ `yarn workspace @atlasdraw/atlas-app test` → **51/51 PASS** (was 41/41 + 10 new in T18).
- ✅ `yarn build` → PASS 14.10s (full monorepo).
- ✅ Tree mostly clean. Unrelated changes pending (see "Shaky ground").

### Wave 4a-tools deliverables

- **T17** (commit `8579bc6`): created `code/packages/geo/src/scaleMode.ts` (computeScaleFactor + clampHybridFactor) + colocated `scaleMode.test.ts` (519 lines, 22 tests). Wired both into `CoordinateSync._projectElement`. Closes seed `atlasdraw-375a` (jointly with T18). Caught + fixed 2 pre-existing test issues now load-bearing because scaleMode is wired (CoordinateSync.test.ts Test C lowercase enum + polyline fixture).
- **T18** (commit `7054ef0`): extended `useGeoAnchor.ts` (91 → 165 lines) from bbox-only to all 8 native Excalidraw tools per the matrix. Refactored into `BBOX/POLYLINE/POINT_TOOL_TYPES` sets + `buildGeoCustomData` helper + `buildGeoAnchorHandler` factory (testable without React renderer, mirrors `buildToolContext` pattern). Created colocated `useGeoAnchor.test.ts` (274 lines, 10 tests).

### Wave 4 scrub + pre-spike artifacts

- **`docs/decisions/wave4-pre-dispatch-scrub-2026-05-04.md`** (commit `801c518`) — full scrub: STATUS DISPATCHABLE; 5 mechanical drifts + 1 semantic + 1 missing-ref; OQ-W4-2 (Playwright) and OQ-W4-1 (arrow binding) resolved.
- **`docs/decisions/wave4-bc-pre-spike-2026-05-04.md`** (commits `609896f` then extended in `c194726`) — full pre-spike pack for T22-T28 + new T29/T30/T31 (Rule-0 retrofit). Every file shape, line range, API verification, and resolved OQ workers need.
- **`.claude/skills/atlasdraw-ui-conventions/SKILL.md`** (~14KB; auto-bootstrapped mid-session by an external mechanism, captured in `609896f`) — atlas-app UI design conventions (Rule 0 "Slot First, Create Never" + surface decision tree + color tokens + z-index ladder + button patterns + accessibility).

### Audit-driven discovery: 3 Rule-0 violations

The atlasdraw-ui-conventions audit caught pre-conventions slot-misuse:

1. **Pin button** (MapEditor.tsx:358-371) is a free-floating overlay → should slot via `<Excalidraw renderTopLeftUI={() => <PinButton/>}>`. Caveat per `mx-682f8a`: button placement vs event dispatch are separate seams; useAtlasdrawTool overlay still owns pointer dispatch.
2. **Convert action** (MapEditor.tsx:380-410) is a custom `<div role="menu">` + onContextMenu handler → should slot via `excalidrawAPI.registerAction(action)` (verified `code/packages/excalidraw/types.ts:955`). Eliminates ~30 lines + the onContextMenu root handler (smaller drop-hijack-style bug surface).
3. **LayerPanel.tsx** predates conventions: NO CSS module, 15+ inline styles for static layout, 6 invented color tokens, 4/6 buttons missing data-testid.

**Filed as `atlasdraw-4ad2` (P1, high severity, wave:4)** with breakdown into T29 (Pin slot), T30 (Convert slot), T31 (LayerPanel CSS). T29+T30 serialize on MapEditor.tsx per Wave 2 OQ-W2-4 lesson.

## What Worked

- **Pre-dispatch scrub paid off again** — Wave 4 scrub caught 5 mechanical drifts before any worker dispatched. The recursive lesson (`mx-04ac8d` — drift is recursive) was honored: even though the plan was written by the prior session's same agent, scrub still found path-literal drift.
- **Pre-spike artifacts cut worker brief failure rate** (`mx-7ef9cf` validated again) — both T17 and T18 shipped clean on first dispatch with substantive PRE-SPIKE blocks (full file content + rule tables) inlined in the brief. Workers caught and reported drift accurately.
- **Advisor call before dispatch** — caught 3 actionables I would have missed (verify `GeoCustomData.scaleMode` field exists, pre-spike Playwright availability, commit unrelated dirty file before T17 dispatch). All resolved before commit.
- **Atomic commits per task** — T17 and T18 each got their own atomic commit with passing tests + build confirmed; auxiliary state (skill bootstrap, plan modifications, pre-spike doc) bundled into a separate `chore(state)` commit. Clean rollback boundary.
- **Explicit slot APIs verified before claiming a refactor target** — for the Rule-0 audit findings, I grep-verified `renderTopLeftUI`, `registerAction`, `ContextMenuItems`, `Sidebar`/`Footer`/`MainMenu` exports BEFORE filing `atlasdraw-4ad2` so the seed cites real APIs not hypothetical ones.
- **Worker T18's factory-pattern refactor** — instead of using `@testing-library/react` (not in package.json), the worker exported `buildGeoAnchorHandler` from the hook module and tested the factory directly. Mirrors existing `buildToolContext` pattern. Generalizable atlas-app convention.

## What Didn't Work / [SNAG]

- **`yarn workspace ... test` from project root fails** — must `cd code/` first. The "workspace root" is `code/`, not the git root. One wrong invocation early in the session; corrected.
- **`grep -v test` filter is wrong for excluding test FILES** — caught silently filtering out lines containing `data-testid` because the substring "test" appears. Re-ran with `--include="*.tsx" | grep -vE "/test|\.test\."` to get accurate counts.
- **`ml diff` syntax** — `ml diff HEAD~6` errors with "too many arguments." Correct invocation TBD; check `ml diff --help` next session if generating expertise sidecar.
- **`sd create --priority high`** rejected — must use `P0`-`P4`. CLI inconsistency vs how seeds are displayed (`[High · task]` in `sd list`).
- **Plan modifications by external mechanism** — Phase 3/4/6/7 plan files (`docs/superpowers/plans/2026-05-03-atlasdraw-phase-{3,4,6,7}-*.md`) appeared in working tree without my touching them; same mechanism that bootstrapped `.claude/skills/atlasdraw-ui-conventions/` and added Skill references to the Wave 4 plan addendum. Likely a SessionStart hook or sub-process. Captured in dirty state, not committed by me.

## Key Decisions

- **OQ-W4-1** (T18 arrow binding): anchor by `points[]` regardless of binding state; bindings overlay. (No special-casing for bound vs unbound arrows.)
- **OQ-W4-2** (T19/T20 Playwright vs vitest+synthetic): Playwright. `@playwright/test@^1.48.0` already in lockfile; no `yarn add` mutex risk for parallel 4a-bench dispatch.
- **OQ-W4-4** (T22 Sidebar mount): render `<LayerPanel/>` as direct `<Excalidraw>` child; toggle via `excalidrawAPI.toggleSidebar({name:"layers"})`.
- **OQ-W4-5** (T24 mixed-geometry): sub-layers (per plan recommendation; expose new `compileLayersForFC(id, style, fc): LayerSpecification[]` from style-compiler).
- **OQ-W4-6** (T28 RTL+vitest cleanup): flip vitest `globals: true` (cheaper, scoped) over per-file `afterEach(cleanup)`.
- **CoordinateSync uppercase enum is correct** — `CaptureUpdateAction` from `code/packages/element/src/store.ts:38-69` is `as const` with literal UPPERCASE strings ("NEVER"/"IMMEDIATELY"/"EVENTUALLY"). The dirty-tree edit I inherited at session start was right; staged + committed as `c984f01`.
- **Wave 4c absorbs Rule-0 retrofit** — atlasdraw-4ad2 filed as 3 sub-tasks (T29/T30/T31) folded into Wave 4c rather than blocking the rest of Wave 4. T29+T30 both modify MapEditor.tsx so they serialize.
- **Auxiliary state separate from feat commits** — committed `chore(state):` and `docs(phase-2):` separately from the `feat(phase-2):` task commits. Clear blame attribution.

## Trajectory

**How we got here:** Session resumed from prior handoff with Wave 4 plan addendum committed (`35d3765`) but un-scrubbed. Followed the proposed session plan: (1) resolved CoordinateSync.ts dirty diff (verified uppercase enum is the correct alignment, committed as chore); (2) dispatched record-extractor for the prior session's d121188+35d3765 commits (mostly confirmed prior coverage; added mx-04ac8d for recursive drift); (3) wrote Wave 4 scrub doc — STATUS DISPATCHABLE; (4) dispatched T17 worker (foreground), verified 72/72 + build, committed; (5) dispatched T18 worker (background), continued with 4b/4c pre-spike work in parallel; T18 returned clean (51/51 + build), committed; (6) user asked to "prepare for 4b and 4c" — wrote comprehensive pre-spike pack covering T22-T28; (7) noticed `atlasdraw-ui-conventions` skill auto-bootstrapped mid-session, ran retroactive audit; (8) found 3 Rule-0 violations (Pin, Convert, LayerPanel); user confirmed visual issues with Pin + Convert; (9) verified Excalidraw v0.18 slot APIs (renderTopLeftUI, registerAction); filed atlasdraw-4ad2; updated pre-spike doc with T29/T30/T31 entries.

**Hard calls:**
- **Committing CoordinateSync.ts as a chore vs leaving for T17 to absorb** — advisor recommended commit-now to keep T17's worker diff clean. Did so. Worth the small commit overhead.
- **Dispatching T18 in background instead of foreground** — let me write the 4b/4c pre-spike pack in parallel; saved roughly 5–10 min wall time. T18 returned cleanly so the parallelism paid off.
- **Filing one comprehensive seed (atlasdraw-4ad2) vs three separate seeds for the audit findings** — chose one because the migrations share Wave 4c sequencing context (T29+T30 serialize on MapEditor.tsx). Splitting into 3 would have lost that constraint.
- **Bundling .claude/skills/atlasdraw-ui-conventions/ into the chore(state) commit despite not authoring it** — chose to commit because it was substantive, well-structured, and immediately load-bearing for the audit and for future Wave 4b briefs. The alternative (leave untracked) would have lost the audit's reference target.

**Shaky ground:**
- **Phase 3/4/6/7 plan files dirty in working tree** — modified by the same external mechanism that auto-bootstrapped the UI conventions skill. Not committed by me; next session should `git diff` them and decide whether they're meant to ship or be reverted.
- **`.mulch/telemetry/` directory appeared mid-session** — untracked. Source unclear (possibly the prior record-extractor or a background hook). Probably ignorable but worth noting.
- **scaleMode wiring is verified by unit tests, not by browser smoke** — T17 + T18 ship feature surface that's only exercised when a user actually pans/zooms. Vitest mocks `MapLibreMap`. The 9-cell matrix (3 kinds × 3 modes) is well-covered by unit tests; cross-system behavior is not.
- **`atlasdraw-ui-conventions` skill SKILL.md was auto-bootstrapped** — I did not author or audit its content beyond skim. The conventions match what I'd write, but I should not assume every cell of every table is correct.

**Invisible context:**
- **The Excalidraw element type union doesn't expose `points` cleanly across all variants** — T18 worker used `as unknown as ElementGeoFields` cast at the helper boundary. Runtime shape is consistent for line/arrow/freedraw per `code/packages/element/src/types.ts:336,390`. Single-cast strategy avoids per-variant narrowing.
- **`renderTopLeftUI` is render-prop, not children-pattern** — verified at `code/packages/excalidraw/index.tsx:73,183`. T29 brief should be specific about this; passing `<Pin/>` as children won't work.
- **`excalidrawAPI.registerAction` exists at `types.ts:955`** but the full Action shape (contextMenuOrder, predicate, perform, contextMenuLabel) needs grep verification before T30 brief authoring. Also: actions can be deregistered? T30 needs unmount cleanup.
- **`SidebarName = string`** (`types.ts:173`) — so `name: "layers"` is type-valid for `toggleSidebar({name:"layers"})`. T22 worker doesn't need to invent a SidebarName enum.
- **vitest workspace is at `code/`, not git root** — `yarn workspace ... test` from `/mnt/Ghar/2TA/DevStuff/atlasdraw` fails. Always `cd code/` first.

## Active Skills & Routing

- `check-handoff` (session entry; resumed prior Wave 4 state).
- `atlasdraw-ui-conventions` (invoked for the Rule-0 audit; auto-bootstrapped mid-session by external mechanism).
- `dispatching-parallel-agents` (T18 in background while writing pre-spike).
- `executing-plans` (implicit — Wave 4a-tools T17→T18).
- `verification-before-completion` (yarn build + workspace tests before each commit).
- `record-extractor` (twice — once for prior session's d121188+35d3765 retro; once at this session's close, currently in background).
- `handoff` (current; this skill).

**Skills NOT invoked this session that should be next:**
- `executing-plans` for Wave 4a-bench (T19+T20) and Wave 4b (T22-T25).
- `perf-investigation` for T19 (bench harness).
- `/triage` — no pending triage queue (all 7 anti-pattern items remain `deferred-on:atlasdraw-d592` from prior session; not new).
- `/dream detect-gaps` (1449 uncategorized failures, growing slowly).
- `/dream integrate` (cross-project memories).

## Pending routing for next session

1. **Decide Wave 4 dispatch order.** Recommended next: Wave 4b-uxserialized (T22 → T23) since they directly enable manual browser smoke for Wave 2/3 deliverables. Wave 4a-bench (T19 → T20) is structurally bigger (creates `code/bench/` and `.github/workflows/` from scratch) and gates only Phase 2 acceptance (atlasdraw-3a5b). Wave 4c-T29 (Pin slot) + T30 (Convert slot) are higher quality-leverage than 4c-T31 (LayerPanel CSS).
2. **Manual browser smoke before any UX-shipping wave** — drop GeoJSON, see features, existing annotations geo-pin, right-click polygon → Convert (currently working but slot-mismatched), open layers sidebar, export PNG. The `d121188` lesson: vitest mocks miss real-browser bugs.
3. **Decide on the dirty Phase 3/4/6/7 plan files** — `git diff` them and either commit, revert, or surface to user. Same external mechanism that auto-added skill references to Wave 4 plan touched these.
4. **Fix `sd create --priority` documentation** — CLI accepts `P0`-`P4` but `sd list` displays `High`/`Medium`. Consider opening upstream issue if not already known.
5. **Optional housekeeping**: `/dream detect-gaps`, push to remote (currently local-only per `mx-8afd1a`), `ml diff` syntax verification.

## Infrastructure Delta

- **NEW** (committed):
  - `.claude/skills/atlasdraw-ui-conventions/SKILL.md` (auto-bootstrapped; ~14KB; canonical UI conventions reference).
  - `docs/decisions/wave4-pre-dispatch-scrub-2026-05-04.md` (122 lines).
  - `docs/decisions/wave4-bc-pre-spike-2026-05-04.md` (extended with T29/T30/T31).
  - `code/packages/geo/src/scaleMode.ts` + `scaleMode.test.ts` (575 lines total).
  - `code/apps/atlas-app/src/hooks/useGeoAnchor.test.ts` (274 lines).
- **MODIFIED** (committed):
  - `code/packages/geo/src/CoordinateSync.ts` (uppercase enum + scaleMode wire).
  - `code/packages/geo/src/CoordinateSync.test.ts` (Test C casing fix + polyline fixture).
  - `code/apps/atlas-app/src/hooks/useGeoAnchor.ts` (91 → 165 lines).
  - `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` (Skill references added to T12, T15, T22 by external mechanism).
- **NEW seeds**: atlasdraw-4ad2 (UI conventions retrofit, P1).
- **CLOSED seeds**: none. (atlasdraw-375a stays open until both T17 + T18 retrospect close it; recommend close on next session entry.)
- **NEW mulch records**: pending — record-extractor running in background at handoff time. New records will appear in `.mulch/expertise/meta.jsonl` after dispatch returns.
- **Hooks**: unchanged.
- **Plugin overrides**: unchanged.

## Knowledge State

- **Indexed**: foxhound state inherited from prior sessions; this session's commits not yet reindexed.
- **Productive tiers**: Bash (git/sd commits), Read+Edit+Write (file mutations), `mcp__plugin_context-mode_context-mode__ctx_execute` (large-output captures with auto-indexing into knowledge base + ctx_search retrieval), Agent dispatch (general-purpose subagent_type for T17/T18; record-extractor for retro), advisor (validation before T17 dispatch).
- **Gaps**:
  - Phase 1 baseline + bench harness (atlasdraw-f1fa → Wave 4a-T19).
  - Phase 2 acceptance gate (atlasdraw-1315 → Wave 4a-T20, blocks atlasdraw-3a5b).
  - Pin/Convert/LayerPanel UI conventions retrofit (atlasdraw-4ad2 → Wave 4c-T29/T30/T31).
  - Native auto-anchor browser smoke (T18 ships untested in real browser; vitest covers the matrix).

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file).
2. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` lines **1354–1603** — Wave 4 plan addendum (12 tasks, now 15 with the atlasdraw-4ad2 retrofit).
3. **`docs/decisions/wave4-pre-dispatch-scrub-2026-05-04.md`** — DISPATCHABLE verdict + per-task drift table + resolved OQs.
4. **`docs/decisions/wave4-bc-pre-spike-2026-05-04.md`** — file shapes + line ranges + slot APIs for every Wave 4b/4c task. Workers can write briefs from this without re-reading source.
5. `.claude/skills/atlasdraw-ui-conventions/SKILL.md` — invoke before any atlas-app UI work; defines surfaces, tokens, z-index ladder, button patterns, accessibility.
6. `code/packages/geo/src/scaleMode.ts` — T17 ship; pure helpers. Read header comment for the matrix interpretation.
7. `code/apps/atlas-app/src/hooks/useGeoAnchor.ts` — T18 ship; `buildGeoAnchorHandler` factory pattern (testable without React renderer).
8. Commit `8579bc6` body — T17 ship + the two pre-existing test issues caught during wiring.
9. Commit `c194726` body — Rule-0 retrofit findings + atlasdraw-4ad2 framing.

## ⚠️ Critical reminders for next session

- **Wave 4a-tools is COMPLETE** — `atlasdraw-375a` can close on next session entry (both T17 + T18 shipped).
- **`@atlasdraw/atlas-app` workspace root is `code/`** — `yarn workspace ... test` from git root fails. Always `cd code/` first.
- **`renderTopLeftUI` is a render-prop, NOT children-pattern** — T29 worker brief must be explicit; verified at `code/packages/excalidraw/index.tsx:73,183`.
- **`excalidrawAPI.registerAction` shape** — T30 worker should grep `code/packages/excalidraw/actions/types.ts` (or wherever `Action` is defined) before brief authoring to pin contextMenuLabel + perform + predicate signature.
- **CSS-module convention is per-package, not project-wide** — atlas-app/components and atlas-app/state use `__tests__/` subdir; atlas-app/hooks and packages/geo/* use **colocated** `*.test.ts`. Plan literals consistently get this wrong.
- **`sd create --priority` requires `P0`-`P4`** not "high"/"medium". CLI vs display inconsistency.
- **Wave 4c gained 3 tasks** — T29 (Pin slot), T30 (Convert slot), T31 (LayerPanel CSS) tracked under `atlasdraw-4ad2`. Dispatch sequencing: T29 + T30 serialize on MapEditor.tsx; T31 independent.
- **Manual browser smoke required after T22 + T23 + T24** — vitest mocks `<Sidebar>`, `OffscreenCanvas`, `map.addSource/addLayer`. The `d121188` bugs were invisible to tests. Same applies to T29 + T30 (slot integrations).
- **External mechanism is mutating files** — Phase 3/4/6/7 plan files dirty without my touching them; same source as `.claude/skills/atlasdraw-ui-conventions/` bootstrap. Investigate or surface to user.
- **Local-only — no remote push** per `mx-8afd1a`.
