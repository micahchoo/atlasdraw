// SPDX-License-Identifier: MIT
// packages/data/src/shpjs.d.ts
// Phase 3 Wave 1 T7 — ambient module declaration for shpjs ^6.2.
//
// shpjs ships its own ESM but no TypeScript declarations, and there is no
// @types/shpjs on npm. This shim covers only the surface we actually call:
// the default export when invoked with an ArrayBuffer-ish payload. Signature
// is derived from `node_modules/shpjs/lib/index.js` (the `getShapefile`
// function — exported as default at line 205).

declare module "shpjs" {
  import type { FeatureCollection } from "geojson";

  /**
   * Parse a shapefile zip (or shp/dbf/etc bytes) into one or more
   * FeatureCollections. Returns a single FC when the input contains exactly
   * one .shp file; an array of FCs (one per .shp) otherwise.
   */
  export default function shp(
    buffer: ArrayBuffer | ArrayBufferView,
  ): Promise<FeatureCollection | FeatureCollection[]>;
}
