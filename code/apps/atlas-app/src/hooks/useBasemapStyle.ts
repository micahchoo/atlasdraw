// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — basemap style application.
// Applies the resolved MapLibre style when the active basemap changes.
import { useEffect } from "react";

import {
  registerPmtilesProtocol,
  resolveStyle,
  BasemapRemoteGatedError,
} from "@atlasdraw/basemap";

import type maplibregl from "maplibre-gl";

export function useBasemapStyle(
  map: maplibregl.Map | null,
  activeBasemapId: string,
  allowRemote: boolean,
): void {
  useEffect(() => {
    if (!map) {
      return;
    }
    registerPmtilesProtocol();
    const apply = async () => {
      try {
        const pmtilesPath =
          import.meta.env.VITE_PMTILES_PATH ?? "/data/world-low-zoom.pmtiles";
        const style = await resolveStyle(activeBasemapId, {
          allowRemote,
          pmtilesPath,
        });
        map.setStyle(style);
      } catch (err) {
        if (err instanceof BasemapRemoteGatedError) {
          console.warn(
            `[basemap] Skipping '${err.basemapId}': remote tiles disabled`,
          );
          return;
        }
        // `void apply()` below is fire-and-forget — an unguarded rethrow here
        // would become a silent unhandled promise rejection (same class of
        // bug as useGeoJsonDrop.ts's addLayer-failure path; see COVERAGE.md).
        console.error(
          `[basemap] Failed to apply style '${activeBasemapId}':`,
          err,
        );
      }
    };
    void apply();
  }, [map, activeBasemapId, allowRemote]);
}
