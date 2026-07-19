/**
 * ToolOptionsBar — the options bar for the active atlas drawing tool.
 *
 * Appears centered below Excalidraw's toolbar while an atlas tool (pin, …)
 * is active. Shows the tool label and an optional "Escape to cancel" hint.
 * (The Geo/Screen/Hybrid scale-mode toggle that briefly lived here was
 * removed 2026-07-19: "geographic" is the only creation mode.)
 *
 * Design: drafting instrument panel — compact, precise, disappears when not
 * needed. Same surface temperature as the raised dialog level.
 */

import React from "react";

import styles from "../styles/ToolOptionsBar.module.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ToolOptionsBarProps {
  /** Display label for the active tool ("Pin", "Rectangle", …). */
  label: string;
  /** Atlas tools cancel on Escape; native tools have their own lifecycle. */
  showEscapeHint?: boolean;
}

// ---------------------------------------------------------------------------

export function ToolOptionsBar({
  label,
  showEscapeHint = false,
}: ToolOptionsBarProps) {
  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={`${label} options`}
      data-testid="tool-options-bar"
    >
      {/* Tool identity */}
      <span className={styles.toolLabel}>{label}</span>

      {/* Future: stroke width + fill color slots */}
      {showEscapeHint && (
        <>
          <span className={styles.separator} />
          <span className={styles.hint}>Escape to cancel</span>
        </>
      )}
    </div>
  );
}
