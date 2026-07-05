import { exportToCanvas } from "@atlasdraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type maplibregl from "maplibre-gl";

export type ExportOpts = { scale?: number; backgroundColor?: string };

/**
 * Composite PNG export: MapLibre basemap (+ data layers) under, Excalidraw
 * annotations on top. Resolution: CSS-logical pixels x scale (default 2),
 * NOT physical pixels — see Plan §T15 OQ-P2-2 amendment.
 *
 * Requires the MapLibre Map to have been constructed with
 * `preserveDrawingBuffer: true` (set in MapCanvas.tsx). Without it, the map
 * canvas may be cleared between draws and drawImage will yield a blank layer.
 */
export async function exportPNG(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  opts: ExportOpts = {},
): Promise<Blob> {
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
    throw new Error("exportPNG: 2D context unavailable on OffscreenCanvas");
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

  return offscreen.convertToBlob({ type: "image/png" });
}
