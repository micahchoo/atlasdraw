# `packages/geo` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/geo`

---

## Core Invariant

MapLibre is the source of truth for the camera. Excalidraw's `scrollX/scrollY/zoom` are derived views, recalculated on every camera event. `customData.geo` (the `GeoAnchor`) is the source of truth for element position. Pixel `x/y/width/height/points` are derived values, never stored as canonical state.
[CONFIDENCE: high — per tech spec §0, §3]

---

## CoordinateSync State Machine

```
         attach()
            │
            ▼
       ┌─────────┐   map "move"|"zoom"|"rotate"|"pitch"
       │  LIVE   │ ◄───────────────────────────────────┐
       │         │                                      │
       │  (syncing)──► throttle 16ms ──► syncMapToScene()
       └────┬────┘                             │
            │ freeze()                         │
            ▼                                  │
       ┌─────────┐                             │
       │ FROZEN  │   (events still queued,     │
       │         │    sync suppressed)         │
       └────┬────┘                             │
            │ thaw()                           │
            │ (immediately syncMapToScene)     │
            └─────────────────────────────────►┘
            │ detach()
            ▼
       ┌─────────┐
       │  DEAD   │  (all listeners removed)
       └─────────┘
```

**`LIVE` state:** Default after `attach()`. Camera events fire `syncMapToScene()` on a 16 ms throttle (one rAF budget). Multiple events within the window are coalesced — only the last camera state matters.

**`FROZEN` state:** Active during tool drawing (Phase 2+). `packages/tools` calls `coordinateSync.freeze()` on `onPointerDown` and `thaw()` on element commit. This prevents mid-stroke camera jitter from corrupting the in-progress element's pixel position.

**`DEAD` state:** After `detach()` (React component unmount). No further callbacks fire. CoordinateSync instance must not be reused — construct a new one.

[CONFIDENCE: high — per Phase 1 plan Task 4, Phase 2 plan tool freeze/thaw requirement]

---

## Key Runtime Flow: Pan/Zoom → Scene Update

Source: Phase 1 plan "Flow A — Pan/Zoom → CoordinateSync → Scene Update"

```
User input (touchpad/mouse wheel/drag)
  │
  ▼
MapLibre internal camera update
  │
  ▼
map.on("move") fires (or "zoom", "rotate", "pitch")
  │
  ▼
CoordinateSync.handleCameraChange()  [THROTTLE: 16ms]
  │
  ▼
CoordinateSync.syncMapToScene()
  │
  ├── for each ExcalidrawElement with customData.geo:
  │     │
  │     ├── kind === "point"
  │     │     └── map.project([lng, lat]) → {x, y}
  │     │         apply ScaleMode for width/height
  │     │
  │     ├── kind === "bbox"
  │     │     └── map.project([west, north]) → nw pixel
  │     │         map.project([east, south]) → se pixel
  │     │         derive x, y, width, height
  │     │
  │     └── kind === "polyline"
  │           └── map.project each coordinate → pixel points[]
  │               subtract centroid to produce local offset coordinates
  │               set element.x/y to centroid pixel; element.points to offsets
  │
  ▼
excalidrawAPI.updateScene({
  elements: updatedElements,
  captureUpdate: "never"       // never pollutes undo history
})
  │
  ▼
Excalidraw canvas re-renders (all elements repositioned)
```

**Performance budget:** The inner loop runs on every `move` event, up to 60 fps. Target: <2ms for 500 elements. Implementation constraint: no object allocations in the loop body — reuse fixed-size arrays.
[CONFIDENCE: high — per Phase 1 plan, tech spec §3]

---

## `geoToExcalidraw` Flow

Called at import time (file open, drag-drop, paste):

```
GeoJSON.Feature (any geometry type)
  │
  ▼
geoToExcalidraw(feature, opts?)
  │
  ├── geometry.type === "Point"
  │     └── GeoAnchor { kind:"point", lng, lat, zRef:currentZoom, projection:"mercator" }
  │
  ├── geometry.type === "LineString"|"MultiLineString"
  │     └── GeoAnchor { kind:"polyline", coordinates:[...], zRef, projection:"mercator" }
  │
  ├── geometry.type === "Polygon"|"MultiPolygon"
  │     └── GeoAnchor { kind:"polyline", coordinates:outerRing, zRef, projection:"mercator" }
  │         (inner rings stored in feature.properties for future rendering)
  │
  └── Returns ExcalidrawElementSkeleton with:
        customData: { geo: GeoAnchor, scaleMode: opts.scaleMode ?? "geographic" }
        x/y/width/height: 0 initially — CoordinateSync fills real values on first sync
```

---

## Endorheic Basins (State Accumulation)

`packages/geo` is designed to be stateless at the module level. The only stateful entity is a `CoordinateSync` instance, which holds:
- A reference to the `maplibregl.Map` instance (not owned by CoordinateSync)
- A reference to `excalidrawAPI` (not owned)
- The `frozen: boolean` flag
- The throttle timer handle

**Flush behavior:** Calling `detach()` clears all timers and removes all event listeners. The instance becomes inert. There is no global cache, no module-level registry.

---

## Concurrency Model

`packages/geo` is synchronous and single-threaded. The throttle on `syncMapToScene` is a simple `setTimeout`/`requestAnimationFrame` guard — not a true concurrency mechanism. If two camera events arrive within 16 ms, the second overwrites the first in the queue; only the latest camera state is projected.

No WebWorker, no SharedArrayBuffer. Future WASM acceleration for Turf operations would be async/worker-based and wrapped in a compatible shim — callers would not change.
[CONFIDENCE: med — per tech spec §3; WASM path is speculative]
