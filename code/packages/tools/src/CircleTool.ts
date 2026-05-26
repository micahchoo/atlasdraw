// packages/tools/src/CircleTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T09 — CircleTool with radius readout.
//
// CircleTool is a drag-preview tool: pointer-down records the center, drag
// extends the radius, and a companion text element renders the live km readout
// near the circle's edge. Both elements are emitted via the canonical
// preview pattern (addElement → updateElement; never updateScene). See
// docs/architecture/subsystems/tools/contracts.md "## Preview pattern" for the
// contract; PinTool.ts for the fire-and-forget contrast.
//
// Element-type choices (per Wave 1 pre-dispatch scrub):
//   * Circle: type "ellipse", scaleMode "geographic", geo:point at the center.
//     The host bridge (seedToElement.ts) sets the bridge-default width/height;
//     subsequent geo updates do not re-size the ellipse — the radius is carried
//     in seed.data.radiusKm and consumed by downstream readouts/exports
//     (Phase 2 Wave 2 convert-to-data-layer + Phase 6 styling overlays).
//   * Companion text: type "text", scaleMode "screen", geo:point pinned at
//     the dragging edge. The label tracks the cursor; data.text holds the
//     km string. data.circleId links text → circle for co-deletion (Phase 6
//     concern; just record the link here per spec).
//
// Why @turf/distance: Haversine formula handles global curvature correctly.
// A flat-Euclidean (lng,lat)-degree distance would be wrong by up to ~30%
// at high latitudes. We pass [lng,lat] tuples and request "kilometers" units;
// the function returns a number suitable for `${km.toFixed(2)} km`.
//
// Tool-local preview state: stored on the tool object as underscored fields,
// matching the RectangleTool example in contracts.md "## Preview pattern". A
// future plugin-worker port (Q11/Phase 7) will move this to a closure factory,
// but for v1 the tool object is the preview-state holder.

import distance from "@turf/distance";

import type { AtlasdrawTool } from "./types.js";

interface CirclePreviewState {
  circleId: string;
  textId: string;
  centerLng: number;
  centerLat: number;
  zRef: number;
}

let _state: CirclePreviewState | null = null;

function formatKm(km: number): string {
  return `${km.toFixed(2)} km`;
}

export const CircleTool: AtlasdrawTool = {
  id: "circle",
  label: "Circle",
  icon: "circle",
  cursor: "crosshair",
  defaultScaleMode: "geographic",

  onPointerDown(e, ctx) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();

    // Seed the circle at zero radius. The bridge gives it a default
    // width/height; subsequent updateElement calls only patch geo + data.
    const circleId = ctx.excalidraw.addElement({
      type: "ellipse",
      geo: { kind: "point", lng, lat, zRef },
      scaleMode: "geographic",
      data: { radiusKm: 0 },
    });

    // Companion text seed — pinned at the same point initially (the drag
    // hasn't started yet, so center === edge). data.circleId links the two
    // for Phase 6 co-deletion / co-selection logic.
    const textId = ctx.excalidraw.addElement({
      type: "text",
      geo: { kind: "point", lng, lat, zRef },
      scaleMode: "screen",
      data: { text: formatKm(0), circleId },
    });

    _state = {
      circleId,
      textId,
      centerLng: lng,
      centerLat: lat,
      zRef,
    };
  },

  onPointerMove(e, ctx) {
    if (!_state) {
      return;
    }
    const { lng: edgeLng, lat: edgeLat } = ctx.map.unproject([
      e.clientX,
      e.clientY,
    ]);
    const radiusKm = distance(
      [_state.centerLng, _state.centerLat],
      [edgeLng, edgeLat],
      { units: "kilometers" },
    );

    // Circle: keep geo at center; updated radiusKm carried in data.
    ctx.excalidraw.updateElement(_state.circleId, {
      geo: {
        kind: "point",
        lng: _state.centerLng,
        lat: _state.centerLat,
        zRef: _state.zRef,
      },
      data: { radiusKm },
    });

    // Text: pin at edge with updated readout.
    ctx.excalidraw.updateElement(_state.textId, {
      geo: { kind: "point", lng: edgeLng, lat: edgeLat, zRef: _state.zRef },
      data: { text: formatKm(radiusKm), circleId: _state.circleId },
    });
  },

  onPointerUp(e, ctx) {
    if (!_state) {
      return;
    }
    const { lng: edgeLng, lat: edgeLat } = ctx.map.unproject([
      e.clientX,
      e.clientY,
    ]);
    const radiusKm = distance(
      [_state.centerLng, _state.centerLat],
      [edgeLng, edgeLat],
      { units: "kilometers" },
    );

    ctx.excalidraw.updateElement(_state.circleId, {
      geo: {
        kind: "point",
        lng: _state.centerLng,
        lat: _state.centerLat,
        zRef: _state.zRef,
      },
      data: { radiusKm },
    });
    ctx.excalidraw.updateElement(_state.textId, {
      geo: { kind: "point", lng: edgeLng, lat: edgeLat, zRef: _state.zRef },
      data: { text: formatKm(radiusKm), circleId: _state.circleId },
    });

    _state = null;
  },
};
