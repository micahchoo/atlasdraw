# Handoff

## Goal
> Prior session: Phase 2 Wave 0 close (T01 layerRegistry types + T02 surgical defaultScaleMode), opus audit, 12 dirty files no commits. **This session** (user-stated, in order): yarn install → /triage queue → commit working tree → Phase 2 Wave 1 pre-dispatch scrub → decide Wave 1 dispatch. Concluded at scrub: Wave 1 dispatch is **blocked** on 3 user OQs and 4 setup tasks (Wave 1a) — recommended fresh session for the implementation work.

## Progress

### Commits landed (3)

- ✅ `939e380` — feat(phase-2): T01 layerRegistry + T02 surgical defaultScaleMode + Phase 1 typecheck unblock (8 files)
- ✅ `dc66a21` — chore(state): handoff + mulch + seeds for Phase 2 Wave 0 close (7 files)
- ✅ `649e9b2` — docs(decisions): Phase 2 Wave 1 pre-dispatch scrub (1 new file, 244 lines)

Working tree clean post-commit. No GitHub push attempted (per `mx-8afd1a`: keep local until atlasdraw-6e33 resolved — still unresolved).

### `yarn install` — `@types/geojson` landed; husky [SNAG]

- ✅ `cd code && yarn install` ran. `@types/geojson` is in `code/node_modules/@types/geojson/` (verified ls).
- ⚠️ Husky postinstall failed (exit-1) because `code/.git` no longer exists (git was hoisted to repo root when `code/.git` backup was retired). Deps installed before postinstall, so non-blocking. Filed `atlasdraw-0c97`.
- ✅ `yarn build` PASS in 13.39s post-install. No regressions.

### `/triage` — queue cleared (13 → 0)

- 6 label-only approved (`needs-triage` removed): atlasdraw-4f26, atlasdraw-fef0, atlasdraw-f31f (all keep blocker:* labels — resurface on unblock); atlasdraw-8a21, atlasdraw-fc04, atlasdraw-0c97 (open without triage gate).
- 7 discarded as scope-mismatch: atlasdraw-5233/47a6/b0c7/795f/665d/22a9/8171 — anti-pattern detector swept vendored Excalidraw v0.18 (797 findings on code we don't own).
- 1 new meta-seed: `atlasdraw-d592` — "Configure anti-pattern detector to scope only atlasdraw-owned paths" (apps/atlas-app + packages/{tools,basemap,geo,atlasdraw-overlay}).
- `sd ready` now shows 30 items, 0 needs-triage.

### Phase 2 Wave 1 pre-dispatch scrub — COMPLETE; revealed Wave 1 is BLOCKED

**Scrub doc:** `docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md` (main body + addendum after advisor review).

**Drifts caught (fixable in worker briefs):**
- T03/T07/T09: plan calls `excalidrawAPI.updateScene` — not on `ToolContext.excalidraw` (Q11 boundary regression). Use `addElement`/`updateElement` per PinTool pattern.
- T06: plan calls `excalidrawAPI.setActiveTool` — not on ctx + violates tool-system independence (`mx-682f8a`). Drop call; host concern.
- T03–T10 (all 8): file paths omit `src/` segment (same class as T01 SNAG; `tools/tsconfig.json` has `rootDir:"./src"`, `include:["src/**/*"]`).

**Integration-seam gaps (NOT in plan; need real implementation work — Wave 1a):**
- `seedToElement.ts:40` is hardcoded `customType==="pin"` — throws on every non-Pin seed. **All 7 new tools fail at runtime without bridge extension.**
- `useAtlasdrawTool.ts:91` `updateElement` is a noisy stub. **Preview tools T07/T08/T09 cannot ship.**

**Resolved by canonical-source grep (no user input needed):**
- OQ-W1-1: T03 polygon uses `freedraw` element (only v0.18 option for closed filled regions; `simulatePressure:false` field confirmed).
- OQ-W1-3-element: T04 polyline uses `line` element type.
- ScaleMode values `"geographic"|"screen"|"hybrid"` all valid (per `code/packages/geo/src/types.ts:25`).
- GeoAnchor.kind values `"point"|"bbox"|"polyline"` only — NO `polygon` kind. Plan correctly uses `polyline` for closed rings.
- @turf/circle install in T09: keep both (circle→polygon conversion in T14 likely needs it).

## What Worked

- **Triage by bucket, not item-by-item** — 13 items in 3 buckets, single round of `sd` calls, queue empty in ~5 minutes. Anti-pattern bucket B (7 items) discarded with a single rationale once the source pattern (vendored upstream sweep) was identified.
- **`ctx_execute_file` for plan analysis** — 64KB Phase 2 plan, extracted T03–T10 task bodies + targeted regex sweep for API literals, only ~10KB landed in context. Wrote intermediate `/tmp/wave1-tasks.md` for Read pass when full bodies were needed.
- **Advisor catch on T05/T08 underread** — first scrub draft claimed T05/T08 were "clean" based on regex token extract; advisor flagged that absence of patterns ≠ confirmation of cleanliness. Reading bodies revealed the implicit `updateElement` dependency. Same lesson applies to "the plan doesn't say X" claims generally.
- **Commit-the-scrub-before-dispatch** — durable artifact lives in git, audit trail tight, fresh session can pick up from `649e9b2` without re-deriving.
- **Two pre-dispatch artifacts in HANDOFF queue** (per `mx-7ef9cf`) — opus audit + scrub doc both committed; fresh session has the full pre-dispatch picture.

## What Didn't Work / [SNAG]

- **[SNAG] Husky postinstall expects `code/.git`** — pre-existing structural mismatch; deps install before postinstall, so non-blocking. Filed `atlasdraw-0c97`. Fix options: (a) move husky config to repo root, (b) symlink `code/.git → ../.git`, (c) `--ignore-scripts`. Decide when convenient.
- **[SNAG] Anti-pattern detector unscoped** — generated 797 findings on vendored Excalidraw, all auto-blocked seeds. 7 issues consumed triage time; correct fix is detector scoping (`atlasdraw-d592`), not per-finding triage. Scoping should run before next anti-pattern sweep.
- **[SNAG] First scrub draft underread T05+T08** — advisor caught it. Lesson: regex sweeps confirm presence of suspect patterns, never absence. Always pair regex sweep with full-body read for sampled tasks.
- **[SNAG] Wave 1a scope ballooned from "5min DEPS" to "~2hr"** — initial scrub thought only the @turf install needed serial setup. Deeper grep revealed seedToElement bridge + updateElement stub are also Wave 1 prerequisites. Lesson: when plan describes new tools that produce non-trivial element shapes, grep the host integration seam, not just the tool-side API surface.

## Key Decisions

- **Wave 1 dispatch deferred to fresh session** — Wave 1a setup is real implementation work touching load-bearing host code (the integration seam for all future tools). Tail-end of this session is the wrong context for it. User chose this option.
- **Wave 1a split into 4 tasks** (one serial DEPS + three parallel: BRIDGE/UPDATEEL/PREVIEW-DOC). Original Phase 2 plan had no setup wave; the integration seam was assumed to exist.
- **Anti-pattern bucket discarded wholesale, not per-item** — single rationale (vendored-upstream scope) covers all 7. Per-item triage would have wasted ~30 min on the same answer.
- **`@types/geojson` install + husky failure: deps verified directly via `ls`** — chose to trust `ls node_modules/@types/geojson` over yarn's exit code. Confirmed correct call after build PASSed.
- **OQ-W1-1 (freedraw vs polygon) resolved by grep, not user question** — per advisor: brief-author responsibility to grep before quoting. Recommendation > menu.

## Trajectory

**How we got here:** User said "yes" to the proposed session plan from `/check-handoff`. Steps 1–4 (yarn install / build verify / triage / commit) executed cleanly with one [SNAG] (husky). Step 5 (pre-dispatch scrub) revealed three layers of issues: (1) plan literal drifts on Q11 boundary (fixable in briefs), (2) plan path drifts (T01 class), (3) host integration-seam absence (needs implementation work). Advisor review caught T05/T08 underread + freedraw-grep skip + preview-pattern unverified — added an addendum that escalated Wave 1a from 5min to ~2hr. Recommended (b) fresh session, user agreed.

**Hard calls:**
- **Discard 7 anti-pattern items as a bucket** rather than triage each. Risk: missing a real finding on atlasdraw-owned code. Mitigation: detector scoping seed (atlasdraw-d592) will surface real findings on next sweep, with proper scope.
- **Commit scrub doc before user OQ resolution** (advisor process note). Risk: doc says "user decision needed" but is committed; could read as "decided." Mitigation: doc explicitly says "still user" on the 3 OQs; future-self/agent reads "still user" verbatim.
- **Wrote scrub doc as durable artifact instead of inline summary** — scrub is decision-grade (drives Wave 1 dispatch); 244 lines justified. Risk: future-self reads outdated doc. Mitigation: addendum supersedes earlier sections explicitly; "Final user decisions needed (3, not 5)" is the canonical OQ list.
- **Did not fix the seedToElement bridge or updateElement stub this session** — even though the gaps are now clearly identified. Reasoning: doing it tail-end of a 30%-context session risks half-baked seam code that becomes load-bearing for all subsequent tools. Better fresh.

**Shaky ground:**
- **The 3 OQs are still open.** Recommended answers in scrub doc, but the user hasn't said yes/no. Fresh session needs to surface them at the top of conversation.
- **Wave 1a estimates assume canonical patterns** — `seedToElement` has only the Pin branch; extending it for 7 new shapes may surface element-factory drift (the existing branch uses `newElement` from `@excalidraw/element`, plan literals reference `newTextElement`/`newLinearElement` etc which `.claude/rules/excalidraw-api.md` warns are easy to misuse). Pre-extension grep mandatory.
- **Background record-extractor agent dispatched at handoff close** (id `ab714cf0ee4aec9a2`) — will land mulch records autonomously; not yet returned at writing time. Mulch state may shift between handoff write and next session start.

**Invisible context:**
- The Phase 2 plan was authored 2026-05-03 (before T02's `defaultScaleMode` decision). The scrub doc is now THE authoritative source for Wave 1 dispatch shape; the plan body is stale on file paths, ctx surface, and wave structure.
- `code/.git` backup at `/mnt/Ghar/2TA/DevStuff/atlasdraw-code-git-backup` is still pending deletion (per prior handoff). Push verified 2 sessions ago; safe to delete. Husky [SNAG] is downstream of this same retirement.
- The advisor was called once this session (during scrub). Caught 3 real gaps. If Wave 1a implementation hits architectural ambiguity, advisor remains the right call.

## Active Skills & Routing

- `check-handoff` (session entry — validated files, git, seeds, surfaced 12 needs-triage at start).
- `triage` (cleared 13 items in one bucket pass).
- pre-dispatch scrub (in-thread analysis, foreground; `ctx_execute_file` for plan reads).
- `advisor` (single call during scrub; 3 gaps caught).
- `record-extractor` (dispatched in background at handoff close; agentId `ab714cf0ee4aec9a2`).
- `handoff` (current).

**Skills NOT invoked this session that should be next:**
- `/dream detect-gaps` — 1092 uncategorized failures (was 1050; growing).
- `/dream integrate` — 88 cross-project memories (still untouched).
- `executing-plans` — applies to Wave 1a/1b dispatch (next session's work).
- `dispatching-parallel-agents` — Wave 1a's 3 parallel tasks + Wave 1b's 8 parallel workers.

## Pending routing for next session

1. **Surface 3 OQs** to the user at conversation top:
   - OQ-W1-3-naming: PolylineTool *(recommended)* vs LineTool?
   - OQ-W1-2 text UX: defer-and-emit *(recommended)* vs solve text entry now in T06?
   - OQ-W1-4 test location: colocated *(recommended, matches PinTool)* vs `__tests__/` subdir?
2. **Execute T-W1a-DEPS** (serial, lockfile mutex): `cd code && yarn add @turf/distance @turf/circle -W`. Verify build PASS. Commit.
3. **Dispatch T-W1a-{BRIDGE, UPDATEEL, PREVIEW-DOC} in parallel** (3 workers). Each commits separately or bundle into one commit.
4. **Pre-dispatch grep for Wave 1a-BRIDGE worker brief** — `.claude/rules/excalidraw-api.md` mandate: grep `code/packages/element/` for the actual factory functions before quoting plan literals (`newTextElement`/`newLinearElement`/`newRectangleElement`).
5. **Dispatch Wave 1b** (T03–T10, 8 parallel workers) per scrub doc's per-task drift table. Each worker brief MUST include the 10-point checklist from the scrub doc.
6. **Optional**: `/dream detect-gaps` if context allows (1092 uncategorized failures growing).
7. **Optional**: delete `code/.git` backup (push verified 2 sessions ago).

## Infrastructure Delta

- **MODIFIED**: `.gitignore` — exclude `.claude/SUGGESTED_SKILLS.md` and `anti-pattern-report.txt` (auto-regenerable diagnostics).
- **NEW**: `docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md` (244 lines, scrub doc with addendum).
- **MODIFIED**: `.seeds/issues.jsonl` (2 new this session: atlasdraw-0c97, atlasdraw-d592; 7 closed; 6 label-only updated).
- **MODIFIED**: `.mulch/expertise/*` — pending record-extractor return (agentId `ab714cf0ee4aec9a2`).
- **MODIFIED**: `code/yarn.lock` — possible drift from yarn install. Not committed (was already up-to-date per yarn output, despite husky postinstall halt). Verify on next session.
- **NO**: hooks, plugin overrides, settings.json edits.

## Knowledge State

- **Indexed**: foxhound has Phase 1 + Wave 0; this session's scrub doc + commits not yet reindexed.
- **Productive tiers this session**: Read+Edit+Write absolute paths, `ctx_execute_file` for large-file analysis (Phase 2 plan, 64KB), Bash for git/grep, sd CLI for triage, advisor for scrub validation. Background Agent for record-extractor.
- **Gaps**:
  - Cross-workspace tsc still broken (atlasdraw-8a21 unchanged this session).
  - `@atlasdraw/basemap` LayerStyle export still missing (atlasdraw-fc04 unchanged).
  - Anti-pattern detector unscoped (atlasdraw-d592 NEW this session).
  - Husky postinstall (atlasdraw-0c97 NEW this session).
  - Host integration seam for non-Pin tools (seedToElement bridge + updateElement stub) — NOT a seed yet, captured in scrub doc as Wave 1a BRIDGE/UPDATEEL tasks. **Decide whether to seed-track these or treat as inline next-session work.**

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — mulch deltas (may be updated by background record-extractor; check freshness).
3. **`docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md`** — THE authoritative source for Wave 1 dispatch. Read main body + addendum together; addendum supersedes earlier wave-shape sections.
4. `docs/decisions/opus-audit-2026-05-04-post-wave4.md` — prior session audit, now committed.
5. `code/packages/tools/src/types.ts` — canonical AtlasdrawTool (post Wave 0).
6. `code/packages/tools/src/PinTool.ts` — canonical impl pattern (single-shot; preview pattern NOT demonstrated, needs Wave 1a-PREVIEW-DOC).
7. `code/packages/geo/src/types.ts` — ScaleMode + GeoAnchor.
8. `code/apps/atlas-app/src/tools/seedToElement.ts` — bridge to extend (Wave 1a-BRIDGE).
9. `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` — ctx wiring; updateElement stub at line 91 (Wave 1a-UPDATEEL).
10. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` — Phase 2 plan; **stale** on file paths and ctx surface, defer to scrub doc for Wave 1.

## ⚠️ Critical reminders for next session

- **Wave 1 dispatch is BLOCKED** on 3 OQs + 4 Wave 1a setup tasks. Do NOT skip to Wave 1b without Wave 1a commits landing first.
- **Plan literal stale list**: file paths (omit `src/`), `excalidrawAPI.updateScene` (T03/T07/T09), `excalidrawAPI.setActiveTool` (T06). Pre-dispatch scrub doc is the correction source.
- **Host integration seam doesn't exist for non-Pin tools** — seedToElement.ts:40 throws, useAtlasdrawTool.ts:91 stubs. Wave 1a BRIDGE + UPDATEEL is real implementation work, not just config.
- **`.claude/rules/excalidraw-api.md` rule paid off again** in T02 (Wave 0) and Wave 1 scrub. Always grep canonical source before quoting plan literals naming Excalidraw APIs.
- **Anti-pattern detector should be scoped first** (atlasdraw-d592) before next sweep, otherwise will refloat 797 vendored-upstream findings.
- **Husky postinstall failure on yarn install is expected** until atlasdraw-0c97 resolves. Verify deps installed via `ls node_modules/...` rather than trusting yarn exit code.
- **Background record-extractor (agentId `ab714cf0ee4aec9a2`) may still be running** when next session starts — check `HANDOFF-expertise.md` mtime + grep `.mulch/expertise/*.jsonl` for fresh entries before dispatching another extractor.
- **The `_data` field naming in seedToElement (line 87)** is load-bearing — uses `_data` to avoid colliding with reserved `GeoCustomData` keys. New BRIDGE branches must follow the same convention.
