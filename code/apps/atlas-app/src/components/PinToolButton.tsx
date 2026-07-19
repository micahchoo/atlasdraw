// SPDX-License-Identifier: AGPL-3.0-only
//
// Pin-tool toggle ON the drawing-tools toolbar (injected into Excalidraw's
// shapes Island via `renderToolbarExtras`, alongside GeoSearchControl).
//
// IA note: the pin toggle previously lived as a MainMenu.Item ("Pin to map",
// W-B Rule-0 retrofit). The menu is document/app scope; a drawing tool
// belongs on the toolbar with the other tools — this is the first step of
// the atlas-tools/toolbar merge (anchoring-as-a-mode), not a revival of the
// old free-floating .pinButton overlay.
//
// Styling: renders inside the `.excalidraw` scope, so it uses Excalidraw
// CSS vars to match the native tool buttons (same pattern as
// GeoSearchControl's toolbar button).

import styles from "../styles/PinToolButton.module.css";

const PinIcon = () => (
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
    <path d="M8 1.5c-2.5 0-4.5 2-4.5 4.5 0 3.4 4.5 8.5 4.5 8.5s4.5-5.1 4.5-8.5c0-2.5-2-4.5-4.5-4.5z" />
    <circle cx="8" cy="6" r="1.8" />
  </svg>
);

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
      data-testid="toolbar-pin-button"
    >
      <PinIcon />
    </button>
  );
}
