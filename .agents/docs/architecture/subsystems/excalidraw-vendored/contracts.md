# `excalidraw-vendored` — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (upstream Excalidraw — packages/excalidraw/LICENSE)
**Covers:** `packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`

---

## What This Document Covers

This file documents the **seam** — the subset of upstream Excalidraw API surface that Atlasdraw actively consumes and depends on. It does not enumerate the full Excalidraw API (that is upstream's domain). It records what we use, what we patch, and what must remain stable for Atlasdraw to function.

---

## Consumed API Surface from `packages/excalidraw`

### `<Excalidraw>` component — **consumed as stable**
[CONFIDENCE: high — central integration point, all phases]

```ts
// Props we depend on:
<Excalidraw
  ref={excalidrawRef}                          // gives us ExcalidrawAPI
  viewBackgroundColor="transparent"            // required for map to show through
  UIOptions={{ canvasActions: { ... } }}       // disable save/load (we handle it)
  customTools={getTools()}                     // registers AtlasdrawTool objects
  onPointerDown={handlePointerDown}            // tool dispatch
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onChange={handleChange}                      // tracks active tool for CoordinateSync freeze/thaw
  renderTopRightUI={() => <AtlasToolbar />}    // custom toolbar injection
/>
```

Props we do NOT use and must not interfere with: Excalidraw's native collab props (`isCollaborating`, `onCollabButtonClick`) — we implement our own collab via Yjs (Q2).

---

### `ExcalidrawAPI` — **consumed as stable**
[CONFIDENCE: high — per tech spec §3, Phase 1 plan]

```ts
// Methods we depend on:
excalidrawAPI.getSceneElements(): readonly ExcalidrawElement[]
excalidrawAPI.updateScene(opts: {
  elements?: ExcalidrawElement[];
  appState?: Partial<AppState>;
  captureUpdate?: "HISTORY" | "NONE" | "never";  // "never" for CoordinateSync
}): void
excalidrawAPI.getAppState(): AppState
excalidrawAPI.setActiveTool(opts: {
  type: "custom";
  customType: string;  // tool id
}): void
excalidrawAPI.scrollToContent(elements?, opts?): void  // used by "fit to selection"
```

`captureUpdate: "never"` is the critical flag for `CoordinateSync.syncMapToScene()` — it prevents pan/zoom reprojections from flooding undo history.

---

### `ExcalidrawElement` type — **consumed as stable**
[CONFIDENCE: high]

```ts
// Fields we read/write:
interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: readonly Point[];      // for linear elements
  customData?: unknown;           // we narrow via module augmentation in packages/geo
  // ...all other fields pass through unchanged
}
```

**Module augmentation (non-patch approach):** Rather than modifying `packages/element`, `packages/geo/types.ts` augments the `ExcalidrawElement` interface:

```ts
// packages/geo/types.ts
declare module "@excalidraw/excalidraw" {
  interface ExcalidrawElement {
    customData?: GeoCustomData;
  }
}
```

This is additive and survives upstream merges without a patch entry.
[CONFIDENCE: high — per Phase 0/1 plan discussion of `customData.geo`]

---

### `ExcalidrawElementSkeleton` — **consumed as stable**
[CONFIDENCE: high — per tech spec §4.1]

Used by `packages/geo/geoToExcalidraw.ts` to programmatically create elements. This is Excalidraw's "creation API" — it accepts partial elements and fills in defaults. Less likely to break in upstream merges than the full element type.

---

### `AppState` — **consumed as partially stable**
[CONFIDENCE: med — AppState is large and upstream changes it frequently]

Fields we depend on:
```ts
appState.activeTool.type   // for isDrawingMode gate (Phase 1 plan Task 13)
appState.scrollX           // for viewport state
appState.scrollY
appState.zoom.value
```

AppState changes are the highest-risk upstream merge conflict surface. Quarterly review (Q6) must check these fields. If upstream renames/removes them, patches are required.

---

### `customTools` prop — **consumed as stable**
[CONFIDENCE: high — per tech spec §4.4]

```ts
// Excalidraw's customTools prop accepts AtlasdrawTool objects.
// We register via setActiveTool({ type:"custom", customType: id }) to activate.
// Excalidraw does not execute tool logic — it only tracks the active tool ID.
// All handler dispatch happens in MapEditor.tsx.
```

---

## Consumed API Surface from `packages/element`

Type imports only:
- `ExcalidrawElement` (re-exported via `packages/excalidraw`)
- `ExcalidrawLinearElement`
- `Point` (coordinate type)

No runtime imports from `packages/element` in Atlasdraw code.
[CONFIDENCE: high]

---

## Consumed API Surface from `packages/math`

Not directly consumed. Used internally by `packages/excalidraw`.
[CONFIDENCE: high]

---

## Consumed API Surface from `packages/common`

- `MIME_TYPES` constants — used in `packages/data` for file type detection
- Occasional utility type guards

No patched code, no runtime-critical dependency.
[CONFIDENCE: med — common imports are convenience; could be eliminated if needed]

---

## Off-Limits Surface

The following upstream APIs are deliberately NOT used to maintain upgrade safety:

| API | Why avoided |
|-----|-------------|
| Excalidraw's native file save/load | We use `.atlasdraw` format via `packages/data` |
| Excalidraw's collab room/socket | We use our own Yjs + WebSocket (Q2) |
| Excalidraw's `exportToCanvas` | We use Puppeteer render in `packages/cli` for server-side |
| Excalidraw's `scrollX/scrollY` writes | MapLibre owns the camera; we derive Excalidraw camera from it |

---

## Stability and Upgrade Risk

| API | Upstream stability | Our risk |
|-----|--------------------|----------|
| `<Excalidraw>` component core props | High | Low |
| `ExcalidrawAPI` methods | Med (grows each release) | Med — watch for deprecations |
| `AppState` field names | Low (upstream changes frequently) | High — patch risk |
| `ExcalidrawElement` core fields (x,y,w,h) | High | Low |
| `customData` field | High (typed as `unknown`) | Low — we own the type via augmentation |
| `customTools` prop | Med | Med — relatively new API |

[CONFIDENCE: med — risk assessment based on observing excalidraw release history; validate each quarterly review]
