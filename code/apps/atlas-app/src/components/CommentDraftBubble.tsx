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
// The pick click may have hit an element or raster (hitTarget non-null) or
// bare map (hitTarget null). A Follow/Pin toggle above the textarea lets the
// author choose: Follow keeps the annotation attached to the element/raster;
// Pin drops a geographic point instead. Only hits offer Follow.
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
  /**
   * What the pick click landed on. null means the click hit bare map, so
   * only "Pin to map" is available.
   */
  hitTarget: { kind: "element" | "raster" } | null;
  /** Commit. Carries the Follow/Pin choice; the parent shapes the anchor. */
  onSubmit: (text: string, followMode: boolean) => void;
  /** Abandon the draft. */
  onCancel: () => void;
  /** False when there is no collab session, i.e. nowhere to write. */
  canSubmit: boolean;
}

export function CommentDraftBubble(
  props: CommentDraftBubbleProps,
): React.JSX.Element {
  const { screenX, screenY, hitTarget, onSubmit, onCancel, canSubmit } = props;
  const [text, setText] = useState("");
  // Default to following whatever the click hit; bare-map drafts start pinned.
  const [followMode, setFollowMode] = useState(hitTarget !== null);
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
    onSubmit(trimmed, followMode);
    setText("");
  };

  const provenance =
    hitTarget?.kind === "raster"
      ? "Anchored to raster"
      : hitTarget?.kind === "element"
      ? "Anchored to element"
      : "Anchored to map point";

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
        {provenance}
      </div>
      <div role="group" aria-label="Anchor mode" className={styles.anchorMode}>
        <button
          type="button"
          aria-pressed={followMode}
          disabled={!hitTarget}
          onClick={() => setFollowMode(true)}
          className={styles.anchorModeButton}
          data-testid="comment-draft-follow"
        >
          Follow {hitTarget?.kind === "raster" ? "raster" : "element"}
        </button>
        <button
          type="button"
          aria-pressed={!followMode}
          onClick={() => setFollowMode(false)}
          className={styles.anchorModeButton}
          data-testid="comment-draft-pin"
        >
          Pin to map
        </button>
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
