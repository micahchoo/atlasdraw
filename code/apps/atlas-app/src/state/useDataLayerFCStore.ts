// SPDX-License-Identifier: AGPL-3.0-only
//
// A view of the open document's FeatureCollections, keyed by data-layer id.
// The document (state/document.ts) owns them; a data layer's FeatureCollection
// arrives with its `add-data-layer` command and leaves with `remove-layer`.

import { create } from "zustand";

import { followDocument } from "./document";

import type { FeatureCollection } from "geojson";

export type DataLayerFCState = {
  fcs: Readonly<Record<string, FeatureCollection>>;
  get: (id: string) => FeatureCollection | undefined;
  /** A shallow copy, safe to iterate while commands run. */
  getAll: () => Record<string, FeatureCollection>;
};

export const useDataLayerFCStore = create<DataLayerFCState>()((_set, get) => ({
  fcs: {},
  get: (id) => get().fcs[id],
  getAll: () => ({ ...get().fcs }),
}));

followDocument((doc) => {
  const fcs = doc.snapshot().featureCollections;
  if (useDataLayerFCStore.getState().fcs !== fcs) {
    useDataLayerFCStore.setState({ fcs });
  }
});
