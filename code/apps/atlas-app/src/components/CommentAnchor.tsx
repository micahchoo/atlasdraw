// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentAnchor.
//
// Renders a comment-bubble badge at the anchor's screen-projected position.
// Two anchor kinds:
//   - "map":     MapLibre map.project([lng, lat]) → screen-space pixel point.
//   - "element": Excalidraw scene-coords → viewport-coords via
//                @excalidraw/common's sceneCoordsToViewportCoords helper
//                (verified at code/packages/common/src/utils.ts:439).
//
// Re-projection is computed every map move / app-state update. CommentAnchor
// is a thin presentational component; the parent (MapEditor overlay) owns
// the reactive subscription and supplies the current `screenX/screenY` here.
//
// Click → popover with text + Resolve action (no replies in v1 per Q-P6-1).
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useState } from "react";

import styles from "../styles/CommentAnchor.module.css";

import type { Comment } from "../state/comments";

export interface CommentAnchorProps {
  comment: Comment;
  /** Projected screen-x of the anchor inside the overlay container. */
  screenX: number;
  /** Projected screen-y of the anchor inside the overlay container. */
  screenY: number;
  onResolve?: (commentId: string) => void;
  isOwn?: boolean;
  onEdit?: (commentId: string, newText: string) => void;
}

export function CommentAnchor(props: CommentAnchorProps): React.JSX.Element {
  const { comment, screenX, screenY, onResolve, isOwn, onEdit } = props;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  const startEditing = (): void => {
    setEditText(comment.text);
    setEditing(true);
  };

  const cancelEditing = (): void => {
    setEditing(false);
  };

  const saveEditing = (): void => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== comment.text && onEdit) {
      onEdit(comment.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className={styles.anchor}
      style={{ left: `${screenX}px`, top: `${screenY}px` }}
      data-testid={`comment-anchor-${comment.id}`}
      data-anchor-kind={comment.anchor.kind}
    >
      <button
        type="button"
        className={[
          styles.button,
          comment.resolved ? styles.buttonResolved : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={`Comment by ${comment.authorName}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`comment-anchor-button-${comment.id}`}
      >
        <svg
          className={styles.icon}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h12v8H6l-3 3v-3H2z" />
        </svg>
      </button>

      {open && (
        <div
          className={styles.popover}
          role="dialog"
          aria-label="Comment"
          data-testid={`comment-popover-${comment.id}`}
        >
          <div className={styles.popoverHeader}>
            <span className={styles.popoverAuthor}>
              {comment.authorName || "Anon"}
            </span>
            <span className={styles.popoverTimestamp}>
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          </div>
          {editing ? (
            <div className={styles.popoverEditArea}>
              <textarea
                className={styles.popoverEditTextarea}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                aria-label="Edit comment text"
                data-testid={`comment-popover-edit-text-${comment.id}`}
              />
              <div className={styles.popoverEditActions}>
                <button
                  type="button"
                  className={styles.popoverButton}
                  onClick={saveEditing}
                  data-testid={`comment-popover-save-${comment.id}`}
                >
                  Save
                </button>
                <button
                  type="button"
                  className={styles.popoverButton}
                  onClick={cancelEditing}
                  data-testid={`comment-popover-cancel-${comment.id}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.popoverText}>{comment.text}</div>
          )}
          {!comment.resolved && (
            <div className={styles.popoverActions}>
              {isOwn && !editing && (
                <button
                  type="button"
                  className={styles.popoverButton}
                  onClick={startEditing}
                  data-testid={`comment-popover-edit-${comment.id}`}
                >
                  Edit
                </button>
              )}
              {onResolve && (
                <button
                  type="button"
                  className={styles.popoverButton}
                  onClick={() => {
                    onResolve(comment.id);
                    setOpen(false);
                  }}
                  data-testid={`comment-popover-resolve-${comment.id}`}
                >
                  Resolve
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
