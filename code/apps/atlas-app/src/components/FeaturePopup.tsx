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
// It also shows a pin's details (title, description, link, photo) in the
// viewer and the embed: the same place-bound popup, with the same keyboard.
//
// Keys, values and a pin's fields are text nodes, never HTML: they come from
// files the user did not write. A pin's link is shown only when it is http
// or https, and opens in a new tab with no opener and no referrer. Its photo
// is shown only from the drawing's own file (a data: URL), never from
// another host.
//
// Keyboard: the popup takes the focus when it opens, Tab reaches its
// buttons, and Escape closes it and gives the focus back to where it was. A
// press anywhere outside it closes it.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { attributeRows, type FeatureHit } from "../lib/featureHit";
import {
  POPUP_ROWS,
  type OpenPopup,
  type PinHit,
} from "../hooks/useFeaturePopup";
import { safeLink } from "../state/pinDetails";

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
      key={`${hitId(popup.hit)} ${popup.lngLat.lng} ${popup.lngLat.lat}`}
      popup={popup}
      onClose={onClose}
    />
  );
}

function hitId(hit: FeatureHit | PinHit): string {
  return "kind" in hit ? hit.id : hit.overlayId;
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
  const hit = popup.hit;
  const rows = "kind" in hit ? [] : attributeRows(hit.properties);
  const shown = showAll ? rows : rows.slice(0, POPUP_ROWS);
  const titleId = `feature-popup-title-${hitId(hit)}`;
  const title = "kind" in hit ? hit.details.title ?? "Pin" : hit.label;

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
          {title}
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
      {"kind" in hit ? (
        <PinBody pin={hit} />
      ) : rows.length === 0 ? (
        <p className={styles.empty}>This feature has no attributes.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              {`Attributes of a feature in ${title}`}
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

/** A pin's description, link and photo, below its title. */
function PinBody({ pin }: { pin: PinHit }) {
  const { description, link, title } = pin.details;
  const href = link ? safeLink(link) : null;
  const photo = pin.photoUrl?.startsWith("data:image/") ? pin.photoUrl : null;
  if (!description && !href && !photo) {
    return <p className={styles.empty}>This pin has no details.</p>;
  }
  return (
    <div className={[styles.scroll, styles.pin].join(" ")}>
      {photo && (
        <img
          className={styles.photo}
          src={photo}
          alt={title ?? "Pin"}
          data-testid="pin-popup-photo"
        />
      )}
      {description && <p className={styles.description}>{description}</p>}
      {href && (
        <a
          className={styles.link}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pin-popup-link"
        >
          {href}
        </a>
      )}
    </div>
  );
}
