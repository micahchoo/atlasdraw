// SPDX-License-Identifier: AGPL-3.0-only
// The composite export: what a PNG or PDF of the map contains.
//
// One rule makes the output honest: every layer is RENDERED at the output's
// pixel ratio, and nothing is scaled up to it. The map is drawn again by an
// offscreen MapLibre map at that ratio, and the drawings by Excalidraw at the
// same ratio. A 3x PNG of a 1440 x 900 view is 4320 x 2700 px with 4320 x 2700
// px of basemap in it, not a 1440 x 900 screenshot stretched to fit.
//
// Do not draw the screen's map canvas (1x on a 1x screen) and the drawings
// (1x) into a 2x canvas through ctx.scale(2): both layers are upscaled, and
// the "2x" export is a stretched screenshot.
//
// Every layer reads one MapView (lib/mapView.ts), captured once by the
// caller: the map is drawn at its camera and bearing, the drawing is turned
// by the same bearing, and the credit is its credits.

import maplibregl from "maplibre-gl";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { creditText, renderDrawing, type MapView } from "./mapView";

/** The PNG sizes the dialog offers, as multiples of the view. */
export const PNG_PIXEL_RATIOS = [1, 2, 3] as const;
export type PngPixelRatio = typeof PNG_PIXEL_RATIOS[number];

/** A map drawn at some pixel ratio, held until the caller has copied it. */
export interface RenderedMap {
  canvas: CanvasImageSource & { width: number; height: number };
  /** Release the renderer (an offscreen map holds a WebGL context). */
  dispose: () => void;
}

/** Draw `view` with `map`'s style at `pixelRatio`. */
export type MapRenderer = (
  map: maplibregl.Map,
  view: MapView,
  pixelRatio: number,
) => Promise<RenderedMap>;

export type ExportOpts = {
  /** Output pixels per CSS pixel of the view. Default 2. */
  pixelRatio?: number;
  backgroundColor?: string;
  /** Test seam. Default `renderMapOffscreen`. */
  renderMap?: MapRenderer;
  /**
   * Print the view's credits in the bottom-right corner over a pale box.
   * Default true: a PNG leaves the app, so the credit the map's providers
   * ask for must travel inside it. The PDF prints the credit as page text
   * instead, so its composite passes false.
   */
  credit?: boolean;
};

export type CompositeImageOpts = ExportOpts & {
  /** MIME type for the encoded image. Default `image/jpeg`. */
  type?: string;
  /** Encoder quality for lossy types. Default 0.92. */
  quality?: number;
};

/**
 * Output size for a CSS-pixel view at `pixelRatio`. Rounded down because
 * that is how MapLibre sizes its canvas (`Math.floor(pixelRatio * width)`),
 * and the map layer must fill the output exactly.
 */
export function exportSize(
  view: { width: number; height: number },
  pixelRatio: number,
): { width: number; height: number } {
  return {
    width: Math.floor(view.width * pixelRatio),
    height: Math.floor(view.height * pixelRatio),
  };
}

/** Longest the offscreen map may take to load tiles, glyphs and sprites. */
const OFFSCREEN_TIMEOUT_MS = 30_000;

/**
 * Draw the live map's view again, in a hidden map of the same CSS size, at
 * `pixelRatio`.
 *
 * Why a second map and not `map.setPixelRatio` on the live one: MapLibre
 * caps the drawing buffer with `maxCanvasSize`, default 4096 x 4096, and that
 * cap is a constructor option. A 2x export of a 2560 px wide view needs 5120.
 * The hidden map is built with a cap that fits the export; the live map, its
 * cap, its events and its screen are left alone.
 *
 * The hidden map gets the live style (`getStyle()` serialises GeoJSON source
 * data too) and the view's camera, bearing included, and is read on `idle`: every tile, glyph and
 * sprite loaded and no fade running (fadeDuration 0). If the GPU limit still
 * makes the canvas smaller, the compositor sees the size and refuses.
 */
export async function renderMapOffscreen(
  map: maplibregl.Map,
  view: MapView,
  pixelRatio: number,
): Promise<RenderedMap> {
  const { width, height } = view.size;
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: `${-(width + 100)}px`,
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(container);

  const offscreen = new maplibregl.Map({
    container,
    style: map.getStyle(),
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing,
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    renderWorldCopies: map.getRenderWorldCopies(),
    pixelRatio,
    maxCanvasSize: [
      Math.ceil(width * pixelRatio),
      Math.ceil(height * pixelRatio),
    ],
    preserveDrawingBuffer: true,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
  });
  const dispose = () => {
    offscreen.remove();
    container.remove();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () =>
          reject(
            new Error(
              `The map did not finish loading in ${
                OFFSCREEN_TIMEOUT_MS / 1000
              } s.`,
            ),
          ),
        OFFSCREEN_TIMEOUT_MS,
      );
      offscreen.once("idle", () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  } catch (err) {
    dispose();
    throw err;
  }
  return { canvas: offscreen.getCanvas(), dispose };
}

function assertSize(
  what: string,
  got: { width: number; height: number },
  want: { width: number; height: number },
): void {
  if (got.width !== want.width || got.height !== want.height) {
    throw new Error(
      `The ${what} was drawn at ${got.width} × ${got.height} px, not ${want.width} × ${want.height} px. ` +
        "The browser cannot draw an image this large. Choose a smaller size.",
    );
  }
}

/**
 * Composite the exportable view: MapLibre basemap (+ data layers) under,
 * Excalidraw annotations on top, both rendered at `pixelRatio`.
 *
 * This is the single definition of "what an export contains". Every export
 * surface must go through it: a path that composites on its own can ship a
 * document with the basemap and none of the user's shapes.
 */
export async function compositeMapScene(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  view: MapView,
  opts: ExportOpts = {},
): Promise<OffscreenCanvas> {
  const pixelRatio = opts.pixelRatio ?? 2;
  const backgroundColor = opts.backgroundColor ?? "transparent";
  const renderMap = opts.renderMap ?? renderMapOffscreen;
  const size = exportSize(view.size, pixelRatio);

  const offscreen = new OffscreenCanvas(size.width, size.height);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error(
      "compositeMapScene: 2D context unavailable on OffscreenCanvas",
    );
  }

  // Layer 0 (optional): the user's background colour, under the map, where
  // the style leaves the canvas transparent.
  if (backgroundColor !== "transparent") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, size.width, size.height);
  }

  // Layer 1: MapLibre (basemap + data layers), drawn 1:1.
  const rendered = await renderMap(map, view, pixelRatio);
  try {
    assertSize("map", rendered.canvas, size);
    ctx.drawImage(rendered.canvas, 0, 0);
  } finally {
    rendered.dispose();
  }

  // Layer 2: the drawing for the same view, turned by its bearing, rendered
  // at the same ratio and drawn 1:1.
  const drawings = await renderDrawing(
    view,
    {
      elements: excalidrawAPI.getSceneElements(),
      files: excalidrawAPI.getFiles(),
      appState: excalidrawAPI.getAppState(),
    },
    pixelRatio,
  );
  assertSize("drawing layer", drawings, size);
  ctx.drawImage(drawings, 0, 0);

  // Layer 3: the credits, unless the caller prints them elsewhere.
  const credit = creditText(view.credits);
  if (opts.credit !== false && credit) {
    drawCredit(ctx, credit, size, pixelRatio);
  }

  return offscreen;
}

/** Credit text: 11 CSS px, like the status bar, at the export's ratio. */
const CREDIT_FONT_PX = 11;
const CREDIT_PAD_PX = 4;

function drawCredit(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  size: { width: number; height: number },
  pixelRatio: number,
): void {
  const font = CREDIT_FONT_PX * pixelRatio;
  const pad = CREDIT_PAD_PX * pixelRatio;
  ctx.font = `${font}px system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const width = Math.min(ctx.measureText(text).width, size.width - 2 * pad);
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillRect(
    size.width - width - 2 * pad,
    size.height - font - 2 * pad,
    width + 2 * pad,
    font + 2 * pad,
  );
  ctx.fillStyle = "#212529";
  ctx.fillText(text, size.width - pad, size.height - pad, width);
}

/** Composite PNG export. */
export async function exportPNG(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  view: MapView,
  opts: ExportOpts = {},
): Promise<Blob> {
  const offscreen = await compositeMapScene(map, excalidrawAPI, view, opts);
  return offscreen.convertToBlob({ type: "image/png" });
}

/**
 * Blob -> `data:` URL. `FileReader.readAsDataURL` does the base64 itself, so
 * there is no hand-rolled encoder here to get the chunking wrong. Works in
 * jsdom and browsers alike.
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The composited view as a `data:` URL, for the PDF export, which embeds
 * encoded bytes. JPEG at 0.92 by default: pdf-lib embeds a JPEG as-is, while
 * a PNG is decoded and re-compressed in JavaScript, which is slow at print
 * size.
 */
export async function exportCompositeDataURL(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  view: MapView,
  opts: CompositeImageOpts = {},
): Promise<string> {
  const type = opts.type ?? "image/jpeg";
  const quality = opts.quality ?? 0.92;
  const offscreen = await compositeMapScene(map, excalidrawAPI, view, opts);
  const blob = await offscreen.convertToBlob({ type, quality });
  return blobToDataURL(blob);
}
