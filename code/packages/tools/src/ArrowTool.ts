// packages/tools/src/ArrowTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b T07 — ArrowTool.
//
// ArrowTool is a drag-preview tool: pointerdown records the tail (lng,lat),
// pointermove updates the head as the user drags, pointerup commits the final
// head. Two-coord polyline anchor [tail, head]. See contracts.md "## Preview
// pattern" for the canonical drag-preview shape we follow here.
//
// Like PinTool, this is an `AtlasdrawTool`, NOT an Excalidraw custom tool.
// v0.18 has no `customTools` prop. Atlas-app's overlay (see
// `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`) dispatches pointer events
// to this tool when the Arrow button is active.
//
// scaleMode: "hybrid" — arrows are body-geographic (endpoints anchored to
// lng/lat) but stroke-screen (the line itself stays a constant pixel width
// regardless of zoom). See Spec §3.4 / patterns.md P-04 for the hybrid contract.
//
// updateScene anti-pattern: do NOT call ctx.excalidraw.updateScene — it is
// not exposed on ToolContext. The preview pattern uses
// ctx.excalidraw.updateElement(id, patch) which is fire-and-forget and lets
// the host re-project the patched geo to scene coords automatically.

import type { AtlasdrawTool, AtlasdrawElementSeed } from "./types.js";

/**
 * Tool-local mutable state for the in-flight preview gesture.
 *
 * MUTABILITY RATIONALE: the AtlasdrawTool contract is a singleton object —
 * one ArrowTool exists per app instance. The drag-preview pattern requires
 * carrying state from `onPointerDown` (where addElement returns the id and
 * we capture the tail) across `onPointerMove` and `onPointerUp` calls. The
 * ToolContext is recreated per-event (postMessage-safe per Q11), so we can't
 * stash state on it. Module-scope mutable state (cleared at gesture end)
 * is the contract-sanctioned channel — see contracts.md preview-pattern
 * example, which uses the same `_previewId` / `_anchor` mutable closure.
 *
 * Single-gesture-at-a-time invariant: only one pointer drives a tool at a
 * time (Excalidraw's tool model is single-pointer), so a single-slot
 * preview state is sufficient. A second `onPointerDown` while one is
 * already in-flight would clobber the previous gesture — but the host's
 * overlay dispatch guarantees pointerup fires before another pointerdown
 * for the same tool (see useAtlasdrawTool.ts pointer capture).
 */
let previewId: string | null = null;
let tail: { lng: number; lat: number; zRef: number } | null = null;

/**
 * ArrowTool — draws a two-point arrow between the down and up locations.
 *
 * Lifecycle: idle → pointerdown (tail captured, zero-length seed emitted) →
 * pointermove* (head updated each frame) → pointerup (final head commit) → idle.
 *
 * Initial seed at pointerdown is a zero-length arrow (head==tail) so the
 * element exists in the scene immediately and the user gets visual feedback
 * the moment they click. Subsequent move/up frames stretch the head out.
 */
export const ArrowTool: AtlasdrawTool = {
  id: "arrow",
  label: "Arrow",
  icon: "arrow",
  cursor: "crosshair",
  defaultScaleMode: "hybrid",

  onPointerDown(e, ctx) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    const zRef = ctx.map.getZoom();
    tail = { lng, lat, zRef };

    const seed: AtlasdrawElementSeed = {
      type: "arrow",
      geo: {
        kind: "polyline",
        // Initial seed: head==tail (zero-length). Move/up stretch the head.
        coordinates: [
          [lng, lat],
          [lng, lat],
        ],
        zRef,
      },
      scaleMode: "hybrid",
    };

    previewId = ctx.excalidraw.addElement(seed);
  },

  onPointerMove(e, ctx) {
    if (previewId === null || tail === null) {
      return;
    }
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    ctx.excalidraw.updateElement(previewId, {
      geo: {
        kind: "polyline",
        coordinates: [
          [tail.lng, tail.lat],
          [lng, lat],
        ],
        zRef: tail.zRef,
      },
    });
  },

  onPointerUp(e, ctx) {
    if (previewId === null || tail === null) {
      return;
    }
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    ctx.excalidraw.updateElement(previewId, {
      geo: {
        kind: "polyline",
        coordinates: [
          [tail.lng, tail.lat],
          [lng, lat],
        ],
        zRef: tail.zRef,
      },
    });
    // Clear the preview state so the next gesture starts fresh.
    previewId = null;
    tail = null;
  },
};
