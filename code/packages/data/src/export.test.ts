// SPDX-License-Identifier: MIT
// Data-layer export: the bytes a user downloads from "Export as GeoJSON" and
// "Export as CSV", "Export as KML" and "Export as GPX". Every test reads the
// produced text, and the round trips read it with the app's own importers.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCSV } from "./csv";
import { csvGeometryMode, toCSV, toGPX, toGeoJSONText, toKML } from "./export";
import { parse, splitByGeometryKind } from "./geojson";
import { parseGPX, parseKML } from "./geoxml";

import type { Feature, FeatureCollection, Geometry } from "geojson";

// `geometry: null` is RFC-legal (§3.2); the typings here say otherwise.
type AnyFeature = Feature<Geometry | null>;

const fc = (...features: AnyFeature[]): FeatureCollection =>
  ({ type: "FeatureCollection", features } as FeatureCollection);

const feature = (
  geometry: Geometry | null,
  properties: Feature["properties"] = {},
): AnyFeature => ({ type: "Feature", geometry, properties });

const point = (lng: number, lat: number, properties = {}) =>
  feature({ type: "Point", coordinates: [lng, lat] }, properties);

const csvBlob = (text: string) => new Blob([text], { type: "text/csv" });

describe("toGeoJSONText", () => {
  it("writes a FeatureCollection that the importer reads back", async () => {
    const input = fc(point(-122.4, 47.6, { name: "Pike", count: 3 }));
    const text = toGeoJSONText(input);
    const back = await parse(new Blob([text]));
    expect(back).toEqual(input);
  });

  it("keeps the properties, nested values included", () => {
    const text = toGeoJSONText(
      fc(point(1, 2, { tags: ["a", "b"], meta: { k: 1 }, empty: null })),
    );
    expect(JSON.parse(text).features[0].properties).toEqual({
      tags: ["a", "b"],
      meta: { k: 1 },
      empty: null,
    });
  });

  it("rounds every coordinate to 7 decimals", () => {
    const text = toGeoJSONText(
      fc(
        feature({
          type: "LineString",
          coordinates: [
            [0.123456789, -45.000000049],
            [10.1 + 0.2, 20, 101.123456789],
          ],
        }),
      ),
    );
    expect(text).toContain("[[0.1234568,-45],[10.3,20,101.1234568]]");
  });

  it("rounds inside every geometry type, GeometryCollection included", () => {
    const text = toGeoJSONText(
      fc(
        feature({
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [1.000000001, 2] },
            {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [0, 0],
                    [1.123456789, 0],
                    [1, 1],
                    [0, 0],
                  ],
                ],
              ],
            },
          ],
        }),
      ),
    );
    const g = JSON.parse(text).features[0].geometry;
    expect(g.geometries[0].coordinates).toEqual([1, 2]);
    expect(g.geometries[1].coordinates[0][0][1]).toEqual([1.1234568, 0]);
  });

  it("writes no foreign members, and the name only when given", () => {
    const input = {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:4326" } },
      bbox: [0, 0, 1, 1],
      features: [
        {
          type: "Feature",
          id: 7,
          title: "foreign",
          geometry: { type: "Point", coordinates: [1, 2], extra: true },
          properties: { a: 1 },
        },
      ],
    } as unknown as FeatureCollection;

    expect(JSON.parse(toGeoJSONText(input))).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 7,
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { a: 1 },
        },
      ],
    });
    expect(JSON.parse(toGeoJSONText(input, { name: "Parcels" })).name).toBe(
      "Parcels",
    );
    expect("name" in JSON.parse(toGeoJSONText(input, { name: "" }))).toBe(
      false,
    );
  });

  it("keeps a null geometry and null properties as null", () => {
    const text = toGeoJSONText(fc(feature(null, null)));
    expect(JSON.parse(text).features[0]).toEqual({
      type: "Feature",
      geometry: null,
      properties: null,
    });
  });
});

describe("toCSV — point layers", () => {
  it("writes longitude, latitude, then property keys in first-seen order", () => {
    const text = toCSV(
      fc(
        point(-122.4, 47.6, { name: "A", count: 1 }),
        point(-122.3, 47.7, { kind: "x", name: "B" }),
      ),
    );
    expect(text).toBe(
      "longitude,latitude,name,count,kind\r\n" +
        "-122.4,47.6,A,1,\r\n" +
        "-122.3,47.7,B,,x\r\n",
    );
  });

  it("quotes by RFC 4180: comma, quote, CR and LF", () => {
    const text = toCSV(
      fc(point(0, 0, { a: 'say "hi"', b: "x,y", c: "line\nbreak", d: "r\r" })),
    );
    expect(text.split("\r\n")[1]).toBe(
      '0,0,"say ""hi""","x,y","line\nbreak","r\r"',
    );
  });

  it("writes numbers unformatted and nested values as JSON", () => {
    const text = toCSV(
      fc(
        point(0, 0, {
          big: 1e21,
          small: 0.000001,
          neg: -3.5,
          flag: true,
          list: [1, "two"],
          obj: { k: "v" },
          none: null,
        }),
      ),
    );
    expect(text.split("\r\n")[1]).toBe(
      '0,0,1e+21,0.000001,-3.5,true,"[1,""two""]","{""k"":""v""}",',
    );
  });

  it("rounds lon/lat to 7 decimals", () => {
    const text = toCSV(fc(point(1.123456789, -2.000000001)));
    expect(text.split("\r\n")[1]).toBe("1.1234568,-2");
  });

  it("writes empty lon/lat for a feature with no geometry", () => {
    const text = toCSV(fc(point(1, 2, { n: 1 }), feature(null, { n: 2 })));
    expect(text.split("\r\n")[2]).toBe(",,2");
  });

  it("round-trips through the CSV importer: same features, same numeric types", async () => {
    const input = fc(
      point(-122.4194, 37.7749, {
        name: "San Francisco",
        population: 808437,
        density: 7194.4,
        note: 'has "quotes", commas',
        zip: "02134",
      }),
      point(-73.9857, 40.7484, {
        name: "New York",
        population: 8336817,
        density: 11313.8,
        note: "two\nlines",
        zip: "10001",
      }),
    );
    const back = await parseCSV(csvBlob(toCSV(input)));
    expect(back).toEqual(input);
    expect(typeof back.features[0].properties!.population).toBe("number");
    expect(typeof back.features[0].properties!.zip).toBe("string");
  });

  it("an empty layer is a header row only", () => {
    expect(toCSV(fc())).toBe("longitude,latitude\r\n");
  });
});

describe("toCSV — other geometry", () => {
  it("writes a WKT geometry column for a polygon layer", () => {
    const text = toCSV(
      fc(
        feature(
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
          { id: "P-1" },
        ),
      ),
    );
    expect(text).toBe(
      'geometry,id\r\n"POLYGON ((0 0, 1 0, 1 1, 0 0))",P-1\r\n',
    );
  });

  it("writes WKT for every GeoJSON geometry type", () => {
    const rows = toCSV(
      fc(
        feature({
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        }),
        feature({
          type: "MultiPoint",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        }),
        feature({
          type: "MultiLineString",
          coordinates: [
            [
              [0, 0],
              [1, 1],
            ],
            [
              [2, 2],
              [3, 3],
            ],
          ],
        }),
        feature({
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [0, 1],
                [0, 0],
              ],
            ],
          ],
        }),
        feature({
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [5, 6] },
            {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        }),
        feature({ type: "MultiPoint", coordinates: [] }),
        feature(null),
        feature({ type: "Point", coordinates: [1.000000001, 2] }),
      ),
    ).split("\r\n");
    expect(rows.slice(1, -1)).toEqual([
      '"LINESTRING (0 0, 1 1)"',
      '"MULTIPOINT ((0 0), (1 1))"',
      '"MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))"',
      '"MULTIPOLYGON (((0 0, 1 0, 0 1, 0 0)))"',
      '"GEOMETRYCOLLECTION (POINT (5 6), LINESTRING (0 0, 1 1))"',
      "MULTIPOINT EMPTY",
      "",
      "POINT (1 2)",
    ]);
  });

  it("csvGeometryMode is point only when every geometry is a Point", () => {
    expect(csvGeometryMode(fc(point(0, 0), feature(null)))).toBe("point");
    expect(csvGeometryMode(fc())).toBe("point");
    expect(
      csvGeometryMode(
        fc(point(0, 0), feature({ type: "MultiPoint", coordinates: [] })),
      ),
    ).toBe("wkt");
  });
});

describe("toCSV — spreadsheet formulas", () => {
  const one = (name: unknown, n: unknown): FeatureCollection => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { name, n },
      },
    ],
  });

  // A spreadsheet runs a cell that starts with = + - @ (or a tab or CR) as a
  // formula. A text cell is prefixed with ' so it opens as text.
  it("opens text that looks like a formula as text", () => {
    const row = toCSV(one('=HYPERLINK("http://x","y")', 1)).split("\r\n")[1];
    expect(row.startsWith("1,2,\"'=HYPERLINK")).toBe(true);
  });

  it("leaves numbers alone, so negative numbers still round-trip", async () => {
    const back = await parseCSV(csvBlob(toCSV(one("plain", -3.5))));
    expect(back.features[0]?.properties?.n).toBe(-3.5);
    expect(back.features[0]?.properties?.name).toBe("plain");
  });
});

describe("toCSV — a property named like a geometry column", () => {
  it("writes one header per column, and the property under its own name", async () => {
    const text = toCSV(
      fc(point(13.4, 52.5, { Longitude: 99, latitude: "n/a", name: "A" })),
    );
    const header = text.split("\r\n")[0]!.split(",");
    expect(header).toEqual([
      "longitude",
      "latitude",
      "Longitude (property)",
      "latitude (property)",
      "name",
    ]);
    const back = await parseCSV(new Blob([text]));
    expect(back.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [13.4, 52.5],
    });
    expect(back.features[0]!.properties).toMatchObject({
      "Longitude (property)": 99,
      "latitude (property)": "n/a",
    });
  });
});

// ---------------------------------------------------------------------------
// KML and GPX

/** Text that breaks XML if it is written as it is. */
const UNSAFE = "a < b & c > d \"q\" 's' ]]> end";

const xmlBlob = (text: string) => new Blob([text], { type: "text/xml" });

describe("toKML", () => {
  const input = fc(
    {
      ...point(2.3522, 48.8566, {
        name: "Well 4, north",
        depth: 12.5,
        count: 3,
        open: true,
        capped: false,
        note: UNSAFE,
      }),
      id: "well-4",
    },
    feature(
      {
        type: "LineString",
        coordinates: [
          [0, 0, 10],
          [1, 1, 20.5],
        ],
      },
      { name: "Track" },
    ),
    feature(
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 0],
          ],
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 1],
          ],
        ],
      },
      { [UNSAFE]: "a key that is not a name" },
    ),
    feature(
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [10, 10],
              [11, 10],
              [11, 11],
              [10, 10],
            ],
          ],
          [
            [
              [20, 20],
              [21, 20],
              [21, 21],
              [20, 20],
            ],
          ],
        ],
      },
      { name: "Islands" },
    ),
  );

  it("writes a layer that the KML importer reads back: same features, same property types", async () => {
    const back = await parseKML(xmlBlob(toKML(input, { name: "Sites" })));
    expect(back.droppedCount).toBe(0);
    // The importer divides by kind and joins a MultiGeometry into a Multi*
    // geometry, as it does for every KML file.
    expect(splitByGeometryKind(back.fc)).toEqual(splitByGeometryKind(input));
  });

  it("escapes markup in names and values, so ]]> and & stay text", () => {
    const text = toKML(fc(point(0, 0, { name: UNSAFE })), { name: UNSAFE });
    expect(text).not.toContain("]]>");
    expect(text).not.toContain(" & ");
    expect(text).toContain("<name>a &lt; b &amp; c &gt; d");
  });

  it("leaves out a null value and characters XML cannot hold", async () => {
    const back = await parseKML(
      xmlBlob(toKML(fc(point(0, 0, { gone: null, bell: "ding\u0007!" })))),
    );
    expect(back.fc.features[0]!.properties).toEqual({ bell: "ding!" });
  });
});

describe("toGPX", () => {
  const fixture = (name: string) =>
    fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "__fixtures__",
        name,
      ),
      "utf8",
    );

  it("writes GPX data that the GPX importer reads back the same: waypoints, routes, tracks, times, elevation", async () => {
    const first = await parseGPX(xmlBlob(fixture("hike.gpx")));
    const back = await parseGPX(xmlBlob(toGPX(first.fc, { name: "Hike" })));
    expect(back.fc).toEqual(first.fc);
  });

  it("escapes markup in names", async () => {
    const text = toGPX(fc(point(1, 2, { name: UNSAFE })));
    expect(text).not.toContain("]]>");
    const back = await parseGPX(xmlBlob(text));
    expect(back.fc.features[0]!.properties).toEqual({ name: UNSAFE });
  });

  it("writes only what GPX has a place for: no areas, no other properties", async () => {
    const square = feature({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    const back = await parseGPX(
      xmlBlob(toGPX(fc(square, point(1, 2, { name: "A", depth: 3 })))),
    );
    expect(back.fc.features).toEqual([point(1, 2, { name: "A" })]);
  });
});
