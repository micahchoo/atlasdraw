// SPDX-License-Identifier: AGPL-3.0-only
//
// The layer registry: the data and raster layers of the open document.
//
// Annotations are not here. They are scene elements, and the layer panel
// computes their rows from the scene (state/annotations.ts).
//
// immer middleware: each action receives a draft and mutates in place.
// Zustand produces an immutable next state, and an entry that did not change
// keeps its identity, which the map bridge's diffs rely on.

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { LayerStyle } from "@atlasdraw/basemap";

import { useDataLayerFCStore } from "./useDataLayerFCStore";
import { useRasterImageStore } from "./useRasterImageStore";

import type { FeatureCollection } from "geojson";

// Re-exported so atlas-app consumers can keep importing LayerStyle from the
// registry module. The shape itself lives in @atlasdraw/basemap (Phase 2 Wave
// 2a) — the local placeholder was inlined when basemap was missing the export
// (closes atlasdraw-fc04).
export type { LayerStyle };

/**
 * Where a data layer came from, and what it cost to get here.
 *
 * `label` is user-editable (rename), so it stops being an answer to "which
 * file was this?" the moment anyone renames a layer — hence `sourceFile` as a
 * separate, immutable record.
 *
 * `droppedCount` is the number of input records the import could not put on
 * the map: CSV rows with unparseable coordinates and no geocode, plus features
 * whose geometry is `null` (RFC-legal, renders nothing). GeoJSON and shapefile
 * imports reject the whole file rather than drop records, so 0 there is a fact,
 * not a default. Note the two contributions sit on opposite sides of
 * `featureCount` — a skipped CSV row is not in the FeatureCollection, a
 * null-geometry feature is — so this is deliberately a count and not a ratio;
 * the panel says "2 dropped", never "2 of N".
 *
 * PRD §3 persona C (Dr. Ana) needs this to reproduce an import; before this it
 * existed only in a 4-second toast that didn't even carry the drop count.
 * Optional on the entry because converted annotations and collaboratively
 * received layers have no import event to describe.
 */
export type LayerProvenance = {
  /** File name as the user supplied it, before any rename. */
  sourceFile: string;
  /** Input records that did not survive into the FeatureCollection. */
  droppedCount: number;
};

/**
 * Data layer — backed by a GeoJSON FeatureCollection rendered through MapLibre.
 * id is namespaced "dl:<uuid>" to never collide with annotation ids (which mirror
 * Excalidraw element ids). featureCount is cached for LayerPanel display.
 */
export type DataLayerEntry = {
  kind: "data";
  id: string;
  label: string;
  visible: boolean;
  order: number;
  featureCount: number;
  style: LayerStyle;
  provenance?: LayerProvenance;
};

/**
 * The four corners of a raster, in lng/lat, in the order MapLibre's `image`
 * source wants them: top-left, top-right, bottom-right, bottom-left.
 *
 * Corners rather than a bbox because that is the shape the source takes, and
 * because a bbox cannot express a raster that is not axis-aligned. Nothing
 * produces a rotated one today — the GeoTIFF importer only accepts north-up
 * files — but storing the shape that can hold one costs nothing now and a
 * migration later.
 */
export type RasterCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * Raster layer — a georeferenced picture, not a set of shapes. A scanned survey
 * sheet, a satellite tile, a historical map plate.
 *
 * FU-1. Deliberately shares almost nothing with `DataLayerEntry`: it has no
 * `featureCount` because it has no features, and no `LayerStyle` because fill
 * colour and stroke width mean nothing to pixels. `opacity` is its whole style,
 * and it is the one that matters — the reason you drop a scanned sheet is to
 * fade it and trace on top.
 *
 * `imageKey` addresses the decoded PNG in the document's `files/` bag, not the
 * original file. The original is not kept: MapLibre's `image` source wants an
 * image, we decode at import anyway, and a 200 MB GeoTIFF in every autosave is
 * its own outage. `provenance.sourceFile` is what remembers where it came from.
 *
 * id is namespaced `rl:<uuid>` — same reasoning as `dl:`, and it keeps
 * "which stack is this in?" answerable from the id alone.
 */
export type RasterLayerEntry = {
  kind: "raster";
  id: string;
  label: string;
  visible: boolean;
  order: number;
  corners: RasterCorners;
  /** 0..1. Separate from LayerStyle.opacity, which is a vector paint property. */
  opacity: number;
  /** Key into the document's binary asset bag. */
  imageKey: string;
  provenance?: LayerProvenance;
};

export type LayerRegistryEntry = DataLayerEntry | RasterLayerEntry;

/**
 * The registry's actions. Consumers call these; nothing mutates `entries`
 * directly.
 */
export interface ILayerRegistry {
  entries: LayerRegistryEntry[];
  renameLayer(id: string, label: string): void;
  registerDataLayer(opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
    provenance?: LayerProvenance;
  }): void;
  /**
   * FU-1. Takes already-decoded geography — the importer owns reading the
   * GeoTIFF and rejecting a CRS it cannot place, so by the time an entry
   * reaches the registry its corners are lng/lat and its pixels are in the
   * document's asset bag. The registry never touches image bytes.
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
  /**
   * Move `id` to `newOrder` **within its own kind**. Data layers and rasters
   * are separate stacks, so a z-index that spans both has no meaning — `newOrder` lives
   * in the same 0..n-1 space as the entry's `order`, and the entry can never
   * leave its own group. Out-of-range values clamp to the group's bounds.
   */
  reorder(id: string, newOrder: number): void;
  updateStyle(id: string, patch: Partial<LayerStyle>): void;
  remove(id: string): void;
}

/**
 * Rasters land fully opaque. The alternative — arriving pre-faded so you can
 * "see it's a backdrop" — means the first thing a user does after every import
 * is drag a slider back to where they dropped it. Fading is a decision they
 * make while tracing, not a greeting.
 */
const DEFAULT_RASTER_OPACITY = 1;

/**
 * Re-stamp `order` as the contiguous 0-based index of each entry *within its
 * own kind* — the meaning every entry type documents. Called after every
 * structural mutation (register / remove / reorder) so `order` is
 * never sparse and never mixes the stacks; LayerPanel renders one section per
 * kind and relies on that to decide first/last.
 *
 * One counter per kind, keyed off `kind` itself. A new kind with no counter
 * is a type error here rather than a wrong number downstream.
 */
function reindexByKind(entries: LayerRegistryEntry[]): void {
  const next: Record<LayerRegistryEntry["kind"], number> = {
    data: 0,
    raster: 0,
  };
  for (const entry of entries) {
    entry.order = next[entry.kind]++;
  }
}

export type LayerRegistryState = {
  entries: LayerRegistryEntry[];
  /**
   * Rises by one on every change a save must carry: a register, rename,
   * restyle, reorder, visibility flip or removal. Persistence compares it to
   * mark the document dirty.
   */
  revision: number;
} & Omit<ILayerRegistry, "entries">;

export const useLayerRegistryStore = create<LayerRegistryState>()(
  immer((set) => ({
    entries: [],
    revision: 0,

    renameLayer: (id, label) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (!e) {
          return;
        }
        e.label = label;
        s.revision += 1;
      }),

    registerDataLayer: ({ id, fc, label, style, provenance }) => {
      if (!id.startsWith("dl:")) {
        throw new Error(
          `data layer id must start with dl: prefix (received "${id}")`,
        );
      }
      // Phase 4 W0 (atlasdraw-ad27): mirror the FC into the FC registry so
      // selectDocument can populate AtlasdrawDocument.layers without ever
      // round-tripping through MapLibre's opaque source storage.
      //
      // Mirror BEFORE the store write, not after: useLayerRegistrySync's
      // subscriber reconciles the new entry onto the map synchronously inside
      // `set`, and it reads geometry from this mirror. Writing the mirror second
      // meant the reconcile saw an entry with no FeatureCollection, warned, and
      // skipped it — so a hydrate()-replayed layer never reached MapLibre.
      useDataLayerFCStore.getState().set(id, fc);
      set((s) => {
        s.entries.push({
          kind: "data",
          id,
          label,
          visible: true,
          order: 0, // reindexByKind owns the value
          featureCount: fc.features.length,
          style,
          ...(provenance ? { provenance } : {}),
        });
        reindexByKind(s.entries);
        s.revision += 1;
      });
    },

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
      set((s) => {
        if (s.entries.some((e) => e.id === id)) {
          return;
        }
        s.entries.push({
          kind: "raster",
          id,
          label,
          visible: true,
          order: 0, // reindexByKind owns the value
          corners,
          imageKey,
          opacity: opacity ?? DEFAULT_RASTER_OPACITY,
          ...(provenance ? { provenance } : {}),
        });
        reindexByKind(s.entries);
        s.revision += 1;
      });
    },

    setVisibility: (id, visible) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e && e.visible !== visible) {
          e.visible = visible;
          s.revision += 1;
        }
      }),

    // Kind-scoped: `newOrder` indexes the entry's own stack (see
    // ILayerRegistry.reorder). Previously this spliced against the whole
    // `entries` array while LayerPanel passed section-local indices, so the
    // two disagreed by however many entries of the other kind sat below —
    // moves silently no-op'd and layers hopped between stacks. Permuting only
    // the slots the kind already occupies makes that move unrepresentable.
    reorder: (id, newOrder) =>
      set((s) => {
        const globalIndex = s.entries.findIndex((x) => x.id === id);
        if (globalIndex === -1) {
          return;
        }
        const { kind } = s.entries[globalIndex];
        const slots: number[] = [];
        s.entries.forEach((e, i) => {
          if (e.kind === kind) {
            slots.push(i);
          }
        });

        const from = slots.indexOf(globalIndex);
        const to = Math.max(0, Math.min(newOrder, slots.length - 1));
        if (from === to) {
          return;
        }

        const group = slots.map((i) => s.entries[i]);
        const [moved] = group.splice(from, 1);
        group.splice(to, 0, moved);
        const next = s.entries.slice();
        slots.forEach((slot, i) => {
          next[slot] = group[i];
        });
        s.entries = next;
        reindexByKind(s.entries);
        s.revision += 1;
      }),

    updateStyle: (id, patch) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e?.kind === "data") {
          Object.assign(e.style, patch);
          s.revision += 1;
        }
      }),

    remove: (id) => {
      set((s) => {
        const before = s.entries.length;
        s.entries = s.entries.filter((e) => e.id !== id);
        if (s.entries.length === before) {
          return;
        }
        // Removing from the middle would otherwise leave a hole in the
        // remaining stack's order (0,2,…), which breaks first/last detection.
        reindexByKind(s.entries);
        s.revision += 1;
      });
      // Drop the FC if any; a raster id has none, so this is a no-op for it.
      useDataLayerFCStore.getState().delete(id);
      // FU-1: and the decoded image, on the same terms. This one is not merely
      // tidy — the store holds an object URL, which keeps its Blob alive until
      // revoked, so a raster removed without this leaks a full-size PNG for the
      // rest of the session.
      useRasterImageStore.getState().delete(id);
    },
  })),
);
