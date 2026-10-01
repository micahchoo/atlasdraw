// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — composite PNG export callback.
import { useCallback } from "react";

import { getBasemap } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { exportPNG, type PngPixelRatio } from "../lib/export";
import { creditLine } from "../lib/tileLayers";
import { useBasemapStore } from "../state/basemap";
import { currentDocument } from "../state/document";

import type maplibregl from "maplibre-gl";

export interface ExportPNGNotify {
  error: (msg: string) => void;
}

/**
 * Returns a callback that downloads a PNG of the view at `pixelRatio`
 * (default 2: the quick action has no size picker). The name carries the
 * size, `atlasdraw-<time>@3x.png`, so files of one view are told apart.
 * The PNG carries the credit line (basemap and visible tile layers), read
 * at export time like the image.
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
          const credit = creditLine(
            getBasemap(useBasemapStore.getState().activeBasemapId)?.attribution,
            currentDocument().snapshot().overlays,
          );
          const blob = await exportPNG(map, excalidrawAPI, {
            pixelRatio,
            backgroundColor,
            credit,
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
