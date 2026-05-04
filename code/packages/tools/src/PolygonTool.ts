// packages/tools/src/PolygonTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T03 — PolygonTool.
//
// PolygonTool is an AtlasdrawTool, NOT an Excalidraw custom tool. It
// dispatches via atlas-app's interaction overlay (see PinTool.ts header for
// the rationale on overlay dispatch / no `customTools` prop in v0.18).
//
// Interaction model: click-to-add-vertex; double-click closes the ring.
//   click  -> push [lng,lat] onto local accumulator
//   click  -> push another [lng,lat]; if Δt to previous click ≤ 300ms, treat
//            as a double-click and commit the ring (close = first appended
//            again as last to satisfy a closed polyline) via addElement.
//   commit -> reset accumulator + timestamp.
//
// Tool-local state: PolygonTool is a singleton object literal (matches
// PinTool's pattern + the AtlasdrawTool registry contract), so we hold a
// mutable accumulator + last-pointerup timestamp directly on the object.
// Closure factory was rejected: the orchestrator's tool registry expects a
// statically-importable AtlasdrawTool, not a factory call. The trade-off is
// that PolygonTool is intrinsically session-singleton — concurrent polygon
// drawing across multiple map panes is out of scope for v1 (one map, one
// active tool at a time). When that constraint changes (multi-map Phase
// 7+), refactor to a factory or a per-ToolContext WeakMap keyed by
// `ctx.excalidraw`.
//
// Why `freedraw` (not `line` or `custom`): per the seedToElement bridge
// (apps/atlas-app/src/tools/seedToElement.ts) closed polylines route through
// the freedraw branch, which renders as a closed shape when first==last.
// This keeps PolygonTool decoupled from any future polygon-specific render
// path; the bridge owns shape selection.
//
// scaleMode: "geographic" — polygons resize with the map (a county outline
// stays glued to the county at every zoom). Per Spec §3.4 default for
// area shapes.
//
// customData.geo wrapper: PolygonTool only emits the bare `geo` payload +
// `scaleMode`. The atlas-app `seedToElement` bridge fills in the full
// `GeoCustomData` shape (`projection: "mercator"`, `schemaVersion: 1`).

import type { AtlasdrawTool, ToolPointerEvent, ToolContext } from "./types.js";

/**
 * Double-click detection window. Two consecutive pointerup events within
 * this many milliseconds close the polygon.
 *
 * 300ms matches the historical browser dblclick threshold and is wide
 * enough for trackpad users without being so wide that a deliberately
 * paced click sequence is mistaken for a double-click.
 */
const DOUBLE_CLICK_MS = 300;

/**
 * Tool-local mutable state for the polygon-in-progress.
 *
 * - `vertices`: accumulated [lng, lat] pairs in click order. Cleared on
 *   commit. The closing vertex (== vertices[0]) is appended only at commit
 *   time; the in-progress accumulator never carries a duplicate first.
 * - `lastClickAt`: epoch ms of the last pointerup. `null` means no prior
 *   click in this drawing session — first click cannot be a double-click.
 * - `lastZRef`: zoom level captured at the FIRST vertex of the current
 *   ring. The whole ring uses one zRef (any single ring is one logical
 *   shape; per-vertex zRef would let half a polygon scale differently from
 *   the other half under hybrid mode in Phase 6).
 */
interface PolygonDraftState {
  vertices: Array<[number, number]>;
  lastClickAt: number | null;
  lastZRef: number | null;
}

/**
 * Resets the in-progress draft. Call after commit OR after a non-commit
 * abandonment (Escape key, future cancel-tool-switch path).
 */
function reset(state: PolygonDraftState): void {
  state.vertices = [];
  state.lastClickAt = null;
  state.lastZRef = null;
}

/**
 * Commits the accumulated ring as one freedraw seed via addElement.
 * Closes the ring by appending vertices[0] as the final coordinate.
 *
 * Pre: state.vertices.length >= 2 (caller guarantees).
 */
function commit(state: PolygonDraftState, ctx: ToolContext): void {
  // Defensive: a degenerate ring (fewer than 3 unique vertices) is not a
  // polygon. Drop it silently rather than emit garbage. The tool will
  // remain in idle and the next click starts a fresh draft.
  if (state.vertices.length < 3) {
    reset(state);
    return;
  }

  const ring: Array<[number, number]> = [...state.vertices, state.vertices[0]];

  ctx.excalidraw.addElement({
    type: "freedraw",
    geo: {
      kind: "polyline",
      coordinates: ring,
      // state.lastZRef is set on the first push, so it cannot be null here.
      zRef: state.lastZRef as number,
    },
    scaleMode: "geographic",
  });

  reset(state);
}

/**
 * Returns true if `now` falls inside the double-click window relative to
 * the previous click. First click in a drawing session always returns
 * false (lastClickAt === null).
 */
function isDoubleClick(state: PolygonDraftState, now: number): boolean {
  return (
    state.lastClickAt !== null && now - state.lastClickAt <= DOUBLE_CLICK_MS
  );
}

/**
 * Reads the current epoch time. Indirection so tests can stub via
 * `vi.useFakeTimers()` / Date.now monkey-patch without us reaching for
 * `performance.now`.
 */
function nowMs(): number {
  return Date.now();
}

/**
 * The single mutable draft instance. Co-located with the tool so the
 * registry can hand back a stable AtlasdrawTool reference. See file
 * header for the singleton trade-off.
 */
const draft: PolygonDraftState = {
  vertices: [],
  lastClickAt: null,
  lastZRef: null,
};

/**
 * PolygonTool — click-to-add-vertex polygon drawing tool.
 *
 * Lifecycle: idle → (click) drawing → (click...) drawing → (double-click)
 * committed → idle.
 *
 * Interactions used: `onPointerDown` (vertex append + double-click close).
 * No drag, no preview pattern (per Wave 1b Q11: no updateScene exposed,
 * preview deferred to a later wave or rendered through addElement-only
 * accumulator pattern).
 */
export const PolygonTool: AtlasdrawTool = {
  id: "polygon",
  label: "Polygon",
  icon: "polygon",
  cursor: "crosshair",
  defaultScaleMode: "geographic",

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const now = nowMs();

    // Double-click branch: close the ring with whatever we have. The
    // double-click event itself does NOT add a new vertex; the second
    // click is consumed entirely by the close gesture (matches Excalidraw
    // / Mapbox / Leaflet draw conventions — the user expects "click to add,
    // double-click to finish without a phantom vertex at the close site").
    if (isDoubleClick(draft, now)) {
      commit(draft, ctx);
      return;
    }

    // Single click: project and accumulate. ctx.map.unproject is the only
    // map method we touch on the click path; structural ctx interface
    // stays narrow per Q11 (postMessage-safe for Phase 7 plugin worker).
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);

    if (draft.vertices.length === 0) {
      // First vertex: capture zRef once for the whole ring. See
      // PolygonDraftState.lastZRef rationale.
      draft.lastZRef = ctx.map.getZoom();
    }

    draft.vertices.push([lng, lat]);
    draft.lastClickAt = now;
  },
};

/**
 * Test-only: reset the singleton draft between tests. NOT part of the
 * public AtlasdrawTool surface — exported under a `__` prefix to signal
 * "internal, do not import from app code". The orchestrator never reads
 * it; only the colocated test suite does.
 */
export function __resetPolygonDraftForTests(): void {
  reset(draft);
}
