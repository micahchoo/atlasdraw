// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — basemap style application.
// Applies the resolved MapLibre style when the active basemap changes.
//
// setStyle() replaces the whole style document, which drops every custom
// source and layer the app added — imported data layers included. The
// LayerRegistry survives the swap, so after each successful setStyle we
// reconcile the map back to the registry once the new style has loaded.
import { useEffect } from "react";

import {
  registerPmtilesProtocol,
  resolveStyle,
  BasemapRemoteGatedError,
} from "@atlasdraw/basemap";

import { useLayerRegistryStore } from "../state/layerRegistry";
import { useDataLayerFCStore } from "../state/useDataLayerFCStore";
import { useRasterImageStore } from "../state/useRasterImageStore";
import { reconcileDataLayers } from "../lib/dataLayerRender";

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

    // One flag and one handler identity per effect run, both captured by the
    // cleanup below. That is what makes the swap cancellable: a second basemap
    // change unmounts this run before it can register anything, so there is
    // never more than one live `styledata` subscriber and never a stale style
    // applied out of order.
    let cancelled = false;

    // `styledata` is the public signal that a new style document finished
    // loading — maplibre-gl 4.x exposes no style.load in MapEventType. MapLibre
    // also fires it for every addLayer/setPaintProperty, so we want exactly the
    // first one after our setStyle: `on` + self-`off` gives us `once` semantics
    // while leaving a handler reference the cleanup can remove.
    const onStyleData = () => {
      map.off("styledata", onStyleData);
      if (cancelled) {
        return;
      }
      reconcileDataLayers(
        map,
        useLayerRegistryStore.getState().entries,
        useDataLayerFCStore.getState().getAll(),
        // FU-1: without these the basemap switch puts every vector layer back
        // and leaves the scanned sheets off the map, with their rows still in
        // the panel. Same shape of failure FU-3 fixed for the collab layer.
        Object.fromEntries(
          Object.entries(useRasterImageStore.getState().getAll()).map(
            ([id, image]) => [id, image.url],
          ),
        ),
      );
    };

    const apply = async () => {
      let style;
      try {
        const pmtilesPath =
          import.meta.env.VITE_PMTILES_PATH ?? "/data/world-low-zoom.pmtiles";
        style = await resolveStyle(activeBasemapId, {
          allowRemote,
          pmtilesPath,
        });
      } catch (err) {
        if (err instanceof BasemapRemoteGatedError) {
          console.warn(
            `[basemap] Skipping '${err.basemapId}': remote tiles disabled`,
          );
          return;
        }
        // `void apply()` below is fire-and-forget — an unguarded rethrow here
        // would become a silent unhandled promise rejection (same class of
        // bug as useDataFileImport.ts's addLayer-failure path; see COVERAGE.md).
        console.error(
          `[basemap] Failed to apply style '${activeBasemapId}':`,
          err,
        );
        return;
      }
      if (cancelled) {
        return;
      }
      // Registered *before* setStyle so the listener can't miss the event, but
      // guarded on its own: failing to schedule the post-swap reconcile costs
      // the data layers a re-add, not the basemap switch. Sharing one try with
      // setStyle meant a throw here silently left the user on the old basemap.
      try {
        map.on("styledata", onStyleData);
      } catch (err) {
        console.warn(
          "[basemap] Could not schedule the post-swap data-layer reconcile:",
          err,
        );
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
      map.off("styledata", onStyleData);
    };
  }, [map, activeBasemapId, allowRemote]);
}
