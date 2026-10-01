// SPDX-License-Identifier: AGPL-3.0-only
//
// The view state of one editor: what the editor shows and holds open, as
// opposed to the document it shows. One store per session, so two editors
// (or two tests) never share it.
//
// `map` and `api` are the two handles the editor's views mount: null until
// they mount, null again after. Code that is not a React component reads them
// here, at the moment it needs them, instead of from a module store.

import { createStore, type StoreApi } from "zustand/vanilla";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  clampRightSidebarWidth,
} from "@atlasdraw/common";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type maplibregl from "maplibre-gl";

export const SHEET_PANEL_WIDTH_KEY = "atlasdraw:sheet-panel:width";

/**
 * The stored sheet-panel width, or the default. A stored value goes through
 * the same clamp as a drag: a value from an older MIN/MAX is as untrusted as
 * a pointer event.
 */
export function loadSheetPanelWidth(): number {
  try {
    const raw = localStorage.getItem(SHEET_PANEL_WIDTH_KEY);
    return raw === null
      ? RIGHT_SIDEBAR_DEFAULT_WIDTH
      : clampRightSidebarWidth(Number.parseInt(raw, 10));
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSheetPanelWidth(width: number): void {
  try {
    localStorage.setItem(SHEET_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable: the width applies for this session only.
  }
}

export interface ViewState {
  /** The MapLibre map; null until it loads. */
  map: maplibregl.Map | null;
  /** The Excalidraw API; null until the drawing mounts. */
  api: ExcalidrawImperativeAPI | null;
  /** The sheet panel's width in px, always within the editor's limits. */
  sheetPanelWidth: number;
  setMap(map: maplibregl.Map | null): void;
  setApi(api: ExcalidrawImperativeAPI | null): void;
  /** Set the width (clamped) and keep it in this browser. */
  setSheetPanelWidth(width: number): void;
  resetSheetPanelWidth(): void;
}

export type ViewStore = StoreApi<ViewState>;

export function createViewStore(
  initial: { map?: maplibregl.Map | null } = {},
): ViewStore {
  return createStore<ViewState>()((set) => ({
    map: initial.map ?? null,
    api: null,
    sheetPanelWidth: loadSheetPanelWidth(),
    setMap: (map) => set({ map }),
    setApi: (api) => set({ api }),
    setSheetPanelWidth: (width) => {
      const next = clampRightSidebarWidth(width);
      set({ sheetPanelWidth: next });
      saveSheetPanelWidth(next);
    },
    resetSheetPanelWidth: () => {
      set({ sheetPanelWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH });
      saveSheetPanelWidth(RIGHT_SIDEBAR_DEFAULT_WIDTH);
    },
  }));
}
