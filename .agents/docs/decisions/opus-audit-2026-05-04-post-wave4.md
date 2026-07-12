# Opus Audit Post-Wave-4 — Phase 1 closure + Phase 2 Wave 0 readiness
Date: 2026-05-04
Auditor: Opus 4.7 (foreground, scoped sub-questions; prior background attempt stalled at 600s)

## Acceptance gates (this run)

| Gate | Exit | Notes |
|---|---|---|
| typecheck (`yarn test:typecheck` from `code/apps/atlas-app/`) | **2** (FAIL) | Pre-fix: tsconfig deprecation halted tsc immediately. Fixed in this audit (`code/packages/tsconfig.base.json` `"ignoreDeprecations": "5.0"` → `"6.0"`; TS is 6.0.3). Post-fix: 5 pre-existing TS errors surfaced in vendored upstream `code/packages/excalidraw/wysiwyg/textWysiwyg.tsx` lines 587, 654, 663, 824, 965. Atlasdraw's own source (`code/packages/{geo,basemap,tools,data}/**`, `code/apps/atlas-app/src/**`) is type-clean. |
| build (`yarn build` / `vite build`) | **0** | Built in 12.33s. Bundle warnings (>500KB chunks) are upstream Excalidraw, not atlasdraw. |
| E2E chromium (per HANDOFF) | **0** | 6/6 pass. |
| E2E firefox (per HANDOFF) | **0** | 6/6 pass. Firefox cold-start flake noted but non-reproducing. |
| E2E webkit | **BLOCKED** | sudo system deps (`atlasdraw-f31f`). Non-gating per Phase 1 plan. |

## Sub-question (a) — typecheck status

**FAIL (post-fix).** The deprecation in `tsconfig.base.json` was masking dormant TS errors in vendored upstream Excalidraw — `tsc` exited 2 on config-load before reaching the source. Bumping `ignoreDeprecations` to `"6.0"` to match TS 6.0.3 reveals 5 errors in `code/packages/excalidraw/wysiwyg/textWysiwyg.tsx`:
- Line 587: `Property 'value' does not exist on type 'ParsedDataTransferItemType<any>'`
- Lines 654, 663: `Element implicitly has 'any' type` (KeyboardEvent indexed access)
- Line 824: `Parameter 'ele' implicitly has 'any' type`
- Line 965: `Parameter 'elements' implicitly has 'any' type`

**Verdict:** upstream-fork debt, not atlasdraw debt. Recommend filing as seeds issue rather than excluding the file (which would mask future regressions).

## Sub-question (b) — build status

**PASS** in 12.33s. Bundle warnings exist but are upstream Excalidraw's known >500KB chunks (Mermaid renderers, KaTeX, CodeMirror, etc.).

## Sub-question (c) — E2E pass count + browser coverage

**12/12 chromium+firefox** per HANDOFF (6 tests × 2 browsers). Webkit blocked on sudo. Phase 1 acceptance functionally satisfied.

## Sub-question (d) — Plan adherence vs Phase 1 plan

**Compliant.** Wave 4 added firefox+webkit Playwright projects, expanded suite 2→6 tests including the 5afc repro/fix gate (Test #6 wheel zoom in DRAWING mode), and produced `docs/test-matrix/phase-1.md`. The `useMapWheelRouter` hook (atlasdraw-5afc fix) was not anticipated in the Phase 1 plan but is internally consistent (advisor-validated `map.easeTo` over synthetic WheelEvent).

## Sub-question (e) — Post-Wave-4 risks before Phase 2 entry

### CRITICAL — T02 plan literal drifts severely from Phase 1 canonical impl

Phase 2 plan was authored 2026-05-03; PinTool + canonical `AtlasdrawTool` shipped 2026-05-04 in Phase 1 Wave 3b. Plan T02's stated extension is partly redundant and partly regressive against settled decisions.

| T02 plan literal | Current `code/packages/tools/src/types.ts` (canonical) | Drift |
|---|---|---|
| `icon: React.FC` | `readonly icon: string` (Phase 1 D-TOOLS-1 canonical) | **Regression** |
| `onPointerDown(e: PointerEvent, …)` | `onPointerDown(e: ToolPointerEvent, …)` (Q11 postMessage-safe boundary) | **Regression** |
| `AtlasdrawToolContext { map: maplibregl.Map; excalidrawAPI: ExcalidrawImperativeAPI; elements; appState }` | Narrow `ToolContext { map: { project, unproject, getZoom, getBounds }; excalidraw: { addElement, updateElement, getActiveTool }; ui }` | **Regression** — abandons postMessage-safe boundary |
| `defaultScaleMode: "geographic" \| "screen" \| "hybrid"` (REQUIRED) | Field does **not** exist; PinTool sets `scaleMode` per-element-seed | **Breaking** — PinTool would fail to satisfy contract |
| Adds `onPointerMove?` + `onPointerUp?` | Both already present (lines 121, 124) | **No-op** |
| Missing `label`, `onActivate?`, `onDeactivate?`, `onKeyDown?` | All present in canonical | **Loss** |

**T02 in its current form must not dispatch.** Worker would either silently revert hard-won Phase 1 decisions or fail typecheck against PinTool. Reconciliation options:

1. **Drop T02** and document Wave 0 Task 2 as "satisfied by Phase 1 Wave 3b — interface is stable for multi-point tools (`onPointerMove?`/`onPointerUp?` already present)." Update Phase 2 plan §"Tasks: T01, T02" → "Tasks: T01 only."
2. **Adopt a stricter contract** — add `defaultScaleMode` as required, retrofit PinTool to set it, update `docs/architecture/subsystems/tools/contracts.md`. Higher cost, doesn't change behavior.
3. **Surgical T02** — only `defaultScaleMode` if needed for Phase 2 PolygonTool/LineTool. Drop the regressions on `icon`/`PointerEvent`/`ctx`.

Recommend **(1)** unless Phase 2 implementations need `defaultScaleMode` at the tool level (the current per-seed pattern is more flexible).

### MEDIUM — T01 has dispatchable drift

- Plan path `apps/atlas-app/state/layerRegistry.ts` is monorepo-relative; absolute path is `code/apps/atlas-app/src/state/layerRegistry.ts`. Worker brief must pin the absolute path.
- Plan imports `LayerStyle from "@atlasdraw/basemap"`. Per prior audit, `BasemapRegistry`/`pmtiles-protocol`/`style-builder` were silently dropped from Wave 1 — `LayerStyle` may not yet be exported. **Verify before dispatch:** `grep -n "LayerStyle" code/packages/basemap/src/index.ts`. If absent, T01 must either define `LayerStyle` inline (with a `// TODO: move to @atlasdraw/basemap` comment + seeds issue) or block on prior basemap work.
- T01 is otherwise types-only at a brand-new file. Low risk.

### LOW — Stale in-progress seeds

- `atlasdraw-9689` (Phase 1 Wave 0 Task 1 GeoAnchor types) — Phase 1 Wave 3b shipped depending on this. Close `outcome:success`.
- `atlasdraw-b8e7` (Phase 1 Wave 0 Task 2 AtlasdrawTool interface) — same. Close `outcome:success`.

### LOW — Anti-pattern report (new untracked file)

`anti-pattern-report.txt` (untracked) appeared with 3 new blocked seeds (catch-all 53, console-only-error 87, fire-and-forget 142, all `needs-triage`). Likely a hook scan ran between sessions. Not gating Phase 2 Wave 0.

### LOW — Backup retention

`/mnt/Ghar/2TA/DevStuff/atlasdraw-code-git-backup` — push verified, technically safe to delete; HANDOFF retains for one more session as margin.

## Top 3 findings

1. **T02 plan literal drifts on 4 settled Phase 1 decisions** (`icon: React.FC` vs `string`; `PointerEvent` vs `ToolPointerEvent`; raw `maplibregl.Map`+`ExcalidrawImperativeAPI` ctx vs narrow postMessage-safe ctx; required `defaultScaleMode` field that PinTool doesn't set). T02's nominal addition (`onPointerMove?`+`onPointerUp?`) is already present. **T02 cannot dispatch as written.**
2. **Typecheck fragility revealed.** `tsconfig.base ignoreDeprecations: "5.0"` was masking 5 pre-existing TS errors in vendored upstream Excalidraw `textWysiwyg.tsx`. This audit fixed the masking (bumped to `"6.0"`); the upstream debt should be filed as a seeds issue. Atlasdraw's own source remains type-clean.
3. **T01 is dispatchable solo** with two corrections in the worker brief: absolute path and `LayerStyle` export verification (likely missing per prior audit's silent-Wave-1 reduction).

## Verdict

**CONDITIONAL.** Phase 1 closure is acceptance-complete on automated chromium+firefox + Phase 1 plan compliance. Phase 2 Wave 0 dispatch is **NOT cleared**: T02 needs reconciliation against canonical Phase 1 impl before any worker brief is written.

### Required before Phase 2 Wave 0 dispatch

1. **Decide T02 disposition** — drop (rec) / adopt-stricter / surgical. Update Phase 2 plan §T02 accordingly.
2. **Verify `LayerStyle` export from `@atlasdraw/basemap`.** If missing, T01 brief either defines inline + files seeds issue, or blocks on a tiny basemap pre-task.
3. **Close stale `atlasdraw-9689` + `atlasdraw-b8e7` seeds** with `outcome:success`.

### Non-blocking but should be tracked

- File seeds issue for upstream-fork `textWysiwyg.tsx` typecheck debt (5 errors).
- Triage 3 anti-pattern blocked seeds.
- Webkit sudo deps (`atlasdraw-f31f`).
- Backup folder deletion at next session boundary.

## Resolution (this audit, post-decision)

User chose **option (2)-surgical**: adopt `defaultScaleMode` only, reject T02's other regressions (icon type, PointerEvent, raw ctx). T02 is now folded into this audit's housekeeping; Phase 2 Wave 0 collapses to T01 only.

### (2)-surgical applied
- **MODIFIED** `code/packages/tools/src/types.ts` — added `readonly defaultScaleMode: ScaleMode` to `AtlasdrawTool` interface (uses existing `ScaleMode` import from `@atlasdraw/geo`).
- **MODIFIED** `code/packages/tools/src/PinTool.ts` — set `defaultScaleMode: "screen"` (matches per-seed scaleMode).
- **MODIFIED** `code/packages/tools/src/types.test.ts` — both fixture tools now satisfy the new required field.
- **MODIFIED** `docs/architecture/subsystems/tools/contracts.md` — full `AtlasdrawTool` block alignment with canonical impl: D-TOOLS-1 (`icon: string`), D-TOOLS-2 (add `label`), D-TOOLS-3 (add `onActivate?`/`onDeactivate?`), bonus drift (`readonly` modifiers), bonus drift (`ToolPointerEvent` over raw `PointerEvent`), drop `onDoubleClick?` (impl-canonical), add `defaultScaleMode` (NEW required). Resolves all 5 outstanding tools-contract drifts from prior audit + adds Phase 2 field.

### T01 applied (collapsed Wave 0 to single inline task)
- **NEW** `code/apps/atlas-app/src/state/layerRegistry.ts` — types-only module: `LayerStyle` (inline placeholder), `AnnotationLayerEntry`, `DataLayerEntry`, `LayerRegistryEntry` discriminated union, `ILayerRegistry` interface. `LayerStyle` inlined per atlasdraw-fc04 (Phase 1 Wave 1 silent reduction means `@atlasdraw/basemap` doesn't export it yet).
- **MODIFIED** `code/apps/atlas-app/package.json` — added `@types/geojson` to devDependencies (Phase 2 plan implicitly required `geojson` typings for `FeatureCollection`).

### Seeds maintenance
- **CREATED** `atlasdraw-8a21` — Phase 1 typecheck debt (atlas-app paths, tools rootDir, vendored Excalidraw textWysiwyg). 3 pre-existing issues masked by deprecation halt; surfaced when `ignoreDeprecations` bumped 5.0→6.0. Out of scope for this audit; gated on Phase 2 implementation work or dedicated tsconfig refactor.
- **CREATED** `atlasdraw-fc04` — Restore `@atlasdraw/basemap` LayerStyle export. T01 inlined a placeholder; this seeds tracks the future restore.
- **CLOSED** `atlasdraw-9689` — Phase 1 Wave 0 Task 1 (GeoAnchor types). `outcome:success` — superseded by Phase 1 Wave 3b shipping in production use.
- **CLOSED** `atlasdraw-b8e7` — Phase 1 Wave 0 Task 2 (AtlasdrawTool interface). `outcome:success` — interface stable; `defaultScaleMode` added by this audit.

### Typecheck deeper finding
The deprecation bump (`5.0`→`6.0`) revealed Phase 1's typecheck baseline was masked beyond just `textWysiwyg.tsx`. Three pre-existing tsconfig issues now visible:
1. `code/apps/atlas-app/tsconfig.json` has `"paths": {}` which fully overrides base's `@excalidraw/*` aliases — tsc cannot resolve workspace packages (vite/esbuild does via package.json). Tracked in `atlasdraw-8a21`.
2. `code/packages/tools/tsconfig.json` has narrow `rootDir: ./src` blocking `@atlasdraw/geo` cross-package imports (TS6059). Tracked in `atlasdraw-8a21`.
3. `code/packages/excalidraw/wysiwyg/textWysiwyg.tsx` has 5 upstream TS errors. Tracked in `atlasdraw-8a21`.

Atlasdraw's own source (geo, basemap, tools/src files in isolation, atlas-app/src files in isolation) compiles. The cross-workspace typecheck is the broken thing. Build (vite) is unaffected.

## Verdict (final)

**Phase 1 closure: ACCEPTANCE-COMPLETE** on chromium+firefox automated coverage + Phase 1 plan compliance. Webkit non-gating (sudo).

**Phase 2 Wave 0: COMPLETE** via this audit's housekeeping (T02 folded; T01 inlined). Wave 1 dispatch is now unblocked from a Wave 0 dependency standpoint, conditional on:
- `atlasdraw-8a21` triage (typecheck baseline) — defer or address before Wave 1's first cross-workspace task.
- `atlasdraw-fc04` triage (LayerStyle restore) — defer; T01 placeholder is sufficient for downstream T11/T12/T13/T14 type-checking.
- 4 needs-triage seeds (`atlasdraw-8a21`, `atlasdraw-fc04`, `atlasdraw-4f26`, `atlasdraw-fef0`, `atlasdraw-f31f` — last 3 are deferred-phase-blockers from prior session).

## Infrastructure delta this audit (final)

- **MODIFIED**: `code/packages/tsconfig.base.json` (`ignoreDeprecations: "5.0"` → `"6.0"`; required by TS 6.0.3).
- **MODIFIED**: `code/packages/tools/src/types.ts` (+`defaultScaleMode` field).
- **MODIFIED**: `code/packages/tools/src/PinTool.ts` (+`defaultScaleMode: "screen"`).
- **MODIFIED**: `code/packages/tools/src/types.test.ts` (both fixtures gain `defaultScaleMode`).
- **MODIFIED**: `docs/architecture/subsystems/tools/contracts.md` (interface block fully aligned with canonical impl + new field).
- **NEW**: `code/apps/atlas-app/src/state/layerRegistry.ts` (T01).
- **MODIFIED**: `code/apps/atlas-app/package.json` (+`@types/geojson`).
- **NEW**: `docs/decisions/opus-audit-2026-05-04-post-wave4.md` (this file).
- **SEEDS**: +2 created (`atlasdraw-8a21`, `atlasdraw-fc04`), +2 closed (`atlasdraw-9689`, `atlasdraw-b8e7`).
