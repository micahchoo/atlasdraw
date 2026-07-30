// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — the composer for a thread being placed in comment mode.
//
// Comment mode is only a mode if the whole gesture happens on the plate:
// click a point, type, post. Sending the user back to a sidebar column to
// finish the sentence is the tab we just deleted, wearing a hat. So the
// composer projects to the anchor the user just picked, exactly where
// CommentAnchor will render the finished thread.
//
// Rendered by CommentAnchorsOverlay, which already owns the projection math
// for both anchor kinds and re-runs it on map move / scene change.
//
// Keyboard: Escape closes the draft (and, upstream, leaves the mode);
// Cmd/Ctrl+Enter posts. Every key is stopPropagation'd at the container —
// text-editing-mode-isolation, the same guard CommentsPanel's composer uses,
// so typing "r" here never selects the rectangle tool and Space never pans.

import React, { useEffect, useRef, useState } from "react";

import styles from "../styles/CommentDraftBubble.module.css";

export interface CommentDraftBubbleProps {
  /** Projected screen-x of the pending anchor, in overlay coordinates. */
  screenX: number;
  /** Projected screen-y of the pending anchor, in overlay coordinates. */
  screenY: number;
  /** "map" | "element" — shown as a one-word provenance line. */
  anchorKind: "map" | "element";
  /** Commit. The parent writes to the CommentsLayer and re-arms the picker. */
  onSubmit: (text: string) => void;
  /** Abandon the draft. */
  onCancel: () => void;
  /** False when there is no collab session, i.e. nowhere to write. */
  canSubmit: boolean;
}

export function CommentDraftBubble(
  props: CommentDraftBubbleProps,
): React.JSX.Element {
  const { screenX, screenY, anchorKind, onSubmit, onCancel, canSubmit } = props;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on placement — the click that set the anchor is the same gesture
  // that should start the sentence.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || !canSubmit) {
      return;
    }
    onSubmit(trimmed);
    setText("");
  };

  return (
    <div
      className={styles.draft}
      style={{ left: `${screenX}px`, top: `${screenY}px` }}
      role="dialog"
      aria-label="New comment thread"
      data-testid="comment-draft-bubble"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
          return;
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div
        className={styles.provenance}
        data-testid="comment-draft-anchor-kind"
      >
        {anchorKind === "map" ? "Anchored to map point" : "Anchored to element"}
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start a thread…"
        aria-label="Comment text"
        data-testid="comment-draft-text"
        disabled={!canSubmit}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={onCancel}
          data-testid="comment-draft-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className={[styles.button, styles.buttonPrimary].join(" ")}
          disabled={!canSubmit || text.trim().length === 0}
          aria-disabled={!canSubmit || text.trim().length === 0}
          title={
            canSubmit
              ? "Post thread (⌘↵)"
              : "Comments require an active collab session"
          }
          onClick={submit}
          data-testid="comment-draft-submit"
        >
          Post
        </button>
      </div>
    </div>
  );
}
