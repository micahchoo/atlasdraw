// SPDX-License-Identifier: MIT
//
// Geographic anchors.
//
// A `GeoAnchor` is a shape given in lng/lat plus `zRef`, the map zoom it was
// given at. Two things use it:
//
//   - a tool's element seed (packages/tools): the tool says where the shape
//     is; `zRef` sets the scene size of its screen-pixel parts.
//   - a version 1 document, which stored one on each element as
//     `customData.geo` (`GeoCustomData`). The v1 → v2 migration reads it and
//     writes world coordinates (migrateV1.ts). Nothing else reads it.

export type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | {
      kind: "bbox";
      west: number;
      south: number;
      east: number;
      north: number;
      zRef: number;
    }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };

/** `customData` of an anchored element in a version 1 document. */
export type GeoCustomData = {
  geo: GeoAnchor;
  /** v1 wrote "geographic", "screen" or "hybrid". All migrate as geographic. */
  scaleMode: string;
  projection: "mercator";
  schemaVersion: 1;
};

/** True when `value` is a version 1 element's `customData` with an anchor. */
export function isGeoCustomData(value: unknown): value is GeoCustomData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
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
