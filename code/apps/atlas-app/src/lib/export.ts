import { exportToCanvas } from "@atlasdraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type maplibregl from "maplibre-gl";

export type ExportOpts = { scale?: number; backgroundColor?: string };

export type CompositeImageOpts = ExportOpts & {
  /** MIME type for the encoded image. Default `image/jpeg`. */
  type?: string;
  /** Encoder quality for lossy types. Default 0.85. */
  quality?: number;
};

/**
 * Composite the exportable view: MapLibre basemap (+ data layers) under,
 * Excalidraw annotations on top. Resolution: CSS-logical pixels x scale
 * (default 2), NOT physical pixels — see Plan §T15 OQ-P2-2 amendment.
 *
 * This is the single definition of "what an export contains". Every export
 * surface must go through it. The PDF path did not, and shipped a document
 * with the basemap and none of the user's shapes — see FU-12 in
 * `.agents/docs/SHEET_PANEL_FOLLOWUPS.md`.
 *
 * Requires the MapLibre Map to have been constructed with
 * `preserveDrawingBuffer: true` (set in MapCanvas.tsx). Without it, the map
 * canvas may be cleared between draws and drawImage will yield a blank layer.
 */
export async function compositeMapScene(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  opts: ExportOpts = {},
): Promise<OffscreenCanvas> {
  const scale = opts.scale ?? 2;
  const backgroundColor = opts.backgroundColor ?? "transparent";
  const mapCanvas = map.getCanvas();
  // CSS logical px (NOT physical px). On retina (DPR=2) mapCanvas.width is
  // already cssWidth*DPR; using it would yield 4x logical resolution.
  const width = mapCanvas.clientWidth;
  const height = mapCanvas.clientHeight;

  const offscreen = new OffscreenCanvas(width * scale, height * scale);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error(
      "compositeMapScene: 2D context unavailable on OffscreenCanvas",
    );
  }
  ctx.scale(scale, scale);

  // Layer 0 (optional): user-chosen background color. Fills before the map so
  // it shows only where the map canvas has transparent pixels. If MapLibre has
  // its own background layer the color is already baked in; this is a fallback.
  if (backgroundColor !== "transparent") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  // Layer 1: MapLibre (basemap + data layers).
  ctx.drawImage(mapCanvas, 0, 0, width, height);

  // Layer 2: Excalidraw annotations rendered at the live viewport so
  // zoom/scroll match the map layer exactly.
  const appState = excalidrawAPI.getAppState();
  const excalidrawCanvas = await exportToCanvas({
    elements: excalidrawAPI.getSceneElements(),
    appState: { ...appState, exportBackground: false },
    files: excalidrawAPI.getFiles(),
    viewport: {
      width,
      height,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    },
  });
  ctx.drawImage(excalidrawCanvas, 0, 0, width, height);

  return offscreen;
}

/**
 * Composite PNG export. Thin wrapper over `compositeMapScene`.
 */
export async function exportPNG(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  opts: ExportOpts = {},
): Promise<Blob> {
  const offscreen = await compositeMapScene(map, excalidrawAPI, opts);
  return offscreen.convertToBlob({ type: "image/png" });
}

/**
 * Blob -> `data:` URL. `FileReader.readAsDataURL` does the base64 itself, so
 * there is no hand-rolled encoder here to get the chunking wrong on a 300KB
 * JPEG. Works in jsdom and browsers alike; jsdom 22's Blob has no
 * `arrayBuffer()`, which is why this does not go through bytes.
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
 * The composited view as a `data:` URL, for consumers that need encoded bytes
 * rather than a canvas — the PDF export in particular, which embeds a JPEG.
 *
 * `OffscreenCanvas` has `convertToBlob` and no `toDataURL`, so the encode is
 * asynchronous. That is why the PDF path takes a prepared data URL instead of
 * a canvas object: there is no honest way to expose a synchronous `toDataURL`
 * over an async encoder.
 */
export async function exportCompositeDataURL(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  opts: CompositeImageOpts = {},
): Promise<string> {
  const type = opts.type ?? "image/jpeg";
  const quality = opts.quality ?? 0.85;
  const offscreen = await compositeMapScene(map, excalidrawAPI, opts);
  const blob = await offscreen.convertToBlob({ type, quality });
  return blobToDataURL(blob);
}
