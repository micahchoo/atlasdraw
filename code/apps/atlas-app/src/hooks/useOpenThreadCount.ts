// SPDX-License-Identifier: AGPL-3.0-only
// The comment badge count (CommentModeButton, and the Threads section's
// disclosure).
//
// Comments are a mode, so their surface is not always on screen.
// The badge is what stops that from making them invisible. It counts OPEN
// threads — `resolved === false` — read straight off the live CommentsLayer
// snapshot, the same array CommentsPanel and CommentAnchorsOverlay render
// from. There is deliberately no parallel counter to drift.
//
// Naming: "open", not "unread". The comment schema
// (protocol/comment-schema.ts CommentSchemaV1) carries no per-user read
// receipt, so "unread" cannot be derived without changing what goes over the
// realtime channel. "Open" is the honest word for what we can count, and it
// is also the number that matters for a review pass: threads still needing
// an answer.

import { useEffect, useState } from "react";

import { useDocumentStore } from "../state/document";

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

/** Live count of unresolved threads on a comments layer. */
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

/** The same count for the open document's comments. */
export function useOpenThreadCount(): number {
  return useOpenThreadCountFor(useDocumentStore((s) => s.doc.comments));
}
