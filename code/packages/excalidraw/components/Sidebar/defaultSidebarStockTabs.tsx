import { CANVAS_SEARCH_TAB, LIBRARY_SIDEBAR_TAB } from "@atlasdraw/common";

import { t } from "../../i18n";
import { LibraryIcon, searchIcon } from "../icons";

import type { SidebarTabName } from "../../types";

/**
 * Atlasdraw fork addition — one of `DefaultSidebar`'s built-in ("stock") tabs.
 *
 * `getLabel` is a thunk, not a string: `t()` reads the currently active
 * language, so the label must be resolved at render/snapshot time rather than
 * at module-evaluation time (when i18n has not loaded yet).
 */
export type DefaultSidebarStockTab = {
  name: SidebarTabName;
  getLabel: () => string;
  icon: React.ReactNode;
};

/**
 * Atlasdraw fork addition — the single definition of `DefaultSidebar`'s stock
 * tabs, in the order the sidebar renders their triggers.
 *
 * Two consumers must agree on this list and used to hardcode it separately:
 * `DefaultSidebar`'s trigger row (what actually renders) and
 * `App.getSidebarTabs()` (what a host-app trigger rail outside the editor's
 * React tree renders *from*). Adding a stock tab to one and not the other
 * silently drops it from the host rail — the exact drift the rail was built to
 * eliminate. Both now map over this array;
 * `DefaultSidebar.stockTabs.test.tsx` fails if they diverge.
 *
 * Panel *bodies* stay hardcoded in `DefaultSidebar`'s JSX — each is a distinct
 * component, not data — but the same test asserts every name here resolves to
 * a rendered panel.
 */
export const DEFAULT_SIDEBAR_STOCK_TABS: readonly DefaultSidebarStockTab[] = [
  {
    name: CANVAS_SEARCH_TAB,
    getLabel: () => t("search.title"),
    icon: searchIcon,
  },
  {
    name: LIBRARY_SIDEBAR_TAB,
    getLabel: () => t("toolBar.library"),
    icon: LibraryIcon,
  },
];

/** Whether `name` collides with one of `DefaultSidebar`'s built-in tabs. */
export const isStockSidebarTabName = (name: SidebarTabName): boolean =>
  DEFAULT_SIDEBAR_STOCK_TABS.some((tab) => tab.name === name);
