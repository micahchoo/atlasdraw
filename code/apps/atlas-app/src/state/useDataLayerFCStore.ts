// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 Wave 0 prereq (atlasdraw-ad27) — data-layer FeatureCollection registry.
//
// The LayerRegistry (state/layerRegistry.ts) deliberately stores only metadata
// (label, visibility, featureCount, style) — the underlying GeoJSON
// FeatureCollection lives inside the MapLibre source after `map.addSource`,
// which means it isn't retrievable as a plain JS object once added. Phase 3 T9
// (state/selectDocument.ts) shipped `layers: new Map()` as a placeholder and
// documented the gap (mulch mx-91343d): without a separate FC registry, the
// .atlasdraw round-trip silently loses every imported layer's geometry.
//
// This Zustand store is that registry. It is keyed by data-layer id (`dl:*`)
// and holds the FeatureCollection as the source of truth for save/restore.
//
// Write path: routed through the LayerRegistry actions —
//   - `registerDataLayer({ id, fc, ... })` writes `(id, fc)` here.
//   - `convertAnnotationToDataLayer(elementId, fc)` writes the new `dl:` id +
//     fc here (and is a no-op delete on the old elementId, harmless).
//   - `remove(id)` deletes unconditionally — deleting an annotation id is a
//     no-op on this store, so we can stay kind-agnostic at the call site.
//
// Read path: `selectDocument` consumes `getAll()` to populate
// `AtlasdrawDocument.layers: Map<string, FeatureCollection>` non-destructively
// every auto-save tick.
//
// This is intentionally framework-light — no immer (the values are opaque to
// us; we never mutate a stored FC, only replace), no persistence (the FCs are
// rehydrated from the .atlasdraw zip on load).

import { create } from "zustand";

import type { FeatureCollection } from "geojson";

export type DataLayerFCState = {
  /**
   * Internal map of `dl:*` id → FeatureCollection. Treated as immutable from
   * the consumer's perspective — write via `set`/`delete`/`clear` only.
   */
  fcs: Record<string, FeatureCollection>;

  /** Insert or replace the FC for the given data-layer id. */
  set: (id: string, fc: FeatureCollection) => void;

  /** Remove the FC for the given id. No-op if absent. */
  delete: (id: string) => void;

  /** Look up the FC for the given id. Returns undefined if absent. */
  get: (id: string) => FeatureCollection | undefined;

  /**
   * Snapshot of all stored FCs as a plain record. Returned object is a fresh
   * shallow clone so callers can iterate without worrying about concurrent
   * mutations from registry actions firing during the read.
   */
  getAll: () => Record<string, FeatureCollection>;

  /** Drop everything. Used by tests; also called when loading a fresh doc. */
  clear: () => void;
};

export const useDataLayerFCStore = create<DataLayerFCState>()((set, get) => ({
  fcs: {},

  set: (id, fc) => set((s) => ({ fcs: { ...s.fcs, [id]: fc } })),

  delete: (id) =>
    set((s) => {
      // Skip the allocation if we have nothing to remove. Both `remove(id)` on
      // an annotation id and `convertAnnotationToDataLayer`'s old-id wipe
      // exercise this branch.
      if (!(id in s.fcs)) {
        return s;
      }
      const next = { ...s.fcs };
      delete next[id];
      return { fcs: next };
    }),

  get: (id) => get().fcs[id],

  // Shallow clone so the caller (selectDocument) gets a stable snapshot and
  // can't accidentally mutate the store via reference. FCs themselves are
  // shared by reference — they're treated as immutable upstream.
  getAll: () => ({ ...get().fcs }),

  clear: () => set({ fcs: {} }),
}));
