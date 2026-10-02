// SPDX-License-Identifier: AGPL-3.0-only
//
// FeaturePopup — the attributes of the feature a click opened, next to the
// click (gap 3 in research-08: "click a feature → see its attributes").
//
// Surface decision (atlasdraw-ui-conventions, Rule 0): the attributes belong
// to one place on the map, so they show at that place. The layer panel's
// attribute preview is the other surface, and it describes a layer, not a
// feature. The popup is a transient pop-over in the z-10 band (popups and
// banners); it holds no state of its own except "show all".
//
// Keys and values are text nodes, never HTML: the properties come from files
// the user did not write.
//
// Keyboard: the popup takes the focus when it opens, Tab reaches its
// buttons, and Escape closes it and gives the focus back to where it was. A
// press anywhere outside it closes it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { attributeRows } from "../lib/featureHit";
import { POPUP_ROWS, type OpenPopup } from "../hooks/useFeaturePopup";

import styles from "../styles/FeaturePopup.module.css";

export interface FeaturePopupProps {
  popup: OpenPopup | null;
  onClose: () => void;
}

export function FeaturePopup({ popup, onClose }: FeaturePopupProps) {
  if (!popup) {
    return null;
  }
  // A new feature is a new popup: "show all" and the focus start again.
  return (
    <OpenFeaturePopup
      key={`${popup.hit.overlayId} ${popup.lngLat.lng} ${popup.lngLat.lat}`}
      popup={popup}
      onClose={onClose}
    />
  );
}

function OpenFeaturePopup({
  popup,
  onClose,
}: {
  popup: OpenPopup;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [flip, setFlip] = useState({ x: false, y: false });
  const rows = attributeRows(popup.hit.properties);
  const shown = showAll ? rows : rows.slice(0, POPUP_ROWS);
  const titleId = `feature-popup-title-${popup.hit.overlayId}`;

  // Focus moves in on open and goes back on close.
  useEffect(() => {
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    ref.current?.focus();
    return () => {
      if (before?.isConnected) {
        before.focus();
      }
    };
  }, []);

  // Escape, and a press outside, close it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  // Open toward the side that has room.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) {
      return;
    }
    setFlip({
      x: popup.x + el.offsetWidth + 16 > parent.clientWidth,
      y: popup.y + el.offsetHeight + 16 > parent.clientHeight,
    });
  }, [popup.x, popup.y, showAll]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={[
        styles.popup,
        flip.x ? styles.flipX : "",
        flip.y ? styles.flipY : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: popup.x, top: popup.y }}
      data-testid="feature-popup"
    >
      <div className={styles.header}>
        <span id={titleId} className={styles.title}>
          {popup.hit.label}
        </span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close"
          data-testid="feature-popup-close"
          onClick={onClose}
        >
          <svg
            className={styles.icon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>This feature has no attributes.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              {`Attributes of a feature in ${popup.hit.label}`}
            </caption>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!showAll && rows.length > POPUP_ROWS && (
        <button
          type="button"
          className={styles.showAll}
          data-testid="feature-popup-show-all"
          onClick={() => setShowAll(true)}
        >
          {`Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
