// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 0 Task T01 — LayerRegistry type contracts.
//
// Types only. Implementation lands in T11 (Phase 2 Wave 2). Consumed by
// T11 (impl), T12 (LayerPanel), T13 (ImportDialog), T14 (Convert action).
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T01
// Audit: docs/decisions/opus-audit-2026-05-04-post-wave4.md

// ---------------------------------------------------------------------------
// T11 — LayerRegistry Zustand store implementation.
//
// Phase 2 Wave 2a. Backs LayerPanel (T12), ImportDialog (T13), Convert (T14).
// Single source of truth for all layer state. Mutations route through the
// store actions; consumers must not mutate `entries` directly.
//
// immer middleware: each action receives a draft and mutates in place. Zustand
// produces an immutable next state. This keeps action bodies imperative and
// readable while preserving referential equality where nothing changed.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { LayerStyle } from "@atlasdraw/basemap";

import { useDataLayerFCStore } from "./useDataLayerFCStore";

import type { FeatureCollection } from "geojson";

// Re-exported so atlas-app consumers can keep importing LayerStyle from the
// registry module. The shape itself lives in @atlasdraw/basemap (Phase 2 Wave
// 2a) — the local placeholder was inlined when basemap was missing the export
// (closes atlasdraw-fc04).
export type { LayerStyle };

/**
 * Annotation layer — backed by a single Excalidraw element. id matches the element id.
 * Order is the z-index within the annotation group (annotation group sits above the
 * basemap and below modal UI).
 */
export type AnnotationLayerEntry = {
  kind: "annotation";
  id: string;
  label: string;
  visible: boolean;
  order: number;
  /**
   * `label` came from the user, not from generateLayerLabel.
   *
   * Annotation labels are generated from the element's type and geo-anchor,
   * and useLayerRegistrySync re-generates them on scene changes — so without a
   * marker, a rename would survive exactly until the shape next moved. Set by
   * `renameLayer`, read by `updateAnnotationLabel` (the auto path), and
   * persisted through the manifest so it also holds across a save/reopen.
   */
  renamedByUser?: boolean;
};

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

export type LayerRegistryEntry = AnnotationLayerEntry | DataLayerEntry;

/**
 * ILayerRegistry — the central authority over all layer state. Implementations
 * (T11) own the entries array; consumers (T12 LayerPanel, T13 ImportDialog,
 * T14 Convert) call methods on this interface. No direct mutation of entries.
 *
 * convertAnnotationToDataLayer is the T14 escape hatch: take an existing
 * annotation (a hand-drawn Excalidraw shape) and promote it to a data layer
 * by attaching a FeatureCollection. The annotation entry is removed atomically.
 */
export interface ILayerRegistry {
  entries: LayerRegistryEntry[];
  registerAnnotation(elementId: string, label?: string): void;
  /**
   * The **generated**-label path: set an entry's display label from
   * useLayerRegistrySync's `generateLayerLabel`, which re-runs whenever the
   * scene changes.
   *
   * No-ops on an entry the user renamed (`renamedByUser`). The guard lives
   * here rather than at the call site because this is the single choke point —
   * a future caller cannot reintroduce the clobber by forgetting to check.
   * User-initiated renames go through `renameLayer` instead.
   */
  updateAnnotationLabel(elementId: string, label: string): void;
  /**
   * The **user**-typed-label path: set an entry's display label and, for
   * annotations, mark it as the user's, which permanently retires automatic
   * naming for that entry. Kind-agnostic by id; on data layers it is a plain
   * label write, since nothing regenerates those.
   *
   * There is deliberately no "back to auto" action. A name someone typed is a
   * decision, and a name that reverts on its own is worse than no rename.
   */
  renameLayer(id: string, label: string): void;
  registerDataLayer(opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
    provenance?: LayerProvenance;
  }): void;
  convertAnnotationToDataLayer(elementId: string, fc: FeatureCollection): void;
  setVisibility(id: string, visible: boolean): void;
  /**
   * Move `id` to `newOrder` **within its own kind**. Data layers and
   * annotations are separate render stacks (MapLibre vs. the Excalidraw canvas
   * above it), so a z-index that spans both has no meaning — `newOrder` lives
   * in the same 0..n-1 space as the entry's `order`, and the entry can never
   * leave its own group. Out-of-range values clamp to the group's bounds.
   */
  reorder(id: string, newOrder: number): void;
  updateStyle(id: string, patch: Partial<LayerStyle>): void;
  remove(id: string): void;
}

/**
 * Default style applied when an annotation is converted to a data layer (T14).
 * Distinct from any user-chosen import style so converted layers are visually
 * recognizable until the user customizes them via LayerPanel.
 */
const DEFAULT_CONVERTED_STYLE: LayerStyle = {
  fillColor: "#0aa",
  strokeColor: "#077",
  strokeWidth: 1,
  opacity: 0.5,
};

/**
 * Re-stamp `order` as the contiguous 0-based index of each entry *within its
 * own kind* — the meaning both entry types document. Called after every
 * structural mutation (register / remove / convert / reorder) so `order` is
 * never sparse and never mixes the two stacks; LayerPanel renders one section
 * per kind and relies on that to decide first/last.
 */
function reindexByKind(entries: LayerRegistryEntry[]): void {
  let dataIndex = 0;
  let annotationIndex = 0;
  for (const entry of entries) {
    entry.order = entry.kind === "data" ? dataIndex++ : annotationIndex++;
  }
}

export type LayerRegistryState = {
  entries: LayerRegistryEntry[];
} & Omit<ILayerRegistry, "entries">;

export const useLayerRegistryStore = create<LayerRegistryState>()(
  immer((set) => ({
    entries: [],

    registerAnnotation: (elementId, label) =>
      set((s) => {
        if (s.entries.some((e) => e.id === elementId)) {
          return;
        }
        s.entries.push({
          kind: "annotation",
          id: elementId,
          label: label ?? elementId,
          visible: true,
          // Pushed to the end of `entries`, which reindexByKind turns into the
          // *highest* order within the annotation stack. This literal is only a
          // placeholder — reindexByKind below owns the real value, so the
          // per-kind rule has exactly one definition.
          order: 0,
        });
        reindexByKind(s.entries);
      }),
    updateAnnotationLabel: (elementId, label) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === elementId);
        if (!e) {
          return;
        }
        // See the interface doc: the generator loses to the user, always.
        if (e.kind === "annotation" && e.renamedByUser) {
          return;
        }
        e.label = label;
      }),

    renameLayer: (id, label) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (!e) {
          return;
        }
        e.label = label;
        if (e.kind === "annotation") {
          e.renamedByUser = true;
        }
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
          order: 0, // see registerAnnotation — reindexByKind owns the value
          featureCount: fc.features.length,
          style,
          ...(provenance ? { provenance } : {}),
        });
        reindexByKind(s.entries);
      });
    },

    convertAnnotationToDataLayer: (elementId, fc) => {
      // Mint the new dl: id outside `set()` so we can mirror it into the FC
      // registry with the exact same id that lands on the entry. Doing it
      // inside immer would force us to capture the id from a draft, which
      // the freeze semantics make awkward.
      const newId = `dl:${crypto.randomUUID()}`;
      // Mirror into the FC registry (Phase 4 W0) before the store write, for the
      // same reason as registerDataLayer: the registry subscriber reconciles the
      // new dl: entry onto the map inside `set` and needs the geometry to be
      // there already. Nothing can observe the mirror early — newId was minted
      // one line ago.
      const fcStore = useDataLayerFCStore.getState();
      fcStore.set(newId, fc);
      set((s) => {
        const idx = s.entries.findIndex(
          (e) => e.kind === "annotation" && e.id === elementId,
        );
        if (idx === -1) {
          return;
        }
        const annotation = s.entries[idx] as AnnotationLayerEntry;
        const label = annotation.label;
        s.entries.splice(idx, 1);
        s.entries.push({
          kind: "data",
          id: newId,
          label,
          visible: true,
          order: 0, // see registerAnnotation — reindexByKind owns the value
          featureCount: fc.features.length,
          style: { ...DEFAULT_CONVERTED_STYLE },
        });
        // The annotation stack just lost a member; close the gap it left.
        reindexByKind(s.entries);
      });
      // Deleting the old elementId is a no-op in the FC store (annotation ids
      // never had an FC), but kept for symmetry with `remove` — the call site
      // shouldn't have to know which ids carry FCs.
      fcStore.delete(elementId);
    },

    setVisibility: (id, visible) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e) {
          e.visible = visible;
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
      }),

    updateStyle: (id, patch) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e?.kind === "data") {
          Object.assign(e.style, patch);
        }
        // annotations: no-op (no style field on AnnotationLayerEntry).
      }),

    remove: (id) => {
      set((s) => {
        s.entries = s.entries.filter((e) => e.id !== id);
        // Removing from the middle would otherwise leave a hole in the
        // remaining stack's order (0,2,…), which breaks first/last detection.
        reindexByKind(s.entries);
      });
      // Phase 4 W0: drop the FC if any. Unconditional delete — annotation ids
      // never had an FC, so the call is a cheap no-op for them and keeps
      // `remove` kind-agnostic at the call site (mx-91343d).
      useDataLayerFCStore.getState().delete(id);
    },
  })),
);
