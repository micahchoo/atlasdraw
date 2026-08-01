// SPDX-License-Identifier: MIT
// FU-1 RA-2 — GeoTIFF decode.
//
// Bytes in, pixels plus four lng/lat corners out. Nothing here knows about
// MapLibre, the registry, or the panel: this module's whole job is turning a
// file someone dropped into the two things a raster layer needs, or refusing
// clearly.
//
// SCOPE, and it is narrow on purpose. This reads north-up GeoTIFFs in WGS84 or
// Web Mercator and rejects everything else by name. It does not warp pixels.
// Reprojecting a raster properly means resampling every pixel through an
// inverse transform, which needs proj4 and a real decision about quality; a
// half version that stretches a UTM extent to fit a lng/lat box would put the
// image in roughly the right place and quietly wrong everywhere inside it,
// which is worse than saying no.

import { fromArrayBuffer } from "geotiff";

/**
 * Longest edge of the decoded image, in pixels.
 *
 * A raster is persisted into the document, and documents autosave. A 12000px
 * survey scan costs ~500 MB of RGBA before it is even a PNG, which is not a
 * thing to put through an autosave every few seconds. 2048 is where a scanned
 * sheet still reads at full-screen zoom and a document still saves in under a
 * second.
 *
 * This is the decision in this file most likely to be wrong — it trades
 * zoom-in fidelity for a document that saves. Revisit when someone actually
 * zooms in and complains, which is a better signal than a guess made here.
 */
export const RASTER_MAX_DIM = 2048;

/** EPSG codes this can place without warping any pixels. */
const EPSG_WGS84 = 4326;
const EPSG_WEB_MERCATOR = 3857;
/**
 * Web Mercator under both codes that can actually appear here. 3785 is the
 * deprecated original; 3857 replaced it.
 *
 * Not 900913 or 102100, the vendor aliases you would otherwise expect in this
 * list: a GeoTIFF geo key is a TIFF SHORT, so anything above 65535 wraps.
 * Verified rather than assumed — writing 102100 and reading it back yields
 * 36564, which is 102100 - 65536. Codes that cannot survive the format are not
 * defensive coverage, they are a line that looks like coverage.
 */
const WEB_MERCATOR_ALIASES = new Set([EPSG_WEB_MERCATOR, 3785]);

/**
 * The extent geotiff reports for a TIFF that states no position at all.
 *
 * A file with no tiepoint gets defaulted to WGS84 covering the entire world —
 * so "no georeferencing" arrives looking like valid global coverage rather than
 * as an error. Accepting it would stretch a scanned ward sheet from pole to
 * pole, which is the worst failure available here: it renders, so nothing looks
 * broken until someone notices their survey is the size of the Pacific.
 */
const WORLD_EXTENT: [number, number, number, number] = [-180, -90, 180, 90];

/** lng/lat, in the order MapLibre's `image` source wants: TL, TR, BR, BL. */
export type RasterCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export interface DecodedRaster {
  /**
   * Interleaved RGBA, `width * height * 4` long.
   *
   * Pinned to a plain `ArrayBuffer` rather than the default `ArrayBufferLike`:
   * `ImageData` will not accept a view that might be over a SharedArrayBuffer,
   * and the alternative — copying into a fresh array at encode time — is up to
   * 16 MB of pointless allocation for a capped raster.
   */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  corners: RasterCorners;
  /** What the file said it was, for the provenance line. */
  crs: string;
}

/**
 * The file is a readable GeoTIFF in a CRS this cannot place without warping.
 *
 * Separate from `RasterDecodeError` because the two want different sentences.
 * This one is "your file is fine, reproject it to EPSG:4326"; the other is
 * "this file is not something I can read". Telling someone with a perfectly
 * good UTM scan that their file is corrupt sends them to fix the wrong thing.
 */
export class UnsupportedRasterCrsError extends Error {
  readonly crs: string;
  constructor(crs: string) {
    super(
      `raster is in ${crs}, which needs reprojecting to EPSG:4326 before import`,
    );
    this.name = "UnsupportedRasterCrsError";
    this.crs = crs;
  }
}

/** The bytes are not a GeoTIFF, or carry no georeferencing at all. */
export class RasterDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterDecodeError";
  }
}

/**
 * Web Mercator metres → lng/lat.
 *
 * `packages/geo` says Mercator math lives in MapLibre and must not be
 * replicated — that rule is about the projection seam that CoordinateSync uses,
 * where a second implementation would drift from the map's own. This is a
 * one-shot conversion of four corner coordinates at import time, with no map
 * instance in scope and no live camera to stay in step with. It is the
 * published EPSG:3857 inverse, and it is six lines.
 */
function webMercatorToLngLat(x: number, y: number): [number, number] {
  const R = 6378137;
  const lng = (x / R) * (180 / Math.PI);
  const lat = (Math.atan(Math.exp(y / R)) * 2 - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

/**
 * Read the CRS out of the GeoTIFF's geo keys.
 *
 * A file with no geo keys at all is a plain TIFF wearing a `.tif` extension —
 * common enough that it gets its own sentence rather than falling through to a
 * generic parse failure.
 */
function readCrs(geoKeys: Partial<Record<string, unknown>> | null): {
  epsg: number;
  label: string;
} {
  if (!geoKeys) {
    throw new RasterDecodeError(
      "this TIFF carries no georeferencing, so there is nowhere on the map to put it",
    );
  }
  const projected = geoKeys.ProjectedCSTypeGeoKey;
  if (typeof projected === "number") {
    return { epsg: projected, label: `EPSG:${projected}` };
  }
  const geographic = geoKeys.GeographicTypeGeoKey;
  if (typeof geographic === "number") {
    return { epsg: geographic, label: `EPSG:${geographic}` };
  }
  throw new RasterDecodeError(
    "this TIFF carries no georeferencing, so there is nowhere on the map to put it",
  );
}

/** Output size that fits inside RASTER_MAX_DIM without changing aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number = RASTER_MAX_DIM,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) {
    return { width, height };
  }
  const scale = max / longest;
  // `max(1, …)` because a 4000x3 strip would otherwise round its short edge to
  // zero, and a zero-height image is a decode that "succeeded" into nothing.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode a GeoTIFF into RGBA pixels and four lng/lat corners.
 *
 * Throws `UnsupportedRasterCrsError` for a readable file this cannot place, and
 * `RasterDecodeError` for one it cannot read.
 */
export async function decodeGeoTiff(
  bytes: ArrayBuffer,
): Promise<DecodedRaster> {
  let image;
  try {
    const tiff = await fromArrayBuffer(bytes);
    image = await tiff.getImage();
  } catch (err) {
    throw new RasterDecodeError(
      `could not read this file as a GeoTIFF: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const { epsg, label } = readCrs(image.getGeoKeys());
  const isWgs84 = epsg === EPSG_WGS84;
  const isWebMercator = WEB_MERCATOR_ALIASES.has(epsg);
  if (!isWgs84 && !isWebMercator) {
    throw new UnsupportedRasterCrsError(label);
  }

  const bbox = image.getBoundingBox();
  if (bbox.length < 4 || bbox.some((n) => !Number.isFinite(n))) {
    throw new RasterDecodeError(
      "this GeoTIFF's bounding box is missing or not finite, so its corners cannot be placed",
    );
  }
  const [minX, minY, maxX, maxY] = bbox as [number, number, number, number];
  if (isWgs84 && WORLD_EXTENT.every((v, i) => Math.abs(bbox[i] - v) < 1e-9)) {
    // See WORLD_EXTENT. This also refuses a genuine whole-world raster, which
    // is a real if unlikely thing to import. That is the deliberate trade: a
    // rejected world map is one confused message, an accepted un-georeferenced
    // scan is a survey sheet silently stretched across the planet.
    throw new RasterDecodeError(
      "this TIFF states no position, so it reads as covering the whole world — " +
        "georeference it before import",
    );
  }
  const [west, south] = isWebMercator
    ? webMercatorToLngLat(minX, minY)
    : [minX, minY];
  const [east, north] = isWebMercator
    ? webMercatorToLngLat(maxX, maxY)
    : [maxX, maxY];

  const srcWidth = image.getWidth();
  const srcHeight = image.getHeight();
  const { width, height } = fitWithin(srcWidth, srcHeight);

  let raster;
  try {
    // readRGB rather than readRasters: it applies the file's photometric
    // interpretation, so palette-indexed and YCbCr scans — which is most of
    // what a scanner produces — come back as visible colour instead of raw
    // sample values. Passing width/height makes geotiff do the downsample.
    raster = await image.readRGB({ interleave: true, width, height });
  } catch (err) {
    throw new RasterDecodeError(
      `could not decode this GeoTIFF's pixels: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const samples = raster as unknown as ArrayLike<number>;
  const perPixel = samples.length / (width * height);
  if (perPixel !== 3 && perPixel !== 4) {
    throw new RasterDecodeError(
      `expected 3 or 4 samples per pixel after RGB conversion, got ${perPixel}`,
    );
  }

  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  if (perPixel === 4) {
    // Bulk copy — Uint8ClampedArray.set applies the same ToUint8Clamp
    // conversion as per-element assignment.
    rgba.set(samples);
  } else {
    for (let i = 0, d = 0, s = 0; i < pixelCount; i++, d += 4, s += 3) {
      rgba[d] = samples[s];
      rgba[d + 1] = samples[s + 1];
      rgba[d + 2] = samples[s + 2];
      rgba[d + 3] = 255;
    }
  }

  return {
    rgba,
    width,
    height,
    // TL, TR, BR, BL.
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
    crs: label,
  };
}

/**
 * Encode decoded raster pixels as a PNG Blob.
 *
 * PNG rather than JPEG on purpose: a scanned survey sheet is line work and
 * text, which is exactly what JPEG's chroma subsampling smears. It is also the
 * format that keeps the alpha channel, and a GeoTIFF with a nodata mask has
 * transparent edges that must not become black ones.
 *
 * Browser-only, returning `null` off it — same contract as `generateThumbnail`
 * in this package, so a caller can wire it in without branching on runtime.
 * Nothing in Node needs to render a raster.
 */
export async function encodeRasterPng(
  raster: Pick<DecodedRaster, "rgba" | "width" | "height">,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.putImageData(
    new ImageData(raster.rgba, raster.width, raster.height),
    0,
    0,
  );
  return await canvas.convertToBlob({ type: "image/png" });
}
