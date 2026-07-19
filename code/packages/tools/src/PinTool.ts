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
// scaleMode: always "geographic" (maintainer decision, 2026-07-19: geographic
// is the ONLY creation mode; Spec §3.4's screen-fixed pins are superseded —
// "screen"/"hybrid" survive only as render support for legacy documents). The
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
  defaultScaleMode: "geographic",

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
      // Geographic — the only creation mode (maintainer decision, 2026-07-19).
      scaleMode: "geographic",
      data: { label: "Pin" },
    });
  },
};
