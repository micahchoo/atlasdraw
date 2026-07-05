// SPDX-License-Identifier: AGPL-3.0-only
//
// Phase 5 Task 9 — Collab data layer: MapLibre source + layer lifecycle.
//
// Renders the live Yjs-backed GeoJSON FeatureCollection (from useYjsLayer)
// as a MapLibre source + layer, adding/removing them as collab activates or
// deactivates and pushing data updates as the collaborative doc mutates.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 1) — the
// safest of the five cuts: touches only `map` + the incoming FeatureCollection,
// with its own self-contained add/remove/update lifecycle and no shared refs.

import { useEffect } from "react";

import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";

import { inferGeometryType } from "../lib/geometryType";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

const COLLAB_DATA_ID = "collab-data";

/**
 * Mount/update/tear down the MapLibre source+layer that renders the
 * collaborative data layer's live FeatureCollection.
 *
 * `features` is null when collab is inactive or the layer is empty — in
 * that state any existing source/layer is removed.
 */
export function useCollabDataLayer(
  map: maplibregl.Map | null,
  features: FeatureCollection | null,
): void {
  const hasFeatures = !!features;

  // Effect 1: add/remove the map source+layer when collab activates/deactivates.
  useEffect(() => {
    if (!map) {
      return;
    }

    if (features) {
      if (!map.getSource(COLLAB_DATA_ID)) {
        map.addSource(COLLAB_DATA_ID, {
          type: "geojson",
          data: features,
        });
        const geometryType = inferGeometryType(features);
        map.addLayer(
          compileLayer(
            COLLAB_DATA_ID,
            defaultLayerStyle(features),
            geometryType,
          ),
        );
      }
    } else {
      // Collab deactivated — remove source and layer.
      try {
        if (map.getLayer(COLLAB_DATA_ID)) {
          map.removeLayer(COLLAB_DATA_ID);
        }
        if (map.getSource(COLLAB_DATA_ID)) {
          map.removeSource(COLLAB_DATA_ID);
        }
      } catch {
        /* Guard against redundant cleanup */
      }
    }

    return () => {
      try {
        if (map.getLayer(COLLAB_DATA_ID)) {
          map.removeLayer(COLLAB_DATA_ID);
        }
        if (map.getSource(COLLAB_DATA_ID)) {
          map.removeSource(COLLAB_DATA_ID);
        }
      } catch {
        /* Guard against redundant cleanup on unmount */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hasFeatures]);

  // Effect 2: push GeoJSON data updates to the existing map source.
  useEffect(() => {
    if (!map || !features) {
      return;
    }
    const src = map.getSource(COLLAB_DATA_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData(features);
    }
  }, [map, features]);
}
