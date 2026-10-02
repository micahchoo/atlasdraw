// SPDX-License-Identifier: AGPL-3.0-only
//
// Apply the resolved MapLibre style when the active basemap changes.
//
// setStyle() replaces the whole style document, which drops every overlay.
// This hook does not put them back: useMapOverlays re-applies the overlays
// on the "styledata" event that follows.
import { useEffect } from "react";

import {
  registerPmtilesProtocol,
  resolveStyle,
  BasemapRemoteGatedError,
} from "@atlasdraw/basemap";

import { getAppConfig } from "../config/app-config";

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

    // A second basemap change cancels this run, so a style resolved late is
    // never applied over a newer one.
    let cancelled = false;

    const apply = async () => {
      let style;
      try {
        const { pmtilesPath, basemapAssetsPath } = getAppConfig();
        style = await resolveStyle(activeBasemapId, {
          allowRemote,
          pmtilesPath,
          assetsPath: basemapAssetsPath,
        });
      } catch (err) {
        if (err instanceof BasemapRemoteGatedError) {
          console.warn(
            `[basemap] Skipping '${err.basemapId}': remote tiles disabled`,
          );
          return;
        }
        // `void apply()` below is fire-and-forget; a rethrow here would be an
        // unhandled promise rejection that nobody sees.
        console.error(
          `[basemap] Failed to apply style '${activeBasemapId}':`,
          err,
        );
        return;
      }
      if (cancelled) {
        return;
      }
      try {
        map.setStyle(style);
      } catch (err) {
        console.error(
          `[basemap] Failed to apply style '${activeBasemapId}':`,
          err,
        );
      }
    };
    void apply();

    return () => {
      cancelled = true;
    };
  }, [map, activeBasemapId, allowRemote]);
}
