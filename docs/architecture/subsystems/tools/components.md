# `packages/tools` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0 (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/tools`
**Phase skeleton:** Phase 0; PinTool Phase 1; full tool suite Phase 2; RouteSnapTool Phase 4

---

## Overview

`packages/tools` provides geo-aware drawing tools registered as Excalidraw `customType` tools. Each tool is a plain object implementing the `AtlasdrawTool` interface — no class hierarchy. Tool logic lives in Atlasdraw handler functions; Excalidraw's built-in tool system is used only for registration (`setActiveTool({ type: "custom", customType: id })`). No React in this package — tools interact with React components through the injected `AtlasdrawToolContext`.

---

## Major Files and Responsibilities

### `types.ts`
**Phase:** Phase 1 [Phase 1 plan, Task "packages/tools skeleton"]
**Responsibility:** Defines `AtlasdrawTool` interface and `AtlasdrawToolContext` injection shape.

```ts
interface AtlasdrawTool {
  id: string;
  icon: React.FC;          // SVG icon component (from apps/atlas-app/assets)
  cursor: string;          // CSS cursor value
  onPointerDown?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onPointerMove?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onPointerUp?(e: PointerEvent, ctx: AtlasdrawToolContext): void;
  onDoubleClick?(e: MouseEvent, ctx: AtlasdrawToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: AtlasdrawToolContext): void;
}

interface AtlasdrawToolContext {
  map: maplibregl.Map;
  excalidrawAPI: ExcalidrawAPI;
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  coordinateSync: CoordinateSync;  // for freeze/thaw during drawing
}
```

**Complexity:** ~50 lines, cyclomatic 1
[CONFIDENCE: high — per Phase 1 plan, tech spec §4.4]

### `PinTool.ts`
**Phase:** Phase 1 [Phase 1 plan, Task 4 + Task "PinTool skeleton"]
**Responsibility:** Single-click geo-anchor tool. On `onPointerDown`, unprojects the click coordinate from screen to `LngLat`, creates a pin Excalidraw element with `customData.geo = { kind:"point", lng, lat, zRef:currentZoom, projection:"mercator" }` and `scaleMode:"screen"`. Immediately committed (no drag phase).
**Dependencies:** `types.ts`, `packages/geo` (`GeoAnchor`); external: `maplibre-gl`, Excalidraw element types
**Complexity:** ~80 lines, cyclomatic ~4
[CONFIDENCE: high — per Phase 1 plan, tech spec §4.4]

### `PolygonTool.ts`
**Phase:** Phase 2 [Phase 2 plan, Task T03 "Wave 1 — Polygon Tool"]
**Responsibility:** Click-to-add-vertex polygon tool. Accumulates vertex clicks in local state. Double-click closes the ring (first coordinate === last coordinate), creates an Excalidraw element with `customData.geo = { kind:"polyline", coordinates:closedRing, zRef, projection:"mercator" }` and `scaleMode:"geographic"`. Calls `coordinateSync.freeze()` on first vertex, `thaw()` on commit.
**Dependencies:** `types.ts`, `packages/geo`
**Complexity:** ~120 lines, cyclomatic ~8
[CONFIDENCE: high — per Phase 2 plan Task T03]

### `LineTool.ts`
**Phase:** Phase 2 [Phase 2 plan]
**Responsibility:** Click-to-add-vertex polyline tool. Similar to PolygonTool but produces an open `"polyline"` GeoAnchor (no ring closure). Double-click or Enter commits.
**Dependencies:** `types.ts`, `packages/geo`
**Complexity:** ~100 lines, cyclomatic ~7
[CONFIDENCE: med — implied by Phase 2 tool suite; exact task number not cited]

### `MeasureTool.ts`
**Phase:** Phase 2 [Phase 2 plan, Task T08]
**Responsibility:** Click-to-add-vertex measurement tool. Renders a temporary polyline while drawing. On each vertex add, calls `measure.length(element)` from `packages/geo` and updates a floating label element in the Excalidraw scene. Committed element retains the label. Read-only output (label not editable as text).
**Dependencies:** `types.ts`, `packages/geo` (`measure.length`); external: Excalidraw element types
**Complexity:** ~130 lines, cyclomatic ~9
**Hot-path:** `onPointerMove` calls `measure.length` on every mouse move during drawing.
[CONFIDENCE: med — Phase 2 plan references measure tool; exact file structure extrapolated]

### `AreaTool.ts`
**Phase:** Phase 2 [Phase 2 plan]
**Responsibility:** Polygon tool variant that additionally calls `measure.area()` from `packages/geo` on commit and attaches an area label element.
**Dependencies:** `types.ts`, `packages/geo` (`measure.area`)
**Complexity:** ~100 lines, cyclomatic ~7
[CONFIDENCE: med — implied; extrapolated from spec mention of area measurement]

### `RouteSnapTool.ts`
**Phase:** Phase 4 [Phase 4 plan; feature-flagged off by default per tech spec §4.4]
**Responsibility:** Freehand-to-road-snapping tool. Captures a sequence of `onPointerMove` coordinates, then at `onPointerUp` sends an interpolation request to a configured OSRM/Valhalla endpoint. The returned road geometry replaces the freehand stroke. Element committed with `customData.geo = { kind:"polyline", coordinates:routeCoords, zRef, projection:"mercator" }`. Feature-flagged: does not activate unless `VITE_ROUTING_ENDPOINT` is set.
**Dependencies:** `types.ts`, `packages/geo`; external: `fetch` (OSRM/Valhalla HTTP), optional `maplibre-gl`
**Complexity:** ~180 lines, cyclomatic ~14 (network error handling, partial route cases)
**Hot-path:** None during drawing; the network request at commit is the bottleneck.
[CONFIDENCE: high — per tech spec §4.4 "route-snap (Phase 4): sends interpolation requests to OSRM/Valhalla; feature-flagged"]

### `tool-registry.ts`
**Phase:** Phase 2 [Phase 2 plan, Task T09 "Full Tool Registry"]
**Responsibility:** The central tool registry. Maps tool IDs to `AtlasdrawTool` objects. Called by `apps/atlas-app/components/MapEditor` to register all tools with Excalidraw's `customTools` prop.

```ts
export const toolRegistry: Map<string, AtlasdrawTool>
export function registerTool(tool: AtlasdrawTool): void
export function getTools(): AtlasdrawTool[]
```

**Endorheic basin:** Module-level `Map`. Populated on import via `registerTool()` calls in each tool file. No flush mechanism — tools are registered once for the session.
**Complexity:** ~40 lines, cyclomatic ~2
[CONFIDENCE: high — per Phase 2 plan Task T09]

### `index.ts`
**Phase:** Phase 0 (skeleton), Phase 2+ (populated)
**Responsibility:** Barrel export. Also calls `registerTool()` for each tool so the registry is populated on import.
**Complexity:** ~30 lines

---

## Cross-Subsystem Notes

- `apps/atlas-app/components/MapEditor.tsx` passes `getTools()` to Excalidraw's `customTools` prop and dispatches pointer events to the active tool.
- `packages/geo/CoordinateSync.freeze()/thaw()` is called by drawing tools to suppress camera sync during active stroke.
- `packages/geo/measure` is called by `MeasureTool` and `AreaTool` on pointer-move and commit.
