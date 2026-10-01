// SPDX-License-Identifier: AGPL-3.0-only
//
// The layer registry: a view of the open document's data and raster layers,
// with actions that dispatch document commands. The document (state/document.ts)
// owns the layers; this store holds no state of its own.
//
// Annotations are not here. They are scene elements, and the layer panel
// computes their rows from the scene (state/annotations.ts).

import { create } from "zustand";

import { currentDocument, followDocument } from "./document";
// Imported before this module registers its own listener, so the payload
// views are in step with the document when a subscriber of this store reads
// them.
import "./useDataLayerFCStore";
import { takePendingRasterImage } from "./useRasterImageStore";

import type {
  DataLayerEntry,
  LayerProvenance,
  LayerStyle,
  OverlayEntry,
  RasterCorners,
  RasterLayerEntry,
} from "./document";
import type { FeatureCollection } from "geojson";

export type {
  DataLayerEntry,
  LayerProvenance,
  LayerStyle,
  RasterCorners,
  RasterLayerEntry,
};

export type LayerRegistryEntry = OverlayEntry;

export interface ILayerRegistry {
  entries: readonly LayerRegistryEntry[];
  renameLayer(id: string, label: string): void;
  registerDataLayer(opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
    provenance?: LayerProvenance;
  }): void;
  /**
   * Takes decoded geography. The image must be given to
   * useRasterImageStore.set first, under the same id.
   */
  registerRasterLayer(opts: {
    id: string;
    label: string;
    corners: RasterCorners;
    imageKey: string;
    opacity?: number;
    provenance?: LayerProvenance;
  }): void;
  setVisibility(id: string, visible: boolean): void;
  /** Move `id` to `newOrder` within its own kind; out-of-range clamps. */
  reorder(id: string, newOrder: number): void;
  updateStyle(id: string, patch: Partial<LayerStyle>): void;
  remove(id: string): void;
}

export type LayerRegistryState = ILayerRegistry & {
  /** The open document's revision. */
  revision: number;
};

const dispatch: ReturnType<typeof currentDocument>["dispatch"] = (command) =>
  currentDocument().dispatch(command);

export const useLayerRegistryStore = create<LayerRegistryState>()(() => ({
  entries: currentDocument().snapshot().overlays,
  revision: currentDocument().revision,
  renameLayer: (id, label) => dispatch({ type: "rename-layer", id, label }),
  registerDataLayer: ({ id, fc, label, style, provenance }) =>
    dispatch({ type: "add-data-layer", id, fc, label, style, provenance }),
  registerRasterLayer: ({
    id,
    label,
    corners,
    imageKey,
    opacity,
    provenance,
  }) => {
    if (!id.startsWith("rl:")) {
      throw new Error(
        `raster layer id must start with rl: prefix (received "${id}")`,
      );
    }
    const image = takePendingRasterImage(id);
    if (!image) {
      // eslint-disable-next-line no-console
      console.warn("[layerRegistry] raster layer has no image, skipping", id);
      return;
    }
    dispatch({
      type: "add-raster-layer",
      id,
      label,
      corners,
      imageKey,
      image,
      opacity,
      provenance,
    });
  },
  setVisibility: (id, visible) =>
    dispatch({ type: "set-visibility", id, visible }),
  reorder: (id, newOrder) => dispatch({ type: "reorder", id, order: newOrder }),
  updateStyle: (id, patch) => dispatch({ type: "restyle", id, patch }),
  remove: (id) => dispatch({ type: "remove-layer", id }),
}));

followDocument((doc) => {
  const entries = doc.snapshot().overlays;
  const prev = useLayerRegistryStore.getState();
  if (prev.entries !== entries || prev.revision !== doc.revision) {
    useLayerRegistryStore.setState({ entries, revision: doc.revision });
  }
});
