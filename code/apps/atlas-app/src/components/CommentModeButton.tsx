// SPDX-License-Identifier: AGPL-3.0-only
//
// CommentModeButton — comment-mode toggle ON the drawing-tools toolbar,
// portaled into the collar tool strip via the vendored `renderToolbarExtras`
// slot (alongside PinToolButton and GeoSearchControl).
//
// IA note: the toggle previously lived on <SheetRail>, the right icon rail.
// The rail is the trigger surface for *panels* — every other item on it
// discloses a sidebar tab (`aria-expanded`). Comment mode discloses nothing;
// it changes what a click on the plate does, which is what the tool strip is
// for. Same move PinToolButton made when it left the main menu.
//
// The mode itself still lives in state/commentMode.ts — this button only
// flips it, exactly as the rail item did. The keyboard toggle and
// Escape-to-exit (useMapEditorKeyboard) are untouched.
//
// Styling: renders inside the `.excalidraw` scope (the collar strip host
// re-establishes it), so it uses Excalidraw CSS vars with fallbacks to match
// the native tool buttons — same pattern as PinToolButton.

import { CommentModeIcon } from "../lib/icons";
import styles from "../styles/CommentModeButton.module.css";

interface CommentModeButtonProps {
  active: boolean;
  onToggle: () => void;
  /**
   * Open (unresolved) thread count. Rendered as the badge, and spoken as part
   * of the accessible name so it reaches a screen reader rather than only the
   * eye. 0 renders no badge.
   */
  openThreadCount?: number;
}

export function CommentModeButton({
  active,
  onToggle,
  openThreadCount = 0,
}: CommentModeButtonProps) {
  const label =
    openThreadCount > 0
      ? `Comment mode, ${openThreadCount} open ${
          openThreadCount === 1 ? "thread" : "threads"
        }`
      : "Comment mode";

  return (
    <button
      type="button"
      className={[styles.button, active ? styles.buttonActive : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={
        openThreadCount > 0
          ? `Comment mode (${openThreadCount} open)`
          : "Comment mode"
      }
      data-testid="comment-mode-button"
    >
      <CommentModeIcon className={styles.icon} />
      {openThreadCount > 0 && (
        // aria-hidden: the same number is already in the accessible name
        // above. Announcing it twice is noise.
        <span
          className={styles.badge}
          aria-hidden="true"
          data-testid="comment-mode-badge"
        >
          {openThreadCount > 99 ? "99+" : openThreadCount}
        </span>
      )}
    </button>
  );
}
