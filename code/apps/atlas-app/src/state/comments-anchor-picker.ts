// SPDX-License-Identifier: AGPL-3.0-only
// Pending-anchor picker store.
//
// The CommentsPanel (the Threads section of the Layers tab) and the canvas
// overlay (CommentAnchorsOverlay, which hit-tests a click on the plate) share
// a single `pendingAnchor` slot:
//
//   - Panel: "user wants to anchor on the map"   → setAnchorMode("map")
//   - Click on an element / a raster / the map   → setPendingAnchor(annotation | map)
//   - Panel submits comment                      → setPendingAnchor(null)
//
// Implemented as a tiny vanilla store with subscribe + getSnapshot so React
// can consume it via useSyncExternalStore with no context provider. Single
// instance per app — module-level state matches the lifetime of MapEditor.

import { useSyncExternalStore } from "react";

import type { CommentAnchor } from "@atlasdraw/protocol";

// "any" is comment MODE's armed state: the user has entered the mode
// but has not told us which kind of anchor they want, so the overlay's
// hit-test accepts every kind (element → raster → map). The panel's explicit
// Map/Element toggle still narrows to a single kind.
export type AnchorMode = "map" | "element" | "any" | null;

interface PickerState {
  mode: AnchorMode;
  anchor: CommentAnchor | null;
  /**
   * Arm generation. The overlay's click-intercept re-appears when
   * the pending anchor is nulled, so `setAnchorMode` clearing the anchor is
   * the re-arm; this monotonically-increasing counter is what makes that
   * re-arm observable to any subscription-based consumer (`mode` alone cannot
   * express it: after posting in comment mode the mode is "any" both before
   * and after, and a `null`-then-`"any"` round-trip is invisible because
   * React batches and `useSyncExternalStore` only ever sees the final
   * snapshot).
   */
  arm: number;
}

let _state: PickerState = { mode: null, anchor: null, arm: 0 };
const _listeners = new Set<() => void>();

function _emit(): void {
  for (const l of _listeners) {
    l();
  }
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _getSnapshot(): PickerState {
  return _state;
}

/**
 * Request a new anchor; clears any prior anchor while the user picks, and
 * re-arms the one-shot pickers even when `mode` is unchanged (see `arm`).
 */
export function setAnchorMode(mode: AnchorMode): void {
  _state = { mode, anchor: null, arm: _state.arm + 1 };
  _emit();
}

/** Anchor resolved by the canvas overlay (map click / element selection). */
export function setPendingAnchor(anchor: CommentAnchor | null): void {
  _state = { mode: _state.mode, anchor, arm: _state.arm };
  _emit();
}

/** Clear both mode and anchor — typically after a successful submit. */
export function clearAnchorPicker(): void {
  _state = { mode: null, anchor: null, arm: _state.arm + 1 };
  _emit();
}

export function usePendingAnchor(): PickerState {
  return useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
}

// Test-only resetter — vitest beforeEach uses this to avoid state leaking
// between test cases. Not exported via index for production.
export function __resetForTest(): void {
  _state = { mode: null, anchor: null, arm: 0 };
  _listeners.clear();
}
