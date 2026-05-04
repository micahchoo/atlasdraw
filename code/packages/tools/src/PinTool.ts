// packages/tools/src/PinTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 1 Wave 3b Task 14 — PinTool.
//
// PinTool is an `AtlasdrawTool`, NOT an Excalidraw custom tool. The
// `<Excalidraw>` component does not have a `customTools` prop in v0.18, so we
// cannot register PinTool with Excalidraw's tool system. Instead, atlas-app
// dispatches to this tool itself via an interaction overlay (see
// `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`) when the user has activated
// the Pin button. The overlay captures pointerdown, builds a `ToolContext`
// from the current (map, excalidrawAPI) tuple, and calls `onPointerDown` here.
//
// scaleMode: per Spec §3.4, point markers use scaleMode:"screen" — they keep
// their visual size as the map zooms (a 16x16 pin stays 16x16 px). The
// CoordinateSync hook re-projects the element's (lng,lat) → (x,y) on every
// camera move so the pin appears stuck to its geographic location.
//
// customData.geo wrapper: the seed only carries the bare `geo` payload and
// `scaleMode`. atlas-app's `seedToElement` bridge fills in the full
// `GeoCustomData` shape (`projection: "mercator"`, `schemaVersion: 1`) when
// it converts the seed into a real Excalidraw element. This keeps the tools
// package decoupled from the wrapper's serialization rules.

import type { AtlasdrawTool } from "./types.js";

/**
 * PinTool — places a small geo-anchored marker at a click location.
 *
 * Lifecycle: idle → (user clicks Pin button) → active → (user clicks map) →
 * onPointerDown → committed → idle (one-shot per dispatch host conventions).
 *
 * Interactions used: just `onPointerDown`. No drag, no keyboard, no
 * activate/deactivate hooks. The tool is fire-and-forget at a single point.
 */
export const PinTool: AtlasdrawTool = {
  id: "pin",
  label: "Pin",
  icon: "pin",
  cursor: "crosshair",
  defaultScaleMode: "screen",

  onPointerDown(e, ctx) {
    // Container-relative pixel → geographic. ctx.map.unproject is the only map
    // method we touch here; the structural ctx interface is intentionally narrow
    // so PinTool stays postMessage-safe (Q11 / Phase 7 plugin worker boundary).
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();

    ctx.excalidraw.addElement({
      type: "custom",
      customType: "pin",
      geo: { kind: "point", lng, lat, zRef },
      // Spec §3.4: pin markers stay screen-fixed in size as the map zooms.
      scaleMode: "screen",
      data: { label: "Pin" },
    });
  },
};
