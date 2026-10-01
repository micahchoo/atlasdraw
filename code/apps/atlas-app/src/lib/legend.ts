// SPDX-License-Identifier: AGPL-3.0-only
// The export legend describes the exported view, not the document.
//
// A legend of every layer in the document includes layers the user switched
// off with the eye toggle and layers whose features sit nowhere near the
// exported page. Print a detail of one neighbourhood and the key describes
// the whole project — the one thing a printed legend exists to prevent.
//
// Small units so each is testable on its own:
//   renderedDataLayerIds  — which MapLibre layers actually painted something
//   visibleAnnotationIds  — which Excalidraw elements fall inside the frame
//   visibleRasterIds      — which rasters' corners overlap the frame
//   buildLegendEntries    — the projection to LayerLegendEntry, given all three
//   exportLegendEntries   — the three questions asked of the live view
//
// Data layers are asked of MapLibre rather than bbox-tested ourselves:
// `queryRenderedFeatures` reports what was drawn, which is the exact question,
// and it already honours layer visibility and zoom-range filters that a bbox
// test would miss.

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { LayerLegendEntry } from "./print-pdf";

import type { OverlayEntry } from "../state/document";
import type { AnnotationRow } from "../state/annotations";

import type maplibregl from "maplibre-gl";

/** A layer the legend can describe: a map layer or an annotation row. */
export type LegendSource = OverlayEntry | AnnotationRow;

/** Fallback swatch: annotation layers carry no colour of their own. */
const NEUTRAL_SWATCH = "#868e96";

/** Minimal shape of an Excalidraw element needed for the frame test. */
export interface ElementBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
}

/** Minimal shape of the Excalidraw appState needed for the frame test. */
export interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
}

/**
 * MapLibre layer ids with at least one feature painted in the current view.
 *
 * **One call per layer, deliberately.** Batching every id into a single
 * `queryRenderedFeatures({layers: [...]})` looks cheaper and is a trap: given
 * an id that is not in the current style, MapLibre 4.7.1 fires an ErrorEvent
 * and returns `[]` for the *whole* query, not just that layer
 * (`maplibre-gl.js`: `if(!i) return this.fire(...), []`). One stale id would
 * blank the entire legend. Asking per layer contains the blast radius to the
 * layer that is actually missing — and a missing layer is genuinely not in the
 * exported image, so excluding it is the right answer anyway.
 *
 * The try/catch is belt-and-braces for a future version that throws rather
 * than fires; today's path returns `[]` and needs no catch.
 */
export function renderedDataLayerIds(
  map: maplibregl.Map,
  layerIds: readonly string[],
): Set<string> {
  const rendered = new Set<string>();
  for (const id of layerIds) {
    try {
      if (map.queryRenderedFeatures({ layers: [id] }).length > 0) {
        rendered.add(id);
      }
    } catch {
      // Layer absent from the current style — not painted, not in the legend.
    }
  }
  return rendered;
}

/**
 * Excalidraw element ids whose bounds intersect the exported frame.
 *
 * The export composites the live viewport at `width` x `height` CSS px, so an
 * element is in the image exactly when its screen box overlaps that rect.
 * Screen from scene is Excalidraw's own transform: `(scene + scroll) * zoom`.
 */
export function visibleAnnotationIds(
  elements: readonly ElementBounds[],
  appState: ViewportState,
  width: number,
  height: number,
): Set<string> {
  const { scrollX, scrollY } = appState;
  const zoom = appState.zoom.value;
  const visible = new Set<string>();
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    const left = (el.x + scrollX) * zoom;
    const top = (el.y + scrollY) * zoom;
    const right = (el.x + el.width + scrollX) * zoom;
    const bottom = (el.y + el.height + scrollY) * zoom;
    // Touching the edge counts as visible: a zero-width element on the border
    // still puts ink on the page.
    if (right >= 0 && left <= width && bottom >= 0 && top <= height) {
      visible.add(el.id);
    }
  }
  return visible;
}

/**
 * Raster ids whose four corners, projected to the screen, overlap the
 * exported frame. Rasters paint no features, so `queryRenderedFeatures`
 * cannot answer for them; their corners are the whole of their footprint.
 * Tested against the annotation set instead, a raster never reaches the
 * legend.
 */
export function visibleRasterIds(
  entries: readonly LegendSource[],
  project: (lngLat: [number, number]) => { x: number; y: number },
  width: number,
  height: number,
): Set<string> {
  const visible = new Set<string>();
  for (const e of entries) {
    if (e.kind !== "raster") {
      continue;
    }
    const pts = e.corners.map((c) => project(c));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    if (
      Math.max(...xs) >= 0 &&
      Math.min(...xs) <= width &&
      Math.max(...ys) >= 0 &&
      Math.min(...ys) <= height
    ) {
      visible.add(e.id);
    }
  }
  return visible;
}

/** The colour a data layer draws in: a line has no fill, only a stroke. */
function swatchOf(entry: Extract<LegendSource, { kind: "data" }>): string {
  const color =
    entry.geometryKind === "line"
      ? entry.style.strokeColor
      : entry.style.fillColor;
  return color ?? NEUTRAL_SWATCH;
}

export interface LegendContext {
  renderedDataLayerIds: ReadonlySet<string>;
  visibleAnnotationIds: ReadonlySet<string>;
  visibleRasterIds: ReadonlySet<string>;
}

/**
 * Project the layers to legend entries, keeping only what the exported page
 * actually shows. `visible` is checked first because a hidden layer is not
 * painted regardless of where the camera is — and because that check needs no
 * map at all. A tile layer is a backdrop, like the basemap: it is never a
 * legend entry, and its credit is in the attribution line.
 */
export function buildLegendEntries(
  entries: readonly LegendSource[],
  ctx: LegendContext,
): LayerLegendEntry[] {
  return entries
    .filter((e) => e.visible && e.kind !== "tile")
    .filter((e) =>
      e.kind === "data"
        ? ctx.renderedDataLayerIds.has(e.id)
        : e.kind === "raster"
        ? ctx.visibleRasterIds.has(e.id)
        : ctx.visibleAnnotationIds.has(e.id),
    )
    .map<LayerLegendEntry>((e) => ({
      id: e.id,
      name: e.label,
      color: e.kind === "data" ? swatchOf(e) : NEUTRAL_SWATCH,
    }));
}

/**
 * The legend for an export of the live view: the document's layers, less what
 * is hidden or not on the page. Read at export time, like the image, so both
 * answer the same viewport.
 */
export function exportLegendEntries(
  entries: readonly LegendSource[],
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
): LayerLegendEntry[] {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  return buildLegendEntries(entries, {
    renderedDataLayerIds: renderedDataLayerIds(
      map,
      entries.filter((e) => e.kind === "data").map((e) => e.id),
    ),
    visibleAnnotationIds: visibleAnnotationIds(
      excalidrawAPI.getSceneElements(),
      excalidrawAPI.getAppState(),
      width,
      height,
    ),
    visibleRasterIds: visibleRasterIds(
      entries,
      (lngLat) => map.project(lngLat),
      width,
      height,
    ),
  });
}
