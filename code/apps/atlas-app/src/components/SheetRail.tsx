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
// The rail hosts exactly one kind of item: tabs (`data-rail-item="tab"`) that
// open a panel in the sidebar. State is `aria-expanded`, because that is what
// a disclosure of a panel is.
//
// Step 5 briefly parked comment mode here too, as a `data-rail-item="mode"`
// toggle. It has since moved to the drawing-tools toolbar
// (`CommentModeButton`, the `renderToolbarExtras` slot): a mode changes what a
// click on the plate does and discloses nothing, so it belongs with the tools
// rather than with the panel triggers. If a second mode ever wants a home,
// that is where it goes — do not re-introduce the two-kinds rail.

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

interface SheetRailProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function SheetRail({ excalidrawAPI }: SheetRailProps) {
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
  // meaningful. `keys` is the focus ring, in DOM order.
  const [focusName, setFocusName] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());

  const keys = useMemo(() => tabs.map((tab) => tab.name), [tabs]);

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
    </div>
  );
}
