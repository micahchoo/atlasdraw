// packages/tools/src/TextLabelTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b T06 — TextLabelTool.
//
// TextLabelTool places a single geo-anchored text element at a click location.
// Like PinTool, it is fire-and-forget: one pointerdown emits one seed and the
// tool's job is done.
//
// Design choices (all gated by `docs/decisions/wave1-pre-dispatch-scrub-2026-05-04.md`):
//
// - We do NOT call `ctx.excalidraw.setActiveTool` after creating the element.
//   That call is not on the `ctx.excalidraw` surface (Q11 boundary), and it
//   would couple the atlasdraw tool layer to Excalidraw's tool system — which
//   we explicitly opted out of per mulch convention `mx-682f8a` (atlasdraw
//   tools dispatch independently of Excalidraw tool system via overlay).
//
// - Inline-editing UX (T25 maintainer decision 2026-05-05, atlasdraw-5193):
//   the tool emits a "Label" placeholder text. Excalidraw's native double-click
//   editor takes over from there — no Atlas-side overlay or focus
//   choreography. Cheapest path; surfaces the element visually on creation
//   instead of relying on a zero-width invisible click target.
//
// - scaleMode: "geographic" — labels scale with the map projection, matching
//   the behavior of bbox annotations (rectangles, images).
//
// - The seed only carries the bare `geo` payload + `scaleMode` + `data.text`.
//   atlas-app's `seedToElement` bridge fills in the full `GeoCustomData`
//   wrapper and reads `data.text` for the element's text content.

import type { AtlasdrawTool } from "./types.js";

/**
 * TextLabelTool — places an empty geo-anchored text element at a click location.
 *
 * Lifecycle: idle → (user clicks Text Label button) → active → (user clicks
 * map) → onPointerDown → committed → idle (one-shot per dispatch host
 * conventions).
 *
 * Interactions used: just `onPointerDown`. No drag, no keyboard. Inline text
 * editing is a host-side decision tracked separately.
 */
export const TextLabelTool: AtlasdrawTool = {
  id: "text-label",
  label: "Text Label",
  icon: "text",
  cursor: "text",
  defaultScaleMode: "geographic",

  onPointerDown(e, ctx) {
    // Container-relative pixel → geographic. Same narrow ctx surface as PinTool
    // for postMessage-safety (Q11 / Phase 7 plugin worker boundary).
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();

    ctx.excalidraw.addElement({
      type: "text",
      geo: { kind: "point", lng, lat, zRef },
      // Spec §3.4 (amended): text labels scale with the map projection.
      scaleMode: "geographic",
      // "Label" placeholder — visible on creation so the user can locate the
      // element and double-click to edit via Excalidraw's native text editor
      // (T25 / atlasdraw-5193). Empty text was the original Wave 1b emit;
      // it left the element invisible and required overlay focus
      // choreography we explicitly opted out of.
      data: { text: "Label" },
    });
  },
};
