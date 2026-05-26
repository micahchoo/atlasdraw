// packages/tools/src/FreehandTool.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T05 — FreehandTool.
//
// FreehandTool is an `AtlasdrawTool`, NOT an Excalidraw custom tool. It plugs
// into atlas-app's interaction overlay (see
// `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`) the same way PinTool does.
// The overlay forwards pointer events; this module owns the in-progress stroke
// buffer and the on-commit simplification pass.
//
// Lifecycle (per the Phase 2 plan T05 contract):
//   onPointerDown -> begin stroke, push first vertex, mark pointer-down
//   onPointerMove -> while pointer-down, push every sample (rapid, dense)
//   onPointerUp   -> RDP simplify in-place, addElement, reset state
//
// Why we track pointer-down state: the AtlasdrawTool contract does not
// distinguish "move while button is held" from "hover" — the host overlay
// only attaches onPointerMove while the gesture is active, but defending
// at this layer keeps the tool host-agnostic (PinTool's fire-and-forget
// pattern would over-collect — Pin is single-shot, Freehand is a gesture).
//
// scaleMode: per Phase 2 plan T05, freehand strokes use scaleMode:"hybrid"
// — vertices are geo-anchored (re-projected on camera move) but stroke width
// stays in screen pixels so a thin line stays thin while the path follows
// the terrain.
//
// RDP epsilon: 0.00001 degrees (~1.1 m at the equator). Tight enough that a
// hand-drawn stroke at street-zoom retains shape; loose enough to collapse
// the dense pointermove sample stream (often >100 pts/sec) to ~1 vertex per
// curvature inflection. Same value the plan suggests at line ~410.
//
// customData.geo wrapper: the seed only carries the bare `geo` payload and
// `scaleMode`. atlas-app's `seedToElement` bridge fills in the full
// `GeoCustomData` shape (`projection: "mercator"`, `schemaVersion: 1`) when
// it converts the seed into a real Excalidraw element — same convention as
// PinTool. Keeps the tools package decoupled from wrapper serialization.

import type { AtlasdrawTool, ToolContext, ToolPointerEvent } from "./types.js";

/** Tight enough to keep curvature, loose enough to collapse 1000-pt strokes. */
const RDP_EPSILON_DEG = 0.00001;

/**
 * In-progress stroke buffer. Module-scoped so the tool object stays a plain
 * value (matches PinTool's stateless export shape — host treats tools as
 * singletons). One Freehand gesture is active at a time per host overlay,
 * which is the project's interaction model.
 */
let activeStroke: {
  pointerId: number;
  zRef: number;
  points: Array<[number, number]>;
} | null = null;

/**
 * Perpendicular distance from point `p` to the segment a–b. Used by RDP to
 * decide whether to keep the worst-deviating point in a sub-range.
 *
 * Operates in raw lng/lat degrees — not equal-area, but RDP only uses this
 * for relative ranking within one stroke, so the distortion is uniform and
 * the simplification stays visually faithful to what the user drew.
 */
function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // Degenerate segment: a == b. Fall back to point-to-point distance.
  if (dx === 0 && dy === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  // Standard "distance from point to infinite line" formula, since we only
  // care about relative magnitude inside a sub-range — the segment endpoints
  // are always kept regardless of this number.
  const num = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
  const den = Math.sqrt(dx * dx + dy * dy);
  return num / den;
}

/**
 * Ramer-Douglas-Peucker polyline simplification. Iterative (explicit stack)
 * to avoid blowing the JS recursion limit on long strokes — a 5000-pt
 * pathological stroke would hit ~5000 recursion depth in the naive form.
 *
 * Pure function; no allocations beyond the keep[] mask and the result array.
 *
 * @param points  ordered vertex list in [lng, lat]
 * @param epsilon perpendicular-distance threshold in the same units as
 *                points (degrees here). Points within epsilon of a kept
 *                segment are dropped.
 * @returns       simplified subset, preserving first and last vertices.
 */
export function rdp(
  points: Array<[number, number]>,
  epsilon: number,
): Array<[number, number]> {
  if (points.length < 3) {
    return points.slice();
  }

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Stack of [startIdx, endIdx] sub-ranges still to evaluate.
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    const a = points[start]!;
    const b = points[end]!;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i]!, a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      result.push(points[i]!);
    }
  }
  return result;
}

/**
 * FreehandTool — pen-style stroke with dense sampling and on-commit RDP.
 *
 * Lifecycle: idle → (user clicks Pen button) → active → (pointer down) →
 * sampling → (pointer up) → simplify → addElement → idle.
 *
 * Interactions used: onPointerDown, onPointerMove (while down), onPointerUp.
 * No keyboard, no activate/deactivate hooks (the host overlay manages
 * activation via the toolbar; we don't reach into that surface).
 */
export const FreehandTool: AtlasdrawTool = {
  id: "freehand",
  label: "Freehand",
  icon: "pen",
  cursor: "crosshair",
  defaultScaleMode: "hybrid",

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    activeStroke = {
      pointerId: e.pointerId,
      zRef: ctx.map.getZoom(),
      points: [[lng, lat]],
    };
  },

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    // Defend against hover events arriving without a prior down (other
    // pointers, or a host that wires move outside the gesture). Fire-and-
    // forget collection here would silently corrupt the next stroke.
    if (activeStroke === null) {
      return;
    }
    if (activeStroke.pointerId !== e.pointerId) {
      return;
    }
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    activeStroke.points.push([lng, lat]);
  },

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext) {
    if (activeStroke === null) {
      return;
    }
    if (activeStroke.pointerId !== e.pointerId) {
      return;
    }

    // Capture the final pointer-up location too — the user's release point
    // is intentional, and the move stream often misses the last few px.
    const { lng, lat } = ctx.map.unproject([e.clientX, e.clientY]);
    activeStroke.points.push([lng, lat]);

    const simplified = rdp(activeStroke.points, RDP_EPSILON_DEG);
    const zRef = activeStroke.zRef;

    // Reset BEFORE addElement so a synchronous host that re-enters the tool
    // (rare, but possible if addElement triggers a re-render that fires
    // another pointer event) sees a clean buffer.
    activeStroke = null;

    // A single-vertex "stroke" (instantaneous click without move) is not a
    // meaningful freehand element — drop it rather than emit a degenerate
    // polyline with one point. Host can decide whether to surface UI
    // feedback for the no-op; the tool stays silent.
    if (simplified.length < 2) {
      return;
    }

    ctx.excalidraw.addElement({
      type: "freedraw",
      geo: { kind: "polyline", coordinates: simplified, zRef },
      scaleMode: "hybrid",
    });
  },
};
