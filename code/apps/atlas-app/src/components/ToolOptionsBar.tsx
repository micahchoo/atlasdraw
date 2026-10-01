/**
 * ToolOptionsBar — the options bar for the active atlas drawing tool.
 *
 * Appears centered below Excalidraw's toolbar while an atlas tool (pin, …)
 * is active. Shows the tool label and an optional "Escape to cancel" hint.
 * The Measure tool and the selection readout (MeasureLayer) put their values
 * and controls in it as children.
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
  /** Values and controls after the label. */
  children?: React.ReactNode;
  /** Test id; the atlas tool bar keeps the default. */
  testId?: string;
}

// ---------------------------------------------------------------------------

export function ToolOptionsBar({
  label,
  showEscapeHint = false,
  children,
  testId = "tool-options-bar",
}: ToolOptionsBarProps) {
  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={`${label} options`}
      data-testid={testId}
    >
      {/* Tool identity */}
      <span className={styles.toolLabel}>{label}</span>

      {children}
      {showEscapeHint && (
        <>
          <span className={styles.separator} />
          <span className={styles.hint}>Escape to cancel</span>
        </>
      )}
    </div>
  );
}
