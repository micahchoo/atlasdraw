// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — pending-anchor picker store.
//
// The CommentsPanel (now the Threads section of the Layers tab, not a tab of
// its own) and the MapEditor canvas overlay (MapLibre click handler +
// Excalidraw selection observer) need to share a single `pendingAnchor` slot:
//
//   - Panel: "user wants to anchor on the map"        → setMode("map")
//   - Map click → translate to {lng,lat}              → setAnchor({kind:"map",...})
//   - Excalidraw element selected → take elementId    → setAnchor({kind:"element",...})
//   - Panel submits comment                           → setAnchor(null)
//
// Implemented as a tiny vanilla store with subscribe + getSnapshot so React
// can consume it via useSyncExternalStore without forcing a context provider
// to wrap MapEditor (the existing component tree doesn't have one). Single
// instance per app — module-level state matches the lifetime of MapEditor.

import { useSyncExternalStore } from "react";

import type { CommentAnchor } from "@atlasdraw/protocol";

// "any" (Step 5) is comment MODE's arming value: the user has entered the mode
// but has not told us which kind of anchor they want, so BOTH pickers listen
// and whichever fires first wins. The panel's explicit Map/Element toggle still
// narrows to a single kind — that path is unchanged.
export type AnchorMode = "map" | "element" | "any" | null;

/** True when `mode` should arm the map-click picker. */
export function wantsMapAnchor(mode: AnchorMode): boolean {
  return mode === "map" || mode === "any";
}

/** True when `mode` should arm the element-selection picker. */
export function wantsElementAnchor(mode: AnchorMode): boolean {
  return mode === "element" || mode === "any";
}

interface PickerState {
  mode: AnchorMode;
  anchor: CommentAnchor | null;
  /**
   * Step 5 — arm generation. The pickers in CommentAnchorsOverlay are one-shot
   * (`map.once("click")`, and a `done` latch on the element observer), so
   * "arm again for the next thread" has to be observable. `mode` alone cannot
   * express it: after posting in comment mode the mode is "any" both before
   * and after, and a `null`-then-`"any"` round-trip is invisible because React
   * batches and `useSyncExternalStore` only ever sees the final snapshot.
   *
   * So `setAnchorMode` bumps this on EVERY call and the picker effects depend
   * on it. `setPendingAnchor` deliberately does not — otherwise resolving an
   * anchor would immediately re-arm the map listener and the next stray click
   * would drag a thread the user is still typing into.
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
