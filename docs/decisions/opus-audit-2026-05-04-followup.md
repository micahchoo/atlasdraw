# Opus Audit Follow-up — Phase 1 Waves 0+1
Date: 2026-05-04
Auditor: Opus (full perms, follow-up to permission-restricted 2026-05-04 audit)

## Acceptance gates (this run)

| Gate | Exit | Notes |
|---|---|---|
| typecheck (`yarn test:typecheck`) | **0** | `tsc` clean in 7.21s. No errors. |
| check-license (`bash scripts/check-license.sh`) | **0** | "All 14 packages have correct license fields" |
| check-patches (`bash scripts/check-patches.sh`) | **0** | Silent success (no vendored-file violations) |
| check-telemetry (`bash scripts/check-telemetry.sh`) | **0** | "No forbidden telemetry imports in OSS scan paths" |

All four gates GREEN. Worker reports verified.

## Plan adherence

### Task 3 (MapCanvas): **PARTIAL**

Plan (`docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md` §"Task 3: [Wave 1a] packages/basemap — MapCanvas Component"):
- Files to Create: `MapCanvas.tsx`, `BasemapRegistry.ts`, `pmtiles-protocol.ts`, `style-builder.ts`, `__tests__/MapCanvas.test.tsx`, `package.json`, `index.ts` (7 files).
- Step 1 mandates deps: `maplibre-gl`, `pmtiles`, peer: `react`.
- Skill: `characterization-testing`.

Met:
- `MapCanvas.tsx` (`code/packages/basemap/src/MapCanvas.tsx`) — clean React shell, useEffect lifecycle correct (`map.remove()` in cleanup return + StrictMode double-mount guard at lines 88-92, 113-116).
- `maxPitch: 0` + `pitchWithRotate: false` enforced at construction (lines 101-102) — OQ-2 invariant holds.
- `package.json` declares `maplibre-gl ^4.7.1` dep AND `react >=18.0.0` peer (good).
- `index.ts` re-exports `MapCanvas`.

Deferred (justified):
- None documented. The MapCanvas docstring says "Those land in later waves" for the stripped pieces — internal self-narration, not a tracked deferral.

Silent reductions (NOT in plan, NOT in any seeds issue or decision doc):
- **`BasemapRegistry.ts` missing** — no basemap registry, no PMTiles registration helper, no style builder.
- **`pmtiles-protocol.ts` missing** — `pmtiles` is not declared as a dependency. Plan Step 2 explicitly required it.
- **`style-builder.ts` missing.**
- **`__tests__/MapCanvas.test.tsx` missing** — characterization-testing skill not exercised.
- **package.json description is actively misleading**: `"MapLibre wrapper: MapCanvas, BasemapRegistry, pmtiles protocol, style compiler"` — three of the four pieces don't exist in the package.

### Task 4 (CoordinateSync): **PARTIAL**

Plan §"Task 4: [Wave 1b] packages/geo — CoordinateSync Skeleton + projection.ts":
- Files to Create: `CoordinateSync.ts`, `projection.ts`, `__tests__/CoordinateSync.test.ts`.
- Skill: `test-driven-development`. Step 1: "Write failing unit tests for `syncMapToScene`" with three explicit Test A/B/C cases.
- Downstream contract specifies a `syncMapToScene()` method.

Met:
- `CoordinateSync.ts` skeleton with `attach`/`detach` (idempotent reentrant — line 86 `if (this._map === map) return`; line 87 swap-detach), `subscribeToMapChanges`, `_captureViewState`.
- `projection.ts` with `projectPoint` + `unprojectPoint` thin delegates.
- Stubs clearly marked with `TODO(Wave2-Task5)` / `TODO(Wave2-Task6)` / `TODO(Wave2-Task7)` (lines 146-150, 171-174). JSDoc explains math intent and lifecycle.
- `tsconfig.json` `ignoreDeprecations` correctly fixed to `"5.0"`.
- `package.json` declares `maplibre-gl ^4.7.1` dev + optional peer.

Deferred (justified): Implementations of `geoToScene`/`sceneToGeo` correctly stubbed with `void` of args + sentinel returns — sound TDD-skeleton pattern.

Silent reductions:
- **TDD bypass**: Plan skill is `test-driven-development`, Step 1 mandates failing unit tests before implementation. **Zero tests exist** in `code/packages/geo/__tests__/` (only `types.test.ts` from Wave 0 exists in `src/`). The methodology requirement was skipped without justification.
- **Method naming drift from plan contract**: Plan downstream contract names `syncMapToScene()` and Wave 2 Task 5 expects to call it. Implementation provides `geoToScene(anchor)` + `sceneToGeo(scenePoint, zRef)` instead — different shape (per-element vs per-scene), no `excalidrawAPI.updateScene({captureUpdate: "never"})` call site. Wave 2 workers writing against the plan will reach for a method that doesn't exist.
- Constructor signature drift: Plan upstream contract says CoordinateSync receives `maplibregl.Map` AND `ExcalidrawImperativeAPI` at construction. Implementation uses an empty constructor and `attach(map)` post-hoc. Architecturally this is BETTER (decouples lifecycle), but it is undocumented as a deviation.

## Schema invariants (Lens 3)

- **MISMATCH-1/3/5: STILL HOLDING.** `code/packages/geo/src/types.ts:16-19` discriminated union with `kind` + `zRef` per variant; `customData.geo` (not `geoAnchor`); `projection: "mercator"` literal.
- **Geo contract↔impl alignment: PASS** for the post-update file. `docs/architecture/subsystems/geo/contracts.md` now correctly hoists `projection` to `GeoCustomData`, includes `schemaVersion: 1`, and explicitly states "projection is NOT a field on individual GeoAnchor variants." D-GEO-1, D-GEO-2 resolved. D-GEO-3 (`isGeoCustomData` documentation) — type guard exists in code (line 42-53 of types.ts) but contracts.md does not declare it as an export. Minor.
- **Tools contract↔impl alignment: DRIFTS REMAIN.** Only D-TOOLS-4 (renamed `ToolContext`) and D-TOOLS-6 (scoped `excalidraw` field) were addressed. The contract block still reads:

  ```ts
  export interface AtlasdrawTool {
    id: string;            // impl: readonly id
    icon: React.FC;        // impl: readonly icon: string
    cursor: string;        // impl: readonly cursor
    onPointerDown?(e: PointerEvent, ctx: ToolContext): void;  // impl: ToolPointerEvent
    onDoubleClick?(e: MouseEvent, ctx: ToolContext): void;    // impl: NOT IMPLEMENTED
    ...
  }
  ```

- **4 additional drifts (triage with canonical verdict):**
  - **D-TOOLS-1 (icon: React.FC vs string)** — IMPL is canonical for Phase 1 (matches the file's own "Phase 1: just a string identifier" comment); contract should be marked "Phase 1 deferred" with React.FC scheduled for Phase 6 UI work.
  - **D-TOOLS-2 (label field missing from contract)** — IMPL is canonical (additive, obvious UX need). Contract must add `readonly label: string` as required field.
  - **D-TOOLS-3 (onActivate/onDeactivate missing from contract)** — IMPL is canonical (lifecycle hooks are sound). Contract must add as optional.
  - **D-TOOLS-8 (onDoubleClick: contract has it, impl omits)** — CONTRACT is canonical for forward compatibility (tools will need it); IMPL must add as optional `onDoubleClick?(e: ToolPointerEvent, ctx: ToolContext): void`. Low effort, removes a future Excalidraw integration headache.
  - Bonus drift: **readonly modifier on `id`/`icon`/`cursor`** — IMPL is canonical (immutable tool definitions). Contract block should add `readonly`.
  - Bonus drift: **PointerEvent vs ToolPointerEvent** — IMPL is canonical (postMessage-safe boundary). Contract must adopt `ToolPointerEvent` and document its shape.

## Carry-forward risks

- **`isGeoCustomData` deep parser**: STILL SHALLOW (types.ts:42-53). Does not validate `geo.kind ∈ {"point","bbox","polyline"}` nor variant-specific fields. Wave 2 has no scheduled task for `parseGeoCustomData(value): Result<GeoCustomData, ParseError>`. Add a Wave 2 pre-task or accept the malformed-customData crash risk in Wave 2 element math.
- **`schemaVersion: 1` migration shim**: STILL MISSING. No `migrate(value, fromVersion)` identity function exists. First schema bump leaves persisted files unhandled. Add identity migrator before Phase 2 (collab/persistence) lands.
- **`react` peer-dep on `packages/tools`**: STILL IMPLICIT. `code/packages/tools/package.json` has `@types/react` as devDep but NO `peerDependencies` block at all. Works in monorepo via hoisting; breaks on external publish. (Note: `packages/basemap/package.json` DOES correctly declare `react >=18.0.0` peer — fix tools to match.)
- **`code/firebase-project/`**: AGREE KEEP. 4 files, 34 lines total, zero monorepo references, pristine upstream Excalidraw deployment config. The Sonnet verification rationale stands. Schedule explicit removal review at Phase 2 boundary, not now.
- **`zRef` bounds (`0 <= zRef <= maxZoom`)**: ABSENT EVERYWHERE. types.ts accepts `number` (any), CoordinateSync stubs accept `zRef: number` and `void` it. Negative or non-integer zRef will silently corrupt scale-mode math in Wave 2. Add boundary validation at the CoordinateSync `sceneToGeo` (and future `geoToScene`) call sites OR brand the type (`type ZRef = number & { __brand: "zRef" }` + factory).

## Wave 1 architectural review

- **MapCanvas lifecycle**: CORRECT. `useEffect` returns `() => { map.remove(); mapRef.current = null; }` (lines 113-116). StrictMode double-mount guard at lines 89-92. `map.once("load", ...)` at line 108 — `once` not `on`, so no leak. `[]` dep array with documented exclusions. No event leaks identified.
- **CoordinateSync stubs**: CLEARLY MARKED. `TODO(Wave2-Task5/6/7)` markers throughout, sentinel returns explained, JSDoc preserves the math intent (`map.project([lng, lat])` → pixel offset → scene coordinate when scroll offsets are identity). `attach`/`detach` are reentrant: `attach` no-ops on same map, swap-detaches on different map; `detach` safe to call when unattached. Subscriptions explicitly NOT auto-disposed by `detach` — documented and correct (caller owns subscription lifetime).
- **projection.ts semantic correctness**: CORRECT. The `[x, y]` tuple at `unprojectPoint` (line 67-68) carries an inline comment explaining MapLibre's `PointLike = Point | [number, number]` accepts tuple literals so TS infers the right type without a cast. This is semantically sound, not compiler-appeasing — `map.unproject([x, y])` is valid per MapLibre's `Map.unproject(point: PointLike)` signature. `projectPoint` mirrors with `map.project([lng, lat])`.
- **Cross-package contract**: COMPATIBLE. `MapCanvas.onMapReady?: (map: maplibregl.Map) => void` (line 47) hands a `maplibregl.Map`. `CoordinateSync.attach(map: MapLibreMap)` (line 85) takes the same nominal type via `import type { Map as MapLibreMap } from "maplibre-gl"`. The handoff `onMapReady={(m) => coordSync.attach(m)}` typechecks. No bridging adapter needed.

## Top 3 findings

1. **Task 4 violates its own TDD skill assignment.** Plan explicitly says `**Skill:** test-driven-development` with Step 1 = "write failing unit tests" (Tests A/B/C enumerated). Implementation has zero tests. Method names also drift (`geoToScene`/`sceneToGeo` vs plan contract's `syncMapToScene`), which means Wave 2 Task 5/6/7 workers reading the plan will write code calling a method that doesn't exist.

2. **Task 3 silently dropped 3 source files (BasemapRegistry, pmtiles-protocol, style-builder) and the test file.** No deferral noted in any seeds issue, decision doc, or HANDOFF. The package.json description still advertises all four pieces, making the silent reduction actively misleading to anyone navigating the package tree. `pmtiles` dep was also dropped from the plan's required deps list.

3. **Tools contract update was incomplete.** Worker fixed only D-TOOLS-4 + D-TOOLS-6. Five additional drifts (icon type, label, onActivate/onDeactivate, onDoubleClick direction, ToolPointerEvent, readonly modifiers) remain in `tools/contracts.md`. A Phase 3+ tool implementor reading the contract will get the wrong icon type, miss the label requirement, and may write `onDoubleClick` handlers that won't be called.

## Verdict

**CONDITIONAL on Wave 2 dispatch.** Green gates are necessary but not sufficient — methodology bypass (TDD skipped on the only TDD-tagged Wave 1 task), scope reduction without tracking, and a method-name drift that will break Wave 2 workers all need closure first.

### Required before Wave 2 dispatches

1. **Resolve `syncMapToScene` naming.** Either:
   - Rename `geoToScene`+`sceneToGeo` to add a `syncMapToScene(elements, excalidrawAPI)` orchestrator that matches the plan's downstream contract; OR
   - Update plan §Task 4/5/6/7 downstream contract to reference the actual `geoToScene`/`sceneToGeo` per-element API.
   This MUST be settled before Wave 2 task dispatch — workers will write broken code otherwise.

2. **Either write Task 4 tests OR file a seeds issue waiving Wave 1 TDD with explicit rationale.** Three failing tests (A/B/C) per plan Step 1 take ~30 min. The cost-of-skipping ratchets up linearly as Wave 2 implements against an untested skeleton.

3. **Finish `tools/contracts.md` alignment.** Update icon type to `string` (with Phase 6 React.FC migration note), add `label`, `onActivate`/`onDeactivate`, switch `PointerEvent`→`ToolPointerEvent`, add `readonly` modifiers, decide canonical direction on `onDoubleClick` (recommend: keep in contract, add to impl). Mark contract status `"fully aligned"` or downgrade Wave 0 stability tier if not.

4. **Add `react >=18` peerDep to `code/packages/tools/package.json`.** Two-line fix; matches what basemap already does correctly.

5. **File seeds issues for the Task 3 deferrals** (BasemapRegistry, pmtiles-protocol, style-builder, MapCanvas.test.tsx). Either schedule them into Wave 2/3 or accept-and-document that the basemap package will not gain tile-protocol or registry capability before Phase 2. Update the package.json description to match reality.

### Non-blocking but should be tracked

- `isGeoCustomData` deep-parser (Wave 2 pre-task).
- `schemaVersion` identity migration shim (Phase 2 pre-task).
- `zRef` bounds validation (Wave 2 boundary check).
- `firebase-project/` removal review (Phase 2 boundary).
