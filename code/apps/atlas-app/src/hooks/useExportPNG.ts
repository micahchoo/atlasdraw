// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — composite PNG export callback.
import { useCallback } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { exportPNG } from "../lib/export";

import type maplibregl from "maplibre-gl";

export interface ExportPNGNotify {
  error: (msg: string) => void;
}

export function useExportPNG(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  backgroundColor: string,
  notify: ExportPNGNotify,
): () => void {
  return useCallback(() => {
    if (!map || !excalidrawAPI) {
      return;
    }
    void (async () => {
      try {
        const blob = await exportPNG(map, excalidrawAPI, { backgroundColor });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `atlasdraw-${Date.now()}.png`;
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
  }, [map, excalidrawAPI, backgroundColor, notify]);
}
