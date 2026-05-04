// packages/geo/src/types.ts
// SPDX-License-Identifier: MIT
// Canonical Atlasdraw geo type schemas. Phase 1 Wave 0 Task 1.
// See docs/architecture/subsystems/geo/contracts.md for consumer contract.

/**
 * GeoAnchor — discriminated union of how an Excalidraw element is anchored to geography.
 * - point: a single (lng, lat) — used by markers, labels, text
 * - bbox: a geographic bounding box — used by rectangles, ellipses, images
 * - polyline: a sequence of (lng, lat) coords — used by lines, polygons, freehand
 *
 * `zRef` is the MapLibre zoom level at which the element was first created.
 * Anchors the "natural size" so screen-mode and hybrid-mode scaling can compute
 * the right factor at other zooms. See docs/architecture/cross-cutting/patterns.md P-04.
 */
export type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };

/**
 * scaleMode — how the element scales as the map zooms.
 * See spec §3.4 for per-tool defaults.
 */
export type ScaleMode = "geographic" | "screen" | "hybrid";

/**
 * GeoCustomData — the wrapper that lives on Excalidraw element's `customData.geo` field.
 * NOTE: field name on the element is `customData.geo`, NOT `customData.geoAnchor`.
 *
 * `projection: "mercator"` is reserved per Q12. Only valid value in v1; CoordinateSync
 * asserts this and throws otherwise. Future: globe view (v2+) will introduce other values.
 */
export type GeoCustomData = {
  geo: GeoAnchor;
  scaleMode: ScaleMode;
  projection: "mercator";
  schemaVersion: 1;
};

/** Type guard: is this element's customData a GeoCustomData? */
export function isGeoCustomData(value: unknown): value is GeoCustomData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === "number" &&
    v.schemaVersion === 1 &&
    v.projection === "mercator" &&
    typeof v.geo === "object" &&
    v.geo !== null &&
    typeof v.scaleMode === "string"
  );
}
