// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentsPanel.
//
// Sidebar tab body listing all comments in chronological order. Provides
// resolve/delete actions and a compose-bar with map/element anchor mode.
//
// Mount: registered via excalidrawAPI.registerSidebarTab({ name: "comments" })
// from MapEditor (slot-first per atlasdraw-ui-conventions Rule 0 — Sidebar
// tab, not a new floating panel).
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useState } from "react";

import styles from "../styles/CommentsPanel.module.css";

import type { CommentAnchor } from "@atlasdraw/protocol";
import type { Comment, CommentsLayer } from "../state/comments";

// ---------------------------------------------------------------------------
// External controller hook handshake
//
// CommentsPanel itself is presentation. The compose-bar's anchor selection
// requires global UI state (drop-pin on map / select-element from canvas)
// owned by MapEditor — so the panel exposes a callback when the user picks
// an anchor mode, and the parent supplies the resolved anchor before
// submission. For Phase 6 we accept the anchor as a parent-provided prop:
//
//   <CommentsPanel
//     commentsLayer={collab.commentsLayer}
//     authorId={socketId}
//     authorName={username}
//     pendingAnchor={pendingAnchor}
//     onRequestAnchor={(kind) => setAnchorMode(kind)}
//   />
// ---------------------------------------------------------------------------

export interface CommentsPanelProps {
  commentsLayer: CommentsLayer | null;
  /** Author identity. socket.id at create time; rotates on reconnect. */
  authorId: string;
  authorName: string;
  /**
   * The resolved anchor for the next addComment(). When non-null, the
   * "Post" button is enabled. Cleared by the parent after submit.
   */
  pendingAnchor?: CommentAnchor | null;
  /**
   * Signals to the parent that the user wants to pick an anchor. The parent
   * (MapEditor) is responsible for entering "drop pin" or "select element"
   * mode and producing the resolved anchor via pendingAnchor.
   */
  onRequestAnchor?: (kind: "map" | "element") => void;
  /**
   * Fires after a successful addComment. The parent uses this to clear the
   * pending-anchor picker so the user picks a fresh anchor for the next
   * comment.
   */
  onSubmitted?: () => void;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString();
}

export function CommentsPanel(props: CommentsPanelProps): React.JSX.Element {
  const {
    commentsLayer,
    authorId,
    authorName,
    pendingAnchor,
    onRequestAnchor,
    onSubmitted,
  } = props;

  // ---- Live snapshot from the CommentsLayer ------------------------------
  const [comments, setComments] = useState<ReadonlyArray<Comment>>(
    () => commentsLayer?.comments ?? [],
  );

  useEffect(() => {
    if (!commentsLayer) {
      setComments([]);
      return;
    }
    setComments(commentsLayer.comments);
    const unsubscribe = commentsLayer.subscribe((next) => {
      setComments(next);
    });
    return unsubscribe;
  }, [commentsLayer]);

  // ---- Local UI state ----------------------------------------------------
  const [showResolved, setShowResolved] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [anchorMode, setAnchorMode] = useState<"map" | "element">("map");

  // Initialize the anchor picker with the default mode on mount so the first
  // map click is captured without requiring an extra button press.
  useEffect(() => {
    onRequestAnchor?.("map");
    // Run once on mount; anchorMode starts as "map".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = showResolved ? comments : comments.filter((c) => !c.resolved);

  const canSubmit = !!commentsLayer && draftText.trim().length > 0;

  const submit = (): void => {
    if (!commentsLayer) {
      return;
    }
    const text = draftText.trim();
    if (!text) {
      return;
    }
    // Default to a map anchor at origin when no explicit anchor was picked.
    // The user can refine placement later by clicking the map first.
    const anchor = pendingAnchor ?? { kind: "map", lng: 0, lat: 0 };
    commentsLayer.addComment({
      text,
      anchor,
      authorId,
      authorName,
    });
    setDraftText("");
    onSubmitted?.();
    onRequestAnchor?.(anchorMode);
  };

  return (
    <div className={styles.root} data-testid="comments-panel">
      <div className={styles.filterBar}>
        <button
          type="button"
          className={styles.filterToggle}
          aria-pressed={showResolved}
          onClick={() => setShowResolved((v) => !v)}
          data-testid="comments-filter-show-resolved"
        >
          {showResolved ? "Hiding nothing" : "Show resolved"}
        </button>
      </div>

      <div className={styles.list} data-testid="comments-list">
        {visible.length === 0 ? (
          <div className={styles.empty} data-testid="comments-empty">
            No comments yet — click an element or a map point to anchor a
            comment.
          </div>
        ) : (
          visible.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              isOwn={c.authorId === authorId}
              onResolve={() => commentsLayer?.resolve(c.id)}
              onDelete={() => commentsLayer?.delete(c.id)}
              onEdit={(newText) => commentsLayer?.editComment(c.id, newText)}
            />
          ))
        )}
      </div>

      {/* Compose bar — text-editing-mode-isolation: stopPropagation on
          keyDown so Space/Enter never reach map pan / Excalidraw shortcut
          handlers. */}
      <div
        className={styles.composer}
        data-testid="comments-composer"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <textarea
          className={styles.composerTextarea}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="Write a comment…"
          aria-label="Comment text"
          data-testid="comments-composer-text"
          disabled={!commentsLayer}
        />
        <div className={styles.composerFooter}>
          <div
            className={styles.composerToggle}
            role="group"
            aria-label="Anchor type"
          >
            <button
              type="button"
              className={[
                styles.composerToggleBtn,
                anchorMode === "map" ? styles.composerToggleBtnActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={anchorMode === "map"}
              onClick={() => {
                setAnchorMode("map");
                onRequestAnchor?.("map");
              }}
              data-testid="comments-anchor-map"
            >
              Map
            </button>
            <button
              type="button"
              className={[
                styles.composerToggleBtn,
                anchorMode === "element" ? styles.composerToggleBtnActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={anchorMode === "element"}
              onClick={() => {
                setAnchorMode("element");
                onRequestAnchor?.("element");
              }}
              data-testid="comments-anchor-element"
            >
              Element
            </button>
          </div>
          <button
            type="button"
            className={styles.composerSubmit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            title={
              !commentsLayer
                ? "Comments require an active collab session"
                : "Post comment"
            }
            onClick={submit}
            data-testid="comments-submit"
          >
            Post
          </button>
        </div>
        {pendingAnchor == null && commentsLayer && (
          <div className={styles.composerHint} data-testid="comments-hint">
            {anchorMode === "map"
              ? "Click the map to pin this comment (or post without a pin)."
              : "Select an element to anchor this comment."}
          </div>
        )}
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: Comment;
  isOwn: boolean;
  onResolve: () => void;
  onDelete: () => void;
  onEdit: (newText: string) => void;
}

function CommentRow(props: CommentRowProps): React.JSX.Element {
  const { comment: c, isOwn, onResolve, onDelete, onEdit } = props;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(c.text);

  const anchorClassName = [
    styles.anchorBadge,
    c.anchor.kind === "map" ? styles.anchorBadgeMap : "",
  ]
    .filter(Boolean)
    .join(" ");

  const startEditing = (): void => {
    setEditText(c.text);
    setEditing(true);
  };

  const cancelEditing = (): void => {
    setEditing(false);
  };

  const saveEditing = (): void => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== c.text) {
      onEdit(trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className={[styles.row, c.resolved ? styles.rowResolved : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={`comments-row-${c.id}`}
    >
      <div className={styles.rowHeader}>
        <span className={styles.authorName}>{c.authorName || "Anon"}</span>
        <span className={styles.timestamp}>{formatTimestamp(c.createdAt)}</span>
      </div>
      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.editTextarea}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            aria-label="Edit comment text"
            data-testid={`comments-row-edit-text-${c.id}`}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className={styles.editActions}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={saveEditing}
              data-testid={`comments-row-save-${c.id}`}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={cancelEditing}
              data-testid={`comments-row-cancel-${c.id}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.text}>{c.text}</div>
      )}
      <span className={anchorClassName} aria-label="Anchor type">
        {c.anchor.kind === "map" ? "Map" : "Element"}
      </span>
      <div className={styles.rowActions}>
        {!c.resolved && (
          <>
            {isOwn && !editing && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={startEditing}
                data-testid={`comments-row-edit-${c.id}`}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className={styles.actionButton}
              onClick={onResolve}
              data-testid={`comments-row-resolve-${c.id}`}
            >
              Resolve
            </button>
          </>
        )}
        {isOwn && !editing && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={onDelete}
            data-testid={`comments-row-delete-${c.id}`}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
