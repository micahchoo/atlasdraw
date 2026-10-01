// SPDX-License-Identifier: AGPL-3.0-only
// Composite PNG export callback.
import { useCallback } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { exportPNG, type PngPixelRatio } from "../lib/export";
import { captureView } from "../lib/mapView";
import { currentDocument } from "../state/document";

import type maplibregl from "maplibre-gl";

export interface ExportPNGNotify {
  error: (msg: string) => void;
}

/**
 * Returns a callback that downloads a PNG of the view at `pixelRatio`
 * (default 2: the quick action has no size picker). The name carries the
 * size, `atlasdraw-<time>@3x.png`, so files of one view are told apart.
 * The view, its bearing and its credits included, is captured at export
 * time (lib/mapView#captureView), so the PNG shows the map of that moment.
 */
export function useExportPNG(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  backgroundColor: string,
  notify: ExportPNGNotify,
): (pixelRatio?: PngPixelRatio) => void {
  return useCallback(
    (pixelRatio: PngPixelRatio = 2) => {
      if (!map || !excalidrawAPI) {
        return;
      }
      void (async () => {
        try {
          const view = captureView(map, currentDocument().snapshot());
          const blob = await exportPNG(map, excalidrawAPI, view, {
            pixelRatio,
            backgroundColor,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `atlasdraw-${Date.now()}@${pixelRatio}x.png`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          notify.error(
            `PNG export failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      })();
    },
    [map, excalidrawAPI, backgroundColor, notify],
  );
}
