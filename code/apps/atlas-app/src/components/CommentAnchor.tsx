// SPDX-License-Identifier: AGPL-3.0-only
// CommentAnchor.
//
// Renders a comment-bubble badge at the anchor's screen-projected position.
// Two canonical anchor kinds (data-anchor-kind is always the normalized kind):
//   - "map":        map.project([lng, lat]).
//   - "annotation": an element's corner through the world frame to lng/lat,
//                   then map.project; or map.project of the raster's corner
//                   centroid. v1 "element" anchors are normalized to this
//                   shape on read.
//
// CommentAnchor is a thin presentational component; the parent
// (CommentAnchorsOverlay) owns the projection and the reactive subscription
// and supplies the current `screenX/screenY` here.
//
// Click → popover with text + Resolve action. There are no replies.
//
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useState } from "react";

import { normalizeAnchor } from "@atlasdraw/protocol";

import styles from "../styles/CommentAnchor.module.css";

import type { Comment } from "../state/comments";

import { Button } from "./Button";

export interface CommentAnchorProps {
  comment: Comment;
  /** Projected screen-x of the anchor inside the overlay container. */
  screenX: number;
  /** Projected screen-y of the anchor inside the overlay container. */
  screenY: number;
  onResolve?: (commentId: string) => void;
  isOwn?: boolean;
  onEdit?: (commentId: string, newText: string) => void;
  /**
   * Bumped by the parent when something off-canvas — a canvas-search hit —
   * asked for THIS comment. A nonce rather than a boolean so that asking
   * twice re-opens a popover the user closed in between (state/commentFocus.ts
   * explains why the signal is an event). `open` stays local state: this only
   * nudges it, so the close button still works.
   */
  focusNonce?: number;
}

export function CommentAnchor(props: CommentAnchorProps): React.JSX.Element {
  const { comment, screenX, screenY, onResolve, isOwn, onEdit, focusNonce } =
    props;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  useEffect(() => {
    if (focusNonce !== undefined) {
      setOpen(true);
    }
  }, [focusNonce]);

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
      data-anchor-kind={normalizeAnchor(comment.anchor).kind}
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveEditing}
                  data-testid={`comment-popover-save-${comment.id}`}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  onClick={cancelEditing}
                  data-testid={`comment-popover-cancel-${comment.id}`}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.popoverText}>{comment.text}</div>
          )}
          {!comment.resolved && (
            <div className={styles.popoverActions}>
              {isOwn && !editing && (
                <Button
                  size="sm"
                  onClick={startEditing}
                  data-testid={`comment-popover-edit-${comment.id}`}
                >
                  Edit
                </Button>
              )}
              {onResolve && (
                <Button
                  size="sm"
                  onClick={() => {
                    onResolve(comment.id);
                    setOpen(false);
                  }}
                  data-testid={`comment-popover-resolve-${comment.id}`}
                >
                  Resolve
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
