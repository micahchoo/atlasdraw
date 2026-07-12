# Phase 2 Wave 3 — Pre-Dispatch Scrub

**Date:** 2026-05-04
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` §T15 (line 990), §T16 (line 1078)
**Wave 1 + Wave 2 scrub templates:** `docs/decisions/wave{1,2}-pre-dispatch-scrub-2026-05-04.md`
**Status:** **HOLD — 1 STRUCTURAL DECISION REQUIRED before any dispatch.**

---

## 0. TL;DR

Wave 3 has **far more drift than Wave 2**, including a structural blocker:

1. **T15 PNG export:** path drift (lib in wrong location), wrong file for `preserveDrawingBuffer` modification, plan literal `excalidrawAPI.exportToCanvas` may not exist on ImperativeAPI (top-level export only). **Fixable in scrub; T15 can dispatch with corrected brief.**
2. **T16 Benchmark gate:** **Phase 1 baseline does NOT exist**. `bench/` directory does NOT exist. `bench/results/phase-1-baseline.json` does NOT exist. `.github/workflows/` does NOT exist. T16 has nothing to compare against. **Cannot dispatch as written.**

The structural decision is about T16 only.

---

## 1. T15 — PNG export pipeline

### 1.1 Plan-literal drift (mechanical)

| Plan literal | Real path |
|---|---|
| `apps/atlas-app/lib/export.ts` | **does not exist** — should be `code/apps/atlas-app/src/lib/export.ts` (NEW; lib/ directory does not exist anywhere in atlas-app). |
| `apps/atlas-app/lib/__tests__/export.test.ts` | `code/apps/atlas-app/src/lib/__tests__/export.test.ts` (NEW). |
| `apps/atlas-app/components/MapEditor.tsx` (for `preserveDrawingBuffer`) | **wrong file**. MapEditor wraps `<MapCanvas>` from `@atlasdraw/basemap`; the actual `new maplibregl.Map(...)` call lives in `code/packages/basemap/src/MapCanvas.tsx:94-103`. T15 must modify `MapCanvas.tsx` (basemap pkg), NOT MapEditor.tsx. |

### 1.2 API verification

- ✅ `getFiles` confirmed on ImperativeAPI: `code/packages/excalidraw/types.ts:952`.
- ⚠️ `excalidrawAPI.exportToCanvas(...)` literal — **not** found on `ImperativeAPI` shape in `types.ts`. The package exports `exportToCanvas` as a top-level function from `code/packages/excalidraw/index.tsx:303` (originally from `code/packages/excalidraw/scene/export.ts`). Plan code may need rewrite:
  ```ts
  // PLAN LITERAL (likely wrong)
  const excalidrawCanvas = await excalidrawAPI.exportToCanvas({...});
  // CORRECTED (top-level import)
  import { exportToCanvas } from "@excalidraw/excalidraw";
  const excalidrawCanvas = await exportToCanvas({
    elements: excalidrawAPI.getSceneElements(),
    appState: { ...excalidrawAPI.getAppState(), exportBackground: false },
    files: excalidrawAPI.getFiles(),
  });
  ```
  T15 worker MUST grep-verify before writing — per `.claude/rules/excalidraw-api.md`. If `exportToCanvas` truly is a method on ImperativeAPI in v0.18, plan literal stands; otherwise pivot to top-level import.

### 1.3 Integration-seam absence

- `MapCanvas.tsx:94` lacks `preserveDrawingBuffer: true`. T15 step 3 is "verify or add" — for Wave 3, ADD it.
- `OffscreenCanvas` is supported in modern browsers; vitest+jsdom may not support it. T15 test will need a polyfill or mock for `OffscreenCanvas` + `convertToBlob`.

### 1.4 T15 verdict

**DISPATCHABLE with corrected brief.** Single worker, foreground.

---

## 2. T16 — Benchmark re-gate

### 2.1 Critical absence

- ❌ `bench/` directory: **does not exist** anywhere in repo.
- ❌ `bench/run.ts`: **does not exist**.
- ❌ `bench/results/phase-1-baseline.json`: **does not exist**. The baseline that T16 compares against has never been measured.
- ❌ `bench/fixtures/large-us-roads.geojson`: **does not exist**.
- ❌ `.github/workflows/`: **does not exist**.

The Phase 1 plan presumably was supposed to land the baseline. It didn't. References in `docs/PHASES.md`, `docs/architecture/risk-map.md`, `docs/test-matrix/phase-1.md`, and the Phase 2 plan are all aspirational, not real.

### 2.2 Q8 acceptance gate citation

Plan §1083 cites: *"Phase 2 acceptance gate re-runs the benchmark with real data layers added; regression budget is +20%."*

This is the canonical Phase 2 ship criterion. Wave 3's T16 IS the Phase 2 ship gate. **Without baseline, the gate cannot be enforced.**

### 2.3 Three resolution options

**Option A — Establish Phase 1 baseline first, then run Phase 2 benchmark.**
- Build the entire `bench/` harness from scratch: `run.ts` + scenarios + fixtures.
- Run Phase 1 scenario, write `phase-1-baseline.json`.
- Then run Phase 2 scenario, write `phase-2-with-data-layers.json`, gate-compare.
- Substantial work — likely a separate Phase 2.5 wave or a multi-session push. Cannot land in this Wave 3 cleanly.

**Option B — Defer T16 to a dedicated benchmark phase.**
- Ship Wave 3 as T15-only. Declare Phase 2 functionally complete except for the benchmark gate.
- File a high-priority seed (e.g. `atlasdraw-bench`) for the benchmark establishment work.
- T16 (the actual gate enforcement) happens in a future phase where baseline exists.
- Pragmatic; matches the actual state of the codebase.

**Option C — Establish a token baseline with synthetic numbers and proceed.**
- Hand-write a `phase-1-baseline.json` with reasonable estimates (e.g. p95=12ms based on typical Excalidraw + MapLibre interactions).
- Run Phase 2 scenario, gate-compare.
- DANGEROUS — fabricated baseline gives false-confidence gating. Anti-pattern; do NOT pick.

### 2.4 Recommendation

**B (defer T16, ship T15 alone).** Reasons:
- A is multi-session work, blocks T15 ship indefinitely.
- C is bad-faith engineering.
- B is honest: Phase 2 ships its functional surface; benchmark gate becomes its own work item with proper scoping.

Filed as a structural decision because it changes the ship criterion for Phase 2.

---

## 3. Wave 3 dispatch shape (after decision)

If user picks B (recommended):

### Wave 3-T15 (single worker, serial)
- Add `preserveDrawingBuffer: true` to `code/packages/basemap/src/MapCanvas.tsx:94-103` constructor options.
- Create `code/apps/atlas-app/src/lib/export.ts` with `exportPNG(map, excalidrawAPI, opts?): Promise<Blob>`.
- Create `code/apps/atlas-app/src/lib/__tests__/export.test.ts`.
- Verify or pivot the `exportToCanvas` import shape per §1.2.
- Acceptance: tests PASS; build PASS.

### Wave 3-followup (separate seed)
- File `atlasdraw-bench-baseline` (high severity) for Phase 1 baseline establishment + harness build.
- File `atlasdraw-phase2-gate` (high severity) blocked-on `atlasdraw-bench-baseline` for the actual gate run.
- Update HANDOFF.md to note Phase 2 is "functionally complete; benchmark gate pending separate phase."

---

## 4. **USER DECISION — T16 disposition**

**A** — Do baseline + benchmark in this wave (long, multi-session)
**B** — Defer T16, ship T15 only this wave **(recommended)**
**C** — Synthetic baseline (anti-pattern; do not pick)

**Open questions to carry into briefs (after decision):**
- OQ-W3-1: T16 disposition (A/B/C) — see above.
- OQ-W3-2: T15's `excalidrawAPI.exportToCanvas` method vs top-level `import { exportToCanvas }`. Worker grep verifies.
- OQ-W3-3: Vitest + jsdom + OffscreenCanvas mocking strategy for T15 tests.
