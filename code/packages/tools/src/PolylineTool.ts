// packages/tools/src/PolylineTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T04 — PolylineTool.
//
// PolylineTool is the open-path counterpart to PolygonTool. The user clicks to
// add successive vertices; the path is finalized by either a double-click
// (two pointerup events within 300ms) or by pressing Escape.
//
// Geo encoding: open paths use `geo.kind: "polyline"` and the vertex array is
// emitted as-is — the first vertex is NOT appended at the end (that closure
// convention belongs to PolygonTool only). See `code/packages/geo/src/types.ts`
// — there is no separate "polygon" kind, so closure is purely a shape contract.
//
// Element type: emitted as a vendored Excalidraw `line` element type
// (`type: "line"`); atlas-app's `seedToElement` bridge wraps the vertex list
// into the host element factory. The tool layer never touches Excalidraw's
// element factories directly (Q11 boundary; mx-682f8a tool-system independence).
//
// scaleMode: "geographic" — vertices are in (lng, lat) and the polyline scales
// with the map. CoordinateSync re-projects on every camera move.

import type { AtlasdrawTool } from "./types.js";

/**
 * Module-local accumulator. The tool object itself is a singleton interface
 * (matches PinTool pattern); per-instance state lives at module scope. There is
 * only one active drawing session at a time per host (the host-side dispatcher
 * in `useAtlasdrawTool.ts` enforces single-tool activation).
 *
 * Reset to empty state after every commit (double-click or Escape).
 */
let vertices: Array<[number, number]> = [];
let lastPointerUpAt = 0;

const DOUBLE_CLICK_MS = 300;

function reset(): void {
  vertices = [];
  lastPointerUpAt = 0;
}

/**
 * PolylineTool — open multi-vertex path drawn by successive clicks.
 *
 * Lifecycle: idle → pointerdown(s) accumulate vertices → finalize on
 * double-click OR Escape → addElement → reset.
 *
 * Interactions used: onPointerDown (accumulate), onPointerUp (double-click
 * detection), onKeyDown (Escape commit). No drag preview — vertices commit
 * one click at a time. Mid-draw preview is a Wave 2 concern.
 */
export const PolylineTool: AtlasdrawTool = {
  id: "polyline",
  label: "Polyline",
  icon: "polyline",
  cursor: "crosshair",
  defaultScaleMode: "geographic",

  onPointerDown(e, ctx) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    vertices.push([lng, lat]);
  },

  onPointerUp(_e, ctx) {
    const now = Date.now();
    if (
      lastPointerUpAt !== 0 &&
      now - lastPointerUpAt < DOUBLE_CLICK_MS &&
      vertices.length >= 2
    ) {
      // Double-click: finalize. The trailing pointerdown of the second click
      // already pushed a duplicate vertex at (or near) the previous one. The
      // contract for an open path is to emit what we have (no ring closure).
      commit(ctx);
      return;
    }
    lastPointerUpAt = now;
  },

  onKeyDown(e, ctx) {
    if (e.key === "Escape" && vertices.length >= 2) {
      commit(ctx);
    } else if (e.key === "Escape") {
      // Escape with insufficient vertices — abandon without emitting.
      reset();
    }
  },
};

function commit(ctx: Parameters<NonNullable<AtlasdrawTool["onPointerDown"]>>[1]): void {
  const zRef = ctx.map.getZoom();
  // OPEN path: emit vertices as-is. Do NOT append vertices[0] at the end —
  // that closure is PolygonTool's contract, not PolylineTool's.
  const coordinates = vertices.slice();

  ctx.excalidraw.addElement({
    type: "line",
    geo: { kind: "polyline", coordinates, zRef },
    scaleMode: "geographic",
  });

  reset();
}
