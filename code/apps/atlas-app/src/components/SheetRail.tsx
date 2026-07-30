// SPDX-License-Identifier: AGPL-3.0-only
//
// SheetRail — the persistent icon rail in the right column of the Collar
// frame. It is the ONLY trigger surface for Excalidraw's DefaultSidebar in
// collar mode: the floating trigger button is suppressed (see vendored
// LayerUI) and the sidebar's own tab-trigger row is suppressed too, via the
// opt-in `hideDefaultSidebarTabTriggers` prop on <Excalidraw>.
//
// Why a rail and not the text tab strip it replaces: the sidebar header is
// 294px and lays its triggers out `repeat(auto-fit, minmax(0, 1fr))`, so four
// labelled triggers clipped into the literal string "Layersomments". A
// horizontal strip caps out at ~3 labels; a vertical icon rail is O(n) in
// height, the axis that has room. Labels live in `aria-label` + a tooltip.
//
// Why it is driven by `excalidrawAPI.getSidebarTabs()`: its predecessor
// (`CollarSheetTabs`) hardcoded `[layers, comments, library]` and had already
// drifted — no `search` entry at all, and structurally blind to any future
// `registerSidebarTab` call. `getSidebarTabs` is the same list DefaultSidebar
// renders from, stock tabs included, so the two can no longer disagree.
//
// Accessibility: the rail lives in a different React tree from the sidebar's
// Radix tablist, so it cannot honestly be `role="tab"` — a tab must be owned
// by the tablist that owns its panel. It is a `role="toolbar"` of toggle
// buttons instead: accessible name from the tab label, `aria-expanded` for
// open state, `aria-controls` at the sidebar island, roving tabindex with
// arrow-key navigation, tooltip on hover AND focus.
//
// Step 5: the rail hosts TWO kinds of item and does not pretend otherwise.
//   * tabs  (`data-rail-item="tab"`)  — open a panel in the sidebar. State is
//     `aria-expanded`, because that is what a disclosure of a panel is.
//   * modes (`data-rail-item="mode"`) — change what a click on the plate does.
//     Nothing is disclosed, so the state is `aria-pressed`, which is what a
//     toolbar toggle button uses. Comment mode is the first of these.
// A `role="toolbar"` of toggle buttons hosts a mode toggle far more naturally
// than a tablist ever hosted the comments tab; roving tabindex spans both
// kinds because keyboard users reach them from the same rail.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DEFAULT_SIDEBAR, DEFAULT_SIDEBAR_DOM_ID } from "@atlasdraw/common";

import type {
  ExcalidrawImperativeAPI,
  SidebarTabDescriptor,
} from "@atlasdraw/excalidraw/types";

import styles from "../styles/SheetRail.module.css";

const NO_TABS: readonly SidebarTabDescriptor[] = [];

/** Stable key for the comment-mode item — never a sidebar tab name. */
export const COMMENT_MODE_ITEM = "comment-mode";

const CommentModeIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 3h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9l-3 3v-3H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M5 7h6M5 9h4" />
  </svg>
);

interface SheetRailProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Comment mode on/off — drives `aria-pressed` on the mode toggle. */
  commentMode?: boolean;
  /** Flips comment mode. When omitted the mode item is not rendered at all. */
  onToggleCommentMode?: () => void;
  /**
   * Open (unresolved) thread count. Rendered as the badge, and spoken as part
   * of the toggle's accessible name so it reaches a screen reader rather than
   * only the eye. 0 renders no badge.
   */
  openThreadCount?: number;
}

export function SheetRail({
  excalidrawAPI,
  commentMode = false,
  onToggleCommentMode,
  openThreadCount = 0,
}: SheetRailProps) {
  // The tab list is a `useSyncExternalStore` pair on the imperative API. The
  // fork keeps the snapshot reference stable between register/unregister, so
  // this does not tear or loop.
  const store = useMemo(
    () => ({
      subscribe: excalidrawAPI
        ? excalidrawAPI.onSidebarTabsChange
        : () => () => {},
      getSnapshot: excalidrawAPI ? excalidrawAPI.getSidebarTabs : () => NO_TABS,
    }),
    [excalidrawAPI],
  );
  const tabs = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Open state mirrors appState.openSidebar. `onChange` fires on every
  // appState commit — cheap derive + set (React bails out when unchanged).
  // Two primitive `useState`s rather than one object so that bail-out holds;
  // a fresh object per commit would re-render the rail on every appState
  // change. `sidebarOpen` is not `openTab !== null`: the sidebar can be open
  // with no tab selected.
  const [openTab, setOpenTab] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    return excalidrawAPI.onChange((_elements, appState) => {
      const open = appState.openSidebar?.name === DEFAULT_SIDEBAR.name;
      setSidebarOpen(open);
      setOpenTab(open ? appState.openSidebar?.tab ?? null : null);
    });
  }, [excalidrawAPI]);

  // Roving tabindex: exactly one button is in the page tab order, arrows move
  // within the rail. Anchored to the open tab so Tab lands somewhere
  // meaningful. `keys` is the focus ring — tabs first, then the mode item, so
  // arrow order matches DOM order.
  const [focusName, setFocusName] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());

  const showCommentMode = !!onToggleCommentMode;
  const keys = useMemo(
    () => [
      ...tabs.map((tab) => tab.name),
      ...(showCommentMode ? [COMMENT_MODE_ITEM] : []),
    ],
    [tabs, showCommentMode],
  );

  // `null` means "no open tab" / "nothing focused yet" — an explicit -1 rather
  // than a sentinel string, which would be a key an item could theoretically own.
  const activeIndex = openTab === null ? -1 : keys.indexOf(openTab);
  const focusIndex = (() => {
    const byFocus = focusName === null ? -1 : keys.indexOf(focusName);
    if (byFocus >= 0) {
      return byFocus;
    }
    return activeIndex >= 0 ? activeIndex : 0;
  })();

  const moveFocus = useCallback(
    (index: number) => {
      const next = keys[index];
      if (next === undefined) {
        return;
      }
      setFocusName(next);
      buttonsRef.current.get(next)?.focus();
    },
    [keys],
  );

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = keys.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        moveFocus(index === last ? 0 : index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        moveFocus(index === 0 ? last : index - 1);
        break;
      case "Home":
        moveFocus(0);
        break;
      case "End":
        moveFocus(last);
        break;
      default:
        return;
    }
    // Only reached when a navigation key matched — keep Escape/Tab/Enter for
    // the browser and the editor's own handlers.
    event.preventDefault();
    event.stopPropagation();
  };

  if (!excalidrawAPI || keys.length === 0) {
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Sheet panel"
      className={styles.rail}
      data-testid="sheet-rail"
    >
      {tabs.map((tab, index) => {
        const expanded = tab.name === openTab;
        return (
          <div className={styles.slot} key={tab.name}>
            <button
              type="button"
              ref={(el) => {
                if (el) {
                  buttonsRef.current.set(tab.name, el);
                } else {
                  buttonsRef.current.delete(tab.name);
                }
              }}
              className={[styles.trigger, expanded ? styles.triggerOpen : ""]
                .filter(Boolean)
                .join(" ")}
              data-rail-item="tab"
              // Icon-only, so the label has to be the accessible name.
              aria-label={tab.label}
              aria-expanded={expanded}
              // The sidebar island only exists in the DOM while it is open
              // (`Sidebar` returns null otherwise), and the resting state is
              // closed. Referencing the id unconditionally would leave every
              // button pointing at nothing most of the time; `aria-expanded`
              // already carries the state.
              aria-controls={sidebarOpen ? DEFAULT_SIDEBAR_DOM_ID : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              onFocus={() => setFocusName(tab.name)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => {
                setFocusName(tab.name);
                excalidrawAPI.toggleSidebar({
                  name: DEFAULT_SIDEBAR.name,
                  tab: tab.name,
                });
              }}
              data-testid={`sheet-rail-${tab.name}`}
            >
              <span className={styles.icon} aria-hidden="true">
                {/* `ProjectSidebarTab.icon` is optional. Fall back to the
                  label's initial so a tab registered without one is still a
                  visible control rather than a blank 32px box. */}
                {tab.icon ?? (
                  <span className={styles.iconFallback}>
                    {tab.label.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </button>
            {/* Visible on hover AND focus. aria-hidden because `aria-label`
              above already carries the name — otherwise it is announced twice. */}
            <span className={styles.tooltip} aria-hidden="true">
              {tab.label}
            </span>
          </div>
        );
      })}

      {showCommentMode && (
        // Not a tab: no panel is disclosed, so no `aria-expanded` and no
        // `aria-controls`. A pressed toolbar toggle is the honest widget.
        <div
          className={[styles.slot, styles.slotMode].join(" ")}
          key={COMMENT_MODE_ITEM}
        >
          <button
            type="button"
            ref={(el) => {
              if (el) {
                buttonsRef.current.set(COMMENT_MODE_ITEM, el);
              } else {
                buttonsRef.current.delete(COMMENT_MODE_ITEM);
              }
            }}
            className={[styles.trigger, commentMode ? styles.triggerOn : ""]
              .filter(Boolean)
              .join(" ")}
            data-rail-item="mode"
            // The count rides the accessible NAME rather than a bare
            // `aria-describedby` dot, so a screen-reader user hears
            // "Comment mode, 3 open threads, toggle button, not pressed"
            // in one go — the badge is information, not decoration.
            aria-label={
              openThreadCount > 0
                ? `Comment mode, ${openThreadCount} open ${
                    openThreadCount === 1 ? "thread" : "threads"
                  }`
                : "Comment mode"
            }
            aria-pressed={commentMode}
            tabIndex={keys.length - 1 === focusIndex ? 0 : -1}
            onFocus={() => setFocusName(COMMENT_MODE_ITEM)}
            onKeyDown={(event) => onKeyDown(event, keys.length - 1)}
            onClick={() => {
              setFocusName(COMMENT_MODE_ITEM);
              onToggleCommentMode();
            }}
            data-testid="sheet-rail-mode-comment"
          >
            <span className={styles.icon} aria-hidden="true">
              <CommentModeIcon />
            </span>
            {openThreadCount > 0 && (
              // aria-hidden: the same number is already in the button's
              // accessible name above. Announcing it twice is noise.
              <span
                className={styles.badge}
                aria-hidden="true"
                data-testid="sheet-rail-comment-badge"
              >
                {openThreadCount > 99 ? "99+" : openThreadCount}
              </span>
            )}
          </button>
          <span className={styles.tooltip} aria-hidden="true">
            {openThreadCount > 0
              ? `Comment mode (${openThreadCount} open)`
              : "Comment mode"}
          </span>
        </div>
      )}
    </div>
  );
}
