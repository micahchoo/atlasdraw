// SPDX-License-Identifier: AGPL-3.0-only
// "Show me THAT comment" — the one-shot focus signal.
//
// Canvas search can now match comment text (see hooks/useCommentSearchSource).
// Picking a result has to do two things: move the viewport to the anchor, and
// open that anchor's popover — the search preview is a few words wide, so
// landing on a closed bubble is not an answer.
//
// The first half is a plain imperative call on the map / editor API. The
// second is this store: the search result and the anchor are in unrelated
// React trees (the result is inside Excalidraw's sidebar, the anchor is in
// MapEditor's overlay), so the signal has to travel through module state —
// same vanilla subscribe + getSnapshot shape as its neighbours
// `commentMode.ts` and `comments-anchor-picker.ts`.
//
// It carries a NONCE, not just an id, because this is an event and not a
// piece of state: picking the same result twice after closing the popover
// must re-open it, and an id-only store would report "no change" the second
// time. Consumers watch the nonce.

import { useSyncExternalStore } from "react";

export interface CommentFocus {
  commentId: string;
  /** Bumped on every request, including repeats of the same id. */
  nonce: number;
}

const NO_FOCUS: CommentFocus | null = null;

let _focus: CommentFocus | null = NO_FOCUS;
let _nextNonce = 1;
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

function _getSnapshot(): CommentFocus | null {
  return _focus;
}

/** Ask whoever renders `commentId` to reveal it. */
export function focusComment(commentId: string): void {
  _focus = { commentId, nonce: _nextNonce++ };
  _emit();
}

export function getCommentFocus(): CommentFocus | null {
  return _focus;
}

export function useCommentFocus(): CommentFocus | null {
  return useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
}

// Test-only resetter — vitest beforeEach uses this so focus does not leak
// between cases. Not exported via any index.
export function __resetForTest(): void {
  _focus = NO_FOCUS;
  _nextNonce = 1;
  _listeners.clear();
}
