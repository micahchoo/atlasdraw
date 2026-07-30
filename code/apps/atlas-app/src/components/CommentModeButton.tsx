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

import styles from "../styles/CommentModeButton.module.css";

const CommentModeIcon = () => (
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
    <path d="M2 3h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9l-3 3v-3H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M5 7h6M5 9h4" />
  </svg>
);

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
      <CommentModeIcon />
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
