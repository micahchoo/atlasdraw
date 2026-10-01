// SPDX-License-Identifier: AGPL-3.0-only
//
// PinToolButton — atlas Pin tool toggle ON the drawing-tools toolbar,
// portaled into the collar tool strip via the vendored `renderToolbarExtras`
// slot (alongside GeoSearchControl).
//
// The main menu is document/app scope; a drawing tool belongs on the toolbar
// with the other tools. The Pin tool itself is dispatched atlas-side
// (useAtlasdrawTool); this button only toggles it.
//
// Styling: renders inside the `.excalidraw` scope (the collar strip host
// re-establishes it), so it uses Excalidraw CSS vars with fallbacks to match
// the native tool buttons — same pattern as GeoSearchControl's toolbar button.

import { PinIcon } from "../lib/icons";
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
      <PinIcon className={styles.icon} />
    </button>
  );
}
