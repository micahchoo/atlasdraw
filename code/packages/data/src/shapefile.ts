// SPDX-License-Identifier: MIT
// packages/data/src/shapefile.ts
// Phase 3 Wave 1 T7 — Shapefile (.zip) → GeoJSON FeatureCollection adapter.
//
// Pure module. No Yjs, no MapLibre, no @excalidraw imports — like the GeoJSON
// adapter, this layer is strictly bytes-in / FeatureCollection-out. Higher
// layers translate the parsed FC into Yjs-backed layers or Excalidraw elements.
//
// shpjs ^6.2 ships no TypeScript types and no @types/shpjs package. We declare
// an ambient module shim below; signature derived from
//   node_modules/shpjs/lib/index.js  →  `export default getShapefile`
// which, when called with an ArrayBuffer / DataView / TypedArray, dispatches
// to `parseZip` and resolves to either a single FeatureCollection (one .shp
// in the zip) or an array of FeatureCollections (multiple .shp siblings).

import shp from "shpjs";

import type { Feature, FeatureCollection } from "geojson";

/** Machine-readable failure modes for `parseShapefile`. */
export type ShapefileParseErrorCode =
  | "BAD_ZIP" //         input bytes are not a readable zip archive
  | "NO_SHP_FILE" //     zip parsed but contained zero .shp entries
  | "PARSE_FAILED"; //   any other shpjs failure (corrupt geometry, dbf, etc.)

/**
 * Error type for Shapefile parse failures. `code` is the machine-readable
 * failure mode; the message carries human-readable detail (often the wrapped
 * shpjs error text).
 */
export class ShapefileParseError extends Error {
  readonly code: ShapefileParseErrorCode;
  constructor(code: ShapefileParseErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ShapefileParseError";
  }
}

/**
 * Parse a Shapefile zip Blob into a single GeoJSON FeatureCollection.
 *
 * Resolves with the FeatureCollection on success. Rejects with a
 * `ShapefileParseError` on any failure.
 *
 * If the zip contains multiple .shp files, the returned FC has all features
 * merged in source order: first FC's metadata wins (`type`), all other FCs'
 * `.features` arrays are appended.
 */
export async function parseShapefile(blob: Blob): Promise<FeatureCollection> {
  const buffer = await blob.arrayBuffer();

  let result: FeatureCollection | FeatureCollection[];
  try {
    result = await shp(buffer);
  } catch (err) {
    throw classifyShpError(err);
  }

  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new ShapefileParseError(
        "NO_SHP_FILE",
        "Shapefile zip contained no .shp layers",
      );
    }
    const head = result[0];
    if (!isFeatureCollection(head)) {
      throw new ShapefileParseError(
        "PARSE_FAILED",
        "shpjs returned a non-FeatureCollection result",
      );
    }
    const merged: Feature[] = [...head.features];
    for (let i = 1; i < result.length; i++) {
      const sib = result[i];
      if (isFeatureCollection(sib)) {
        merged.push(...sib.features);
      }
    }
    return { type: "FeatureCollection", features: merged };
  }

  if (!isFeatureCollection(result)) {
    throw new ShapefileParseError(
      "PARSE_FAILED",
      "shpjs returned a non-FeatureCollection result",
    );
  }
  return result;
}

function isFeatureCollection(v: unknown): v is FeatureCollection {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((v as { features?: unknown }).features)
  );
}

/**
 * Map an unknown thrown value from shpjs to a `ShapefileParseError`.
 *
 * Heuristic — shpjs ^6.2 surfaces failures as plain `Error` with messages from:
 *   - `but-unzip` (non-zip / corrupt zip input) → BAD_ZIP
 *   - `parseZip` literal `'no layers founds'` (sic) when no .shp/.dbf/.json
 *     entries are found in the archive → NO_SHP_FILE
 *   - everything else (dbf parse, shp record header, proj4) → PARSE_FAILED
 *
 * The string-matching is fragile across shpjs upgrades; if shpjs changes its
 * error messages, this classifier will need an update. Documented here so the
 * next maintainer doesn't have to grep.
 */
function classifyShpError(err: unknown): ShapefileParseError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("no layers found")) {
    return new ShapefileParseError(
      "NO_SHP_FILE",
      `Shapefile zip contained no .shp layers: ${msg}`,
    );
  }
  // but-unzip throws errors mentioning "zip", "central directory",
  // "signature", or for empty input "buffer"/"length" issues. Treat all
  // pre-shp-entry failures as BAD_ZIP — it's the user's intuitive read.
  if (
    lower.includes("zip") ||
    lower.includes("central") ||
    lower.includes("signature") ||
    lower.includes("buffer") ||
    lower.includes("length") ||
    lower.includes("invalid")
  ) {
    return new ShapefileParseError(
      "BAD_ZIP",
      `Failed to read shapefile zip: ${msg}`,
    );
  }
  return new ShapefileParseError(
    "PARSE_FAILED",
    `Failed to parse shapefile: ${msg}`,
  );
}
