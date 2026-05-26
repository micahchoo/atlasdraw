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

import { useDataLayerFCStore } from "./useDataLayerFCStore";

import type { LayerStyle } from "@atlasdraw/basemap";
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
  updateAnnotationLabel(elementId: string, label: string): void;
  registerDataLayer(opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }): void;
  convertAnnotationToDataLayer(elementId: string, fc: FeatureCollection): void;
  setVisibility(id: string, visible: boolean): void;
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
          order: s.entries.length,
        });
      }),
    updateAnnotationLabel: (elementId, label) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === elementId);
        if (e) {
          e.label = label;
        }
      }),

    registerDataLayer: ({ id, fc, label, style }) => {
      if (!id.startsWith("dl:")) {
        throw new Error(
          `data layer id must start with dl: prefix (received "${id}")`,
        );
      }
      set((s) => {
        s.entries.push({
          kind: "data",
          id,
          label,
          visible: true,
          order: s.entries.length,
          featureCount: fc.features.length,
          style,
        });
      });
      // Phase 4 W0 (atlasdraw-ad27): mirror the FC into the FC registry so
      // selectDocument can populate AtlasdrawDocument.layers without ever
      // round-tripping through MapLibre's opaque source storage.
      useDataLayerFCStore.getState().set(id, fc);
    },

    convertAnnotationToDataLayer: (elementId, fc) => {
      // Mint the new dl: id outside `set()` so we can mirror it into the FC
      // registry with the exact same id that lands on the entry. Doing it
      // inside immer would force us to capture the id from a draft, which
      // the freeze semantics make awkward.
      const newId = `dl:${crypto.randomUUID()}`;
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
          order: s.entries.length,
          featureCount: fc.features.length,
          style: { ...DEFAULT_CONVERTED_STYLE },
        });
      });
      // Mirror into FC registry (Phase 4 W0). Deleting the old elementId is a
      // no-op in the FC store (annotation ids never had an FC), but kept for
      // symmetry with `remove` — the call site shouldn't have to know which
      // ids carry FCs.
      const fcStore = useDataLayerFCStore.getState();
      fcStore.delete(elementId);
      fcStore.set(newId, fc);
    },

    setVisibility: (id, visible) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e) {
          e.visible = visible;
        }
      }),

    reorder: (id, newOrder) =>
      set((s) => {
        const clamped = Math.max(0, Math.min(newOrder, s.entries.length - 1));
        const from = s.entries.findIndex((x) => x.id === id);
        if (from === -1) {
          return;
        }
        const [entry] = s.entries.splice(from, 1);
        s.entries.splice(clamped, 0, entry);
        s.entries.forEach((e, i) => {
          e.order = i;
        });
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
      });
      // Phase 4 W0: drop the FC if any. Unconditional delete — annotation ids
      // never had an FC, so the call is a cheap no-op for them and keeps
      // `remove` kind-agnostic at the call site (mx-91343d).
      useDataLayerFCStore.getState().delete(id);
    },
  })),
);
