// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentsPanelHost.
//
// Thin wrapper that reads the active CollabState from useCollab() and
// supplies it to <CommentsPanel/>. Pending-anchor coordination flows through
// the comments-anchor-picker store: the panel signals "I want a map/element
// anchor" via onRequestAnchor → setAnchorMode; the canvas overlay
// (CommentsAnchorPicker, owned by MapEditor) listens for the next map click
// or element selection, resolves the anchor, and writes it back via
// setPendingAnchor. After a successful submit the panel fires onSubmitted
// which clears the picker so the next comment starts fresh.
//
// This is the body markup for the "comments" Sidebar tab — registered in
// MapEditor via excalidrawAPI.registerSidebarTab.
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3

import React, { useCallback } from "react";
import { useCollab } from "../hooks/useCollab";
import { CommentsPanel } from "./CommentsPanel";
import {
  clearAnchorPicker,
  setAnchorMode,
  usePendingAnchor,
} from "../state/comments-anchor-picker";

export function CommentsPanelHost(): React.JSX.Element {
  const { commentsLayer } = useCollab();
  const { anchor: pendingAnchor } = usePendingAnchor();

  // Author identity — for Phase 6 v1, derive from the Y.Doc clientID (stable
  // across the session). socket.id would rotate on reconnect.
  // TODO(phase-7): replace with a stable user identity from auth.
  const authorId = commentsLayer
    ? `client-${commentsLayer.doc.clientID}`
    : "anonymous";
  const authorName = "You";

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
