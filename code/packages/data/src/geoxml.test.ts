// SPDX-License-Identifier: MIT
// Tests for the KML, KMZ and GPX parsers and for the split by geometry kind.
//
// The parsers read XML with the global DOMParser, which a browser has and
// Node does not. These tests install jsdom's DOMParser, because jsdom reports
// malformed XML the way a browser does: a <parsererror> document.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GeoXmlParseError, parseGPX, parseKML, parseKMZ } from "./geoxml.js";
import { splitByGeometryKind } from "./geojson.js";

import type { FeatureCollection } from "geojson";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "__fixtures__", name), "utf8");

const hadDOMParser = "DOMParser" in globalThis;
beforeAll(() => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM(
    "",
  ).window.DOMParser;
});
afterAll(() => {
  if (!hadDOMParser) {
    delete (globalThis as { DOMParser?: unknown }).DOMParser;
  }
});

async function expectParseError(
  promise: Promise<unknown>,
  code: GeoXmlParseError["code"],
): Promise<GeoXmlParseError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GeoXmlParseError);
    expect((err as GeoXmlParseError).code).toBe(code);
    return err as GeoXmlParseError;
  }
  throw new Error(`expected a GeoXmlParseError with code ${code}`);
}

function byName(fc: FeatureCollection, name: string) {
  const f = fc.features.find((x) => x.properties?.name === name);
  if (!f) {
    throw new Error(`no feature named ${name}`);
  }
  return f;
}

async function zipBlob(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) {
    zip.file(name, text);
  }
  return new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
}

describe("parseGPX", () => {
  it("reads waypoints as points, routes and tracks as lines", async () => {
    const { fc, droppedCount } = await parseGPX(
      new Blob([fixture("hike.gpx")]),
    );

    expect(droppedCount).toBe(0);
    expect(fc.features).toHaveLength(5);
    expect(byName(fc, "East Peak").geometry).toEqual({
      type: "Point",
      coordinates: [-122.5965, 37.9235, 784],
    });
    expect(byName(fc, "Planned descent").geometry?.type).toBe("LineString");
    expect(byName(fc, "Morning climb").geometry?.type).toBe("LineString");
    // Two track segments are one feature with two lines.
    const paused = byName(fc, "Paused walk").geometry;
    expect(paused?.type).toBe("MultiLineString");
    expect(
      paused?.type === "MultiLineString" ? paused.coordinates : [],
    ).toHaveLength(2);
  });

  it("keeps names, descriptions and timestamps as properties", async () => {
    const { fc } = await parseGPX(new Blob([fixture("hike.gpx")]));

    expect(byName(fc, "East Peak").properties).toMatchObject({
      desc: "Fire lookout at the summit",
      time: "2026-09-12T08:00:00Z",
    });
    expect(byName(fc, "Morning climb").properties).toMatchObject({
      desc: "Recorded on the way up",
      time: "2026-09-12T07:00:00Z",
    });
  });

  it("rejects malformed XML", async () => {
    const err = await expectParseError(
      parseGPX(new Blob(["<gpx><wpt lat='1' lon='2'></gpx>"])),
      "MALFORMED_XML",
    );
    expect(err.format).toBe("GPX");
    expect(err.message).toMatch(/not well-formed XML/);
  });

  it("rejects a KML file given as GPX and says to rename it", async () => {
    const err = await expectParseError(
      parseGPX(new Blob([fixture("parks.kml")])),
      "WRONG_FORMAT",
    );
    expect(err.message).toMatch(/\.kml/);
  });

  it("rejects a GPX file that holds no coordinates", async () => {
    await expectParseError(
      parseGPX(
        new Blob([
          '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>x</name></metadata></gpx>',
        ]),
      ),
      "NO_FEATURES",
    );
  });
});

describe("parseKML", () => {
  it("flattens folders and keeps the folder path as a property", async () => {
    const { fc } = await parseKML(new Blob([fixture("parks.kml")]));

    expect(byName(fc, "Visitor centre").properties?.folder).toBeUndefined();
    expect(byName(fc, "Golden Gate Park").properties?.folder).toBe("Parks");
    expect(byName(fc, "Lake loop").properties?.folder).toBe("Parks / Trails");
  });

  it("reads points, polygons and lines with their properties", async () => {
    const { fc } = await parseKML(new Blob([fixture("parks.kml")]));

    expect(byName(fc, "Visitor centre").geometry?.type).toBe("Point");
    expect(byName(fc, "Visitor centre").properties).toMatchObject({
      description: "Open 9 to 5",
      timestamp: "2026-04-01",
    });
    expect(byName(fc, "Golden Gate Park").geometry?.type).toBe("Polygon");
    expect(byName(fc, "Lake loop").geometry?.type).toBe("LineString");
  });

  it("drops a placemark with no geometry and counts it", async () => {
    const { fc, droppedCount } = await parseKML(
      new Blob([fixture("parks.kml")]),
    );

    expect(fc.features).toHaveLength(3);
    expect(
      fc.features.some((f) => f.properties?.name === "Planned bench"),
    ).toBe(false);
    expect(droppedCount).toBe(1);
  });

  it("keeps a folder property that the file already sets", async () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Folder><name>A</name>
      <Placemark><name>p</name>
        <ExtendedData><Data name="folder"><value>mine</value></Data></ExtendedData>
        <Point><coordinates>1,2</coordinates></Point></Placemark></Folder></kml>`;
    const { fc } = await parseKML(new Blob([kml]));

    expect(fc.features[0].properties?.folder).toBe("mine");
  });

  it("drops a ground overlay, which is an image and not a feature", async () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <GroundOverlay><name>scan</name><Icon><href>scan.png</href></Icon>
        <LatLonBox><north>2</north><south>1</south><east>2</east><west>1</west></LatLonBox>
      </GroundOverlay>
      <Placemark><name>p</name><Point><coordinates>1,2</coordinates></Point></Placemark>
    </Document></kml>`;
    const { fc, droppedCount } = await parseKML(new Blob([kml]));

    expect(fc.features.map((f) => f.properties?.name)).toEqual(["p"]);
    expect(droppedCount).toBe(1);
  });

  it("rejects malformed XML", async () => {
    const err = await expectParseError(
      parseKML(new Blob(["<kml><Placemark></kml>"])),
      "MALFORMED_XML",
    );
    expect(err.format).toBe("KML");
  });

  it("rejects a GPX file given as KML and says to rename it", async () => {
    const err = await expectParseError(
      parseKML(new Blob([fixture("hike.gpx")])),
      "WRONG_FORMAT",
    );
    expect(err.message).toMatch(/\.gpx/);
  });

  it("rejects a KML file in which no placemark has coordinates", async () => {
    await expectParseError(
      parseKML(
        new Blob([
          '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>x</name></Placemark></kml>',
        ]),
      ),
      "NO_FEATURES",
    );
  });
});

describe("parseKMZ", () => {
  it("reads the KML inside the archive", async () => {
    const blob = await zipBlob({
      "doc.kml": fixture("parks.kml"),
      "files/icon.png": "not really a png",
    });
    const { fc, droppedCount } = await parseKMZ(blob);

    expect(fc.features).toHaveLength(3);
    expect(byName(fc, "Lake loop").properties?.folder).toBe("Parks / Trails");
    expect(droppedCount).toBe(1);
  });

  it("prefers doc.kml at the root when the archive holds more than one KML", async () => {
    const other = fixture("parks.kml").replace("Visitor centre", "Other file");
    const blob = await zipBlob({
      "a/other.kml": other,
      "doc.kml": fixture("parks.kml"),
    });
    const { fc } = await parseKMZ(blob);

    expect(byName(fc, "Visitor centre")).toBeDefined();
  });

  it("reads the first KML when there is no doc.kml", async () => {
    const blob = await zipBlob({ "Parks.KML": fixture("parks.kml") });
    const { fc } = await parseKMZ(blob);

    expect(fc.features).toHaveLength(3);
  });

  it("rejects bytes that are not a zip archive", async () => {
    const err = await expectParseError(
      parseKMZ(new Blob(["this is not a zip"])),
      "BAD_ZIP",
    );
    expect(err.format).toBe("KMZ");
  });

  it("rejects an archive with no KML file in it", async () => {
    await expectParseError(
      parseKMZ(await zipBlob({ "readme.txt": "hello" })),
      "NO_KML_IN_KMZ",
    );
  });

  it("rejects malformed KML inside the archive", async () => {
    await expectParseError(
      parseKMZ(await zipBlob({ "doc.kml": "<kml><Placemark></kml>" })),
      "MALFORMED_XML",
    );
  });
});

describe("splitByGeometryKind", () => {
  it("gives one collection per kind, areas then lines then points", async () => {
    const { fc } = await parseKML(new Blob([fixture("parks.kml")]));
    const parts = splitByGeometryKind(fc);

    expect(parts.map((p) => p.kind)).toEqual(["fill", "line", "circle"]);
    expect(
      parts.map((p) => p.fc.features.map((f) => f.properties?.name)),
    ).toEqual([["Golden Gate Park"], ["Lake loop"], ["Visitor centre"]]);
  });

  it("puts GPX tracks and routes in one lines part, waypoints in a points part", async () => {
    const { fc } = await parseGPX(new Blob([fixture("hike.gpx")]));
    const parts = splitByGeometryKind(fc);

    expect(parts.map((p) => [p.kind, p.fc.features.length])).toEqual([
      ["line", 3],
      ["circle", 2],
    ]);
  });

  it("returns one part for a file with one kind", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "a" },
          geometry: { type: "MultiPoint", coordinates: [[0, 0]] },
        },
        {
          type: "Feature",
          properties: { name: "b" },
          geometry: { type: "Point", coordinates: [1, 1] },
        },
      ],
    };

    expect(splitByGeometryKind(fc)).toEqual([{ kind: "circle", fc }]);
  });

  it("divides a geometry collection by kind and keeps its properties on each piece", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "labelled field" },
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "Point", coordinates: [0.5, 0.5] },
              {
                type: "Polygon",
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                  ],
                ],
              },
              {
                type: "GeometryCollection",
                geometries: [{ type: "Point", coordinates: [0.2, 0.2] }],
              },
            ],
          },
        },
      ],
    };
    const parts = splitByGeometryKind(fc);

    expect(parts.map((p) => p.kind)).toEqual(["fill", "circle"]);
    expect(parts[0].fc.features[0]).toEqual({
      type: "Feature",
      properties: { name: "labelled field" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    });
    expect(parts[1].fc.features[0]).toEqual({
      type: "Feature",
      properties: { name: "labelled field" },
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [0.5, 0.5],
          [0.2, 0.2],
        ],
      },
    });
  });

  it("leaves out features with no geometry", () => {
    // RFC 7946 allows a null geometry; the GeoJSON types do not.
    const fc = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: null }],
    } as unknown as FeatureCollection;

    expect(splitByGeometryKind(fc)).toEqual([]);
  });
});
