// SPDX-License-Identifier: MPL-2.0
//
// The Measure tool's path, as a pure state machine. The atlas-app overlay
// (`MeasureLayer`) feeds it pointer and key events in lng/lat; it holds no
// screen state, so the path stays correct when the map pans, zooms or turns.
//
//   idle ──click──▶ measuring ──click near last point / Enter──▶ done
//                     ▲  │ click, move, undo                      │
//                     │  └───────────────────────────────────────┘
//                     └──────────────── click (a new path) ◀──────┘
//
// "Near the last point" is the caller's test, in screen pixels: the second
// click of a double-click lands there, so a double-click ends the path
// without adding a point.

import type { LngLat } from "@atlasdraw/geo";

export interface MeasureState {
  readonly phase: "idle" | "measuring" | "done";
  readonly points: readonly LngLat[];
  /** Where the pointer is while measuring: the end of the running segment. */
  readonly hover: LngLat | null;
}

export type MeasureEvent =
  | { readonly type: "click"; readonly at: LngLat; readonly nearLast: boolean }
  | { readonly type: "move"; readonly at: LngLat }
  | { readonly type: "finish" }
  | { readonly type: "undo" }
  | { readonly type: "reset" };

export const IDLE_MEASURE: MeasureState = {
  phase: "idle",
  points: [],
  hover: null,
};

function finished(s: MeasureState): MeasureState {
  return s.points.length >= 2 ? { ...s, phase: "done", hover: null } : s;
}

export function measureStep(s: MeasureState, e: MeasureEvent): MeasureState {
  switch (e.type) {
    case "click":
      if (s.phase === "measuring") {
        return e.nearLast && s.points.length > 0
          ? finished(s)
          : { ...s, points: [...s.points, e.at], hover: null };
      }
      return { phase: "measuring", points: [e.at], hover: null };
    case "move":
      return s.phase === "measuring" ? { ...s, hover: e.at } : s;
    case "finish":
      return s.phase === "measuring" ? finished(s) : s;
    case "undo":
      return s.phase === "measuring" && s.points.length > 0
        ? { ...s, points: s.points.slice(0, -1) }
        : s;
    case "reset":
      return IDLE_MEASURE;
  }
}

/** The path to draw and measure: the points, then the pointer while measuring. */
export function shownPath(s: MeasureState): readonly LngLat[] {
  return s.phase === "measuring" && s.hover && s.points.length > 0
    ? [...s.points, s.hover]
    : s.points;
}
