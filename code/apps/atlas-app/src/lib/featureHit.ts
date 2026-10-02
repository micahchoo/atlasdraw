// SPDX-License-Identifier: AGPL-3.0-only
//
// Which feature a click opens, and its attributes as text.
//
//   featureAt(map, overlays, point)  the feature of the topmost visible data
//                                    layer under the point, or null
//   attributeRows(properties)        the properties as key/value text, in the
//                                    feature's order
//
// The hit test asks MapLibre one layer at a time, top of the stack first.
// MapLibre answers a query that names a layer missing from the style with []
// for every layer, so one overlay the map did not draw must not hide the
// others. A layer's visibility is read from the map, through the query: a
// hidden layer draws nothing, so it returns nothing.

import { outlineLayerId } from "@atlasdraw/basemap";

import type { OverlayEntry } from "../state/document";

/**
 * The part of a MapLibre map the hit test reads. `P` is the map's point type
 * (maplibregl.Point for a real map).
 */
export interface QueryTarget<P = { x: number; y: number }> {
  getLayer(id: string): unknown;
  queryRenderedFeatures(
    point: P,
    options: { layers: string[] },
  ): Array<{ properties?: Record<string, unknown> | null }>;
}

/** A feature that a click opened. */
export interface FeatureHit {
  overlayId: string;
  /** The data layer's name, for the popup's heading. */
  label: string;
  properties: Record<string, unknown>;
}

/** The feature of the topmost data layer under `point`, or null. */
export function featureAt<P>(
  map: QueryTarget<P>,
  overlays: readonly OverlayEntry[],
  point: P,
): FeatureHit | null {
  const dataLayers = overlays
    .filter((e) => e.kind === "data" && e.visible)
    .slice()
    .sort((a, b) => b.order - a.order);
  for (const entry of dataLayers) {
    // A polygon layer is a fill and an outline; either one is a hit.
    const layers = [entry.id, outlineLayerId(entry.id)].filter((id) =>
      map.getLayer(id),
    );
    if (layers.length === 0) {
      continue;
    }
    const [hit] = map.queryRenderedFeatures(point, { layers });
    if (hit) {
      return {
        overlayId: entry.id,
        label: entry.label,
        properties: hit.properties ?? {},
      };
    }
  }
  return null;
}

/** One property as text: a key and its value. */
export interface AttributeRow {
  key: string;
  value: string;
}

/**
 * A property value as the user reads it: text as it is, a number or boolean
 * as JavaScript prints it, an object or array as JSON, nothing as "". The
 * popup and the attribute table both use it.
 */
export function attributeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * The properties as text rows, in the feature's order. The popup renders
 * them as text nodes, so a key or value that looks like HTML stays text.
 */
export function attributeRows(
  properties: Record<string, unknown> | null | undefined,
): AttributeRow[] {
  return Object.entries(properties ?? {}).map(([key, value]) => ({
    key,
    value: attributeText(value),
  }));
}
