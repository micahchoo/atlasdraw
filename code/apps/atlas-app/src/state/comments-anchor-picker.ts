// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — pending-anchor picker store.
//
// The CommentsPanel (Sidebar tab body) and the MapEditor canvas overlay
// (MapLibre click handler + Excalidraw selection observer) need to share a
// single `pendingAnchor` slot:
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

export type AnchorMode = "map" | "element" | null;

interface PickerState {
  mode: AnchorMode;
  anchor: CommentAnchor | null;
}

let _state: PickerState = { mode: null, anchor: null };
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

/** Request a new anchor; clears any prior anchor while the user picks. */
export function setAnchorMode(mode: AnchorMode): void {
  _state = { mode, anchor: null };
  _emit();
}

/** Anchor resolved by the canvas overlay (map click / element selection). */
export function setPendingAnchor(anchor: CommentAnchor | null): void {
  _state = { mode: _state.mode, anchor };
  _emit();
}

/** Clear both mode and anchor — typically after a successful submit. */
export function clearAnchorPicker(): void {
  _state = { mode: null, anchor: null };
  _emit();
}

export function usePendingAnchor(): PickerState {
  return useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
}

// Test-only resetter — vitest beforeEach uses this to avoid state leaking
// between test cases. Not exported via index for production.
export function __resetForTest(): void {
  _state = { mode: null, anchor: null };
  _listeners.clear();
}
