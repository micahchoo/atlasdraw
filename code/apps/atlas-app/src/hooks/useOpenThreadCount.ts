// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — the rail's comment badge count.
//
// Comments became a mode, so their surface is no longer always on screen.
// The badge is what stops that from making them invisible. It counts OPEN
// threads — `resolved === false` — read straight off the live CommentsLayer
// snapshot, the same array CommentsPanel and CommentAnchorsOverlay render
// from. There is deliberately no parallel counter to drift.
//
// Naming: the design doc says "unread". The v1 wire format
// (protocol/comment-schema.ts CommentSchemaV1) carries no per-user read
// receipt, so "unread" is not derivable without changing what goes over the
// realtime channel — which this step does not do. "Open" is the honest word
// for what we can actually count, and it is also the number that matters for
// Marcus's review pass: threads still needing an answer.

import { useEffect, useState } from "react";

import { useCollab } from "./useCollab";

import type { Comment, CommentsLayer } from "../state/comments";

/** Pure predicate — a thread counts while nobody has resolved it. */
export function isOpenThread(comment: Comment): boolean {
  return !comment.resolved;
}

export function countOpenThreads(comments: ReadonlyArray<Comment>): number {
  let n = 0;
  for (const c of comments) {
    if (isOpenThread(c)) {
      n++;
    }
  }
  return n;
}

/**
 * Live count of unresolved threads on an explicitly-supplied layer.
 *
 * MapEditor uses this one, because it OWNS the CollabContext.Provider and so
 * must not go through `useCollab()`: outside its own provider that hook
 * constructs a second, disconnected `CollabState` as its no-provider
 * fallback. Harmless in isolation, but it means MapEditor would instantiate a
 * stray session on every mount — and MapEditor.collab-presence.test.tsx,
 * which identifies the live instance as "the last CollabState constructed",
 * would start driving the wrong one.
 */
export function useOpenThreadCountFor(
  commentsLayer: CommentsLayer | null,
): number {
  const [count, setCount] = useState(() =>
    commentsLayer ? countOpenThreads(commentsLayer.comments) : 0,
  );

  useEffect(() => {
    if (!commentsLayer) {
      setCount(0);
      return;
    }
    setCount(countOpenThreads(commentsLayer.comments));
    // `subscribe` hands us the whole snapshot on every Yjs mutation; deriving
    // here keeps the count and the list provably the same data.
    return commentsLayer.subscribe((next) => setCount(countOpenThreads(next)));
  }, [commentsLayer]);

  return count;
}

/**
 * The same count, read from the CollabContext. For consumers rendered INSIDE
 * MapEditor's provider — LayerPanel's Threads section, and anything else that
 * grows a thread count later.
 */
export function useOpenThreadCount(): number {
  return useOpenThreadCountFor(useCollab().commentsLayer);
}
