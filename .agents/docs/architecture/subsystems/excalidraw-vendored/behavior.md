# `excalidraw-vendored` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (upstream)
**Covers:** `packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`

---

## Integration Pattern

Atlasdraw treats `packages/excalidraw` as a vendored dependency, not a first-party subsystem. The behavioral contract is: **Excalidraw manages its canvas; Atlasdraw feeds it data and reacts to its events. Atlasdraw never drives Excalidraw's internal state machine directly.**

---

## Excalidraw's Role in the Dual-Canvas Stack

```
DOM viewport
  │
  ├── [BOTTOM] MapLibre canvas (z-index: 0)
  │     pointer-events: auto when no draw tool active
  │     Camera: source of truth (lng/lat, zoom, bearing, pitch)
  │
  └── [TOP] Excalidraw canvas (z-index: 1)
        pointer-events: none (base state)
        pointer-events: auto when draw tool is active
        Background: transparent (viewBackgroundColor: "transparent")
        Scrollbars: hidden
        Native pan/zoom: disabled (hijacked when tool is "hand" or "selection")
```

The stacking is implemented in `apps/atlas-app/components/MapEditor.tsx`. `packages/excalidraw` has no knowledge of MapLibre — it renders in its own coordinate space and receives scene updates from `CoordinateSync`.

[CONFIDENCE: high — per tech spec §0, §2, Phase 1 plan]

---

## Scene Update Flow (Excalidraw's Perspective)

From Excalidraw's viewpoint, it receives `updateScene({ elements, captureUpdate:"never" })` calls on every map camera change. Excalidraw re-renders its canvas with the new element positions. It does not know these positions are derived from a geo projection — from its perspective, it's just a scene update with new `x/y/width/height/points` values.

```
CoordinateSync.syncMapToScene()
  → excalidrawAPI.updateScene({
      elements: reprojectedElements,
      captureUpdate: "never"   ← critical: no undo entry created
    })
  → Excalidraw React reconciler rerenders canvas
  → All elements appear at correct pixel positions for current map viewport
```

`captureUpdate: "never"` is load-bearing — without it, every pan/zoom creates an undo history entry, making Ctrl+Z impossible to use.

[CONFIDENCE: high — per Phase 1 plan, tech spec §3]

---

## Tool Dispatch Flow (Excalidraw's Perspective)

Excalidraw handles tool UI (toolbar button states, cursor changes) and notifies us of active tool changes via `onChange`. We dispatch pointer events to the active tool handler ourselves via `MapEditor.tsx`'s event listeners — we do not use Excalidraw's internal tool dispatch for custom tools.

```
User clicks Atlasdraw toolbar button (e.g. PolygonTool)
  │
  ▼
excalidrawAPI.setActiveTool({ type: "custom", customType: "polygon" })
  → Excalidraw updates its UI state (active button highlight, cursor)
  → Excalidraw calls our onChange with updated appState.activeTool
  │
  ▼
apps/atlas-app/hooks/useToolState.ts
  → isDrawingMode = true (activeTool.type !== "hand" && !== "selection")
  → Excalidraw layer gets pointer-events: auto (CSS class applied)
  → MapLibre layer gets pointer-events: none
  │
  ▼
User pointer events → captured by Excalidraw canvas → MapEditor forwards to PolygonTool handlers
```

[CONFIDENCE: high — per Phase 1 plan Task 13, Phase 2 plan tool tasks]

---

## Patches Applied to `packages/excalidraw` (Expected)

[CONFIDENCE: med — patch necessity depends on Excalidraw API surface at fork time; may be 0 patches if all needed behavior is configurable via props]

| Patch | Reason | Mitigation Path |
|-------|--------|-----------------|
| Pointer-event hijack for map pan | Excalidraw's wheel handler may prevent MapLibre from receiving scroll events when no draw tool is active. If `UIOptions` doesn't expose enough control, a patch to `App.tsx` event handler is needed. | Eliminated if Excalidraw adds a prop to disable native scroll handling |
| `viewBackgroundColor` transparent persistence | Ensure transparency survives style reloads — likely no patch needed if prop is respected | N/A if prop works |
| Disable native collab button | Replace with Atlasdraw's own collab UI | Eliminated if `UIOptions.canvasActions` exposes it |

Every patch logged in `decisions/upstream-patches.md` on creation.

---

## Upstream Merge Risk Areas

| Risk | Severity | Mitigation |
|------|----------|------------|
| `AppState.activeTool` shape change | HIGH | Q6 checklist item; patch if needed |
| `updateScene` `captureUpdate` option removal/rename | HIGH | Q6 checklist item |
| `customTools` prop API change | MED | Monitor Excalidraw changelog; patch if needed |
| `ExcalidrawElement.customData` type narrowed away from `unknown` | LOW | Module augmentation approach survives most narrowing; if upstream removes the field entirely, it's a breaking fork event |
| React version bump in upstream | MED | Test Atlasdraw's React version against new peer req at each quarterly merge |

---

## Endorheic Basins in Excalidraw

Excalidraw maintains internal state we do not control:
- The undo/redo history (`captureUpdate: "never"` keeps our updates out of it)
- The element selection state (`AppState.selectedElementIds`)
- The viewport camera (`scrollX/scrollY/zoom`) — we write to this via `updateScene({ appState })` when necessary, but MapLibre is the source of truth

These are Excalidraw's endorheic basins. We treat them as opaque — we read them via `getAppState()` but do not directly mutate Excalidraw's internal stores.

---

## Concurrency Model

Excalidraw is a React application — its state updates follow React's scheduling model. `excalidrawAPI.updateScene()` is synchronous-ish: it schedules a React state update. The actual re-render is asynchronous (React batch). This means that immediately after calling `updateScene`, `getSceneElements()` may still return the old elements for one render cycle. `CoordinateSync` is designed to tolerate this — it does not read back elements immediately after writing.
[CONFIDENCE: med — React scheduling behavior is standard; the CoordinateSync tolerance is engineering judgment]
