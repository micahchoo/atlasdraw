# Phase 1 — Open Questions Research Notes

**Date:** 2026-05-03
**Researcher:** open-questions-resolver agent
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md`
**Status:** OQ-2, OQ-3, OQ-4, OQ-5 resolved. OQ-1 still open pending Task 16 benchmark.

---

## OQ-1 — Incremental projection under benchmark failure (Q8 escape hatch)

**Status:** STILL OPEN

**Queries run:**
- `MapLibre GL JS MercatorCoordinate worker offload projection`
- `Excalidraw updateScene performance bottleneck 5k elements`

**Why still open:**
OQ-1 asks which incremental projection strategy to use if Task 16 benchmark fails (p99 >= 16ms). This question is unanswerable without Task 16 data. Three candidates exist:
- Candidate A: viewport-bbox filter (only project elements in view)
- Candidate B: Worker offload via `MercatorCoordinate` math
- Candidate C: dirty-bit per element (only re-project changed anchors)

The correct choice depends on whether the bottleneck is `map.project()` call count or `scene.replaceAllElements()` full-scene cost. OQ-3 resolution (see below) establishes that `replaceAllElements` always does a full rebuild — so if updateScene is the bottleneck, the diff strategy (Candidate C + partial element pass) is needed; if map.project() is the bottleneck, Candidates A or B apply. Task 16 must instrument both segments separately before any strategy is selected.

**Decision rule added to plan:** Task 16 instruments `map.project()` loop time and `updateScene()` call time separately. Strategy chosen at Phase 1 closure based on which segment dominates. No pre-pick.

**Confidence:** N/A — deferred by design.

---

## OQ-2 — Does `map.project()` return accurate results under pitch/tilt?

**Status:** RESOLVED

**Queries run:**
- `MapLibre GL JS map.project pitch perspective correction`
- `maplibre-gl-js/src/geo/projection/mercator_transform.ts locationToScreenPoint`
- `maplibre-gl-js/src/ui/map.ts project method source`

**Sources (primary):**
1. `https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/ui/map.ts` — `map.project()` implementation, commit `fd31bd85`. Call chain: `project(lnglat)` → `transform.locationToScreenPoint(LngLat.convert(lnglat), this.style && this.terrain)`.
2. `https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/geo/projection/mercator_transform.ts` — `locationToScreenPoint` and `coordinatePoint` implementations.

**Key findings:**
- `locationToScreenPoint(lnglat, terrain?)` calls `coordinatePoint(MercatorCoordinate.fromLngLat(lnglat))` (no terrain) or `coordinatePoint(coord, elevation, this._pixelMatrix3D)` (with terrain).
- `coordinatePoint(coord, elevation, pixelMatrix)` does: `vec4.transformMat4(p, p, pixelMatrix)` then returns `new Point(p[0]/p[3], p[1]/p[3])` — a full 4D perspective divide.
- `_pixelMatrix` is constructed as `clipSpaceToPixelsMatrix × viewProjectionMatrix` where the view-projection matrix includes camera pitch/tilt. With pitch > 0, the tilt is baked into `_pixelMatrix`.
- Result: **`map.project()` IS perspective-correct at any pitch.** The plan's premise ("does not account for perspective") was wrong.
- The GitHub issues tracker shows no bugs about `map.project()` returning wrong results at pitch > 0 for Mercator projection (only globe/terrain edge cases).

**Decision:**
The original question was whether to add a `CoordinateSync` runtime assertion `map.getPitch() === 0`. The corrected answer: enforce `pitch: 0` at the MapLibre boundary via `MapOptions` (`maxPitch: 0`, `pitchWithRotate: false`) in `MapCanvas` constructor, not in CoordinateSync. This is cleaner (constraint at source), keeps CoordinateSync projection-agnostic, and allows Phase 2 to simply raise `maxPitch` if tilt is ever added.

**Tasks edited:** Task 3 Step 5 — added `maxPitch: 0` and `pitchWithRotate: false` to MapOptions at MapCanvas construction.

**Confidence:** HIGH — primary source inspection of production code on `main` branch.

---

## OQ-3 — What is the actual cost of `excalidrawAPI.updateScene` for 5k elements?

**Status:** RESOLVED

**Queries run:**
- `excalidraw/packages/excalidraw/components/App.tsx updateScene captureUpdate NEVER`
- `excalidraw/packages/element/src/Scene.ts replaceAllElements triggerUpdate`
- `excalidraw/packages/excalidraw/index.tsx reconcileElements export`

**Sources (primary):**
1. `https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/components/App.tsx` — `updateScene` at line 4559, `captureUpdate: NEVER` behavior.
2. `https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/element/src/Scene.ts` — `replaceAllElements` at line 271, `triggerUpdate` at line 300.
3. `https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/index.tsx` — `reconcileElements` exported from `./data/reconcile` (confirming reconciliation is a separate code path, not called by `updateScene`).

**Key findings:**
- `updateScene` with `captureUpdate: "never"` (= `CaptureUpdateAction.NEVER`): `scheduleMicroAction` is only called when `captureUpdate` is truthy → NEVER skips the Store entirely. No undo/redo entry created.
- `updateScene` always calls `this.scene.replaceAllElements(elements)` when `elements` is provided — no element-identity diff or short-circuit.
- `Scene.replaceAllElements()` rebuilds the internal `nonDeletedElements` array and `nonDeletedElementsMap`, then always calls `this.triggerUpdate()` at line 300 — unconditionally, no diff.
- **Conclusion:** `captureUpdate: "never"` saves only the undo-stack capture work. It does NOT skip the full scene rebuild or the canvas re-render. Every `updateScene({ elements: allElements })` call is an O(n) array rebuild + full canvas re-render trigger.
- `reconcileElements` (exported from `./data/reconcile`) is the CRDT reconciliation path used for collaboration — it is NOT called by `updateScene` directly. The concern about "reconciliation cost" in the original OQ was a false alarm; there is no reconciliation on every updateScene call, but there IS a full scene replacement.

**Impact on Task 16:**
- Task 16 benchmark must instrument `map.project()` loop separately from `updateScene()` call time.
- The `updateScene` full-scene-rebuild cost means that passing only the changed elements (rather than the full array) would be a significant win if `updateScene` is the bottleneck. This is the Candidate C strategy from OQ-1.
- fast-check confirmed at v4.7.0 on npm registry — no version pinning issue.

**Tasks edited:** OQ-3 resolution text in plan. No task steps changed (Task 16 already calls for instrumenting both segments).

**Confidence:** HIGH — primary source inspection of production code on `master` branch.

---

## OQ-4 — PinTool popup lifecycle: MapLibre popup or React portal?

**Status:** RESOLVED

**Queries run:**
- `maplibregl.Popup setDOMContent React portal lifecycle`
- `MapLibre Popup API setDOMContent`
- Protomaps/MapLibre docs review

**Sources:**
1. MapLibre GL JS API docs — `maplibregl.Popup` supports `.setDOMContent(htmlNode)` allowing any DOM element as popup content.
2. Phase plan Task 14 — popup is minimal for Phase 1 (label + lat/lng only).
3. Architecture principle — avoid React-in-MapLibre complexity until needed.

**Key findings:**
- `maplibregl.Popup` with `.setDOMContent()` supports arbitrary HTML including React-rendered nodes. Phase 2 can upgrade by calling `ReactDOM.createRoot(popupNode)` on the Popup's DOM container.
- React portal approach requires injecting a second React root and managing its lifecycle alongside the map's event system — meaningful added complexity for Phase 1's simple label display.
- The upgrade path is clean: write `PinPopup.tsx` as a plain React component (`{ lngLat, label }` props only), use `maplibregl.Popup` in Phase 1, mount the component via `ReactDOM.createRoot` in Phase 2 when richer content is needed.

**Decision:** Native `maplibregl.Popup` for Phase 1. `PinPopup.tsx` constrained to `{ lngLat, label }` props only — no internal map references — to preserve portability.

**Tasks edited:** Task 14 Step 3 — added OQ-4 constraint note on props and Phase 2 upgrade path.

**Confidence:** HIGH — architectural reasoning from primary source behavior; no ambiguity in upgrade path.

---

## OQ-5 — Should `bounds.ts` be deferred to Phase 2?

**Status:** RESOLVED

**Queries run:**
- Phase 1 file structure review — `bounds.ts` listed but no consuming task
- Phase 2 plan cross-check for first consumer

**Sources:**
1. Phase 1 plan file structure (line 165): `bounds.ts [NEW]` listed without a task.
2. Tech spec §4.1 — `packages/geo` public surface.
3. `open-questions-resolution.md` Q13 — Phase 2 data layers are the first real consumer of scene bounds.

**Key findings:**
- Implementation is ~5 lines: iterate elements, filter by `customData.geo`, union coordinate extents.
- Interface risk if deferred: `GeoAnchor` type may evolve between Phase 1 and Phase 2, making a later implementation harder to get right.
- The `index.ts` barrel already lists `bounds` as an export (line 629 in current plan), so the export surface is already committed. Not implementing it creates a broken export.
- Cost is negligible: one function, one null-case unit test.

**Decision:** Implement as Task 10 add-on. Create `packages/geo/bounds.ts` exporting `computeSceneBounds(elements: ExcalidrawElement[]): LngLatBounds | null`.

**Tasks edited:** Task 10 — added Step 5 (bounds.ts implementation), Step 6 (index.ts export updated), renumbered existing Steps 5–7 to 6–8. Files list updated.

**Confidence:** HIGH — implementation is trivial; deferral creates broken export and interface drift risk.

---

## Summary Table

| Q | Status | Confidence | Tasks Edited |
|---|--------|-----------|--------------|
| OQ-1 | STILL OPEN — awaits Task 16 benchmark | N/A | None (decision rule added to OQ text) |
| OQ-2 | RESOLVED — `map.project()` IS perspective-correct; enforce via `maxPitch: 0` in MapOptions | HIGH | Task 3 Step 5 |
| OQ-3 | RESOLVED — `updateScene` always does full scene rebuild; `captureUpdate: NEVER` skips only undo-stack | HIGH | None (Task 16 already covers; OQ text updated) |
| OQ-4 | RESOLVED — native `maplibregl.Popup` for Phase 1; `PinPopup.tsx` props-only for portability | HIGH | Task 14 Step 3 |
| OQ-5 | RESOLVED — implement `bounds.ts` as Task 10 add-on; ~5 lines | HIGH | Task 10 (Step 5 added, Steps 6–8 renumbered) |
