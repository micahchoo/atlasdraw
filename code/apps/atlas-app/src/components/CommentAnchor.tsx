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
import type { Comment } from "../state/comments";
import styles from "../styles/CommentAnchor.module.css";

export interface CommentAnchorProps {
  comment: Comment;
  /** Projected screen-x of the anchor inside the overlay container. */
  screenX: number;
  /** Projected screen-y of the anchor inside the overlay container. */
  screenY: number;
  onResolve?: (commentId: string) => void;
}

export function CommentAnchor(props: CommentAnchorProps): React.JSX.Element {
  const { comment, screenX, screenY, onResolve } = props;
  const [open, setOpen] = useState(false);

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
          <div className={styles.popoverText}>{comment.text}</div>
          {!comment.resolved && onResolve && (
            <div className={styles.popoverActions}>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
