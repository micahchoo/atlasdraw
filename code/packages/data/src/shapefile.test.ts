// SPDX-License-Identifier: MIT
// packages/data/src/shapefile.test.ts
// Phase 3 Wave 1 T7 — colocated tests for the Shapefile zip → GeoJSON adapter.
//
// Error-path coverage (Option B from the worker brief):
//   - non-zip blob          → ShapefileParseError code === "BAD_ZIP"
//   - empty blob            → ShapefileParseError (any code)
//   - empty zip (no layers) → ShapefileParseError code === "NO_SHP_FILE"
//
// Happy-path coverage (ISSUES.md Direction 1 — closed the [SNAG] this file
// used to carry: "no happy-path test ships with this file"): a real 2-point
// shapefile bundle at __fixtures__/point.zip, produced once via Python's
// `pyshp` (no GDAL/ogr2ogr required — this environment doesn't have it).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parseShapefile, ShapefileParseError } from "./shapefile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("shapefile.parseShapefile — error paths", () => {
  it("rejects a non-zip blob with ShapefileParseError code=BAD_ZIP", async () => {
    const blob = new Blob(["not a zip file at all"]);
    try {
      await parseShapefile(blob);
      throw new Error("expected parseShapefile to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(ShapefileParseError);
      expect((err as ShapefileParseError).code).toBe("BAD_ZIP");
    }
  });

  it("rejects an empty blob with ShapefileParseError", async () => {
    const blob = new Blob([]);
    try {
      await parseShapefile(blob);
      throw new Error("expected parseShapefile to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(ShapefileParseError);
      // Code may be BAD_ZIP or PARSE_FAILED depending on but-unzip's reaction
      // to a 0-byte buffer; both are acceptable user-visible classifications.
      const code = (err as ShapefileParseError).code;
      expect(["BAD_ZIP", "PARSE_FAILED"]).toContain(code);
    }
  });

  it("rejects a valid zip with no .shp entries, code=NO_SHP_FILE", async () => {
    // Build a zip that contains only a stray .txt — shpjs's parseZip filters
    // for .shp/.dbf/.json/.prj/.cpg and throws "no layers founds" (sic).
    const zip = new JSZip();
    zip.file("readme.txt", "hello");
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const blob = new Blob([buf], { type: "application/zip" });

    try {
      await parseShapefile(blob);
      throw new Error("expected parseShapefile to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(ShapefileParseError);
      expect((err as ShapefileParseError).code).toBe("NO_SHP_FILE");
    }
  });
});

describe("shapefile.parseShapefile — happy path", () => {
  it("parses a real point shapefile zip into a FeatureCollection", async () => {
    const zipPath = path.join(__dirname, "..", "__fixtures__", "point.zip");
    const buf = Uint8Array.from(fs.readFileSync(zipPath));
    const blob = new Blob([buf], { type: "application/zip" });

    const fc = await parseShapefile(blob);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.type).toBe("Point");
    expect(fc.features[0].geometry).toMatchObject({
      type: "Point",
      coordinates: [expect.closeTo(-122.4194, 3), expect.closeTo(37.7749, 3)],
    });
    expect(fc.features.map((f) => f.properties?.name).sort()).toEqual([
      "New York",
      "San Francisco",
    ]);
  });
});
