// SPDX-License-Identifier: AGPL-3.0-only
//
// PinToolButton — atlas Pin tool toggle on the collar tool strip.
//
// Injected via the vendored `renderToolbarExtras` slot, so it renders inside
// the `.excalidraw` scope (the collar strip host re-establishes it) and uses
// Excalidraw CSS vars with fallbacks — the same pattern as GeoSearchControl's
// toolbar variant. The Pin tool itself is dispatched atlas-side
// (useAtlasdrawTool); this button only toggles it.

import React from "react";

import styles from "../styles/PinToolButton.module.css";

interface PinToolButtonProps {
  active: boolean;
  onToggle: () => void;
}

export function PinToolButton({ active, onToggle }: PinToolButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, active ? styles.buttonActive : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      aria-pressed={active}
      aria-label="Pin to map"
      title="Pin to map"
      data-testid="pin-tool-button"
    >
      <svg
        className={styles.icon}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 14 C8 14 3.5 9.4 3.5 6.4 A4.5 4.5 0 0 1 12.5 6.4 C12.5 9.4 8 14 8 14 Z" />
        <circle cx="8" cy="6.4" r="1.6" />
      </svg>
    </button>
  );
}
