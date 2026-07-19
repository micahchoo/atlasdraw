// SPDX-License-Identifier: AGPL-3.0-only
// Basemap UI state — Zustand store.
//
// IA restructure (2026-07-18): the basemap is presented as a LAYER — the
// bottom of the stack in LayerPanel — not as a MainMenu concern. That put
// its state behind three surfaces at once:
//
//   LayerPanel      — picker + "Edit style" trigger (sidebar tab; mounted
//                     via registerSidebarTab, so it can't take props from
//                     MapEditor without re-registering — hence a store)
//   MapEditor       — useBasemapStyle application + MaputnikDialog mount
//   SettingsDialog  — Basemap tab (receives value/setter as props from
//                     MapEditor, which binds them to this store)
//
// `styleEditorOpen` lives here (not in MapEditor useState) for the same
// reason: the trigger is in LayerPanel, the MaputnikDialog mount is in
// MapEditor.

import { create } from "zustand";

import type { BasemapConfig } from "@atlasdraw/basemap";

export type BasemapUIState = {
  activeBasemapId: BasemapConfig["id"];
  /** True while the Maputnik "Edit basemap style" modal is open. */
  styleEditorOpen: boolean;
  setActiveBasemapId: (id: BasemapConfig["id"]) => void;
  setStyleEditorOpen: (open: boolean) => void;
};

export const useBasemapStore = create<BasemapUIState>((set) => ({
  activeBasemapId: "protomaps-light",
  styleEditorOpen: false,
  setActiveBasemapId: (id) => set({ activeBasemapId: id }),
  setStyleEditorOpen: (open) => set({ styleEditorOpen: open }),
}));
