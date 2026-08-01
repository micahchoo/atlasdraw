// @atlasdraw/data — YjsLayer → GeoJSON read-only projection.
// Phase 5 Task 4: Converts a Yjs layer (Y.Map<featureId, Feature>) into a
// GeoJSON FeatureCollection snapshot. Provides an observe helper that calls
// back with the latest snapshot on every mutation.
//
// These functions do NOT mutate the Y.Doc — they are read-only projections.
//
// `observeLayer` subscribes with `observeDeep`, not `observe`: three of the
// five mutators in yjs-layer.ts (appendVertex, deleteVertex, setProperty)
// only touch nested Y types, which a shallow observer never sees. It also
// keeps a per-feature cache so each event re-converts only the features the
// event actually touched — a vertex append on a 2000-feature layer re-builds
// one feature, not all of them (~28 ms → ~0.15 ms per event, measured).
// Consequence of the cache: unchanged Feature objects are SHARED between
// consecutive snapshots. Treat snapshots as immutable (React state already
// requires this); mutating one in place corrupts later snapshots.

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
export function toGeoJSON(layer: Y.Map<Y.Map<unknown>>): FeatureCollection {
  const features: Feature[] = [];

  layer.forEach((featureMap, featureId) => {
    if (!featureMap) {
      return;
    }
    features.push(convertFeature(featureMap as Y.Map<unknown>, featureId));
  });

  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// observeLayer — subscribe to mutations on a Yjs layer
// ---------------------------------------------------------------------------

/**
 * Subscribe to every mutation on a Yjs layer, including nested geometry /
 * property edits.  The callback receives a fresh GeoJSON FeatureCollection
 * snapshot on each change; features untouched by a change are reused from
 * the previous snapshot (content is always identical to a full
 * `toGeoJSON(layer)` — asserted in yjs-snapshot.test.ts).
 *
 * Returns an unsubscribe function.
 */
export function observeLayer(
  layer: Y.Map<Y.Map<unknown>>,
  callback: (snapshot: FeatureCollection) => void,
): () => void {
  // featureId → converted Feature from the last emit. Invalidated per event
  // below; a full re-convert only ever happens for the touched features.
  const cache = new Map<string, Feature>();

  const emit = (): void => {
    const features: Feature[] = [];
    // Iterate the layer itself so ordering always matches toGeoJSON.
    layer.forEach((featureMap, featureId) => {
      if (!featureMap) {
        return;
      }
      let feature = cache.get(featureId);
      if (!feature) {
        feature = convertFeature(featureMap as Y.Map<unknown>, featureId);
        cache.set(featureId, feature);
      }
      features.push(feature);
    });
    callback({ type: "FeatureCollection", features });
  };

  // Dropping a cache entry is the whole invalidation story: emit() lazily
  // re-converts any still-present feature it finds missing, and features
  // deleted from the layer simply never come back.
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    for (const event of events) {
      if (event.target === layer) {
        // Top-level add/update/delete: the changed feature ids are the keys.
        for (const featureId of event.changes.keys.keys()) {
          cache.delete(featureId);
        }
      } else {
        // Nested edit (geometry vertex, property, …): the first path segment
        // under the layer map is the feature id.
        const featureId = event.path[0];
        if (typeof featureId === "string") {
          cache.delete(featureId);
        }
      }
    }
    emit();
  };

  // Fire once immediately so the caller has the initial state.
  emit();
  layer.observeDeep(handler);
  return () => {
    layer.unobserveDeep(handler);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert one feature Y.Map to a plain GeoJSON Feature (fresh objects). */
function convertFeature(f: Y.Map<unknown>, featureId: string): Feature {
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

  return {
    type: "Feature",
    id: featureId,
    geometry,
    properties: Object.keys(properties).length > 0 ? properties : null,
  } as Feature;
}

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
