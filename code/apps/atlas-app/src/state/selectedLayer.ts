// SPDX-License-Identifier: AGPL-3.0-only
//
// Bidirectional layer selection — the bridge between Excalidraw's
// selectedElementIds (map/canvas) and the LayerPanel's row highlighting
// (panel). A plain Zustand store, no immer needed for a single record field.
//
// Shape mirrors `AppState.selectedElementIds`: Record<id, true>.
// Consumers are MapEditor (reads/writes on Excalidraw selection change,
// subscribes to drive updateScene) and LayerPanel row components
// (reads for highlighting, writes on row click).
//
// Annotation IDs are Excalidraw element IDs. Data layer IDs are "dl:<uuid>"
// and raster IDs are their own namespace — both are valid selection entries
// even though they have no Excalidraw element counterpart.

import { create } from "zustand";

export type SelectedLayerState = {
  selectedLayerIds: Record<string, true>;
  /** Replace the entire selection set. */
  setSelectedLayerIds: (ids: Record<string, true>) => void;
  /** Single-select: replace selection with exactly this id. */
  selectLayer: (id: string) => void;
  /** Toggle one id in/out of the current set. */
  toggleLayerSelection: (id: string) => void;
  /** Deselect everything. */
  clearSelection: () => void;
};

export const useSelectedLayerStore = create<SelectedLayerState>()((set) => ({
  selectedLayerIds: {},
  setSelectedLayerIds: (ids) => set({ selectedLayerIds: ids }),
  selectLayer: (id) => set({ selectedLayerIds: { [id]: true } }),
  toggleLayerSelection: (id) =>
    set((s) => {
      const next = { ...s.selectedLayerIds };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return { selectedLayerIds: next };
    }),
  clearSelection: () => set({ selectedLayerIds: {} }),
}));
