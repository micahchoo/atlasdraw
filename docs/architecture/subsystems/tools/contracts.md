# `packages/tools` — Contracts

<!-- updated 2026-05-04: aligned with Wave 0 implementation; see decisions/phase0-ci-evidence.md drifts D-GEO-1 (geo), D-TOOLS-4/6 (tools). Implementation is canonical. -->

**Status: Wave 0 implementation-aligned.** Speculative pre-code contracts updated against real code.

**License:** MPL-2.0 (per Q5)
**Package name:** `@atlasdraw/tools`

---

## Public Export Surface

### `AtlasdrawTool` interface — **stable**
[CONFIDENCE: high — per tech spec §4.4, Phase 1 plan]

```ts
export interface AtlasdrawTool {
  /** Unique string identifier for setActiveTool({ type: "custom", customType: id }) */
  id: string;
  /** SVG icon React component displayed in the toolbar */
  icon: React.FC;
  /** CSS cursor string while this tool is active */
  cursor: string;

  onPointerDown?(e: PointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: PointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: PointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: MouseEvent, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
}
```

**Backward-compat:** All handler methods are optional. New optional methods may be added in minors. `id`, `icon`, `cursor` are required and frozen.

---

### `ToolContext` interface — **stable**
[CONFIDENCE: high — per tech spec §4.4]

```ts
export interface ToolContext {
  /** MapLibre instance — tools use only `project` / `unproject` / `getZoom`. Other access is discouraged. */
  readonly map: {
    project: (lngLat: [number, number]) => { x: number; y: number };
    unproject: (point: [number, number]) => LngLatLike;
    getZoom: () => number;
    getBounds: () => {
      getNorth: () => number;
      getSouth: () => number;
      getEast: () => number;
      getWest: () => number;
    };
  };
  /** Excalidraw API surface — tools call addElement, not direct mutate. */
  readonly excalidraw: {
    addElement: (element: AtlasdrawElementSeed) => string; // returns element id
    updateElement: (id: string, patch: Partial<AtlasdrawElementSeed>) => void;
    getActiveTool: () => string;
  };
  /** App-level callbacks — popups, status bar, snackbar. */
  readonly ui: {
    showPopup: (lngLat: LngLatLike, content: ReactNode) => void;
    setStatusBarMessage: (msg: string) => void;
  };
}
```

The context is constructed by `apps/atlas-app/components/MapEditor` and passed to every event handler. Tools must not store a reference to the context beyond the event handler call (the context object may be reconstructed on each event). Designed to be postMessage-safe per Q11 (so plugin tools work via Worker boundary in Phase 7).

---

### Built-in Tool Objects — **stable**

All exported as named constants:

```ts
export const PinTool: AtlasdrawTool;         // Phase 1; id: "pin"
export const PolygonTool: AtlasdrawTool;     // Phase 2; id: "polygon"
export const LineTool: AtlasdrawTool;        // Phase 2; id: "line"
export const MeasureTool: AtlasdrawTool;     // Phase 2; id: "measure"
export const AreaTool: AtlasdrawTool;        // Phase 2; id: "area"
export const RouteSnapTool: AtlasdrawTool;   // Phase 4; id: "route-snap"
                                             //   feature-flagged; no-op if no routing endpoint
```

[CONFIDENCE: high for Phase 1–2 tools; med for RouteSnapTool per Phase 4 plan]

---

### Tool Registry — **stable**

```ts
export const toolRegistry: {
  register(tool: AtlasdrawTool): void;
  get(id: string): AtlasdrawTool | undefined;
  getAll(): AtlasdrawTool[];
};
```

`getAll()` returns all registered tools in registration order. `apps/atlas-app` calls `getAll()` to build the toolbar and passes the array to Excalidraw's `customTools` prop.

---

### Custom Tool Registration — **stable** (Phase 7+)
[CONFIDENCE: med — Phase 7 plugin sandbox consumes this; extrapolated from Phase 6 produces contract]

```ts
/** Register a plugin-provided tool. Same as toolRegistry.register() — alias for discoverability. */
export function registerCustomTool(tool: AtlasdrawTool): void;
```

---

## GeoAnchor Produced by Tools

Every drawing tool produces an Excalidraw element with `customData.geo` set as the canonical `GeoAnchor` discriminated union (from `packages/geo/types.ts`). Field name is `"geo"` (not `"geoAnchor"` — MISMATCH-3 fix). Projection field is always `"mercator"` (Q12).

| Tool | GeoAnchor kind | scaleMode |
|------|---------------|-----------|
| PinTool | `"point"` | `"screen"` |
| PolygonTool | `"polyline"` (closed ring) | `"geographic"` |
| LineTool | `"polyline"` (open) | `"geographic"` |
| MeasureTool | `"polyline"` | `"geographic"` |
| AreaTool | `"polyline"` (closed ring) | `"geographic"` |
| RouteSnapTool | `"polyline"` (OSRM-snapped) | `"geographic"` |

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `AtlasdrawTool` interface | stable | Phase 1 |
| `ToolContext` interface | stable | Phase 1 |
| `PinTool` | stable | Phase 1 |
| `PolygonTool`, `LineTool`, `MeasureTool`, `AreaTool` | stable | Phase 2 |
| `toolRegistry` | stable | Phase 2 |
| `RouteSnapTool` | experimental | Phase 4 (feature-flagged) |
| `registerCustomTool` | stable | Phase 7 |

---

## License Notes

`packages/tools` is MPL-2.0. Modifications to tool files must be shared under MPL-2.0. Tools are not bundled into the MIT-licensed SDK — they are used by the AGPL-licensed `apps/atlas-app`. The MPL license is appropriate: Atlasdraw's tool implementations are shareable improvements without requiring AGPL on the tool package itself.

---

## Backward-Compatibility Policy

`AtlasdrawTool` and `ToolContext` interfaces are frozen — new optional fields may be added in minors. Tool IDs (`"pin"`, `"polygon"`, etc.) are stable identifiers used in serialized state — they must not change. `RouteSnapTool` is `experimental` and may be promoted to `stable` in Phase 5/6 as the routing backend matures.
