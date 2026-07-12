# `packages/tools` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0
**Package name:** `@atlasdraw/tools`

---

## Internal Module Dependency Graph

```
packages/tools/
├── index.ts                    ← barrel + auto-registration of built-in tools
│
├── types.ts                    ← AtlasdrawTool, AtlasdrawToolContext interfaces
│   └── ext: maplibre-gl (Map type), @excalidraw types, packages/geo (CoordinateSync type)
│
├── tool-registry.ts            ← module-level registry Map
│   └── deps: types.ts
│
├── PinTool.ts                  ← Phase 1
│   ├── deps: types.ts, tool-registry.ts
│   └── ext: packages/geo (GeoAnchor), @excalidraw element types
│
├── PolygonTool.ts              ← Phase 2
│   ├── deps: types.ts
│   └── ext: packages/geo (GeoAnchor, CoordinateSync)
│
├── LineTool.ts                 ← Phase 2
│   ├── deps: types.ts
│   └── ext: packages/geo (GeoAnchor)
│
├── MeasureTool.ts              ← Phase 2
│   ├── deps: types.ts
│   └── ext: packages/geo (GeoAnchor, measure.length)
│
├── AreaTool.ts                 ← Phase 2
│   ├── deps: types.ts
│   └── ext: packages/geo (GeoAnchor, measure.area)
│
└── RouteSnapTool.ts            ← Phase 4 (feature-flagged)
    ├── deps: types.ts
    └── ext: packages/geo (GeoAnchor), fetch (OSRM/Valhalla)
```

---

## ASCII Layering

```
┌──────────────────────────────────────────────────────┐
│                    index.ts                          │
│     (barrel + registerTool() calls for builtins)     │
└──┬──────────────┬──────────────────────────────────┘
   │              │
   ▼              ▼
tool-registry   individual tools (PinTool, PolygonTool, ...)
   ▲              │
   │              ▼
   └──────── types.ts
                  │
                  ▼
           packages/geo
           (GeoAnchor, measure, CoordinateSync)
```

---

## Layering Rules

1. **No React in tool logic files.** `icon` properties reference React components by type but are not rendered here. `MapEditor` renders them. Tools are plain objects.
2. **No DOM access** in tool files — only the injected `PointerEvent`/`MouseEvent` objects (which are DOM events, but received by injection, not acquired).
3. **No side-effectful imports at module level** (no `fetch` calls, no singletons) except for `tool-registry.ts` registration in `index.ts`.
4. **`RouteSnapTool.ts` is the only network-touching module.** It must check for the feature flag before making any `fetch` call. It must never throw if the routing endpoint is unavailable — return the freehand stroke as-is.
5. **All tools are stateless between events.** Accumulation state (e.g. polygon vertices) lives in a closure created on `onPointerDown` and released on `onPointerUp`/commit — not in module-level variables.

---

## Knot Complement — Independent Refactor Units

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `types.ts` | No | Root contract; changing interface breaks all tools |
| `tool-registry.ts` | Yes | Interface is stable |
| `PinTool.ts` | Yes | Self-contained; no inter-tool deps |
| `PolygonTool.ts` | Yes | Same |
| `LineTool.ts` | Yes | Same |
| `MeasureTool.ts` | Yes | Depends on `packages/geo/measure` interface |
| `AreaTool.ts` | Yes | Same |
| `RouteSnapTool.ts` | Yes | Most complex; isolated behind feature flag |

---

## External Dependencies

| Dep | Usage | Notes |
|-----|-------|-------|
| `packages/geo` | GeoAnchor types, measure.*, CoordinateSync type | Always |
| `maplibre-gl` | Map.unproject (via ctx.map) | Type-only in tools; runtime provided by caller |
| `@excalidraw/excalidraw` (vendored) | ExcalidrawAPI, element types | Type-only |
| `fetch` | RouteSnapTool → OSRM/Valhalla | Guarded by feature flag |

---

## Package Boundary

`packages/tools` must not import from:
- `packages/basemap` (no style deps in tools)
- `packages/data` (tools produce elements; data serializes them)
- `packages/sdk`
- `apps/*`

It imports from:
- `packages/geo` (GeoAnchor types, measure functions, CoordinateSync type)
- `packages/excalidraw-vendored` (type-only)
