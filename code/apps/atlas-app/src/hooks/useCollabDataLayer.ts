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

import { useEffect, useRef } from "react";

import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";

import { inferGeometryType } from "../lib/geometryType";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

const COLLAB_DATA_ID = "collab-data";

/**
 * Add the source + layer if the current style is missing them. Idempotent, so
 * both the mount effect and the post-style-swap listener can call it.
 */
function ensureOnMap(map: maplibregl.Map, features: FeatureCollection): void {
  if (map.getSource(COLLAB_DATA_ID)) {
    return;
  }
  map.addSource(COLLAB_DATA_ID, { type: "geojson", data: features });
  map.addLayer(
    compileLayer(
      COLLAB_DATA_ID,
      defaultLayerStyle(features),
      inferGeometryType(features),
    ),
  );
}

/**
 * Mount/update/tear down the MapLibre source+layer that renders the
 * collaborative data layer's live FeatureCollection.
 *
 * `features` is null when collab is inactive or the layer is empty — in
 * that state any existing source/layer is removed.
 *
 * FU-3 — this layer is NOT in the LayerRegistry, so `reconcileDataLayers` (the
 * thing that puts every other custom layer back after `setStyle` drops it)
 * never sees it. Before the `styledata` listener below, switching the basemap
 * in a shared session made every collaborator's shapes disappear from the map
 * while still sitting in the document — indistinguishable from live data loss,
 * in front of the other people in the session.
 *
 * The ticket proposed registering it instead. Rejected: the registry is what
 * the LayerPanel renders, so an entry there gets rename, delete, restyle and
 * reorder — four controls that would all lie about a Yjs-owned layer, and a
 * delete that undoes itself on the next sync. Machine-owned layers keep their
 * own lifecycle; they just have to *have* one across a style swap.
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
      ensureOnMap(map, features);
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

  // Effect 3 (FU-3): put the layer back after a basemap switch or any other
  // setStyle, which drops every custom source and layer in the document.
  //
  // `styledata` is the same signal useBasemapStyle reconciles the registry on,
  // and MapLibre fires it for ordinary addLayer/setPaintProperty calls too —
  // hence `ensureOnMap`'s existence check rather than `once` semantics. This
  // listener is deliberately persistent: a basemap can be switched any number
  // of times per session, so unsubscribing after the first swap would fix
  // exactly one of them.
  //
  // The latest FeatureCollection comes from a ref, not the dependency array.
  // As a dependency it would tear down and re-add the listener on every
  // collaborative edit — which is many times a second while someone is drawing.
  const featuresRef = useRef(features);
  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    if (!map) {
      return;
    }
    const onStyleData = () => {
      const current = featuresRef.current;
      if (!current) {
        return;
      }
      try {
        ensureOnMap(map, current);
      } catch (err) {
        // A style mid-swap can reject addSource. Losing one re-add attempt is
        // survivable — the next styledata retries — but throwing inside a
        // MapLibre event handler is not.
        // eslint-disable-next-line no-console
        console.warn("[collab] could not restore the collab data layer:", err);
      }
    };
    map.on("styledata", onStyleData);
    return () => {
      map.off("styledata", onStyleData);
    };
  }, [map]);
}
