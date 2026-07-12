# Phase 2 Wave 4 — Pre-Dispatch Scrub

**Date:** 2026-05-04
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` §Wave 4 Addendum (lines 1354–1603)
**Wave 1/2/3 scrub templates:** `docs/decisions/wave{1,2,3}-pre-dispatch-scrub-2026-05-04.md`
**Status:** **DISPATCHABLE with corrected briefs.** No structural blockers; 1 sub-wave (4a-bench) creates new infrastructure from scratch — that is the work, not a blocker.

---

## 0. TL;DR

- **No HOLD-class issues.** Unlike Wave 3 (T16 had no baseline), every Wave 4 task can dispatch.
- **5 mechanical drifts** across T17, T18, T24, T26 — path/literal corrections fold into briefs.
- **1 semantic drift** (T24): `inferGeometryType` returns MapLibre layer-type strings, not GeoJSON geometry kinds; brief must pin the actual function signature so the worker doesn't write contradictory code.
- **1 missing reference** (T17): plan cites "Spec §3.4" but no such section exists in the live plan; worker brief must inline the rule set instead of referencing it.
- **Wave 4a-bench (T19+T20)** creates `code/bench/` and `.github/workflows/` from scratch (both still absent — same baseline as Wave 3 scrub). Confirmed expected, not a blocker. Worker should be told these are NEW directories so the brief doesn't read "modify."

**Dispatch shape recommendation:** split into 4a/4b/4c. 4a-tools (T17→T18 sequential), 4a-bench (T19→T20 sequential), 4a-T21 (decision-only, parallel), 4b (T22→T23 serialized on MapEditor.tsx; T24, T25 parallel), 4c (post-4a/4b, single cleanup commit).

---

## 1. Per-task drift table

| Task | Plan literal | Drift | Required correction |
|---|---|---|---|
| T17 | `code/packages/geo/src/__tests__/scaleMode.test.ts` | `__tests__/` directory does not exist in `packages/geo/src/`; geo pkg uses **colocated** `*.test.ts` (CoordinateSync.test.ts, bounds.test.ts, etc., 7 files). | → `code/packages/geo/src/scaleMode.test.ts` |
| T17 | "Spec §3.4 defaults arrow/freedraw to `scaleMode:'hybrid'`" | No `### 3.4` heading exists in the plan body. Reference is to a non-existent section. | Worker brief must inline the rule set: `point+geographic|hybrid` (scale el.width/height by computeScaleFactor), `bbox+screen` (override projected span with stored), `bbox+hybrid` (clamp span 2⁻²..2⁺²), `polyline+screen|hybrid` similar. (Source: Wave 4 plan T17 "Downstream contract" paragraph itself, line 1398.) |
| T17 | `_projectElement` location | ✓ Verified at `code/packages/geo/src/CoordinateSync.ts:159`; line 147 confirms `customData.scaleMode` "currently unread" — T17 is the wiring task. | None. |
| T17 | `GeoCustomData.scaleMode` type field exists? | ✓ Verified at `code/packages/geo/src/types.ts:34-36` (`type GeoCustomData = { ...; scaleMode: ScaleMode; ... }`). T17 is **pure wiring**; type def already correct, no second file modification needed. | None. |
| T18 | `code/apps/atlas-app/src/hooks/__tests__/useGeoAnchor.test.ts` | `__tests__/` directory does not exist in `apps/atlas-app/src/hooks/`; hooks pkg uses **colocated** convention (`useAtlasdrawTool.test.ts` colocated). | → `code/apps/atlas-app/src/hooks/useGeoAnchor.test.ts` |
| T18 | `BBOX_TOOL_TYPES = {rectangle, ellipse, diamond}` | ✓ Verified exact match at `useGeoAnchor.ts:28` (`new Set(["rectangle", "ellipse", "diamond"])`). | None. |
| T18 | "arrow has bound endpoints — confirm" | Open question, not drift; worker decides per spec. | Carry as OQ-W4-1. |
| T19/T20 | `code/bench/`, `.github/workflows/` | ❌ Both **still absent** (confirmed against current HEAD — same baseline Wave 3 scrub flagged for T16). T19/T20 ARE the work that creates them. | Brief must say "CREATE" for every path, not "modify." |
| T21 | (Decision-only; no plan literals.) | None. | None. |
| T22 | `excalidrawAPI.toggleSidebar({name:"layers"})` | ✓ Verified — `toggleSidebar: InstanceType<typeof App>["toggleSidebar"]` at `code/packages/excalidraw/types.ts:963`. | None. |
| T22 | `appState.openSidebar?.name === "layers"` | ✓ Shape verified — `openSidebar: { name: SidebarName; tab?: SidebarTabName } \| null` at types.ts:397. `SidebarName = string` (types.ts:173) so `"layers"` is type-valid. | None. |
| T22 | LayerPanel currently rendered? | ✓ Verified NOT rendered — grep for `LayerPanel\|toggleSidebar\|openSidebar` in `MapEditor.tsx` returns empty. T22 is the first wire-up. | None. |
| T22 | LayerPanel test convention | If T22 ships a test, components/ uses **`__tests__/`** subdir (LayerPanel.test.tsx already lives there). Hooks/geo do NOT. | Brief: place new component test in `code/apps/atlas-app/src/components/__tests__/`. |
| T23 | `exportPNG` import | ✓ Verified at `code/apps/atlas-app/src/lib/export.ts` (T15 ship). | None. |
| T24 | `MapEditor.inferGeometryType(fc)` | ✓ Exists at `MapEditor.tsx:53`. **SEMANTIC DRIFT:** function returns MapLibre layer-type strings (`"fill" \| "line" \| "circle"`), NOT GeoJSON geometry kinds (`"Polygon" \| "LineString" \| "Point"`). Plan's "geometry kind" framing is misleading. | Brief must pin the actual signature: `function inferGeometryType(fc): "fill" \| "line" \| "circle"` and clarify the fix produces 1–3 MapLibre layers under one source, indexed by `features[i].geometry.type` rather than by `features[0]` only. New helper name: prefer `compileLayersForFC(id, style, fc): LayerSpecification[]` (plan-suggested) or rename existing `inferGeometryType` → `inferLayerType`. |
| T24 | `compileLayer` location | ✓ Verified at `code/packages/basemap/src/style-compiler.ts:67`; barrel re-exports at `index.ts:10`. | None. |
| T25 | `code/packages/tools/src/TextLabelTool.ts` | ✓ Verified exists. | None. |
| T26 | `code/packages/geo/src/parseGeoCustomData.ts` | ✓ Verified exists. | None. |
| T26 | `layerRegistry.ts:19-24` (inline LayerStyle) | ✓ Approximately correct — `export interface LayerStyle` declared at line 19 in current HEAD; spans ~5 lines (lines 19–24 inclusive holds `{`, fillColor, strokeColor, strokeWidth, opacity, `}`). May drift by 1–2 lines after Wave 4 work; worker greps the symbol, doesn't pin line. | Brief: grep for `interface LayerStyle` rather than literal line range. |
| T26 | basemap `LayerStyle` export | ✓ Verified at `code/packages/basemap/src/index.ts:9` (`export type { LayerStyle } from "./style"`). T26 migration is a clean import swap. | None. |
| T27 | `code/package.json`, `code/apps/atlas-app/{tsconfig,package}.json`, `code/packages/tools/tsconfig.json` | ✓ All 4 files exist. | None. |
| T28 | (Decision-only; no plan literals.) | None. | None. |

---

## 2. Open questions to carry into Wave 4 briefs

- **OQ-W4-1** (T18): Do bound arrows derive position from their endpoints, or do they need their own `customData.geo`? Worker must grep `code/packages/element/src/types.ts` for `binding\|startBinding\|endBinding` on arrow elements before writing the auto-anchor branch.
- **OQ-W4-2** (T20): ~~Bench gate — Playwright vs vitest+jsdom + synthetic.~~ **RESOLVED.** `@playwright/test@^1.48.0` already in `code/apps/atlas-app/package.json` (resolved 1.59.1 in lockfile); existing `e2e` / `e2e:all` / `e2e:ui` scripts. Use Playwright. **No `yarn add` required** — eliminates lockfile-mutex wave-cut risk for parallel 4a-bench dispatch.
- **OQ-W4-3** (T21): `style-builder` decision — merge intent into `style-compiler.ts` (recommended; functions overlap) or restore as separate file.
- **OQ-W4-4** (T22): `<Sidebar>` v0.18 mount path — render `<LayerPanel/>` as direct child of `<Excalidraw>` or wrap with `<Excalidraw.Sidebar name="layers">{<LayerPanel/>}</Excalidraw.Sidebar>`? Worker greps `Sidebar` exports from excalidraw barrel.
- **OQ-W4-5** (T24): sub-layers (recommended; more correct) vs reject-mixed-FCs at parse. Plan recommends sub-layers; carry as confirmed unless worker hits compile-time blocker.
- **OQ-W4-6** (T28): RTL+vitest cleanup — flip vitest `globals: true` (cheaper, scoped to atlas-app + tools) vs apply explicit `afterEach(cleanup)` to all RTL test files. Recommend `globals: true` route.

---

## 3. Dispatch shape (plan §1387 holds after scrub)

Plan §1387 prescribes: *"Wave 4a + 4b dispatch in parallel where deps allow. Wave 4a-T17 must precede T18; T19 must precede T20; T21 stands alone. Wave 4b tasks all stand alone except T22+T23 both modify MapEditor.tsx (serialize per Wave 2 lesson). Wave 4c is a single post-Wave-4a/b cleanup commit."* Scrub confirms this shape is realizable — no drift forces re-shaping.

```
Wave 4a-tools (sequential — T17 before T18)
  T17 — scaleMode.ts + CoordinateSync wire        [single worker]
  T18 — useGeoAnchor extension                     [single worker, blocked-by T17]

Wave 4a-bench (sequential — T19 before T20)
  T19 — bench harness + Phase 1 baseline           [single worker; perf-investigation skill]
  T20 — Phase 2 acceptance gate                    [single worker, blocked-by T19]

Wave 4a-T21 (decision-only, parallel with bench)
  T21 — Phase 1 dropped sources triage             [decision; ~30 min]

Wave 4b-uxserialized (T22 → T23 on MapEditor.tsx)
  T22 — LayerPanel SidebarTrigger                  [single worker]
  T23 — PNG export UI button                       [single worker, blocked-by T22]

Wave 4b-uxparallel
  T24 — Mixed-geometry FC handling                 [single worker]
  T25 — TextLabelTool inline-editing               [single worker]

Wave 4c (post-4a/4b, single commit)
  T26 — zRef bounds + LayerStyle migration         [single worker]
  T27 — Build/dep quality debt                     [single worker]
  T28 — Architectural orphans (post-T24 for compileLayer decision)
```

**Cache strategy:** rebuild shared prefix between 4a-tools and 4a-bench (independent codepaths). T18 brief should commit T17's `scaleMode.ts` content into prefix (T18 imports it). T20 brief commits T19's `bench/run.ts` shape. T23 commits T22's MapEditor.tsx diff (drop-in at known location).

**Risk:** T22+T23 both modify MapEditor.tsx — serialize to avoid the cross-worker conflict pattern Wave 2's OQ-W2-4 prevented.

---

## 4. Pre-spike artifacts (per `mx-7ef9cf`)

For each sub-wave, the dispatcher should emit a PRE-SPIKE artifact before brief authoring:

- **4a-tools PRE-SPIKE:** read `CoordinateSync.ts:140-200`, identify the exact `_projectElement` body, write the wire-up snippet inline so the worker's brief contains the literal patch shape.
- **4a-bench PRE-SPIKE:** decide Playwright vs vitest+synthetic up front (OQ-W4-2). If Playwright, scaffold `package.json` install of `@playwright/test` in the prefix step (lockfile mutex).
- **4b-uxserialized PRE-SPIKE:** confirm `<Sidebar>` v0.18 mount API (OQ-W4-4) before T22 dispatch.
- **4b-T24 PRE-SPIKE:** read current `inferGeometryType` body + `compileLayer(id, style, geometryType)` signature so worker knows the rename/refactor target.
- **4c PRE-SPIKE:** none — pure cleanup with explicit per-file checklist.

---

## 5. Verdict

**DISPATCHABLE — 4 sub-waves, ~9 worker dispatches.**

- No HOLD-class issues like Wave 3's T16-baseline blocker.
- 5 mechanical path drifts auto-correct in briefs.
- 1 semantic drift (T24) requires deliberate brief framing.
- 1 missing reference (T17 §3.4) requires inlining the rule set.
- 6 open questions carry into briefs as worker-decisions or pre-spike resolutions.

**Recommended next step:** dispatch Wave 4a-tools (T17, then T18). 4a-bench can proceed in parallel if perf-investigation skill is available; otherwise serialize after T18.

`[gate: scrub-clean]` — 18 plan literals checked, 5 corrections folded into corrections column, 1 semantic + 1 missing-ref flagged for brief inlining. No phantom files.
