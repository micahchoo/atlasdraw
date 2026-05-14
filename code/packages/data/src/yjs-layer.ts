// @atlasdraw/data — YjsLayer CRDT type model.
// Phase 5 Task 4: Y.Doc-backed feature storage with Y.Map features and
// Y.Array geometry coordinates for conflict-free concurrent vertex edits.
//
// Structure:
//   Y.Doc
//     └─ "layers" Y.Map<layerName, Y.Map<featureId, Feature>>
//           └─ Feature Y.Map:
//                 "type"       → string ("Feature")
//                 "properties" → Y.Map<key, value>
//                 "geometry"   → Y.Map:
//                     "type"        → string (e.g. "Polygon", "LineString")
//                     "coordinates" → Y.Array<Y.Array<Y.Array<number>>>
//                                    (rings of [lng, lat] vertices)
//
// Consumers sync the Y.Doc via Y.encodeStateAsUpdate / Y.applyUpdate.

import * as Y from "yjs";

// ---------------------------------------------------------------------------
// YjsLayer — wrapper around a Y.Doc with CRDT-native data layer ops
// ---------------------------------------------------------------------------

export class YjsLayer {
  private _doc: Y.Doc;

  /**
   * @param doc Optional existing Y.Doc. If omitted, a new one is created.
   */
  constructor(doc?: Y.Doc) {
    this._doc = doc ?? new Y.Doc();
  }

  /** The underlying Y.Doc for sync via Y.encodeStateAsUpdate / Y.applyUpdate. */
  get doc(): Y.Doc {
    return this._doc;
  }

  /**
   * Returns the root "layers" map: layer name → feature id → feature map.
   * Top-level key in the Y.Doc.
   */
  getLayers(): Y.Map<Y.Map<Y.Map<unknown>>> {
    return this._doc.getMap("layers");
  }

  /**
   * Gets or creates a named layer inside the root layers map.
   * Each layer is a Y.Map keyed by feature id.
   */
  getOrCreateLayer(name: string): Y.Map<Y.Map<unknown>> {
    const layers = this.getLayers();
    let layer = layers.get(name) as Y.Map<Y.Map<unknown>> | undefined;
    if (!layer) {
      layer = new Y.Map() as Y.Map<Y.Map<unknown>>;
      layers.set(name, layer);
    }
    return layer;
  }
}

// ---------------------------------------------------------------------------
// Helper functions — operate on a Y.Map<Y.Map<unknown>> (a single layer)
// ---------------------------------------------------------------------------

/**
 * Add a GeoJSON-like feature to a layer.
 *
 * @param layer     The layer Y.Map (from getOrCreateLayer).
 * @param featureId Unique string identifier for the feature.
 * @param geometryType GeoJSON geometry type (e.g. "Point", "LineString", "Polygon").
 * @param coordinates  Array of rings, where each ring is Array<[lng, lat]>.
 *                     For Point/LineString use a single-ring wrapper.
 * @param properties   Optional plain-object properties.
 */
export function addFeature(
  layer: Y.Map<Y.Map<unknown>>,
  featureId: string,
  geometryType: string,
  coordinates: ReadonlyArray<ReadonlyArray<[number, number]>>,
  properties?: Record<string, unknown>,
): void {
  const featureMap = new Y.Map() as Y.Map<unknown>;
  featureMap.set("type", "Feature");

  // Geometry
  const geometry = new Y.Map() as Y.Map<unknown>;
  geometry.set("type", geometryType);
  geometry.set("coordinates", buildCoordinates(coordinates));
  featureMap.set("geometry", geometry);

  // Properties
  const props = new Y.Map<unknown>();
  if (properties) {
    for (const [k, v] of Object.entries(properties)) {
      props.set(k, v);
    }
  }
  featureMap.set("properties", props);

  layer.set(featureId, featureMap as Y.Map<unknown>);
}

/**
 * Build a Y.Array<Y.Array<Y.Array<number>>> from a rings array.
 * Each ring is an array of [lng, lat] tuples; each tuple becomes a
 * Y.Array<number> so concurrent pushes merge correctly.
 */
function buildCoordinates(
  rings: ReadonlyArray<ReadonlyArray<[number, number]>>,
): Y.Array<Y.Array<Y.Array<number>>> {
  const outer = new Y.Array<Y.Array<Y.Array<number>>>();
  for (const ring of rings) {
    const ringArr = new Y.Array<Y.Array<number>>();
    for (const [lng, lat] of ring) {
      const pt = new Y.Array<number>();
      pt.push([lng, lat]);
      ringArr.push([pt]);
    }
    outer.push([ringArr]);
  }
  return outer;
}

/**
 * Remove a feature from a layer by id.
 * No-op if the feature does not exist.
 */
export function deleteFeature(
  layer: Y.Map<Y.Map<unknown>>,
  featureId: string,
): void {
  layer.delete(featureId);
}

/**
 * Set a property value on a feature's properties map.
 * Throws if the feature does not exist.
 */
export function setProperty(
  layer: Y.Map<Y.Map<unknown>>,
  featureId: string,
  key: string,
  value: unknown,
): void {
  const feature = layer.get(featureId) as Y.Map<unknown> | undefined;
  if (!feature) {
    throw new Error(`Feature "${featureId}" not found`);
  }
  const props = feature.get("properties") as Y.Map<unknown> | undefined;
  if (!props) {
    throw new Error(`Feature "${featureId}" has no properties map`);
  }
  props.set(key, value);
}

/**
 * Append a vertex to a specific ring of a feature's geometry ring.
 * Throws if the feature or ring index is not found.
 *
 * @param layer     The layer containing the feature.
 * @param featureId Feature identifier.
 * @param ringIndex Index into the coordinates array (0-based).
 * @param vertex    [lng, lat] tuple to append.
 */
export function appendVertex(
  layer: Y.Map<Y.Map<unknown>>,
  featureId: string,
  ringIndex: number,
  vertex: [number, number],
): void {
  const feature = layer.get(featureId) as Y.Map<unknown> | undefined;
  if (!feature) {
    throw new Error(`Feature "${featureId}" not found`);
  }

  const geometry = feature.get("geometry") as Y.Map<unknown> | undefined;
  if (!geometry) {
    throw new Error(`Feature "${featureId}" has no geometry`);
  }

  const coords = geometry.get("coordinates") as Y.Array<Y.Array<Y.Array<number>>>;
  const ring = coords.get(ringIndex);
  if (!ring) {
    throw new Error(`Ring index ${ringIndex} not found`);
  }

  const pt = new Y.Array<number>();
  pt.push([vertex[0], vertex[1]]);
  ring.push([pt]);
}

/**
 * Delete a vertex from a specific ring of a feature's geometry.
 * Throws if the feature or ring index is not found.
 *
 * @param layer       The layer containing the feature.
 * @param featureId   Feature identifier.
 * @param ringIndex   Index into the coordinates array (0-based).
 * @param vertexIndex Index of the vertex to remove (0-based).
 */
export function deleteVertex(
  layer: Y.Map<Y.Map<unknown>>,
  featureId: string,
  ringIndex: number,
  vertexIndex: number,
): void {
  const feature = layer.get(featureId) as Y.Map<unknown> | undefined;
  if (!feature) {
    throw new Error(`Feature "${featureId}" not found`);
  }

  const geometry = feature.get("geometry") as Y.Map<unknown> | undefined;
  if (!geometry) {
    throw new Error(`Feature "${featureId}" has no geometry`);
  }

  const coords = geometry.get("coordinates") as Y.Array<Y.Array<Y.Array<number>>>;
  const ring = coords.get(ringIndex);
  if (!ring) {
    throw new Error(`Ring index ${ringIndex} not found`);
  }

  ring.delete(vertexIndex);
}
