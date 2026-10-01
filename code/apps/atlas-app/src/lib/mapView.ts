// SPDX-License-Identifier: AGPL-3.0-only
//
// MapView: the map as the user sees it, as one plain value.
//
//   captureView(map, doc)     read the live map and the open document once
//   renderDrawing(view, ...)  the drawing for that view, turned by its bearing
//   mapCredits(...)           the credits every surface prints
//   groundResolution(view)    metres per CSS px, for a scale bar
//
// Two facts used to live only in the live editor's DOM: the bearing (a CSS
// turn of the drawing canvases, `--world-rotate`) and the credit line (the
// status bar). A surface that draws the map somewhere else, such as the PNG,
// the PDF, the viewer and the embed, had to know both by name, and the
// exports did not know the bearing. So a turned map exported its shapes
// north-up, away from their places on the map. Now each surface takes a
// MapView, and the bearing and the credits come with it.
//
// The value is captured once. The image, the north arrow, the scale bar and
// the credit then describe the same moment, even if the camera moves while
// the export runs.

import { exportToCanvas } from "@atlasdraw/excalidraw";
import { getBasemap } from "@atlasdraw/basemap";
import { viewportFor, type WorldFrame } from "@atlasdraw/geo";

import type { NormalizedZoomValue } from "@atlasdraw/excalidraw/types";

import type { OverlayEntry } from "../state/document";

export interface MapView {
  center: { lng: number; lat: number };
  zoom: number;
  /** Degrees clockwise from north, as MapLibre gives it. */
  bearing: number;
  /** The map's size in CSS px. */
  size: { width: number; height: number };
  /** The document's world frame: how scene units map to the world. */
  frame: WorldFrame;
  /** The basemap's credit, then each visible tile layer's, each once. */
  credits: string[];
}

/** What `captureView` reads off the live map. */
export interface ViewSource {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getCanvas(): { clientWidth: number; clientHeight: number };
}

/** What `captureView` reads off the open document. */
export interface ViewDocument {
  world: WorldFrame;
  /** A basemap registry id. */
  basemap: string;
  overlays: readonly OverlayEntry[];
}

/**
 * The credits: the basemap's credit, then the credit of each visible tile
 * layer, top of the stack first, each one once. This is the only function
 * that decides them. Every surface that shows the map prints its result.
 */
export function mapCredits(
  basemap: string | undefined,
  overlays: readonly OverlayEntry[],
): string[] {
  const credits: string[] = [];
  const add = (text: string | undefined) => {
    const credit = text?.trim();
    if (credit && !credits.includes(credit)) {
      credits.push(credit);
    }
  };
  add(basemap);
  overlays
    .filter((e) => e.kind === "tile" && e.visible)
    .slice()
    .sort((a, b) => b.order - a.order)
    .forEach((e) => add(e.kind === "tile" ? e.attribution : undefined));
  return credits;
}

/** The credits as one line of text. */
export function creditText(credits: readonly string[]): string {
  return credits.join(" · ");
}

/** The credits of a document, with the basemap's credit from its definition. */
export function documentCredits(
  doc: Pick<ViewDocument, "basemap" | "overlays">,
): string[] {
  return mapCredits(getBasemap(doc.basemap)?.attribution, doc.overlays);
}

/** Read the live map and the open document into a MapView. */
export function captureView(map: ViewSource, doc: ViewDocument): MapView {
  const center = map.getCenter();
  const canvas = map.getCanvas();
  return {
    center: { lng: center.lng, lat: center.lat },
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    size: { width: canvas.clientWidth, height: canvas.clientHeight },
    frame: doc.world,
    credits: documentCredits(doc),
  };
}

/** Equator length in metres, WGS84. */
const EQUATOR_M = 40075016.686;
/** MapLibre's zoom counts 512-px tiles. */
const TILE_PX = 512;

/** Web Mercator metres per CSS px at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return ((EQUATOR_M / TILE_PX) * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Ground metres per CSS px at the centre of the view. Web Mercator is
 * conformal, so the direction on screen, and so the bearing, does not change
 * it.
 */
export function groundResolution(view: MapView): number {
  return metersPerPixel(view.center.lat, view.zoom);
}

/**
 * The size, in CSS px, of the axis-aligned box around the view turned by
 * `bearing`. The drawing is rendered for this box and then turned, so the
 * corners of the output show the drawing too.
 */
export function drawingCover(
  size: { width: number; height: number },
  bearing: number,
): { width: number; height: number } {
  const t = (bearing * Math.PI) / 180;
  const cos = Math.abs(Math.cos(t));
  const sin = Math.abs(Math.sin(t));
  // Round off float noise first, so 90° gives the exact swapped size.
  const fit = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e6);
  return {
    width: fit(size.width * cos + size.height * sin),
    height: fit(size.width * sin + size.height * cos),
  };
}

type ExportInput = Parameters<typeof exportToCanvas>[0];

/** The drawing to render: the scene, its image files, and its look. */
export interface DrawingScene {
  elements: ExportInput["elements"];
  files: ExportInput["files"];
  /** The editor's app state, for the theme. The background is never drawn. */
  appState?: ExportInput["appState"];
}

/**
 * The drawing for `view`, at `pixelRatio` output px per CSS px, on a
 * transparent canvas the size of the view's export.
 *
 * Excalidraw renders the box around the turned view, north-up; the result
 * is then turned by -bearing about the centre. That is the turn the live
 * editor gives the drawing canvases (useCameraBridge, `--world-rotate`), so
 * a shape lands where it is on the turned map.
 */
export async function renderDrawing(
  view: MapView,
  scene: DrawingScene,
  pixelRatio: number,
): Promise<OffscreenCanvas> {
  const width = Math.floor(view.size.width * pixelRatio);
  const height = Math.floor(view.size.height * pixelRatio);
  const cover = drawingCover(view.size, view.bearing);
  const viewport = viewportFor(view.frame, {
    center: view.center,
    zoom: view.zoom,
    width: cover.width,
    height: cover.height,
  });
  const drawing = await exportToCanvas({
    elements: scene.elements,
    appState: { ...scene.appState, exportBackground: false },
    files: scene.files,
    viewport: {
      width: cover.width,
      height: cover.height,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: { value: viewport.zoom as NormalizedZoomValue },
    },
    getDimensions: () => ({
      width: Math.round(cover.width * pixelRatio),
      height: Math.round(cover.height * pixelRatio),
      scale: pixelRatio,
    }),
  });

  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("renderDrawing: 2D context unavailable on OffscreenCanvas");
  }
  ctx.save();
  // The camera centre, in output px; then the turn about it.
  ctx.translate(
    (view.size.width * pixelRatio) / 2,
    (view.size.height * pixelRatio) / 2,
  );
  ctx.rotate((-view.bearing * Math.PI) / 180);
  ctx.drawImage(
    drawing,
    -(cover.width * pixelRatio) / 2,
    -(cover.height * pixelRatio) / 2,
  );
  ctx.restore();
  return out;
}
