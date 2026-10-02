// SPDX-License-Identifier: AGPL-3.0-only
//
// The import pipeline: a dropped or picked file in, layers or one message
// out. It reads, parses, divides by geometry kind and, for a GeoTIFF,
// decodes and encodes a PNG. It touches no DOM, no map and no document, so
// it runs in a Web Worker (import.worker.ts); importClient.ts runs it there.
//
// A file gives one layer per geometry kind. A file of one kind gives one
// layer, named after the file. A file that mixes kinds (a GPX file with
// waypoints and tracks, a CSV whose WKT column holds points and lines)
// gives layers named "<file> — areas", "<file> — lines" and
// "<file> — points".
//
// Every failure becomes a sentence for the user. The worker boundary cannot
// carry error classes, and the sentence is what the caller needs.

import {
  parse,
  parseCSV,
  parseShapefile,
  parseKML,
  parseKMZ,
  parseGPX,
  prepareForMap,
  CoordinateError,
  GeoJSONParseError,
  CSVParseError,
  ShapefileParseError,
  GeoXmlParseError,
  PhotonGeocoder,
  decodeGeoTiff,
  encodeRasterPng,
  RasterDecodeError,
  UnsupportedRasterCrsError,
} from "@atlasdraw/data";

import { LIMITS } from "@atlasdraw/protocol";

import type { AtlasGeometryKind } from "@atlasdraw/data";

import type { RasterCorners } from "../state/document";
import type { FeatureCollection } from "geojson";

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

export type ImportPhase = "reading" | "parsing" | "geocoding" | "encoding";

export interface ImportProgress {
  phase: ImportPhase;
  /** Geocoding only: addresses done and the total. */
  done?: number;
  total?: number;
}

export interface ImportedLayer {
  fc: FeatureCollection;
  label: string;
  /** Records of the file that did not become features of this layer. */
  droppedCount: number;
}

export type ImportOutcome =
  | {
      ok: true;
      kind: "vector";
      layers: ImportedLayer[];
      /** The CRS the positions were converted from, or null. */
      reprojectedFrom: string | null;
    }
  | {
      ok: true;
      kind: "raster";
      png: Blob;
      corners: RasterCorners;
      crs: string;
    }
  | { ok: false; message: string };

export interface ImportOptions {
  /** The operator's Photon endpoint. Absent: no address is geocoded. */
  geocoderEndpoint?: string;
  onProgress?: (progress: ImportProgress) => void;
}

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

/** The word for each geometry kind in a layer name. */
const KIND_LABEL: Readonly<Record<AtlasGeometryKind, string>> = {
  fill: "areas",
  line: "lines",
  circle: "points",
};

function shapefileErrorMessage(err: ShapefileParseError): string {
  switch (err.code) {
    case "BAD_ZIP":
      return "That doesn't look like a valid zip file";
    case "NO_SHP_FILE":
      return "No .shp file found in that zip";
    case "PARSE_FAILED":
      return `Couldn't parse the shapefile — ${err.message}`;
  }
}

async function importVector(
  file: File,
  format: Exclude<ImportFormat, "geotiff">,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const progress = options.onProgress ?? (() => {});
  progress({ phase: "parsing" });

  // Input records the parser discarded: CSV rows with no usable
  // coordinates, KML/GPX features with no geometry.
  let parsed = 0;
  let fc: FeatureCollection;
  if (format === "kml" || format === "kmz" || format === "gpx") {
    const parser =
      format === "kml" ? parseKML : format === "kmz" ? parseKMZ : parseGPX;
    const result = await parser(file);
    fc = result.fc;
    parsed = result.droppedCount;
  } else if (format === "csv") {
    fc = await parseCSV(file, {
      ...(options.geocoderEndpoint
        ? {
            geocoder: new PhotonGeocoder({
              endpoint: options.geocoderEndpoint,
            }),
          }
        : {}),
      onStats: (stats) => {
        parsed = stats.dropped;
      },
      onGeocodeProgress: (done, total) =>
        progress({ phase: "geocoding", done, total }),
    });
  } else if (format === "zip") {
    fc = await parseShapefile(file);
  } else {
    fc = await parse(file);
  }

  // Positions in lng/lat, drawable features only, one layer per kind.
  const { parts, dropped, reprojectedFrom } = prepareForMap(fc);
  if (parts.length === 0) {
    return {
      ok: false,
      message: `${file.name}: no feature in this file has coordinates the map can draw.`,
    };
  }
  return {
    ok: true,
    kind: "vector",
    reprojectedFrom,
    layers: parts.map(({ kind, fc: part }, i) => ({
      fc: part,
      label:
        parts.length > 1 ? `${file.name} — ${KIND_LABEL[kind]}` : file.name,
      // The counts belong to the file, not to a kind. The first layer
      // records them, so the sum over the layers is true.
      droppedCount: i === 0 ? parsed + dropped : 0,
    })),
  };
}

async function importRaster(
  file: File,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const progress = options.onProgress ?? (() => {});
  progress({ phase: "reading" });
  const bytes = await file.arrayBuffer();
  progress({ phase: "parsing" });
  const decoded = await decodeGeoTiff(bytes);
  progress({ phase: "encoding" });
  const png = await encodeRasterPng(decoded);
  if (!png) {
    return {
      ok: false,
      message: `${file.name}: this browser cannot encode the image for import`,
    };
  }
  return {
    ok: true,
    kind: "raster",
    png,
    corners: decoded.corners,
    crs: decoded.crs,
  };
}

/** The sentence for an import failure. */
function failureMessage(
  file: File,
  err: unknown,
  options: ImportOptions,
): string {
  if (err instanceof UnsupportedRasterCrsError) {
    // "Reproject this" is actionable; "import failed" would send someone to
    // check a file that was never the problem.
    return `${file.name}: this image is in ${err.crs}. Reproject it to EPSG:4326 and try again.`;
  }
  if (err instanceof RasterDecodeError) {
    return `${file.name}: ${err.message}`;
  }
  if (err instanceof CoordinateError) {
    return `${file.name}: ${err.message}`;
  }
  if (err instanceof GeoJSONParseError) {
    return `GeoJSON import failed — ${err.message}`;
  }
  if (err instanceof CSVParseError) {
    // NO_COORD_COLUMNS on an address-only CSV means "no geocoder
    // configured" from the user's point of view.
    const hint =
      err.code === "NO_COORD_COLUMNS" && !options.geocoderEndpoint
        ? " (address-only CSVs need a geocoder — see the VITE_GEOCODER_ENDPOINT setting)"
        : "";
    return `CSV import failed — ${err.message}${hint}`;
  }
  if (err instanceof GeoXmlParseError) {
    return `${err.format} import failed — ${err.message}`;
  }
  if (err instanceof ShapefileParseError) {
    return `Shapefile import failed — ${shapefileErrorMessage(err)}`;
  }
  return `${file.name}: import failed unexpectedly`;
}

/** Import one file. Never throws: a failure is `{ ok: false, message }`. */
export async function runImport(
  file: File,
  format: ImportFormat,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const tooLarge = sizeRefusal(file);
  if (tooLarge) {
    return { ok: false, message: tooLarge };
  }
  try {
    return format === "geotiff"
      ? await importRaster(file, options)
      : await importVector(file, format, options);
  } catch (err) {
    console.error(`[import] ${file.name}:`, err);
    return { ok: false, message: failureMessage(file, err, options) };
  }
}
