// SPDX-License-Identifier: MIT
// packages/data/src/shapefile.test.ts
// Phase 3 Wave 1 T7 — colocated tests for the Shapefile zip → GeoJSON adapter.
//
// Coverage is currently error-path only (Option B from the worker brief):
//   - non-zip blob          → ShapefileParseError code === "BAD_ZIP"
//   - empty blob            → ShapefileParseError (any code)
//   - empty zip (no layers) → ShapefileParseError code === "NO_SHP_FILE"
//
// [SNAG] No happy-path test ships with this file. Generating a valid
// shapefile binary in code requires hand-rolling the mixed-endian .shp/.shx
// headers + a .dbf attribute table — fragile and expensive relative to the
// task budget. Recommended follow-up: add a checked-in fixture (e.g.
// `code/packages/data/__fixtures__/point.zip`, ~1 KB, produced once via
// `ogr2ogr -f "ESRI Shapefile"`) and a test asserting
// `parseShapefile(<fixture>)` returns `{ features.length === 1, geometry.type === "Point" }`.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parseShapefile, ShapefileParseError } from "./shapefile.js";

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
