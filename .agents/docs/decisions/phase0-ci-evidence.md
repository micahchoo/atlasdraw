# Phase 0 + Wave 0 Verification Evidence
Date: 2026-05-04
Auditor: Sonnet 4.6 (re-run after Opus audit was permission-restricted)

## Acceptance Gates

| Gate | Command | Exit | Notes |
|---|---|---|---|
| install | `yarn install` | **0** | "Already up-to-date." Strip-ansi resolution warnings (3x) — non-fatal, pre-existing. husky installed. |
| typecheck | `yarn test:typecheck` (→ `tsc`) | **0** | Clean in 7.36s. No errors. |
| check-license | `bash scripts/check-license.sh` | **0** | "All 14 packages have correct license fields" |
| check-patches | `bash scripts/check-patches.sh` | **0** | Silent success (no output = no violations) |
| check-telemetry | `bash scripts/check-telemetry.sh` | **0** | "No forbidden telemetry imports in OSS scan paths" |

All 5 gates PASS.

---

## firebase-project/ disposition

- **Contents:** `firebase.json`, `.gitignore`, `.firebaserc`, `firestore.rules`, `storage.rules`, `firestore.indexes.json` (6 files, no subdirectories, no `functions/`)
- **References found:** Zero. `grep -r 'firebase-project'` across all `*.json`, `*.ts`, `*.js` in the monorepo returns nothing. Not in any `package.json` workspace, not imported by any app or package.
- **Git history:** One commit: `2dfcc6f chore: Remove startBoundElement from state (#11264)` — this is an upstream Excalidraw commit. No Phase 0 commits touched `firebase-project/`.
- **Verdict:** KEEP (with annotation)
- **Rationale:** This is pristine upstream Excalidraw firestore deployment config — their Firebase Hosting + Firestore rules for the excalidraw.com live app. It is not a `functions/` directory (no Cloud Functions code), not wired into any monorepo workspace, and not referenced by any Phase 0 or Phase 1 code. The Firebase SDK strip in plan task 9b correctly no-op'd `excalidraw-app/data/firebase.ts` (the runtime SDK calls) while leaving this deployment config untouched. KEEP for now — it carries no runtime cost and preserves upstream sync fidelity. Flag for explicit removal at Phase 2 if the team confirms `excalidraw-app/` will be fully replaced by `apps/atlas-app/`.

---

## Geo contracts drift

**contracts.md asserts** (`docs/architecture/subsystems/geo/contracts.md`):

```ts
// GeoAnchor — each variant carries `projection: "mercator"` inline
type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number; projection: "mercator" }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number; projection: "mercator" }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number; projection: "mercator" };
```

**types.ts implements** (`code/packages/geo/src/types.ts`):

```ts
// GeoAnchor — NO `projection` field on variants; projection hoisted to GeoCustomData wrapper
type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };

type GeoCustomData = {
  geo: GeoAnchor;
  scaleMode: ScaleMode;
  projection: "mercator";  // <-- projection here, not on each variant
  schemaVersion: 1;
};
```

**Drifts:**

| # | Field / Type | Contract says | Implementation has | Severity |
|---|---|---|---|---|
| D-GEO-1 | `projection` placement | Inline on each `GeoAnchor` variant (`point`, `bbox`, `polyline`) | Hoisted to `GeoCustomData` wrapper; absent from `GeoAnchor` variants | **Medium** — structurally equivalent (projection is still enforced), but consumers narrowing on `GeoAnchor` alone won't see `projection`. Any code that reads `anchor.projection` directly will fail to typecheck. |
| D-GEO-2 | `GeoCustomData.schemaVersion` | Not mentioned in contracts.md | Present in implementation (`schemaVersion: 1`) | **Low** — additive field, aids future migrations. Contract should be updated to include it. |
| D-GEO-3 | `isGeoCustomData` type guard | Not in contracts.md | Exported from types.ts | **Low** — additive export. Contract should declare it. |
| D-GEO-4 | `ScaleMode` type | Declared in contracts.md as `"geographic" \| "screen" \| "hybrid"` | Matches exactly | None |
| D-GEO-5 | `CoordinateSync`, `geoToExcalidraw`, `excalidrawToGeo`, `projectElement`, `measure.*`, `bounds` | All declared in contracts.md | **None implemented yet** — types.ts only contains type aliases + type guard | **Info** — these are Phase 3+ stubs per the plan. Not a Wave 0 failure; contract correctly marks these "stable" as forward declarations. |

**Root cause of D-GEO-1:** The implementation made a sound architectural choice — `projection` as a wrapper-level field is cleaner (one assertion point, single source of truth). The contract was written before this refinement. The contract is the artifact that needs updating, not the implementation.

---

## Tools contracts drift

**contracts.md asserts** (`docs/architecture/subsystems/tools/contracts.md`):

```ts
// AtlasdrawTool — contracts.md version
interface AtlasdrawTool {
  id: string;
  icon: React.FC;          // SVG icon React component
  cursor: string;

  onPointerDown?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onPointerMove?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onPointerUp?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onDoubleClick?(e: MouseEvent, ctx: AtlasdrawToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: AtlasdrawToolContext): void;
}

// AtlasdrawToolContext — contracts.md version
interface AtlasdrawToolContext {
  map: maplibregl.Map;           // full MapLibre instance
  excalidrawAPI: ExcalidrawAPI;
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  coordinateSync: CoordinateSync;
}
```

**types.ts implements** (`code/packages/tools/src/types.ts`):

```ts
// AtlasdrawTool — implementation version
interface AtlasdrawTool {
  readonly id: string;
  readonly label: string;        // <-- ADDED (user-facing label)
  readonly icon: string;         // <-- CHANGED: string identifier, not React.FC
  readonly cursor: string;

  onActivate?(ctx: ToolContext): void;    // <-- ADDED lifecycle hook
  onDeactivate?(ctx: ToolContext): void;  // <-- ADDED lifecycle hook
  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void;   // event type changed
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
  // onDoubleClick NOT implemented
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
}

// ToolContext (renamed from AtlasdrawToolContext) — implementation version
interface ToolContext {
  readonly map: { project, unproject, getZoom, getBounds };  // scoped subset, not full Map
  readonly excalidraw: { addElement, updateElement, getActiveTool };  // scoped, renamed
  readonly ui: { showPopup, setStatusBarMessage };
}

// Additional types NOT in contracts.md:
interface ToolPointerEvent { ... }         // custom postMessage-safe event type
interface AtlasdrawElementSeed { ... }     // element creation payload
type ToolRegistry = ReadonlyMap<string, AtlasdrawTool>;
```

**Drifts:**

| # | Field / Type | Contract says | Implementation has | Severity |
|---|---|---|---|---|
| D-TOOLS-1 | `icon` type | `React.FC` (React component) | `string` (identifier/path) | **Medium** — contract says component, impl says string. Phase 1 deferral is intentional (comment in file: "Phase 1: just a string identifier"). Will need reconciling before Phase 6 UI work. |
| D-TOOLS-2 | `label` field | Not in contract | `readonly label: string` | **Low** — additive. Obvious UX need. Contract should declare it. |
| D-TOOLS-3 | `onActivate` / `onDeactivate` | Not in contract | Both added as optional lifecycle hooks | **Low** — additive, sound design. Contract should declare them. |
| D-TOOLS-4 | Context name | `AtlasdrawToolContext` | `ToolContext` (renamed) | **Medium** — name divergence. Consumers following contracts.md would import wrong name. Should align: either update contract to `ToolContext` or rename impl to `AtlasdrawToolContext`. |
| D-TOOLS-5 | `map` in context | `maplibregl.Map` (full instance) | Scoped subset `{ project, unproject, getZoom, getBounds }` | **Low** — impl is deliberately more restrictive (postMessage-safe, avoids heavy import). Better design; contract needs update. |
| D-TOOLS-6 | `excalidrawAPI` / `elements` / `appState` | Three separate fields on context | Merged into `readonly excalidraw: { addElement, updateElement, getActiveTool }` | **Medium** — structural refactor. Contract's `ExcalidrawAPI` / `AppState` types would force importing Excalidraw internals into tools package. Impl avoids this correctly. Contract is architecturally weaker here. |
| D-TOOLS-7 | `coordinateSync` on context | `CoordinateSync` field present | Absent from `ToolContext` | **Low** — may be intentional deferral (CoordinateSync not yet implemented). Watch for Phase 3. |
| D-TOOLS-8 | `onDoubleClick` handler | Optional `onDoubleClick?(e: MouseEvent, ctx): void` | Not implemented | **Low** — omission, not conflict. Can be added without breaking change. |
| D-TOOLS-9 | `ToolPointerEvent` | Not in contract (uses raw `PointerEvent`) | Custom `ToolPointerEvent` interface (postMessage-safe subset) | **Low** — better design for plugin boundary. Contract should adopt this. |
| D-TOOLS-10 | `AtlasdrawElementSeed` | Not in contract | Exported from types.ts | **Low** — additive. Core to how tools create elements. Contract should declare it. |
| D-TOOLS-11 | `ToolRegistry` | `Tool Registry` section exists in contracts.md, shape unspecified | `ReadonlyMap<string, AtlasdrawTool>` | **Low** — implementation made a concrete choice. Contract should formalize. |

---

## Top findings

1. **All 5 Phase 0 acceptance gates PASS** — `yarn install` (exit 0), `yarn test:typecheck` (exit 0, clean in 7.36s), `check-license` (14 packages correct), `check-patches` (clean), `check-telemetry` (clean). No blockers.

2. **GEO D-GEO-1 is the only meaningful drift** — `projection` was correctly hoisted from per-variant to the `GeoCustomData` wrapper. The implementation is architecturally sound; the contracts.md definition is outdated. Any Phase 3+ consumer written against contracts.md would try to read `anchor.projection` and fail. The contract must be updated before Phase 3 dispatch.

3. **TOOLS D-TOOLS-4 and D-TOOLS-6 are the highest-risk tool drifts** — the context type is renamed (`AtlasdrawToolContext` → `ToolContext`) and structurally refactored (three loose fields → two scoped namespaces). Both decisions are good, but the contract divergence will confuse Phase 3+ implementors who read contracts.md expecting the old shape. Update contracts.md before any tool implementations begin.

4. **firebase-project/ is KEEP** — pristine upstream Excalidraw deployment config, zero monorepo references, not touched by any Phase 0 commit. No runtime impact. Schedule explicit removal review at Phase 2 boundary.

5. **Recommendation: GO for Wave 1 dispatch**, conditioned on contracts.md updates (GEO D-GEO-1, TOOLS D-TOOLS-4, D-TOOLS-6) being filed as a Wave 1 pre-dispatch task. These are doc-only corrections — no code changes needed. All executable gates are green.
