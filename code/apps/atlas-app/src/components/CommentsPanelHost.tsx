// SPDX-License-Identifier: AGPL-3.0-only
// CommentsPanelHost.
//
// Thin wrapper that gives <CommentsPanel/> the open document's comments and
// this browser's identity (state/identity.ts) as the author. Pending-anchor
// coordination flows through the comments-anchor-picker store: the panel
// signals "I want a map/element anchor" via onRequestAnchor → setAnchorMode;
// the canvas overlay (CommentAnchorsOverlay) takes the next click on the plate,
// resolves the anchor, and writes it back via setPendingAnchor. After a
// successful submit the panel fires onSubmitted which clears the picker so the
// next comment starts fresh.
// Mounted by LayerPanel's ThreadsSection, inside the Layers tab. There is no
// "comments" Sidebar tab: comments are a mode, and this list is one level
// down.

import React, { useCallback } from "react";

import { useDocumentStore } from "../state/document";
import { localIdentity } from "../state/identity";

import {
  clearAnchorPicker,
  setAnchorMode,
  usePendingAnchor,
} from "../state/comments-anchor-picker";

import { CommentsPanel } from "./CommentsPanel";

export function CommentsPanelHost(): React.JSX.Element {
  const commentsLayer = useDocumentStore((s) => s.doc.comments);
  const { anchor: pendingAnchor } = usePendingAnchor();

  const { id: authorId, name: authorName } = localIdentity();

  const onRequestAnchor = useCallback((kind: "map" | "element") => {
    setAnchorMode(kind);
  }, []);

  const onSubmitted = useCallback(() => {
    clearAnchorPicker();
  }, []);

  return (
    <CommentsPanel
      commentsLayer={commentsLayer}
      authorId={authorId}
      authorName={authorName}
      pendingAnchor={pendingAnchor}
      onRequestAnchor={onRequestAnchor}
      onSubmitted={onSubmitted}
    />
  );
}
