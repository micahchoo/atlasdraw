# `packages/tools` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0
**Package name:** `@atlasdraw/tools`

---

## Tool Lifecycle State Machine

This state machine applies to all drawing tools. Each tool activation is a separate instance of this machine — there is no shared state between activations.

```
                    setActiveTool({ type:"custom", customType: id })
                             │
                             ▼
                         ┌────────┐
               ┌────────►│  IDLE  │◄─────────────────────────────────┐
               │         └────┬───┘                                   │
               │              │ onPointerDown                         │
               │              ▼                                       │
               │         ┌─────────────────────────────┐             │
               │         │         ACTIVE               │             │
               │         │   coordinateSync.freeze()    │             │
               │         │   accumulate vertex/state    │             │
               │         └────┬──────────┬──────────────┘             │
               │              │          │                             │
               │    onPointerMove   onDoubleClick / Enter / Escape     │
               │         (preview)        │                            │
               │              ▼          │                             │
               │         ┌──────────┐   │                             │
               │         │ DRAWING  │   │                             │
               │         │(preview) │   │                             │
               │         └────┬─────┘   │                             │
               │         (continue      │                             │
               │          adding        │                             │
               │          vertices)     ▼                             │
               │                   ┌─────────────────────────────┐   │
               │     Escape ──────►│        COMMITTED             │   │
               │                   │  coordinateSync.thaw()       │   │
               │                   │  excalidrawAPI.updateScene() │   │
               │                   │  element written to scene    │   │
               │                   └──────────────────────────────┘   │
               │                             │                         │
               └─────────────────────────────┘  (returns to IDLE)     │
                                                                       │
               Tool deactivated (user selects different tool) ────────►┘
```

**Notes:**
- `IDLE` → `ACTIVE` transition calls `coordinateSync.freeze()`. This suppresses camera sync during active drawing to prevent jitter.
- `ACTIVE`/`DRAWING` → `COMMITTED` calls `coordinateSync.thaw()` then `excalidrawAPI.updateScene()` with the committed element. `captureUpdate: "HISTORY"` (default) so the element is undo-able.
- `Escape` key while drawing: discard accumulated vertices, `thaw()`, return to `IDLE` without writing to scene.
- `PinTool` skips the `DRAWING` phase — it is always a single `onPointerDown` → immediate commit.

[CONFIDENCE: high — per Phase 2 plan tool tasks, Phase 1 plan pointer-events gate]

---

## Key Runtime Flows

### PinTool Click Flow

```
User clicks canvas (no active draw tool blocking)
  │
  ▼
onPointerDown(e, ctx)
  │
  ├── lngLat = ctx.map.unproject([e.clientX, e.clientY])
  ├── GeoAnchor = { kind:"point", lng, lat, zRef:map.getZoom(), projection:"mercator" }
  ├── element = createPinElement(lngLat, ctx.appState)
  │     customData.geo = GeoAnchor
  │     customData.scaleMode = "screen"
  └── ctx.excalidrawAPI.updateScene({ elements:[...ctx.elements, element] })
  │
  ▼
CoordinateSync picks up new element on next map.on("move") → positions it
```

### PolygonTool Vertex Accumulation Flow

```
First onPointerDown:
  coordinateSync.freeze()
  vertices = [map.unproject(e)]

Each subsequent onPointerDown:
  vertices.push(map.unproject(e))
  update preview line in scene (captureUpdate:"never")

onDoubleClick:
  vertices.push(vertices[0])  // close the ring
  GeoAnchor = { kind:"polyline", coordinates:vertices, zRef, projection:"mercator" }
  element = createPolygonElement(GeoAnchor, ctx.appState)
    customData.geo = GeoAnchor
    customData.scaleMode = "geographic"
  excalidrawAPI.updateScene({ elements:[...existingWithoutPreview, element] })
  coordinateSync.thaw()        // immediately re-projects committed element
```

### RouteSnapTool Commit Flow (Phase 4, feature-flagged)

```
onPointerUp:
  freehandCoords = [...capturedMoveCoords]
  if (!VITE_ROUTING_ENDPOINT) {
    // feature flag off: commit freehand as-is
    commitElement(freehandCoords)
    return
  }
  coordinateSync.freeze()  // keep frozen while awaiting network
  showLoadingOverlay()
  response = await fetch(VITE_ROUTING_ENDPOINT + "/route?coords=" + encode(freehandCoords))
  if (response.ok) {
    routeCoords = parseOSRM(await response.json())
    commitElement(routeCoords)
  } else {
    console.warn("Routing failed; using freehand")
    commitElement(freehandCoords)
  }
  hideLoadingOverlay()
  coordinateSync.thaw()
```

[CONFIDENCE: high — per tech spec §4.4 RouteSnapTool description]

---

## Endorheic Basins

**`tool-registry.ts`:** Module-level `Map<string, AtlasdrawTool>`. Populated once on import. Never flushed. Phase 7 plugin tools are added via `registerCustomTool()` at plugin install time. No unregistration mechanism.

**Per-tool drawing state:** Closures created on `onPointerDown` (vertex arrays, preview element IDs). Released on commit or Escape. No module-level drawing state — concurrent tool activations each have isolated closure state.

---

## Concurrency Model

All tool handlers execute on the main thread (React event handlers). `RouteSnapTool` has an `await fetch()` call — the tool remains in `ACTIVE` state and the scene shows a loading overlay during the network request. No parallel tool strokes are possible (Excalidraw's tool system activates one tool at a time).
