// SPDX-License-Identifier: AGPL-3.0-only
//
// Sheet-panel UI state — the right panel's width, and only that.
//
// Why a store rather than `useState` in MapEditor: the width has three
// consumers in two React trees — the `<Excalidraw>` prop that publishes
// `--right-sidebar-width`, the resize handle that mutates it, and the map
// plate's reflow inset. Same reason `state/basemap.ts` exists.
//
// Persistence follows the app's existing convention for a single scalar
// preference: a namespaced localStorage key read once at store creation and
// written in the setter, wrapped so a throwing/absent Storage (private mode,
// quota, SSR) degrades to "default width, not persisted" instead of taking the
// editor down. Cf. `state/commentsChannel.ts` (`atlasdraw:comments:local`) and
// `components/OnboardingTips.tsx`. There is no zustand `persist` middleware
// anywhere in atlas-app, so this does not introduce a second convention.
//
// The width is clamped by `clampRightSidebarWidth` on *every* path in — load,
// drag, keyboard — because a stale localStorage value from an older MIN/MAX is
// exactly as untrustworthy as a pointer event.

import { create } from "zustand";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  clampRightSidebarWidth,
} from "@atlasdraw/common";

const STORAGE_KEY = "atlasdraw:sheet-panel:width";

/** Read the persisted width, or the default when absent/unusable. */
function loadSheetPanelWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    }
    const parsed = Number.parseInt(raw, 10);
    // clampRightSidebarWidth maps NaN → default, so a corrupt value is
    // indistinguishable from an absent one. Deliberate: this is a preference,
    // not data, and there is nothing to recover.
    return clampRightSidebarWidth(parsed);
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSheetPanelWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Storage unavailable — the width still applies for this session.
  }
}

export type SheetPanelState = {
  /** Panel width in px, always within [MIN, MAX]. */
  width: number;
  /** Set the width (clamped) and persist it. */
  setWidth: (width: number) => void;
  /** Back to {@link RIGHT_SIDEBAR_DEFAULT_WIDTH} — the double-click reset. */
  resetWidth: () => void;
};

export const useSheetPanelStore = create<SheetPanelState>((set) => ({
  width: loadSheetPanelWidth(),
  setWidth: (width) => {
    const next = clampRightSidebarWidth(width);
    set({ width: next });
    saveSheetPanelWidth(next);
  },
  resetWidth: () => {
    set({ width: RIGHT_SIDEBAR_DEFAULT_WIDTH });
    saveSheetPanelWidth(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  },
}));
