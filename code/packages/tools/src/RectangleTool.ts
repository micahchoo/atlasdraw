// packages/tools/src/RectangleTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T08 — RectangleTool.
//
// Drag-corner rectangle: click+drag from corner A to corner B yields a
// geo-anchored rectangle whose `GeoAnchor` is a `bbox` (west/south/east/north).
// Implements the canonical preview pattern documented in
// `docs/architecture/subsystems/tools/contracts.md` ("Preview pattern"):
//   onPointerDown  -> ctx.excalidraw.addElement(seed); capture id + first corner
//   onPointerMove  -> ctx.excalidraw.updateElement(id, { geo: bbox(min/max) })
//   onPointerUp    -> final updateElement; clear the in-flight state
//
// scaleMode: per Spec §3.4 + Phase 2 plan T08, rectangles are
// scaleMode:"geographic" — the bbox covers fixed lng/lat extent so the
// rectangle grows/shrinks on screen as the camera zooms (it represents a
// region of the world, not a screen-space label).
//
// In-flight state lives in module scope (closure-equivalent to the contract
// example's `_previewId` / `_anchor` fields, which are illustrative only —
// `AtlasdrawTool` is a structural interface and stashing arbitrary fields on
// the tool object would not pass typecheck). Single in-flight gesture is fine
// per the host overlay (`useAtlasdrawTool.ts`) which only dispatches one
// active tool / one pointer at a time.
//
// bbox normalization: the user can drag from any corner toward any other
// corner. We always normalize to min/max so `west <= east` and `south <= north`
// regardless of drag direction — the GeoAnchor.bbox contract requires it and
// downstream consumers (data layers, exports) assume normalized extents.

import type { AtlasdrawTool, ToolPointerEvent, ToolContext } from "./types.js";

// In-flight gesture state. Reset to null between gestures.
let previewId: string | null = null;
let anchor: { lng: number; lat: number; zRef: number } | null = null;

/**
 * Build a normalized bbox from two arbitrary corners.
 * west = min(lng), east = max(lng); south = min(lat), north = max(lat).
 */
function makeBbox(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  zRef: number,
) {
  return {
    kind: "bbox" as const,
    west: Math.min(a.lng, b.lng),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    north: Math.max(a.lat, b.lat),
    zRef,
  };
}

export const RectangleTool: AtlasdrawTool = {
  id: "rectangle",
  label: "Rectangle",
  icon: "rectangle",
  cursor: "crosshair",
  defaultScaleMode: "geographic",

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();
    anchor = { lng, lat, zRef };

    // Initial degenerate seed (west==east, south==north). The host's
    // seedToElement bridge is responsible for accepting zero-extent bboxes
    // during the in-flight phase; updateElement frames immediately follow.
    previewId = ctx.excalidraw.addElement({
      type: "rectangle",
      geo: makeBbox({ lng, lat }, { lng, lat }, zRef),
      scaleMode: "geographic",
    });
  },

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    if (previewId === null || anchor === null) {
      return;
    }
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    ctx.excalidraw.updateElement(previewId, {
      geo: makeBbox(anchor, { lng, lat }, anchor.zRef),
    });
  },

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext) {
    if (previewId === null || anchor === null) {
      return;
    }
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    ctx.excalidraw.updateElement(previewId, {
      geo: makeBbox(anchor, { lng, lat }, anchor.zRef),
    });
    previewId = null;
    anchor = null;
  },
};
