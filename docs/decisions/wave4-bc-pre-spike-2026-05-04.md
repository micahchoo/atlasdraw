# Phase 2 Wave 4b + 4c — Pre-Spike Pack

**Date:** 2026-05-04
**Authored from:** post-Wave-4a-T17 ship state (commit `8579bc6`); T18 in-flight at write time.
**Companion to:** `docs/decisions/wave4-pre-dispatch-scrub-2026-05-04.md` (full scrub, scope decisions).
**Purpose:** every file shape, line range, API signature, and resolved OQ a Wave 4b/4c worker brief needs — so workers don't re-read source. Per `mx-7ef9cf` (PRE-SPIKE artifacts cut worker brief failure rate).

---

## Wave 4b — Visible UX polish + bug fix

**Brief-prep dependency for T22 + T23:** invoke skill `atlasdraw-ui-conventions` BEFORE writing button/panel CSS. Skill covers surface selection, color tokens, z-index ladder, button patterns, and the "slot first" rule. Existing Pin button at MapEditor.tsx:358 already follows the conventions; reuse its className references rather than reinventing styles.

### T22 — LayerPanel SidebarTrigger wiring

**Closes:** `atlasdraw-7748`. **Modifies:** `code/apps/atlas-app/src/components/MapEditor.tsx` only.

**State today:**
- `LayerPanel.tsx` (293 lines, `code/apps/atlas-app/src/components/`) is **already correct** — renders `<Sidebar name="layers">` with proper Header + Tabs structure. Verified header comment cites vendored Excalidraw v0.18 source paths.
- `<Sidebar>` short-circuits to null unless `appState.openSidebar?.name === "layers"`.
- `LayerPanel` is **not yet rendered** as a child of `<Excalidraw>` in MapEditor — that's what T22 wires.
- `excalidrawAPI.toggleSidebar({name:"layers"})` is on the ImperativeAPI (`code/packages/excalidraw/types.ts:963`).
- Pin-button pattern established at `MapEditor.tsx:358-371` — copy for the LayerPanel toggle:
  ```tsx
  <button
    type="button"
    className={...}
    onClick={() => excalidrawAPI?.toggleSidebar({ name: "layers" })}
    aria-pressed={appState?.openSidebar?.name === "layers"}
    data-testid="layers-toggle-button"
  >
    Layers
  </button>
  ```

**OQ-W4-4 RESOLVED:** Render `<LayerPanel/>` as a direct child of `<Excalidraw>`. Sidebar export at `code/packages/excalidraw/index.tsx:342` (`export { Sidebar } from "./components/Sidebar/Sidebar"`); Sidebar exposes static subcomponents (Header, Tabs, TabTriggers, Tab, Trigger, TabTrigger). `Object.assign`-pattern at Sidebar.tsx:162. **Not** wrap with `<Excalidraw.Sidebar>` — pass `<LayerPanel/>` as `children` and Excalidraw handles the slot.

**Brief skeleton:**
- File 1: `MapEditor.tsx` — wrap `<Excalidraw>{...}</Excalidraw>` to include `<LayerPanel/>` as child; add toggle button next to Pin button (top-left zone). Pull `appState` from a tracked state subscription if needed for `aria-pressed`.
- File 2: `MapEditor.layers-toggle.test.tsx` (in `__tests__/` per components convention; see existing LayerPanel.test.tsx, MapEditor.contextmenu.test.tsx, MapEditor.drop.test.tsx).
- Acceptance: render MapEditor, click button, assert sidebar visible.

---

### T23 — PNG export UI button

**Closes:** `atlasdraw-ca89`. **Modifies:** `code/apps/atlas-app/src/components/MapEditor.tsx` (serialize after T22 — both modify same file). **Imports:** `exportPNG` from `code/apps/atlas-app/src/lib/export.ts` (T15 ship).

**State today:** `exportPNG(map, excalidrawAPI, opts?): Promise<Blob>` exists at `code/apps/atlas-app/src/lib/export.ts`. No UI surface yet.

**Brief skeleton:**
- Add a button (use Pin/Layers button pattern) — `data-testid="png-export-button"`.
- Click handler: `await exportPNG(map, excalidrawAPI)` → `URL.createObjectURL(blob)` → invisible `<a download="atlasdraw-${Date.now()}.png">` → click → revokeObjectURL.
- Wrap call in try/catch; surface tainted-canvas errors (CORS-blocked basemap tiles) to user via simple alert or toast — T23 is the smoke-surface for the highest silent-fail risk in T15.
- Test: click flow doesn't throw; `URL.createObjectURL` called (mock).

**Browser smoke required after ship.** PNG export against real basemap tiles is the silent-fail risk T15 vitest mocks couldn't catch.

---

### T24 — Mixed-geometry FC handling [BUG FIX]

**Closes:** `atlasdraw-4142`. **Modifies:** `code/packages/basemap/src/style-compiler.ts` + `code/apps/atlas-app/src/components/MapEditor.tsx` (drop + handleConvert).

**Critical: SEMANTIC drift in current code.**

Current `inferGeometryType` at `MapEditor.tsx:53`:
```ts
function inferGeometryType(fc: FeatureCollection): "fill" | "line" | "circle" {
  const t = fc.features[0]?.geometry?.type;
  if (t === "Polygon" || t === "MultiPolygon") return "fill";
  if (t === "LineString" || t === "MultiLineString") return "line";
  return "circle";
}
```

This returns **MapLibre layer-type strings**, NOT GeoJSON geometry kinds. The function name implies geometry, the return type says layer. The bug: a mixed FC (Polygon + LineString + Point) renders ALL features through one MapLibre layer styled for `features[0]`'s type.

`compileLayer(id, style, geometryType)` at `style-compiler.ts:67` is a 69-line pure function that takes the caller-supplied geometryType.

**OQ-W4-5 RESOLVED:** sub-layers (recommended in plan; carry forward).

**Brief skeleton:**
- New helper in `style-compiler.ts`: `compileLayersForFC(id: string, style: LayerStyle, fc: FeatureCollection): LayerSpecification[]` — scans `fc.features`, deduplicates layer-types via `inferLayerType(geom.type)`, returns 1–3 layers under the same source filtered by `["==", ["geometry-type"], "Polygon"]` etc.
- Either rename existing `inferGeometryType` → `inferLayerType` in MapEditor.tsx OR expose `inferLayerType` from style-compiler so MapEditor can use it. Recommend exposing from style-compiler — single source of truth.
- `processGeoJsonDrop` (MapEditor.tsx:151): `compileLayer(...)` → `compileLayersForFC(...)`; iterate `map.addLayer` over each.
- `handleConvert` (MapEditor.tsx:266): same swap (single-geometry FCs always; less critical but consistent).
- Test: drop a mixed-geometry FC; assert all 3 geometry types render.

**Closes architectural orphan T28.2 too** (`atlasdraw-cc43` `compileLayer geometryType API`) — this refactor IS the API decision.

---

### T25 — TextLabelTool inline-editing UX

**Closes:** `atlasdraw-5193`. **Modifies:** `code/packages/tools/src/TextLabelTool.ts`. License header for tools pkg: `// SPDX-License-Identifier: MPL-2.0`.

**State today:** TextLabelTool is fire-and-forget — emits an empty text element via seed; `data: { text: "" }`. Header comment explicitly defers inline-editing as "host concern."

**Critical:** `setActiveTool` is on Excalidraw's ImperativeAPI (`types.ts:817, 960`); `focusContainer` at types.ts:793. The host bridge (`seedToElement`) creates the element from the seed; T25 needs the post-create focus-into-text-edit flow.

**Brief skeleton:**
- Two design options. Recommend (b):
  - (a) Modify TextLabelTool seed shape to include a `requestEdit: true` flag; bridge layer (in atlas-app, NOT in tools pkg per Q11 boundary) reads flag + dispatches `excalidrawAPI.setActiveTool({type:"text"})` + selects the new element.
  - (b) Cleaner — keep TextLabelTool unchanged; add a hook (or extend an existing one) in `code/apps/atlas-app/src/hooks/` that subscribes to `excalidrawAPI.onChange`, detects newly-created text elements with empty `text` field, and triggers edit mode.
- Test: existing TextLabelTool test + new case verifying text-edit-mode entered after emit.
- Risk: Excalidraw's text-edit mode is internal; setActiveTool({type:"text"}) sets the tool but doesn't focus a specific element. May need to dispatch a synthetic double-click, or use a more direct API (grep `editingElement` on AppState).

**Test convention:** tools pkg tests are colocated (`PinTool.test.ts` lives next to `PinTool.ts`). New test: `TextLabelTool.inline-edit.test.ts` colocated.

---

## Wave 4c — Hardening + cleanup

### T26 — zRef bounds + LayerStyle migration [CLEANUP, two parts]

**Closes:** `atlasdraw-02f6`, `atlasdraw-fc04`. **Modifies:** `code/packages/geo/src/parseGeoCustomData.ts` + `code/apps/atlas-app/src/state/layerRegistry.ts`.

**Part 1 — domain bounds in parseGeoCustomData:**

Current state (`parseGeoCustomData.ts`): only `isFiniteNumber` checks. No `[-180, 180]` lng or `[-90, 90]` lat or `0 ≤ zRef ≤ maxZoom` enforcement.

```ts
// Current pattern (line 50–52):
if (!isFiniteNumber(obj.lng)) fail("geo.lng: must be a finite number");
if (!isFiniteNumber(obj.lat)) fail("geo.lat: must be a finite number");
if (!isFiniteNumber(obj.zRef)) fail("geo.zRef: must be a finite number");
```

Add bounds (use existing `fail` helper):
```ts
if (!isFiniteNumber(obj.lng)) fail("geo.lng: must be a finite number");
if (obj.lng < -180 || obj.lng > 180) fail("geo.lng: must be in [-180, 180]");
if (!isFiniteNumber(obj.lat)) fail("geo.lat: must be a finite number");
if (obj.lat < -90 || obj.lat > 90) fail("geo.lat: must be in [-90, 90]");
if (!isFiniteNumber(obj.zRef)) fail("geo.zRef: must be a finite number");
if (obj.zRef < 0 || obj.zRef > 24) fail("geo.zRef: must be in [0, 24]");
```

(MapLibre default maxZoom is 24; if a different cap applies use that. zRef = 0 is world view, 24 is street level — finer than typical.)

Same bounds for `bbox` arms (west/east/north/south + zRef) and `polyline` coords.

**Part 2 — LayerStyle migration:**

Current: `code/apps/atlas-app/src/state/layerRegistry.ts:19` declares inline `interface LayerStyle { fillColor?, strokeColor?, strokeWidth?, opacity? }`.

Basemap exports it: `code/packages/basemap/src/index.ts:9` → `export type { LayerStyle } from "./style"`.

Brief: drop inline declaration; replace with `import type { LayerStyle } from "@atlasdraw/basemap";`. Verify shape matches (basemap's authoritative; atlas-app inline was a placeholder per the file's own header comment).

---

### T27 — Build/dep quality debt batch [CLEANUP, four items]

**Closes:** `atlasdraw-0c97`, `atlasdraw-dc84`, `atlasdraw-b733`, `atlasdraw-8a21`. Each item is one file edit.

| Item | File | Current state | Fix |
|---|---|---|---|
| `atlasdraw-dc84` (paths clobber) | `code/apps/atlas-app/tsconfig.json` | `"paths": {}` clobbers parent's `paths` from `tsconfig.base.json` | Remove `"paths": {}` line entirely; inherit from base. Verify `vitest`/`vite` still resolve `@atlasdraw/*` after removal. |
| `atlasdraw-b733` (vitest devDep) | `code/apps/atlas-app/package.json` | devDeps include `@playwright/test`, `@types/geojson`, `@types/react`, `@vitejs/plugin-react`, `sass`, `typescript`, `vite`. **No vitest** — currently hoisted from monorepo root. | Add `"vitest": "^X.Y.Z"` (use version from `code/package.json` root). |
| `atlasdraw-0c97` (husky postinstall) | `code/package.json` | husky postinstall expects `code/.git`. Repo root is at `/mnt/Ghar/2TA/DevStuff/atlasdraw/.git`, not `code/.git`. | Either: (a) skip husky when `code/.git` absent (`"prepare": "husky install || true"`); or (b) move `.husky/` to repo root + adjust path. Recommend (a) — least invasive. Worker greps current `prepare` script first. |
| `atlasdraw-8a21` (rootDir TS6059) | `code/packages/tools/tsconfig.json` | Bare `tsc --noEmit` fails with `TS6059` rootDir error; build masks it. | Worker reads existing tsconfig, identifies the rootDir mismatch, fixes either by adjusting `rootDir` or by adding files to `include`. |

Acceptance: each fix verified by running the relevant command (typecheck, install, build).

---

### T29/T30/T31 — Rule-0 retrofit [NEW; tracks atlasdraw-4ad2]

**Closes:** `atlasdraw-4ad2` (UI conventions retrofit; filed during 4b/4c prep audit). **Three independent migrations.**

The atlasdraw-ui-conventions skill audit (post-609896f) caught 3 Rule-0 ("Slot First, Create Never") violations in pre-conventions code. v0.18 already exposes the right slots; existing code created custom surfaces instead.

| Task | Migration | Slot API | Files |
|---|---|---|---|
| **T29** | Pin button → Excalidraw toolbar | `<Excalidraw renderTopLeftUI={() => <PinButton/>}>` (verified `code/packages/excalidraw/index.tsx:73,183`). Caveat: button placement vs event dispatch are SEPARATE seams per `mx-682f8a` — button can render via renderTopLeftUI while click logic still toggles `activeAtlasTool` and useAtlasdrawTool overlay still owns pointer dispatch. Also: add `font-weight: 600` per conventions. | MapEditor.tsx, MapEditor.module.css |
| **T30** | Convert action → Excalidraw element-context-menu | `excalidrawAPI.registerAction(action)` (verified `types.ts:955`; `ContextMenuItems` shape at `types.ts:57,276`). Eliminates ~30 lines of custom menu div + the `onContextMenu` root handler (smaller surface for drop-hijack-style bugs like d121188). | MapEditor.tsx (DELETE custom menu + onContextMenu) |
| **T31** | LayerPanel.tsx CSS-module migration | Create `code/apps/atlas-app/src/styles/LayerPanel.module.css`. Migrate 15+ inline `style={{}}` instances. Resolve 6 invented color tokens (#eee, #dbeafe/#1e3a8a, #888, #fef3c7/#92400e) against conventions table — likely needs to extend the table with documented data-layer + annotation badge color pairs. Add `data-testid` to 4 missing buttons. | LayerPanel.tsx, LayerPanel.module.css (NEW) |

**Sequencing:** T29 + T30 both modify MapEditor.tsx — **serialize** per Wave 2 OQ-W2-4 lesson. T31 independent.

**Acceptance:** `atlasdraw-ui-conventions` skill audit produces zero findings on Pin, Convert, LayerPanel. Atlas-app tests still pass. Manual browser smoke confirms visual integration (Pin in toolbar, Convert in native context menu, LayerPanel visually unchanged).

---

### T28 — Architectural orphans [CLEANUP, three decisions]

**Closes:** `atlasdraw-6e9a`, `atlasdraw-cc43`, `atlasdraw-cf62`. **Wait until after T24** if T24 reshapes `compileLayer` (resolves `cc43` indirectly).

| Item | Decision | Files | Recommended action |
|---|---|---|---|
| `6e9a` | `convertAnnotationToDataLayer` registry method dead-code (T14 pivoted to manual `registerDataLayer + remove`) | `code/apps/atlas-app/src/state/layerRegistry.ts` (interface + impl) | **DELETE** from `ILayerRegistry` interface + impl. Clean orphan. |
| `cc43` | `compileLayer(id, style, geometryType)` API shape | `code/packages/basemap/src/style-compiler.ts` | If T24 introduced `compileLayersForFC`, decide whether `compileLayer` stays (single-geometry case) or gets removed in favor of always-FC API. Recommend: keep `compileLayer` for direct single-geometry uses; `compileLayersForFC` calls into it internally. |
| `cf62` | RTL+vitest `globals: false` cleanup | `vitest.config.ts` (atlas-app + tools) | **OQ-W4-6 recommendation:** flip vitest `globals: true` (cheaper, scoped) over per-file `afterEach(cleanup)`. Worker verifies no test relies on `globals: false`. |

---

## Resolved OQ summary

| OQ | Status | Resolution |
|---|---|---|
| OQ-W4-1 (T18 arrow binding) | **RESOLVED** | Anchor by `points[]` regardless of binding state; bindings overlay. (Already in T18 brief.) |
| OQ-W4-2 (T19/T20 Playwright) | **RESOLVED** in scrub | `@playwright/test@^1.48.0` already in lockfile; use Playwright. |
| OQ-W4-3 (T21 style-builder) | **DEFERRED** to T21 worker | Decision-only task; worker decides per spec. |
| OQ-W4-4 (T22 Sidebar mount) | **RESOLVED** above | LayerPanel as direct `<Excalidraw>` child; toggle via `excalidrawAPI.toggleSidebar({name:"layers"})`. |
| OQ-W4-5 (T24 sub-layers vs reject) | **RESOLVED** above | Sub-layers via new `compileLayersForFC`. |
| OQ-W4-6 (T28 cleanup pattern) | **RESOLVED** above | Flip vitest `globals: true`. |

---

## Dispatch sequencing reminders (from scrub §3 + plan §1387)

```
4b-uxserialized: T22 → T23  (both modify MapEditor.tsx)
4b-uxparallel:    T24 || T25 (independent files)
4c-cleanup:       T26 → T27 → T28 (T28 depends on T24 ship)
```

**Manual browser smoke required after T22+T23+T24** — vitest doesn't simulate `<Sidebar>`'s appState handshake, doesn't catch tainted-canvas, doesn't render multi-layer geo. The `d121188` lesson (drop hijack + convert vanish) was caught only by browser smoke. Don't ship 4b without a smoke pass.

---

## Path-literal corrections to fold into briefs (already in scrub, recap)

- All `__tests__/` plan literals in `geo` and `apps/atlas-app/src/hooks/` → use **colocated** `*.test.ts(x)`. `apps/atlas-app/src/components/` and `apps/atlas-app/src/state/` use `__tests__/` subdir (existing convention).
- All paths prefixed `code/<pkg-or-app>/src/...` — never omit `src/`.

`[gate: pre-spike-clean]` — 7 tasks (T22–T28) covered with file shapes, line ranges, API verifications, and resolved OQs. Workers can write briefs from this without re-reading source.
