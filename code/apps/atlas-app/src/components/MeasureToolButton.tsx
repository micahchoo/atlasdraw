// SPDX-License-Identifier: AGPL-3.0-only
//
// MeasureToolButton — the Measure tool's toggle on the drawing-tools toolbar,
// beside PinToolButton in the `renderToolbarExtras` slot. It reads and flips
// the session view itself; MeasureLayer does the measuring.

import { MeasureIcon } from "../lib/icons";
import { useView } from "../session/SessionContext";
import styles from "../styles/MeasureToolButton.module.css";

export function MeasureToolButton() {
  const active = useView((s) => s.measuring);
  const onToggle = useView((s) => s.toggleMeasuring);
  return (
    <button
      type="button"
      className={[styles.button, active ? styles.buttonActive : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      aria-pressed={active}
      aria-label="Measure distance"
      title="Measure distance — M"
      data-testid="measure-tool-button"
    >
      <MeasureIcon className={styles.icon} />
    </button>
  );
}
