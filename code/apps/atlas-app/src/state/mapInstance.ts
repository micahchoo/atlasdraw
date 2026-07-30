// SPDX-License-Identifier: AGPL-3.0-only
//
// The live maplibregl.Map, published so components that are NOT descendants of
// MapEditor's render tree can still move the camera.
//
// LayerPanel is the reason this exists. It mounts inside Excalidraw's
// DefaultSidebar via `excalidrawAPI.registerSidebarTab({ content: <LayerPanel/> })`
// — an element captured once, in an effect keyed on `excalidrawAPI`. Threading
// the map in as a prop would mean adding `map` to that effect's deps, so the
// tab would unregister and re-register the moment the map finished loading;
// registration order is the rail's display order (SheetRail reads
// getSidebarTabs()), so Layers would silently jump below Comments on every
// startup. A store sidesteps the whole question: one writer, many readers, no
// re-registration.
//
// Same shape as state/basemap.ts — a plain Zustand store, no immer needed for a
// single reference field. Tests set it directly via `setState`.

import { create } from "zustand";

import type maplibregl from "maplibre-gl";

export type MapInstanceState = {
  /** null until MapCanvas fires "load"; null again on unmount. */
  map: maplibregl.Map | null;
  setMap: (map: maplibregl.Map | null) => void;
};

export const useMapInstanceStore = create<MapInstanceState>()((set) => ({
  map: null,
  setMap: (map) => set({ map }),
}));
