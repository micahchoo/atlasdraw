// @vitest-environment node
//
// Import runs in a Web Worker, which has no DOMParser. The parsers must work
// there too: this file runs with no DOMParser on globalThis.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GeoXmlParseError, parseGPX, parseKML } from "./geoxml.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__",
);
const blobOf = (name: string) =>
  new Blob([new Uint8Array(fs.readFileSync(path.join(fixtures, name)))]);

describe("KML and GPX without a global DOMParser (as in a worker)", () => {
  it("has no global DOMParser here", () => {
    expect("DOMParser" in globalThis).toBe(false);
  });

  it("reads a KML file", async () => {
    const { fc } = await parseKML(blobOf("parks.kml"));
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it("reads a GPX file", async () => {
    const { fc } = await parseGPX(blobOf("hike.gpx"));
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it("refuses broken XML with the same error a browser gives", async () => {
    const broken = new Blob(["<kml><Document><Placemark></kml>"]);
    await expect(parseKML(broken)).rejects.toMatchObject({
      name: GeoXmlParseError.name,
      code: "MALFORMED_XML",
    });
  });
});
