// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 0 Task T01 — LayerRegistry type contracts.
//
// Types only. Implementation lands in T11 (Phase 2 Wave 2). Consumed by
// T11 (impl), T12 (LayerPanel), T13 (ImportDialog), T14 (Convert action).
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T01
// Audit: docs/decisions/opus-audit-2026-05-04-post-wave4.md

import type { FeatureCollection } from "geojson";

/**
 * Minimal LayerStyle shape, inlined here pending restore of the @atlasdraw/basemap
 * export. The Phase 2 plan expected `import { LayerStyle } from "@atlasdraw/basemap"`,
 * but BasemapRegistry/style-builder were silently dropped from Phase 1 Wave 1 (see
 * opus-audit-2026-05-04-followup.md "Top 3 findings"). Replace this local definition
 * with the basemap export once that gap is closed — tracked in seeds.
 */
export interface LayerStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0..1
}

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
