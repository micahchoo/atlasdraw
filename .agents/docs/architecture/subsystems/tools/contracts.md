# `packages/tools` — Contracts

<!-- updated 2026-05-04: aligned with Wave 0 implementation; see decisions/phase0-ci-evidence.md drifts D-GEO-1 (geo), D-TOOLS-4/6 (tools). Implementation is canonical. -->
<!-- updated 2026-05-04 (post-wave4 audit): full impl alignment — D-TOOLS-1/2/3 + ToolPointerEvent + readonly + onDoubleClick (drop from contract; impl canonical) + defaultScaleMode (NEW required field for Phase 2). See docs/decisions/opus-audit-2026-05-04-post-wave4.md. -->

**Status: Wave 0 implementation-aligned.** Speculative pre-code contracts updated against real code.

**License:** MPL-2.0 (per Q5)
**Package name:** `@atlasdraw/tools`

---

## Public Export Surface

### `AtlasdrawTool` interface — **stable**
[CONFIDENCE: high — per tech spec §4.4, Phase 1 plan]

```ts
export interface AtlasdrawTool {
  /** Stable id, registered into Excalidraw via customType. */
  readonly id: string;
  /** User-facing label. */
  readonly label: string;
  /** Toolbar icon identifier (Phase 1: string). React.FC scheduled for Phase 6 UI work. */
  readonly icon: string;
  /** CSS cursor while this tool is active. */
  readonly cursor: string;
  /**
   * Default scale-mode for elements this tool produces. Per-element seeds may override,
   * but this declares the tool's intent at definition site (queryable for toolbar UI).
   */
  readonly defaultScaleMode: ScaleMode;

  /** Optional: lifecycle hooks. */
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;

  /** Required: pointer-down committed event. */
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void;
  /** Optional: pointer-move while down (drag tools). */
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
  /** Optional: pointer-up (commit point for drag tools). */
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
  /** Optional: keyboard (Escape, Enter) while tool is active. */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
}
```

**Backward-compat:** `id`, `label`, `icon`, `cursor`, `defaultScaleMode`, and `onPointerDown` are required and frozen. New optional handlers may be added in minors. `ToolPointerEvent` (subset of DOM `PointerEvent`) is the postMessage-safe boundary for Q11 (Phase 7 plugin Worker boundary) — tools must not accept raw `PointerEvent`.

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

## Preview pattern

**When to use it.** Any tool with a drag-preview phase (down → move → up) — e.g., `ArrowTool`, `RectangleTool`, `CircleTool`, `PolylineTool`, `FreehandTool`, `PolygonTool`. The element appears at `onPointerDown`, mutates in place during `onPointerMove`, and finalizes at `onPointerUp`. **Do NOT use** for fire-and-forget tools like `PinTool` or `TextLabelTool` — those single-shot at `onPointerDown` and never call `updateElement`. See `code/packages/tools/src/PinTool.ts` for the contrast.

```ts
// Example: a drag-preview tool
export const RectangleTool: AtlasdrawTool = {
  id: "rectangle",
  // ... other AtlasdrawTool fields (label, icon, cursor) ...
  defaultScaleMode: "geographic",

  // Tool-local state for the in-flight preview. Cleared on commit.
  // (In real impl, may live in module scope or via a closure factory; the
  // important contract is that an id from addElement is held until updateElement
  // calls finalize it.)
  _previewId: null as string | null,
  _anchor: null as { lng: number; lat: number; zRef: number } | null,

  onPointerDown(e, ctx) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();
    this._anchor = { lng, lat, zRef };
    this._previewId = ctx.excalidraw.addElement({
      type: "rectangle",
      geo: { kind: "bbox", west: lng, south: lat, east: lng, north: lat, zRef },
      scaleMode: "geographic",
    });
  },

  onPointerMove(e, ctx) {
    if (!this._previewId || !this._anchor) return;
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    // Patch only the geo field; the host re-projects to new scene coords.
    ctx.excalidraw.updateElement(this._previewId, {
      geo: {
        kind: "bbox",
        west: Math.min(this._anchor.lng, lng),
        south: Math.min(this._anchor.lat, lat),
        east: Math.max(this._anchor.lng, lng),
        north: Math.max(this._anchor.lat, lat),
        zRef: this._anchor.zRef,
      },
    });
  },

  onPointerUp(e, ctx) {
    if (!this._previewId || !this._anchor) return;
    // Final commit: same patch shape as move, just the last frame.
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    ctx.excalidraw.updateElement(this._previewId, {
      geo: {
        kind: "bbox",
        west: Math.min(this._anchor.lng, lng),
        south: Math.min(this._anchor.lat, lat),
        east: Math.max(this._anchor.lng, lng),
        north: Math.max(this._anchor.lat, lat),
        zRef: this._anchor.zRef,
      },
    });
    this._previewId = null;
    this._anchor = null;
  },
};
```

**Contract guarantees.**
- `addElement` returns the new element's id synchronously — safe to capture for later `updateElement` calls in the same gesture.
- `updateElement(id, patch)` is fire-and-forget; if `id` doesn't exist (e.g., element was deleted mid-drag, or a stale id from a previous gesture), the host warns and no-ops. Tools never need to null-check the result.
- When `patch.geo` is set, the host re-projects to scene coords automatically before splicing back. Tools never project directly — they emit lng/lat and let `useCoordinateSync` own the screen-space transform.
- When `patch.geo` is omitted, only the named fields update (`scaleMode`, `style`, `data`) — geo coords stay put.

**Anti-patterns.**
- **Don't call `excalidrawAPI.updateScene` from a tool** — not exposed on `ToolContext.excalidraw`. Q11 boundary: tools must be postMessage-safe for the Phase 7 plugin worker isolation. Direct scene mutation reverts that boundary.
- **Don't call `setActiveTool` from a tool** — also not exposed; tool-system independence per mulch convention `mx-682f8a` (atlasdraw tools dispatch independently of Excalidraw's tool system via the overlay in `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`). Tool deactivation is a host concern.
- **Don't reach into the DOM directly** — use `ToolPointerEvent` fields (`clientX`, `clientY`, modifier keys) only. Raw `PointerEvent` would break the postMessage boundary.
- **Don't project coordinates inside the tool** — emit `geo` in lng/lat; the host owns projection. Tools that pre-project are fragile across camera moves and break the geographic scale-mode contract.

**Testing the pattern.** Mock `ctx.excalidraw.addElement` to return a stub id (e.g., `"test-elem-1"`). Mock `ctx.excalidraw.updateElement` to capture `(id, patch)` tuples in an array. Drive the tool with synthetic `ToolPointerEvent` objects (down → move → move → up) and assert the captured sequence: one `addElement` call with the down-frame seed, then one `updateElement(id, patch)` per move/up frame, with each `patch.geo` reflecting the cumulative gesture geometry. The id captured from `addElement`'s return must be the id passed to every subsequent `updateElement` call in the gesture.

**See also:** `.claude/rules/excalidraw-api.md` (grep-before-trust gate for Excalidraw API literals); mulch convention `mx-682f8a` (atlasdraw tool-system independence via overlay dispatch).

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
