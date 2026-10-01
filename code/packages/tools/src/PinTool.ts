// packages/tools/src/PinTool.ts
// SPDX-License-Identifier: MPL-2.0
// PinTool is an `AtlasdrawTool`, NOT an Excalidraw custom tool. The
// `<Excalidraw>` component does not have a `customTools` prop in v0.18, so we
// cannot register PinTool with Excalidraw's tool system. Instead, atlas-app
// dispatches to this tool itself via an interaction overlay (see
// `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`) when the user has activated
// the Pin button. The overlay captures pointerdown, builds a `ToolContext`
// from the current (map, excalidrawAPI) tuple, and calls `onPointerDown` here.
//
// The seed carries the click's lng/lat and the zoom it was made at. atlas-app's
// `seedToElement` places the pin in the document's world frame, centred on
// the click, sized in screen pixels at that zoom.

import type { AtlasdrawTool } from "./types.js";

/**
 * PinTool — places a small geo-anchored marker at a click location.
 *
 * Lifecycle: idle → (user clicks Pin button) → active → (user clicks map) →
 * onPointerDown → committed → idle (one shot per activation).
 *
 * Interactions used: just `onPointerDown`. No drag, no keyboard, no
 * activate/deactivate hooks. The tool is fire-and-forget at a single point.
 */
export const PinTool: AtlasdrawTool = {
  id: "pin",
  label: "Pin",
  icon: "pin",
  cursor: "crosshair",

  onPointerDown(e, ctx) {
    // Viewport-relative pixel → geographic. buildToolContext's unproject
    // wrapper subtracts the map container's bounding-rect offset before
    // calling MapLibre's unproject, so e.clientX/clientY (viewport coords)
    // are the correct input here.
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();

    ctx.excalidraw.addElement({
      type: "custom",
      customType: "pin",
      geo: { kind: "point", lng, lat, zRef },
      data: { label: "Pin" },
    });
  },
};
