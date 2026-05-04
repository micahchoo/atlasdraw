# Handoff

## Goal
> Prior handoff said "Wave 1 BLOCKED on 3 OQs + 4 setup tasks." This session shipped both Wave 1a setup (BRIDGE/UPDATEEL/PREVIEW-DOC) and Wave 1b (7 tools + GeoJSON parser). All Phase 2 Wave 1 work landed in 4 new commits. **Phase 2 Wave 2 (T11–T14: LayerRegistry impl + LayerPanel + DnD import + Convert) is now ready.**

## Progress

### 7 commits this session

| SHA | Subject |
|---|---|
| `939e380` | Wave 0: T01 layerRegistry types + T02 surgical defaultScaleMode + Phase 1 typecheck unblock |
| `dc66a21` | Wave 0 state files (handoff + mulch + seeds) |
| `649e9b2` | Wave 1 pre-dispatch scrub doc (244 lines) |
| `9e88e5b` | Mid-session close: handoff + mulch + CLAUDE.md rename |
| `9d18a47` | Wave 1a-DEPS: @turf/distance + @turf/circle |
| `4f587cf` | Wave 1a setup: BRIDGE seedToElement + UPDATEEL impl + PREVIEW-DOC contracts.md (15 tests) |
| `54e56f8` | Wave 1b: 7 tools (T03–T09) + GeoJSON parser (T10) — 40 new tests |

### Verification at session close

- `yarn workspace @atlasdraw/tools test` → **58/58 PASS** (was 24 at session start)
- `yarn workspace @atlasdraw/data test` → **6/6 PASS** (T10 parser)
- `yarn workspace @atlasdraw/atlas-app test` → **15/15 PASS** (Wave 1a bridge + updateel)
- `yarn build` → **PASS 14.27s**
- Tree clean, no uncommitted changes (record-extractor running in background, will land mulch deltas next session)

### Wave 1 deliverables

- **Tools** (`code/packages/tools/src/`): PolygonTool, PolylineTool, FreehandTool, TextLabelTool, ArrowTool, RectangleTool, CircleTool. All exported from `index.ts`. PinTool unchanged.
- **Bridge** (`code/apps/atlas-app/src/tools/seedToElement.ts`): 8 element shapes (pin + 7 new branches). Each branch grep-verified against `code/packages/element/src/newElement.ts` factories.
- **updateElement impl** (`code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts:91-308`): real implementation with re-projection on `patch.geo`, no double-projection (useCoordinateSync owns camera-tick re-project).
- **Preview pattern doc** (`docs/architecture/subsystems/tools/contracts.md`): canonical drag-preview shape + anti-patterns + testing guidance.
- **Parser** (`code/packages/data/src/geojson.ts`): RFC 7946 minimum validation; `parse(blob)` + `write(fc)` + `class GeoJSONParseError`.

## What Worked

- **Pre-dispatch scrub paid off twice this session** — caught 3 plan literal drifts (updateScene/setActiveTool/path-omits-src) AND surfaced 2 integration-seam absences (seedToElement Pin-only + updateElement noisy stub). Without the scrub, 8 Wave 1b workers would have failed at runtime. Convention `mx-e9dc63` validated as load-bearing for any Phase 2+ wave.
- **Advisor catch on T05/T08 underread** — first scrub draft claimed "clean" based on regex tokens, missed implicit updateElement dep. Advisor caught; I added the addendum. **Lesson:** regex extracts confirm presence, never absence.
- **3 parallel Wave 1a workers + 8 parallel Wave 1b workers** — both batches dispatched in single messages, each named, all returned successfully. No cross-worker file conflict because: (a) Wave 1a touched 3 different files, (b) Wave 1b workers each created their own tool file + I aggregated `index.ts` exports at orchestration level (avoiding 8-way mutex).
- **Bundled commits per wave** instead of per-worker splits — kept commit count manageable; per-worker audit trail lives in commit body + scrub doc.
- **Module-singleton state convention emerged organically** — 6 of 7 Wave 1b tools chose this pattern independently, all citing the same trade-off (single-pointer invariant; revisit Phase 7 plugin-worker port). Codified in tool file headers.
- **Husky postinstall failure is reliably non-blocking** — confirmed across 2 yarn install runs this session. Filed atlasdraw-0c97 last session; new pattern: verify deps via `ls node_modules/...` not yarn exit code.

## What Didn't Work / [SNAG]

- **[SNAG] `yarn workspace add` pruned hoisted packages** — adding @turf to @atlasdraw/tools pruned `vite-plugin-checker` from root `node_modules`, breaking build. Bare `yarn install` re-hoisted. Lesson: chain `yarn workspace add` with `yarn install` immediately + verify build before commit.
- **[SNAG] LSP diagnostics hallucinating useAtlasdrawTool.ts errors** — across the entire Wave 1b dispatch, LSP reported dozens of phantom syntax errors at lines 313–330 in a 312-line file. Pure stale-state noise. Build + tests + git status are sources of truth; NEVER LSP diagnostics during background-worker runs.
- **[SNAG] T04 PolylineTool needed KeyboardEvent stub** — vitest tools-package env was `node` (no DOM globals). Worker used `as unknown as KeyboardEvent` cast. Works but fragile if more tools need richer DOM. Consider switching tools/vitest.config.ts environment to "jsdom" (matches atlas-app).
- **[SNAG] T10 GeoJSON parser needed @atlasdraw/data bootstrap** — package had no test script, no `type:module`, no `@types/geojson`. T10 worker added all three. Convention: when first non-trivial code lands in a previously-skeleton package, expect bootstrap modifications to package.json.
- **[SNAG] T06 worker reported PolylineTool failing with "KeyboardEvent is not defined"** but T04 reported passing — race in vitest env state. Final integration test (post all-workers) showed all 58 passing. Symptom of running tests in different worker contexts.

## Key Decisions

- **OQ-W1-3 (PolylineTool naming)**: PolylineTool (not LineTool) — aligns with `kind:"polyline"` GeoAnchor.
- **OQ-W1-2 (T06 text UX)**: defer-and-emit. TextLabelTool emits empty text element; inline-editing UX deferred to atlasdraw-5193 (filed this session).
- **OQ-W1-4 (test location)**: colocated (matches PinTool), NOT `__tests__/` subdir.
- **OQ-W1-1 (T03 polygon element)**: `freedraw` (only v0.18 option for closed filled regions; `simulatePressure: false` valid). Resolved by grep at scrub time.
- **OQ-W1-3-element (T04 polyline element)**: `line` (not arrow no-arrowhead). Resolved by grep.
- **Wave 1a + Wave 1b each as ONE bundled commit**, not per-worker splits.
- **TextLabelTool drops `setActiveTool` call entirely** — boundary held per `mx-682f8a`.
- **Module-singleton state for stateful tools** (PolygonTool/PolylineTool/FreehandTool/ArrowTool/RectangleTool/CircleTool) — matches AtlasdrawTool literal-export pattern.

## Trajectory

**How we got here:** User said "do as you recommend" twice. First time triggered (b) handoff (commit `9e88e5b`); second time pivoted to (a) execute Wave 1a + Wave 1b. Wave 1a setup ran cleanly (3 parallel workers in 5–10 min each). Build broke transiently after `yarn workspace add` pruned vite-plugin-checker; bare `yarn install` restored. Wave 1b dispatched 8 parallel workers; all returned in 2–3 min with passing tests. Aggregated `index.ts` exports at orchestration. Build PASS. Bundled commits per wave.

**Hard calls:**
- **Bundling Wave 1a + Wave 1b each into one commit** instead of 3+8 per-worker splits. Trade-off: less granular audit, but each commit is a coherent functional milestone; per-worker detail in commit body + scrub doc.
- **Skipping advisor before Wave 1b dispatch** — advisor had already validated the scrub doc; the dispatch shape derived directly from it; cost-benefit said proceed. The 8 workers all succeeded, so the call was right — but advisor would have caught the seedToElement dependency on `updateScene` patterns earlier if I'd asked.
- **Trusting LSP-noise-vs-build conflict** — picked build/tests as truth source over LSP diagnostics. Vindicated: LSP was hallucinating, build PASSed.
- **T10 worker's package.json modification accepted without re-dispatch** — brief said "do not modify other files" but acceptance command required `data/package.json` updates. Worker chose narrow interpretation = "don't touch other source files." Reasonable.

**Shaky ground:**
- **Wave 2 dependencies** — T11 LayerRegistry impl is the foundation; T12/T13/T14 all depend on T11's interface implementation. Wave 2 cannot be fully parallel like Wave 1b was.
- **`code/packages/tools/tsconfig.json` rootDir noise** — every tool that imports `@atlasdraw/geo` triggers TS6059. Pre-existing baseline; tracked under `atlasdraw-8a21`. Vitest's transform path bypasses tsc, so tests pass; bare `tsc --noEmit` does not. Worth a fix-now decision before Wave 2 if cross-package types proliferate.
- **`useAtlasdrawTool.test.ts` typecheck single-error** — `ExcalidrawImperativeAPI not exported` from `@excalidraw/excalidraw`. Same pattern as 4 other sibling files (pre-existing baseline). Not a regression, but accumulates as more atlas-app tests land.

**Invisible context:**
- `useCoordinateSync` re-projects every element with `customData.geo` on every camera move. Wave 1a UPDATEEL projects-at-patch-site for the same-frame case; the next camera tick re-projects from the (just-updated) `customData.geo`. No double projection. This is documented in `useAtlasdrawTool.ts` updateElement comments but worth re-reading if Wave 2's LayerPanel adds layer-visibility-toggle state that interacts with the camera loop.
- **Scrub doc's "10-point checklist" was used by all 8 Wave 1b workers** as a self-gate. Workers cited specific items in their reports. The checklist generalizes for any future multi-tool wave — keep it as a template.

## Active Skills & Routing

- `check-handoff` (session entry).
- `triage` (cleared 13 needs-triage early in session).
- `dispatching-parallel-agents` (Wave 1a 3 + Wave 1b 8 workers).
- `executing-plans` (implicit — Wave 1a → 1b sequencing per scrub doc).
- `verification-before-completion` (yarn build + test before each commit).
- `record-extractor` (background, agentId `a49fce0343b0e41a1` running at handoff close).
- `handoff` (current).

**Skills NOT invoked this session that should be next:**
- `/dream detect-gaps` — 1092 uncategorized failures; growing.
- `/dream integrate` — 88 cross-project memories.
- `executing-plans` (Wave 2 dispatch).

## Pending routing for next session

1. **Phase 2 Wave 2 dispatch decision**:
   - **T11 LayerRegistry impl** (`code/apps/atlas-app/src/state/layerRegistry.ts` already has the type interface from Wave 0; T11 implements it). Single worker, foreground or background.
   - **T12 LayerPanel sidebar** — React component consuming ILayerRegistry. Depends on T11.
   - **T13 GeoJSON Drag-and-Drop import** — uses T10 parser + registry.registerDataLayer. Depends on T11 + T10.
   - **T14 Convert annotation→data layer** — right-click action; uses registry.convertAnnotationToDataLayer. Depends on T11.
   - **Suggested dispatch**: T11 serial first (single worker), then T12+T13+T14 parallel after T11 commits.
2. **Pre-dispatch scrub for Wave 2** — same playbook as Wave 1. Plan literals may be stale (plan was 2026-05-03; canonical types are post-Wave-1 commit `54e56f8`). Mandatory per `mx-e9dc63`.
3. **Optional pre-Wave-2: fix `atlasdraw-8a21` (tools tsconfig rootDir)** — if Wave 2 components will need cross-package types frequently, fix now. Else defer to post-Wave-2 cleanup.
4. **Phase 2 Wave 3** (T15 PNG export + T16 benchmark) — after Wave 2.
5. **Optional housekeeping**:
   - `/dream detect-gaps` (failures growing).
   - Delete `code/.git` backup (push verified 3 sessions ago, husky failure is downstream).
   - Triage atlasdraw-d592 (anti-pattern detector scoping) before next sweep.

## Infrastructure Delta

- **NEW** (committed): 7 tools + 7 tests in `code/packages/tools/src/` + GeoJSON parser + test in `code/packages/data/src/` + 2 vitest configs (atlas-app, data) + preview-pattern section in contracts.md.
- **MODIFIED** (committed): `code/packages/tools/src/index.ts` (+7 exports), `code/apps/atlas-app/src/tools/seedToElement.ts` (8 branches), `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` (updateElement impl + buildToolContext extraction), `code/apps/atlas-app/package.json` (+test script), `code/packages/data/package.json` (+test script + type:module + @types/geojson), `code/packages/tools/package.json` (+@turf deps), `code/yarn.lock`.
- **NEW seeds this session**: atlasdraw-0c97 (husky), atlasdraw-d592 (detector scoping), atlasdraw-dc84 (paths:{}), atlasdraw-b733 (vitest devDeps), atlasdraw-5193 (T06 inline-editing UX).
- **NO**: hooks, plugin overrides, settings.json edits.

## Knowledge State

- **Indexed**: foxhound has Phase 1 + Wave 0; Wave 1 commits not yet reindexed.
- **Productive tiers**: Read+Edit+Write absolute paths, ctx_execute_file for plan extraction, parallel Agent dispatch (3 + 8 workers), Bash for git/yarn ops, advisor for scrub validation.
- **Gaps** (unchanged):
  - atlasdraw-8a21: Cross-workspace tsc still broken.
  - atlasdraw-fc04: @atlasdraw/basemap LayerStyle export still missing (T01 placeholder still inline).
  - atlasdraw-d592: Anti-pattern detector unscoped.
  - atlasdraw-0c97: Husky postinstall expects code/.git.
  - atlasdraw-dc84: atlas-app tsconfig paths:{} clobber.
  - atlasdraw-b733: atlas-app missing vitest devDep (hoisting fragile).
  - atlasdraw-5193: T06 TextLabelTool inline-editing UX deferred.

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — mulch deltas (background record-extractor running; check freshness).
3. **`docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md`** — canonical pre-dispatch scrub example. Use as template for Wave 2 scrub.
4. `docs/architecture/subsystems/tools/contracts.md` — AtlasdrawTool contract + new "Preview pattern" section.
5. `code/packages/tools/src/index.ts` — current tool exports (PinTool + 7 Wave 1b tools).
6. `code/apps/atlas-app/src/tools/seedToElement.ts` — 8-branch bridge (consumer reference for Wave 2 import paths).
7. `code/apps/atlas-app/src/state/layerRegistry.ts` — T01 ILayerRegistry interface (Wave 2 T11 implements this).
8. `code/packages/data/src/geojson.ts` — T10 parser (Wave 2 T13 consumes).
9. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` — Phase 2 plan; Wave 2 = T11–T14, Wave 3 = T15+T16.

## ⚠️ Critical reminders for next session

- **Plan literals stale list will grow** — Phase 2 plan was authored 2026-05-03; Wave 1 ship is 2026-05-04. Wave 2 plan literals likely have similar drift to T02/Wave 1. **Pre-dispatch scrub mandatory** before T11 brief (per `mx-e9dc63`).
- **Wave 2 has cross-task dependencies** unlike Wave 1b — T11 must land before T12/T13/T14. Single-worker T11 first; then 3 parallel.
- **`yarn workspace add` is hoist-hostile** — any Wave 2 task that adds deps must run `yarn install` after, then verify build. (Wave 2 likely doesn't add deps; T11–T14 should be pure code on existing surfaces.)
- **LSP diagnostics during background workers are unreliable** — this session showed phantom errors at non-existent lines. Source of truth: `git status`, `yarn build`, `yarn test`.
- **`useCoordinateSync` is the implicit re-projection layer** — Wave 2 LayerPanel visibility toggle, layer reorder, etc. should NOT call updateScene directly; let useCoordinateSync handle camera-tick re-projection from `customData.geo`.
- **Background record-extractor (agentId `a49fce0343b0e41a1`) may still be running at session start** — check `HANDOFF-expertise.md` mtime + `.mulch/expertise/*.jsonl` recency before dispatching another extractor.
- **The 10-point brief-author checklist in scrub doc** generalizes to Wave 2 — copy/adapt for T11–T14 worker briefs.
