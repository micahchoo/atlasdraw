# Phase 2 Wave 2 — Pre-Dispatch Scrub

**Date:** 2026-05-04
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md`
**Plan vintage:** 2026-05-03 (24h+ old; Wave 1 shipped at `54e56f8` 2026-05-04)
**Wave 1 scrub template:** `docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md`
**Status:** **HOLD — 1 user decision + setup wave required before brief authoring.**

---

## 0. TL;DR

Wave 2 cannot dispatch as a single 4-worker parallel batch. Three reasons:

1. **One user decision required:** Zustand vs module-singleton for `LayerRegistry` (cross-component reactive shared state — different problem class than Wave 1b's tool singletons).
2. **Two integration seams missing:** `style-compiler.ts` (basemap pkg) + `useLayerRegistry.ts` hook file (atlas-app). Both consumed by ≥2 Wave 2 tasks.
3. **One file must exist for downstream typecheck:** `useLayerRegistry.ts` is T11's deliverable but T12/T13/T14 import it. Plan's "fully parallel" claim breaks at the import-path level even with interface-only coupling.

**Resolution shape:** insert a Wave 2a setup wave (deps + skeletons + 2 hardening seeds) before Wave 2b parallel ship.

---

## 1. Reconciled scope

### Plan tasks (4)

| ID | Title | Status |
|---|---|---|
| T11 | LayerRegistry impl | path drift + Zustand decision |
| T12 | LayerPanel sidebar | path drift + style-compiler seam |
| T13 | GeoJSON DnD import | path drift + style-compiler + ImportDialog seam |
| T14 | Convert annotation → data layer | path drift + scene-mutation boundary check |

### Wave 2 hardening seeds (4 found, 2 in / 2 out)

| Seed | Title | Severity | Verdict |
|---|---|---|---|
| atlasdraw-db43 | parseGeoCustomData (deep parser) | High | **IN — Wave 2a (data pkg)**. Blocks T13's trust in imported customData. |
| atlasdraw-072a | schemaVersion migration shim | High | **IN — Wave 2a (data pkg)**. Foundation; v2 bump needs scaffold wired. |
| atlasdraw-02f6 | zRef bounds at CoordinateSync boundary | Med | **OUT — defer to Wave 2.5 / post-ship.** Not blocking T11–T14. |
| atlasdraw-cdd3 | Dropped sources (BasemapRegistry/pmtiles/style-builder/MapCanvas.test) | Med | **OUT — defer.** Phase 1 cleanup, not Wave 2. |

---

## 2. Plan-literal drift (mechanical)

Per `mx-8ec7b9`: plan paths omit `code/` prefix and `src/` segment. Worker briefs MUST pin corrected literals.

| Plan literal | Real path |
|---|---|
| `apps/atlas-app/state/layerRegistry.ts` | `code/apps/atlas-app/src/state/layerRegistry.ts` (T01 stub, 79 lines, types only) |
| `apps/atlas-app/state/store.ts` | **does not exist** — see §3 below |
| `apps/atlas-app/hooks/useLayerRegistry.ts` | `code/apps/atlas-app/src/hooks/useLayerRegistry.ts` (NEW; T11 creates) |
| `apps/atlas-app/components/LayerPanel.tsx` | `code/apps/atlas-app/src/components/LayerPanel.tsx` (NEW) |
| `apps/atlas-app/components/MapEditor.tsx` | `code/apps/atlas-app/src/components/MapEditor.tsx` (EXISTS, 192 lines) |
| `apps/atlas-app/components/ImportDialog.tsx` | **does not exist** — see §3 below |
| `packages/tools/convert.ts` | `code/packages/tools/src/convert.ts` (NEW) |
| `basemap/style-compiler.ts` | `code/packages/basemap/src/style-compiler.ts` (**does not exist**; basemap/src has only `MapCanvas.tsx` + `index.ts`) |

Verified API literals (no drift):
- `useMapRef()` returns `{ mapRef, map, onMapReady }` where `map: maplibregl.Map | null` — raw maplibre instance. T13's `map.addSource(id, …)` literal valid against `code/apps/atlas-app/src/hooks/useMapRef.ts:23-25`.
- `isGeoCustomData` lives in `code/packages/geo/src/types.ts` (shallow type guard); db43's `parseGeoCustomData` lands alongside it.
- `parse(blob)` + `class GeoJSONParseError` exported from `code/packages/data/src/geojson.ts` (T10 ship, commit `54e56f8`).

---

## 3. Integration-seam absences (per `mx-d4f376`)

### 3.1 `useLayerRegistry.ts` — T11's deliverable, T12/T13/T14 imports

**Plan implication:** T12/T13/T14 in parallel implies they each `import { useLayerRegistry } from "../hooks/useLayerRegistry"`. The file is T11's output. Even with interface-only coupling, the *import path* must resolve for typecheck.

**Resolution paths:**
- **(a)** T11 ships first as a serial step (handoff's instinct); T12/T13/T14 parallel after.
- **(b)** T11 produces a *skeleton* hook (typed, with throw-not-implemented bodies) in Wave 2a; full impl runs parallel with T12/T13/T14 in Wave 2b. Skeleton is enough for typecheck + mock injection.

Recommendation: **(a)** — handoff's call. Wave 1b's 8-way parallel was a special case (each tool its own file). Wave 2's 3-of-4 with shared registry import is a different shape; serializing T11 buys clean dispatch + 1 fewer concurrent worker.

### 3.2 `code/packages/basemap/src/style-compiler.ts` — referenced by T12 + T13

**Plan implications:**
- T12 step 2: "On change: call `updateStyle(id, patch)` → emit `map.setPaintProperty` via `style-compiler.ts`"
- T13 step 2: `map.addLayer(compileLayer(id, style))  // basemap/style-compiler.ts`

**Required surface (minimum):**
```ts
// code/packages/basemap/src/style-compiler.ts
import type { LayerStyle } from "./types"; // or wherever LayerStyle lives — Spec §7.3
export function compileLayer(id: string, style: LayerStyle): maplibregl.LayerSpecification;
export function defaultLayerStyle(fc: GeoJSON.FeatureCollection): LayerStyle;
// later: emit setPaintProperty / setLayoutProperty patches for updateStyle
```

`LayerStyle` location currently unknown — atlasdraw-fc04 (basemap LayerStyle export missing) is still listed as a Knowledge State gap. Confirm before writing T11/T12 briefs.

### 3.3 `ImportDialog.tsx` — does not exist

**Plan literal:** T13 says "Modify: ImportDialog.tsx".

**Question:** is ImportDialog vestigial (dropped from architecture) or pending creation?

**Decision needed:** **DROP** the ImportDialog.tsx reference. The MapEditor.tsx drop handler (T13 step 2) already covers the file→FC→registry flow. ImportDialog adds a programmatic-trigger surface (button to open file picker) that's nice-to-have but not on the critical path. Defer to a post-Wave-2 polish task.

If user disagrees, T13 brief gains a CREATE step for ImportDialog.tsx.

---

## 4. **USER DECISION NEEDED — Zustand vs module-singleton**

T11 plan literal uses `zustand` + `zustand/middleware/immer`. Neither is in `code/apps/atlas-app/package.json` deps. Adding them is a one-line install but the deeper question is architectural.

### Context
- Wave 1b convention `mx-2c…` (module-singleton state) emerged organically — 6 of 7 tools chose it for **per-tool internal state** (single active drag, single active text-edit cursor, etc.).
- LayerRegistry is a **different problem class**: cross-component shared reactive state. LayerPanel reads + mutates; MapEditor reads (drop handler appends); Convert reads + mutates. Multiple consumers, multiple mutators, must trigger re-render.

### Options

**Option A — Zustand + immer (plan-literal default).**
- Pros: idiomatic for cross-component reactive store; immer for ergonomic mutation; ~3KB; broad React ecosystem precedent.
- Cons: introduces a new state library to the project; one more dep to track; postinstall already fragile (atlasdraw-0c97).

**Option B — module-singleton + `useSyncExternalStore`.**
- Pros: no new dep; aligns with Wave 1b emergent convention.
- Cons: reinvents Zustand's wheel for cross-component case; manual subscribe/snapshot wiring; risk of subtle re-render bugs without battle-tested store.

**Option C — React context + `useReducer`.**
- Pros: no dep; built-in React; idiomatic for small shared state.
- Cons: re-renders entire subtree on every change unless context is split; mutation ergonomics worse than immer.

### Recommendation
**A (Zustand + immer).** LayerRegistry's shape — multiple readers, multiple mutators, mutation-heavy (visibility toggles, reorder, style edits) — is exactly Zustand's sweet spot. Module-singleton was right for tool-internal state; it's not the same problem.

If user picks B or C, T11 brief rewrites Step 2 accordingly and Wave 2a drops the dep-install step.

---

## 5. Wave 2a setup wave (sequenced, mostly parallel)

**Goal:** unblock Wave 2b parallel dispatch.

### Wave 2a-DEPS (serial, single worker, only if user picks Option A)
- `cd code && yarn workspace @atlasdraw/atlas-app add zustand immer`
- `yarn install` immediately after (`yarn workspace add` is hoist-hostile per Wave 1 [SNAG])
- Verify build: `yarn build`
- Commit: `chore(deps): zustand + immer for Wave 2 LayerRegistry`

### Wave 2a-PARALLEL (3 workers, after DEPS commits)

| Worker | Files | Acceptance |
|---|---|---|
| **T11** LayerRegistry impl | `code/apps/atlas-app/src/state/layerRegistry.ts` (augment), `code/apps/atlas-app/src/hooks/useLayerRegistry.ts` (NEW) | `npx vitest run …/state/__tests__/layerRegistry.test.ts` PASS; ID-prefix throw test green |
| **STYLE-COMPILER skeleton** | `code/packages/basemap/src/style-compiler.ts` (NEW) | Exports `compileLayer` + `defaultLayerStyle`; LayerStyle type imported (resolve atlasdraw-fc04 inline if needed); `yarn build` PASS |
| **db43 parseGeoCustomData + 072a migrate** | `code/packages/geo/src/types.ts` (augment) OR new file in geo or data pkg (worker chooses) | `parseGeoCustomData(value: unknown): Result<GeoCustomData, ParseError>` exported; `migrate(value, fromVersion): GeoCustomData` exported (identity at v1); tests for both |

Three workers touch three different packages — no cross-worker file conflict.

### Wave 2a verification gate
- `yarn workspace @atlasdraw/atlas-app test` PASS
- `yarn workspace @atlasdraw/basemap test` PASS (or build if no tests)
- `yarn workspace @atlasdraw/geo test` PASS
- `yarn workspace @atlasdraw/data test` PASS (regression)
- `yarn build` PASS
- Single bundled commit per Wave 1 pattern.

---

## 6. Wave 2b parallel dispatch (3 workers, after Wave 2a commits)

**Pre-state:** T11 LayerRegistry impl + style-compiler skeleton + parseGeoCustomData/migrate landed. Workers consume verified seams.

| Worker | Files | Depends-on (in shared prefix) |
|---|---|---|
| **T12** LayerPanel | `code/apps/atlas-app/src/components/LayerPanel.tsx` (NEW) | useLayerRegistry, style-compiler exports |
| **T13** GeoJSON DnD | `code/apps/atlas-app/src/components/MapEditor.tsx` (modify) | parse, GeoJSONParseError, registerDataLayer, compileLayer, parseGeoCustomData (for any persisted-state ingestion) |
| **T14** Convert | `code/packages/tools/src/convert.ts` (NEW), `code/apps/atlas-app/src/components/MapEditor.tsx` (context menu wiring) | annotationToFeatureCollection, convertAnnotationToDataLayer |

**Cross-worker conflict risk:** T13 + T14 both modify `MapEditor.tsx`. **Mitigate:** T13 adds drop handlers; T14 adds context-menu wiring. Different lexical regions. Briefs must pin **anchor lines** (use commit `9d18a47` MapEditor as base) so workers' edits don't merge-clash. Alternative: run T13 first, then T14 against post-T13 MapEditor. Recommendation: **serial T13 → T14** (a 5-minute serialization is cheaper than merge-conflict resolution).

Adjusted Wave 2b: T12 parallel with (T13→T14 serial). 2 streams instead of 3.

---

## 7. T14 scene-mutation boundary check

**Plan literal:** `excalidrawAPI.updateScene({ elements: elements.filter(e => e.id !== el.id) })` — destructive scene mutation removing the converted annotation.

**Concern:** Wave 1's `mx-682f8a` boundary held that AtlasdrawTool drops `setActiveTool` calls. Is there a parallel rule about scene mutations from non-tool components?

**Action for T14 brief author:** before writing Step 2, search for prior `updateScene({ elements: …filter… })` patterns in atlas-app + grep for any "no scene mutation outside tools" mulch convention. If found, T14 must route through a tool-side helper. If not, the plan literal stands.

**Note:** seedToElement.ts (Wave 1a) calls `excalidrawAPI.updateScene` to add elements. So the boundary, if it exists, isn't "no updateScene from non-tool code" — it's narrower. Most likely fine; verify in 5 minutes before T14 dispatch.

---

## 8. 10-point brief-author checklist (port from Wave 1)

For every Wave 2a/2b worker brief:

1. **Pin every plan literal** — file path + line number, verified against current HEAD.
2. **`code/` + `src/` segments present** in every path.
3. **Acceptance command** runnable from project root with `cd` chained.
4. **Pre-state files** that worker needs to read (not re-grep).
5. **Cross-worker file lock list** — name every file modified by sibling workers; if collision, serialize.
6. **Forbidden zones** — files worker MUST NOT touch (e.g., other tools' files, root configs).
7. **Test colocation rule** stated (matches PinTool — same dir as source, `*.test.ts`).
8. **Element factory verified** if creating Excalidraw elements (per `excalidraw-api.md` rule).
9. **AppState vs Props verified** if touching Excalidraw (per `excalidraw-api.md` rule).
10. **Mulch/seed cross-refs** for any decision the worker is asked to make (style of state, error reporting, etc.).

---

## 9. Open questions (carry into briefs)

- **OQ-W2-1 (Zustand/Module/Context):** USER DECISION — see §4.
- **OQ-W2-2 (ImportDialog):** drop reference or create file? Recommendation: drop; surface to user.
- **OQ-W2-3 (LayerStyle export source):** atlasdraw-fc04 says basemap pkg LayerStyle export missing. STYLE-COMPILER worker must resolve before exporting `compileLayer`.
- **OQ-W2-4 (T14 scene-mutation boundary):** verify in <5 min before T14 dispatch.

---

## 10. Recommended decision sequence

1. User picks Zustand/Module/Context (Option A/B/C). 30 seconds.
2. User confirms ImportDialog drop. 30 seconds.
3. Author Wave 2a-DEPS brief (single worker, dep install). Dispatch + commit.
4. Author Wave 2a-PARALLEL briefs (3 workers). Dispatch in single message. Verify + commit.
5. Author Wave 2b briefs: T12 parallel with T13→T14 serial. Dispatch. Verify + commit.
6. Wave 2 ship.

Estimated total: 2–3 hours of orchestration + worker time, assuming no surprises.
