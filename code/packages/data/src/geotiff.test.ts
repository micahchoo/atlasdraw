// SPDX-License-Identifier: MIT
// FU-1 RA-2 — GeoTIFF decode.
//
// Fixtures are WRITTEN here rather than committed as binaries, using geotiff's
// own writer. Three reasons, in order of how much they matter:
//
//   1. A committed .tif is opaque. When one of these fails, the next person has
//      to open a binary in a hex editor to find out what the input claimed.
//      Here the CRS and the bbox under test are literals two lines up.
//   2. Every case needs a different CRS or extent, and a fixture per case is a
//      directory of near-identical binaries nobody dares delete.
//   3. It keeps the reader and the writer honest about each other.
//
// The cost is real and worth naming: these files are geotiff's idea of a
// GeoTIFF, not a scanner's or GDAL's. That is why RA-4 also gets a Playwright
// probe against a real drop — a round-trip through one library's writer cannot
// prove we read what the world actually produces.

import { describe, expect, it } from "vitest";
import { writeArrayBuffer } from "geotiff";

import {
  decodeGeoTiff,
  fitWithin,
  RasterDecodeError,
  UnsupportedRasterCrsError,
  RASTER_MAX_DIM,
} from "./geotiff.js";

interface TiffOpts {
  width?: number;
  height?: number;
  /** [west, south, east, north] in the file's own CRS units. */
  bbox?: [number, number, number, number];
  geographicCrs?: number;
  projectedCrs?: number;
  /** Drop georeferencing entirely — a plain TIFF wearing a .tif name. */
  bare?: boolean;
}

/** A solid-grey RGB GeoTIFF with the geography the case is about. */
function makeTiff({
  width = 4,
  height = 4,
  bbox = [10, 20, 11, 21],
  geographicCrs,
  projectedCrs,
  bare = false,
}: TiffOpts = {}): ArrayBuffer {
  const [west, south, east, north] = bbox;
  const values = new Uint8Array(width * height * 3).fill(128);

  const metadata: Record<string, unknown> = {
    width,
    height,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2, // RGB
  };
  if (!bare) {
    // Tiepoint pins raster (0,0) to the NW corner; pixel scale carries the
    // rest, which together is how a north-up GeoTIFF states its extent.
    metadata.ModelTiepoint = [0, 0, 0, west, north, 0];
    metadata.ModelPixelScale = [
      (east - west) / width,
      (north - south) / height,
      0,
    ];
    if (projectedCrs !== undefined) {
      metadata.ProjectedCSTypeGeoKey = projectedCrs;
    } else {
      metadata.GeographicTypeGeoKey = geographicCrs ?? 4326;
    }
  }
  return writeArrayBuffer(values, metadata as never);
}

describe("fitWithin", () => {
  it("leaves an image already inside the cap alone", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales the long edge to the cap and keeps the aspect ratio", () => {
    expect(fitWithin(4096, 2048)).toEqual({
      width: RASTER_MAX_DIM,
      height: RASTER_MAX_DIM / 2,
    });
  });

  it("never rounds an edge to zero", () => {
    // A 4000x3 strip scales its short edge to 1.5px. Rounding that to 0 is a
    // decode that "succeeds" into an image with no pixels in it.
    const out = fitWithin(4000, 3);
    expect(out.width).toBe(RASTER_MAX_DIM);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe("decodeGeoTiff — placement", () => {
  it("reads a WGS84 file's corners as TL, TR, BR, BL", async () => {
    const out = await decodeGeoTiff(makeTiff({ bbox: [10, 20, 11, 21] }));

    expect(out.crs).toBe("EPSG:4326");
    // The order is MapLibre's `image` source contract, not ours to choose, and
    // getting it wrong mirrors the image rather than failing.
    expect(out.corners[0][0]).toBeCloseTo(10, 6); // TL lng = west
    expect(out.corners[0][1]).toBeCloseTo(21, 6); // TL lat = north
    expect(out.corners[1][0]).toBeCloseTo(11, 6); // TR lng = east
    expect(out.corners[2][1]).toBeCloseTo(20, 6); // BR lat = south
    expect(out.corners[3][0]).toBeCloseTo(10, 6); // BL lng = west
  });

  it("converts a Web Mercator file's metres to degrees", async () => {
    // 0,0 in EPSG:3857 is 0°,0°; 20037508.34 m is 180° — the world's edge.
    const out = await decodeGeoTiff(
      makeTiff({ projectedCrs: 3857, bbox: [0, 0, 20037508.34, 20037508.34] }),
    );

    expect(out.crs).toBe("EPSG:3857");
    expect(out.corners[3][0]).toBeCloseTo(0, 6); // BL lng
    expect(out.corners[3][1]).toBeCloseTo(0, 6); // BL lat
    expect(out.corners[1][0]).toBeCloseTo(180, 4); // TR lng
    expect(out.corners[1][1]).toBeCloseTo(85.0511, 3); // TR lat — Mercator's top
  });

  // 3785 is Web Mercator's deprecated original code. NOT 900913/102100, the
  // vendor aliases: a geo key is a TIFF SHORT, so those wrap. Writing 102100
  // and reading it back gives 36564. Checked, not assumed — which is why they
  // are not in the source's alias set either.
  it("treats EPSG:3785 as Web Mercator rather than rejecting it", async () => {
    const out = await decodeGeoTiff(
      makeTiff({ projectedCrs: 3785, bbox: [0, 0, 1000, 1000] }),
    );
    expect(out.corners[3][0]).toBeCloseTo(0, 6);
    expect(out.corners[1][0]).toBeGreaterThan(0);
  });
});

describe("decodeGeoTiff — pixels", () => {
  it("returns interleaved RGBA at the source size when it is under the cap", async () => {
    const out = await decodeGeoTiff(makeTiff({ width: 4, height: 4 }));

    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.rgba).toHaveLength(4 * 4 * 4);
    expect(out.rgba[0]).toBe(128);
    // Alpha is synthesised for a 3-sample file. Without it the image draws
    // fully transparent and reads as "nothing imported".
    expect(out.rgba[3]).toBe(255);
  });

  it("downsamples past the cap instead of holding the full grid", async () => {
    const big = RASTER_MAX_DIM + 500;
    const out = await decodeGeoTiff(makeTiff({ width: big, height: 10 }));

    expect(out.width).toBe(RASTER_MAX_DIM);
    expect(out.rgba).toHaveLength(out.width * out.height * 4);
  });
});

describe("decodeGeoTiff — refusing clearly", () => {
  it("names the CRS it cannot place, and does not guess", async () => {
    // EPSG:32643 — UTM zone 43N, the kind of file an Indian survey actually
    // arrives in. Its extent is in metres from a false easting; placing those
    // numbers as degrees puts the sheet in the Gulf of Guinea, which reads as
    // a broken app rather than a missing feature.
    const err = await decodeGeoTiff(
      makeTiff({
        projectedCrs: 32643,
        bbox: [500000, 1900000, 501000, 1901000],
      }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsupportedRasterCrsError);
    expect((err as UnsupportedRasterCrsError).crs).toBe("EPSG:32643");
    expect((err as Error).message).toContain("EPSG:32643");
  });

  it("separates 'cannot place' from 'cannot read'", async () => {
    // The two need different sentences: one says reproject, the other says the
    // file is not readable. Telling someone with a good UTM scan that their
    // file is corrupt sends them to fix the wrong thing.
    const unplaceable = await decodeGeoTiff(
      makeTiff({ projectedCrs: 32643 }),
    ).catch((e: unknown) => e);
    const unreadable = await decodeGeoTiff(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
    ).catch((e: unknown) => e);

    expect(unplaceable).toBeInstanceOf(UnsupportedRasterCrsError);
    expect(unreadable).toBeInstanceOf(RasterDecodeError);
    expect(unreadable).not.toBeInstanceOf(UnsupportedRasterCrsError);
  });

  // The nastiest case, and not the one expected. A TIFF with no tiepoint does
  // not arrive as an error: geotiff defaults it to WGS84 covering [-180,-90,
  // 180,90]. So "no georeferencing" looks exactly like valid global coverage,
  // and accepting it stretches a scanned ward sheet from pole to pole — it
  // renders, so nothing looks broken until someone notices their survey is the
  // size of the Pacific.
  it("refuses a TIFF that states no position, which reads as whole-world", async () => {
    const err = await decodeGeoTiff(makeTiff({ bare: true })).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RasterDecodeError);
    expect((err as Error).message).toMatch(/whole world/i);
  });

  it("still accepts a normal extent, so the world-extent guard is not a blanket refusal", async () => {
    const out = await decodeGeoTiff(makeTiff({ bbox: [10, 20, 11, 21] }));
    expect(out.width).toBeGreaterThan(0);
  });

  it("rejects bytes that are not a TIFF", async () => {
    const err = await decodeGeoTiff(
      new TextEncoder().encode("this is not a tiff").buffer as ArrayBuffer,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RasterDecodeError);
  });
});
