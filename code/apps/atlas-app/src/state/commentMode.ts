// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — comment MODE.
//
// Comments stopped being a sidebar tab (a flat chronological list in a ~300px
// column whose empty state was most of its screen time) and became a mode, the
// way Felt / Figma / FigJam independently converged on. A mode is a single
// boolean that several unrelated surfaces have to agree about:
//
//   SheetRail            — renders the toggle and its pressed state
//   useMapEditorKeyboard — the keyboard toggle + Escape exit
//   useCommentModeTool   — arms the anchor picker, swaps the Excalidraw tool,
//                          and exits the mode when the user picks a real tool
//   CommentAnchorsOverlay— shows the draft composer at the picked anchor
//   MapEditor            — the crosshair cursor + the on-plate hint
//
// None of those is an ancestor of the others, so this is a module-level
// vanilla store with subscribe + getSnapshot (identical shape to its
// neighbour `comments-anchor-picker.ts`) rather than a context. Single
// instance per app — module lifetime matches MapEditor's.
//
// It deliberately holds ONLY the boolean. The "which tool were we on before"
// memory lives in useCommentModeTool, because restoring it is an effect with
// a cleanup, not a piece of shared state anyone else reads.

import { useSyncExternalStore } from "react";

let _active = false;
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

function _getSnapshot(): boolean {
  return _active;
}

/** True while the editor is in comment mode. */
export function isCommentModeActive(): boolean {
  return _active;
}

export function setCommentMode(active: boolean): void {
  if (_active === active) {
    return;
  }
  _active = active;
  _emit();
}

export function toggleCommentMode(): void {
  setCommentMode(!_active);
}

export function useCommentMode(): boolean {
  return useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
}

// Test-only resetter — vitest beforeEach uses this so mode does not leak
// between cases. Not exported via any index.
export function __resetForTest(): void {
  _active = false;
  _listeners.clear();
}
