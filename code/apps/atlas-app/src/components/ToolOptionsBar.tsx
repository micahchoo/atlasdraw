/**
 * ToolOptionsBar — context-sensitive controls for the active atlas tool.
 *
 * Appears centered below Excalidraw's toolbar when an atlas tool is active.
 * Shows the tool label, a scale-mode segmented toggle, and placeholder slots
 * for future stroke/fill controls. Uses --ad-* design tokens throughout.
 *
 * Design: drafting instrument panel — compact, precise, disappears when not
 * needed. Same surface temperature as the raised dialog level.
 */

import React from "react";

import styles from "../styles/ToolOptionsBar.module.css";

import type { AtlasdrawTool, ScaleMode } from "@atlasdraw/tools";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ToolOptionsBarProps {
  tool: AtlasdrawTool;
  scaleMode: ScaleMode;
  onScaleModeChange: (mode: ScaleMode) => void;
}

// ---------------------------------------------------------------------------
// Scale mode options
// ---------------------------------------------------------------------------

const SCALE_MODES: { value: ScaleMode; label: string }[] = [
  { value: "geographic", label: "Geo" },
  { value: "screen", label: "Screen" },
  { value: "hybrid", label: "Hybrid" },
];

// ---------------------------------------------------------------------------

export function ToolOptionsBar({
  tool,
  scaleMode,
  onScaleModeChange,
}: ToolOptionsBarProps) {
  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={`${tool.label} options`}
      data-testid="tool-options-bar"
    >
      {/* Tool identity */}
      <span className={styles.toolLabel}>{tool.label}</span>

      <span className={styles.separator} />

      {/* Scale mode toggle */}
      <div className={styles.modeGroup} data-testid="scale-mode-toggle">
        {SCALE_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={[
              styles.modeButton,
              scaleMode === m.value ? styles.modeButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onScaleModeChange(m.value)}
            aria-pressed={scaleMode === m.value}
            data-testid={`scale-mode-${m.value}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Future: stroke width + fill color slots */}
      <span className={styles.hint}>Escape to cancel</span>
    </div>
  );
}
