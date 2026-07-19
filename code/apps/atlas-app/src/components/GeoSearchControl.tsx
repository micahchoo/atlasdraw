// SPDX-License-Identifier: AGPL-3.0-only
//
// Geo-search affordance that lives ON the drawing-tools toolbar (injected into
// Excalidraw's shapes Island via the `renderToolbarExtras` prop — see
// packages/excalidraw LayerUI). A magnifying-glass toggle button opens a small
// popover: type a place, pick a candidate, the map flies there.
//
// Styling note (atlasdraw-ui-conventions): the BUTTON renders inside the
// `.excalidraw` scope, so it uses Excalidraw CSS vars to match the native tool
// buttons. The POPOVER is portaled to document.body (to escape the toolbar's
// clipping/stacking), so it lives OUTSIDE that scope and uses the atlas hex
// palette. z-index 100 reuses the existing "context menu / popover" band.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useGeocoderSearch, type PlaceHit } from "../hooks/useGeocoderSearch";

import styles from "../styles/GeoSearchControl.module.css";

import type maplibregl from "maplibre-gl";

const POPOVER_WIDTH = 300;
const LISTBOX_ID = "geo-search-listbox";
const optionId = (index: number) => `geo-search-option-${index}`;

interface GeoSearchControlProps {
  map: maplibregl.Map | null;
  /**
   * "toolbar" (default) — icon-only button matching Excalidraw tool buttons
   * (renders inside the `.excalidraw` scope via renderToolbarExtras).
   * "collar" — search-field-shaped affordance for the Collar head bar
   * (outside the Excalidraw scope; --ad-* tokens).
   */
  variant?: "toolbar" | "collar";
}

interface PopoverPos {
  top: number;
  left: number;
}

const SearchIcon = () => (
  <svg
    className={styles.icon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" />
  </svg>
);

export function GeoSearchControl({
  map,
  variant = "toolbar",
}: GeoSearchControlProps) {
  const {
    enabled,
    query,
    setQuery,
    results,
    status,
    errorMessage,
    flyTo,
    reset,
  } = useGeocoderSearch(map);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<PopoverPos>({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    reset();
  }, [reset]);

  const select = useCallback(
    (hit: PlaceHit | undefined) => {
      if (!hit) {
        return;
      }
      flyTo(hit);
      close();
    },
    [flyTo, close],
  );

  // Position the popover under the button; recompute while open on
  // resize/scroll so it tracks the (fixed) toolbar.
  const reposition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) {
      return;
    }
    const rect = btn.getBoundingClientRect();
    const maxLeft = window.innerWidth - POPOVER_WIDTH - 8;
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, maxLeft)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Focus the input when the popover opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the active option in range as results change (highlight first match).
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  // Dismiss on outside pointerdown.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      buttonRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : -1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        results.length ? (i - 1 + results.length) % results.length : -1,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const index = activeIndex >= 0 ? activeIndex : 0;
      select(results[index]);
    }
  };

  if (!enabled) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          variant === "collar"
            ? [styles.collarButton, open ? styles.collarButtonActive : ""]
                .filter(Boolean)
                .join(" ")
            : [styles.button, open ? styles.buttonActive : ""]
                .filter(Boolean)
                .join(" ")
        }
        onClick={() => setOpen((v) => !v)}
        aria-label="Search places"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Search places"
        data-testid="geo-search-button"
      >
        <SearchIcon />
        {variant === "collar" && (
          <span className={styles.collarLabel} aria-hidden="true">
            Search places…
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={styles.popover}
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
            role="dialog"
            aria-label="Search places"
            data-testid="geo-search-popover"
          >
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search for a place…"
              aria-label="Place name or address"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={LISTBOX_ID}
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex >= 0 ? optionId(activeIndex) : undefined
              }
              autoComplete="off"
              spellCheck={false}
              data-testid="geo-search-input"
            />

            {status === "success" && (
              <ul
                id={LISTBOX_ID}
                role="listbox"
                className={styles.list}
                data-testid="geo-search-results"
              >
                {results.map((hit, index) => (
                  <li
                    key={`${hit.lng},${hit.lat},${index}`}
                    role="presentation"
                  >
                    <button
                      type="button"
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={[
                        styles.result,
                        index === activeIndex ? styles.resultActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => select(hit)}
                      onMouseEnter={() => setActiveIndex(index)}
                      data-testid="geo-search-result"
                    >
                      <span className={styles.resultName}>
                        {hit.label || `${hit.lat}, ${hit.lng}`}
                      </span>
                      {hit.kind && (
                        <span className={styles.resultKind}>{hit.kind}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {status === "loading" && (
              <div className={styles.hint} data-testid="geo-search-loading">
                Searching…
              </div>
            )}
            {status === "empty" && (
              <div className={styles.hint} data-testid="geo-search-empty">
                No matches for “{query.trim()}”.
              </div>
            )}
            {status === "error" && (
              <div
                className={styles.hint}
                role="alert"
                data-testid="geo-search-error"
              >
                {errorMessage}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
