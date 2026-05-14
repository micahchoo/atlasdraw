// @atlasdraw/data — YjsLayer → GeoJSON read-only projection.
// Phase 5 Task 4: Converts a Yjs layer (Y.Map<featureId, Feature>) into a
// GeoJSON FeatureCollection snapshot. Provides an observe helper that calls
// back with the latest snapshot on every mutation.
//
// These functions do NOT mutate the Y.Doc — they are read-only projections.

import * as Y from "yjs";
import type {
  FeatureCollection,
  Feature,
  Geometry,
  GeoJsonProperties,
} from "geojson";

// ---------------------------------------------------------------------------
// toGeoJSON — deep-convert a Yjs layer to a plain GeoJSON FeatureCollection
// ---------------------------------------------------------------------------

/**
 * Convert a Yjs layer (Y.Map of feature id → feature maps) into a plain
 * GeoJSON FeatureCollection.  Every call produces a fresh object tree.
 */
export function toGeoJSON(
  layer: Y.Map<Y.Map<unknown>>,
): FeatureCollection {
  const features: Feature[] = [];

  layer.forEach((featureMap, featureId) => {
    if (!featureMap) return;

    const f = featureMap as Y.Map<unknown>;
    const geomMap = f.get("geometry") as Y.Map<unknown> | undefined;
    const propsMap = f.get("properties") as Y.Map<unknown> | undefined;

    const geometry: Geometry | null = geomMap
      ? ({
          type: geomMap.get("type") as Geometry["type"],
          coordinates: deepYjsToPlain(geomMap.get("coordinates")),
        } as Geometry)
      : null;

    const properties: GeoJsonProperties = {};
    if (propsMap) {
      propsMap.forEach((value, key) => {
        properties[key] = deepYjsToPlain(value);
      });
    }

    features.push({
      type: "Feature",
      id: featureId,
      geometry,
      properties: Object.keys(properties).length > 0 ? properties : null,
    } as Feature);
  });

  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// observeLayer — subscribe to mutations on a Yjs layer
// ---------------------------------------------------------------------------

/**
 * Subscribe to every mutation on a Yjs layer.  The callback receives a fresh
 * GeoJSON FeatureCollection snapshot on each change.
 *
 * Returns an unsubscribe function.
 */
export function observeLayer(
  layer: Y.Map<Y.Map<unknown>>,
  callback: (snapshot: FeatureCollection) => void,
): () => void {
  const handler = (): void => {
    callback(toGeoJSON(layer));
  };
  // Fire once immediately so the caller has the initial state.
  handler();
  layer.observe(handler);
  return () => {
    layer.unobserve(handler);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively convert a Yjs data structure to plain JS.
 *   Y.Map  → Record<string, unknown>
 *   Y.Array → unknown[]
 *   other  → passed through
 */
function deepYjsToPlain(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => {
      obj[k] = deepYjsToPlain(v);
    });
    return obj;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((v) => deepYjsToPlain(v));
  }
  return value;
}
