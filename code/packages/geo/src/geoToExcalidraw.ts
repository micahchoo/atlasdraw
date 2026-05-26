// packages/geo/src/geoToExcalidraw.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 2 Task 10 — GeoJSON Feature → Excalidraw element skeleton.
//
// Produces a structural skeleton (no @excalidraw dependency). Geometry kind
// drives default scaleMode + element type per spec §3.4:
//   Point      → kind:"point",    scaleMode:"screen",     type:"rectangle"
//   Polygon    → kind:"bbox",     scaleMode:"geographic", type:"rectangle"
//   LineString → kind:"polyline", scaleMode:"hybrid",     type:"line"
//
// Scene-coords (x/y/width/height/points) are intentionally zeroed; they're
// computed by CoordinateSync.syncMapToScene once the element is registered.

import type { GeoCustomData } from "./types.js";

/**
 * Minimal GeoJSON Feature shape we accept. Defined inline to avoid a
 * @types/geojson devDep — only the fields we read are typed.
 */
export type GeoJSONFeatureLike = {
  type: "Feature";
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "Polygon"; coordinates: Array<Array<[number, number]>> }
    | { type: "LineString"; coordinates: Array<[number, number]> }
    // Other geometry types are rejected at runtime; widen here so callers can
    // pass through GeoJSON from libraries without casting.
    | { type: string; coordinates: unknown };
  properties?: Record<string, unknown> | null;
};

/**
 * Structural Excalidraw element skeleton. Local to this module — consumers
 * that need a richer element shape should map this onto their own type.
 */
export type ExcalidrawElementSkeleton = {
  type: "rectangle" | "ellipse" | "line";
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  customData: GeoCustomData;
};

export type GeoToExcalidrawOptions = {
  /** MapLibre zoom at which the element is being created. Defaults to 12. */
  zRef?: number;
};

const DEFAULT_Z_REF = 12;

export function geoToExcalidraw(
  feature: GeoJSONFeatureLike,
  opts: GeoToExcalidrawOptions = {},
): ExcalidrawElementSkeleton {
  const zRef = opts.zRef ?? DEFAULT_Z_REF;
  const { geometry } = feature;

  switch (geometry.type) {
    case "Point": {
      const [lng, lat] = geometry.coordinates as [number, number];
      const customData: GeoCustomData = {
        geo: { kind: "point", lng, lat, zRef },
        scaleMode: "screen",
        projection: "mercator",
        schemaVersion: 1,
      };
      return {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        customData,
      };
    }
    case "Polygon": {
      const rings = geometry.coordinates as Array<Array<[number, number]>>;
      const outer = rings[0];
      if (!outer || outer.length === 0) {
        throw new Error("geoToExcalidraw: polygon has empty outer ring");
      }
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      for (const [lng, lat] of outer) {
        if (lng < west) {
          west = lng;
        }
        if (lng > east) {
          east = lng;
        }
        if (lat < south) {
          south = lat;
        }
        if (lat > north) {
          north = lat;
        }
      }
      const customData: GeoCustomData = {
        geo: { kind: "bbox", west, south, east, north, zRef },
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      };
      return {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        customData,
      };
    }
    case "LineString": {
      const coords = geometry.coordinates as Array<[number, number]>;
      const customData: GeoCustomData = {
        geo: {
          kind: "polyline",
          // Defensive copy — caller's array won't be aliased into customData.
          coordinates: coords.map(
            ([lng, lat]) => [lng, lat] as [number, number],
          ),
          zRef,
        },
        scaleMode: "hybrid",
        projection: "mercator",
        schemaVersion: 1,
      };
      return {
        type: "line",
        x: 0,
        y: 0,
        points: [],
        customData,
      };
    }
    default:
      throw new Error(
        `geoToExcalidraw: unsupported geometry type: ${geometry.type}`,
      );
  }
}
