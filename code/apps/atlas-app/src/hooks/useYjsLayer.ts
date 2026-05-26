// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 9 — useYjsLayer React hook.
//
// Binds a YjsLayer (CRDT data layer) to React state so that local and remote
// mutations trigger re-renders and the map re-projects the updated GeoJSON
// snapshot.
//
// Flow position: Step 3 of 3 in data-layer-crdt (YjsLayer → useYjsLayer → map
// render).
// Upstream contract: receives {active, yjsDoc} from CollabState / useCollab.
// Downstream contract: produces {features, mutate} consumed by MapEditor.

import { useState, useEffect, useRef } from "react";

import {
  YjsLayer,
  observeLayer,
  addFeature as yjsAddFeature,
  deleteFeature as yjsDeleteFeature,
  setProperty as yjsSetProperty,
  appendVertex as yjsAppendVertex,
  deleteVertex as yjsDeleteVertex,
} from "@atlasdraw/data";

import type * as Y from "yjs";

import type { FeatureCollection } from "geojson";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal collab-state shape consumed by this hook.
 * Structurally compatible with CollabContextValue from useCollab.
 */
export interface YjsLayerCollab {
  active: boolean;
  /** The Y.Doc from CollabState. Null before connect() or after disconnect(). */
  yjsDoc: Y.Doc | null;
}

/**
 * Stable CRUD helpers wrapping YjsLayer operations on the "default" layer.
 *
 * Each method operates on the shared Y.Doc and is safe to call from event
 * handlers or effects — mutations are CRDT-merged across peers via Yjs.
 * The mutate object identity is stable for the lifetime of the collab session;
 * consumers can capture it in a ref or effect dependency without causing
 * excessive re-renders.
 */
export interface LayerMutators {
  addFeature: (
    featureId: string,
    geometryType: string,
    coordinates: ReadonlyArray<ReadonlyArray<[number, number]>>,
    properties?: Record<string, unknown>,
  ) => void;
  deleteFeature: (featureId: string) => void;
  setProperty: (featureId: string, key: string, value: unknown) => void;
  appendVertex: (
    featureId: string,
    ringIndex: number,
    vertex: [number, number],
  ) => void;
  deleteVertex: (
    featureId: string,
    ringIndex: number,
    vertexIndex: number,
  ) => void;
}

/** Return type for useYjsLayer. */
export interface YjsLayerState {
  /** GeoJSON FeatureCollection snapshot. Null when collab is inactive. */
  features: FeatureCollection | null;
  /** CRUD mutators for the "default" layer. Null when collab is inactive. */
  mutate: LayerMutators | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribe to a YjsLayer's "default" layer and return live GeoJSON snapshots
 * with memoized CRUD mutators.
 *
 * When `collab.active === false` or `collab.yjsDoc` is null, returns
 * `{ features: null, mutate: null }`. Consumers should treat null as
 * "not in collaborative editing mode" and fall back to local data sources.
 */
export function useYjsLayer(collab: YjsLayerCollab): YjsLayerState {
  const [features, setFeatures] = useState<FeatureCollection | null>(null);
  const mutateRef = useRef<LayerMutators | null>(null);

  useEffect(() => {
    if (!collab.active || !collab.yjsDoc) {
      setFeatures(null);
      mutateRef.current = null;
      return;
    }

    const yjsLayer = new YjsLayer(collab.yjsDoc);
    const layer = yjsLayer.getOrCreateLayer("default");

    // Build stable mutator closures bound to this layer.
    // Each wraps the raw @atlasdraw/data helper, currying the layer reference.
    mutateRef.current = {
      addFeature: (featureId, geometryType, coordinates, properties) =>
        yjsAddFeature(layer, featureId, geometryType, coordinates, properties),
      deleteFeature: (featureId) => yjsDeleteFeature(layer, featureId),
      setProperty: (featureId, key, value) =>
        yjsSetProperty(layer, featureId, key, value),
      appendVertex: (featureId, ringIndex, vertex) =>
        yjsAppendVertex(layer, featureId, ringIndex, vertex),
      deleteVertex: (featureId, ringIndex, vertexIndex) =>
        yjsDeleteVertex(layer, featureId, ringIndex, vertexIndex),
    };

    // observeLayer fires the callback synchronously with the initial snapshot,
    // then on every Yjs mutation. The callback receives a fresh
    // FeatureCollection each time via toGeoJSON (yjs-snapshot.ts).
    const unsubscribe = observeLayer(layer, (snapshot) => {
      setFeatures(snapshot);
    });

    return () => {
      unsubscribe();
      // Do not clear features here — the next effect will re-subscribe and
      // setFeatures synchronously if the deps are still active.
      mutateRef.current = null;
    };
  }, [collab.active, collab.yjsDoc]);

  return { features, mutate: mutateRef.current };
}
