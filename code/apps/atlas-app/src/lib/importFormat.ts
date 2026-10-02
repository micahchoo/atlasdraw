// SPDX-License-Identifier: AGPL-3.0-only
//
// Which import format a file is, and whether it is too large to read. Kept
// apart from importPipeline.ts on purpose: the editor asks these questions
// on every drop, and importPipeline.ts imports every parser (proj4, jszip,
// shpjs, geotiff, papaparse, togeojson, xmldom). Importing a function from
// there would put all of them in the editor's boot chunk; the parsers load
// only in the import worker.

import { LIMITS } from "@atlasdraw/protocol";

export type ImportFormat =
  | "geojson"
  | "csv"
  | "zip"
  | "geotiff"
  | "kml"
  | "kmz"
  | "gpx";

/**
 * The largest file an import reads (protocol LIMITS). A data file becomes
 * the layer, so its cap is what a server save takes. A GeoTIFF is resampled,
 * so it may be larger. A file over its cap is refused before it is read.
 */
function importLimit(file: { name: string; type?: string }): number {
  return detectFormat(file) === "geotiff" ? LIMITS.importRaster : LIMITS.import;
}

/** The formats the pipeline reads, for messages. */
export const SUPPORTED_FORMATS =
  ".geojson, .json, .csv, zipped shapefiles, .kml, .kmz, .gpx and GeoTIFF";

/**
 * MIME types that identify a format when the file name has no known
 * extension, for example a download saved without one.
 */
const MIME_TYPES: Readonly<Record<string, ImportFormat>> = {
  "application/geo+json": "geojson",
  "application/vnd.google-earth.kml+xml": "kml",
  "application/vnd.google-earth.kmz": "kmz",
  "application/gpx+xml": "gpx",
};

/**
 * The format of a file, from its extension first and its MIME type second,
 * or null when it is not a data file.
 */
export function detectFormat(file: {
  name: string;
  type?: string;
}): ImportFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    return "geojson";
  }
  if (name.endsWith(".csv")) {
    return "csv";
  }
  if (name.endsWith(".zip")) {
    return "zip";
  }
  // A .tif can be a plain image. The decoder decides whether it can be
  // placed, and says so by name.
  if (
    name.endsWith(".tif") ||
    name.endsWith(".tiff") ||
    name.endsWith(".geotiff")
  ) {
    return "geotiff";
  }
  for (const ext of ["kml", "kmz", "gpx"] as const) {
    if (name.endsWith(`.${ext}`)) {
      return ext;
    }
  }
  return MIME_TYPES[(file.type ?? "").toLowerCase()] ?? null;
}

/** The refusal for a file over its import cap, or null. */
export function sizeRefusal(file: {
  name: string;
  type?: string;
  size?: number;
}): string | null {
  const limit = importLimit(file);
  if (!(typeof file.size === "number" && file.size > limit)) {
    return null;
  }
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  return `${file.name} is ${mb(
    file.size,
  )} MB. Atlasdraw imports files like this up to ${mb(
    limit,
  )} MB; split or simplify the file and try again.`;
}
