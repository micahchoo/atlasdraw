# `packages/basemap` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0
**Package name:** `@atlasdraw/basemap`

---

## MapCanvas Lifecycle

```
Component mounts
  │
  ├── registerPmtilesProtocol() [idempotent]
  │
  ├── BasemapRegistry.get(styleId) → StyleEntry
  │     └── throws StyleNotFoundError if unknown
  │
  ├── buildStyle(styleId) → StyleSpecification
  │
  ├── new maplibregl.Map({ container, style, ... })
  │
  ├── map.on("load") fires
  │     └── ref.current = map
  │         onLoad?.(map)
  │
  └── [MOUNTED — ref.current is live]

Style switch (styleId prop changes)
  │
  ├── Check map.isStyleLoaded()
  │     ├── true  → map.setStyle(newStyleSpec) immediately
  │     └── false → queue setStyle for after next "style.load" event
  │           (prevents crash during mid-load switch)
  │
  └── [Invariant: never throws; never sets ref.current to null]

Component unmounts
  │
  ├── map.remove()
  └── ref.current = null
```

[CONFIDENCE: high — per Phase 1 plan Task 3 invariants]

---

## Style Compiler Flow

```
User edits layer style (Phase 6 Style Editor)
  │
  ▼
LayerStyle object constructed (solid | categorical | graduated)
  │
  ▼
compileLayerStyle(style, layerType)
  │
  ├── type === "solid"
  │     └── return { type: layerType, paint: { [paintProp]: color } }
  │
  ├── type === "categorical"
  │     └── MapLibre expression:
  │         ["match", ["get", field], stop1val, stop1color, ..., default]
  │         → LayerSpecification with paint property as expression array
  │
  └── type === "graduated"
        ├── interpolate === "linear"
        │     └── ["interpolate", ["linear"], ["get", field], ...stops]
        └── interpolate === "step"
              └── ["step", ["get", field], defaultColor, ...stops]
  │
  ▼
map.addLayer(compiledSpec) or map.setPaintProperty(...)
```

Output is deterministic — same `LayerStyle` always produces the same expression. Required for Phase 7 plugin-authored styles (per Phase 6 produces contract).
[CONFIDENCE: high — per Phase 6 plan Task 10]

---

## BasemapRegistry Endorheic Basin

The `BasemapRegistry` is a module-level `Map<string, StyleEntry>`. It is populated at module load time with the four built-in styles (Phase 1). Additional entries are registered at application startup via `BasemapRegistry.register()`.

**Flush:** Never flushed at runtime. Styles accumulate for the session. In tests, a `reset()` helper (unexported from index; test-internal) restores defaults. There is no mechanism to unregister a style once registered — this is intentional to prevent mid-session style ID invalidation.

---

## PMTiles Protocol Registration

The pmtiles protocol handler is registered exactly once per page load. The guard is:

```ts
let registered = false;
export function registerPmtilesProtocol() {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile.bind(protocol));
  registered = true;
}
```

React StrictMode mounts components twice in development; without this guard, `addProtocol` would throw on the second call. The guard must be at module scope, not component scope.
[CONFIDENCE: high — per Phase 1 plan Task 3 Step 2 note]

---

## Key Flows Participated In

| Flow | Role |
|------|------|
| Phase 1: Map stack initialization | `<MapCanvas>` creates the MapLibre instance; passes `map` ref to `MapEditor` which passes it to `CoordinateSync` |
| Phase 3: Layer data rendering | `style-builder` adds vector/raster sources; `style-compiler` generates layer paint specs |
| Phase 6: Style Editor | `compileLayerStyle` is called on every user style change; output fed to `map.setPaintProperty` or `map.addLayer` |
| Phase 7: Plugin-authored styles | Plugins produce `LayerStyle` objects; `compileLayerStyle` converts them; same deterministic output as editor path |

---

## Concurrency Model

`MapCanvas` is a React component — its lifecycle is managed by React's scheduler. All `maplibregl.Map` callbacks (`"load"`, `"style.load"`) fire on the main thread. No async I/O in `style-compiler.ts` or `BasemapRegistry.ts`.

The only async path is the initial map style tile fetch (handled by MapLibre internally). The component buffers style switches that arrive before `map.isStyleLoaded()` to prevent MapLibre's internal state machine from entering an error state.
[CONFIDENCE: med — style-switch buffering behavior inferred from Phase 1 invariant; exact impl is an engineering judgment call]
