// SPDX-License-Identifier: MIT
// Well-Known Text → GeoJSON geometry. The reader of the WKT that `toWKT`
// writes, and of the WKT that GIS programs put in a CSV column.

import { describe, expect, it } from "vitest";

import { toWKT } from "./export";
import { parseWKT } from "./wkt";

import type { Geometry } from "geojson";

const ring = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 0],
];
const hole = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 1],
];

describe("parseWKT", () => {
  it("reads back every geometry type that toWKT writes", () => {
    const geometries: Geometry[] = [
      { type: "Point", coordinates: [30.5, -10] },
      {
        type: "LineString",
        coordinates: [
          [30, 10],
          [10, 30],
          [40, 40],
        ],
      },
      { type: "Polygon", coordinates: [ring, hole] },
      {
        type: "MultiPoint",
        coordinates: [
          [10, 40],
          [40, 30],
        ],
      },
      {
        type: "MultiLineString",
        coordinates: [
          [
            [10, 10],
            [20, 20],
          ],
          [
            [40, 40],
            [30, 30],
          ],
        ],
      },
      { type: "MultiPolygon", coordinates: [[ring], [ring, hole]] },
      {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [4, 6] },
          {
            type: "LineString",
            coordinates: [
              [4, 6],
              [7, 10],
            ],
          },
        ],
      },
    ];
    for (const g of geometries) {
      expect(parseWKT(toWKT(g))).toEqual(g);
    }
  });

  it("reads the forms other programs write: any case, SRID, Z, M and ZM, bare multipoints", () => {
    expect(parseWKT("point(1 2)")).toEqual({
      type: "Point",
      coordinates: [1, 2],
    });
    expect(parseWKT("SRID=4326;POINT (1 2)")).toEqual({
      type: "Point",
      coordinates: [1, 2],
    });
    expect(parseWKT("POINT Z (1 2 3)")).toEqual({
      type: "Point",
      coordinates: [1, 2, 3],
    });
    expect(parseWKT("POINT M (1 2 9)")).toEqual({
      type: "Point",
      coordinates: [1, 2],
    });
    expect(parseWKT("LINESTRING ZM (1 2 3 9, 4 5 6 9)")).toEqual({
      type: "LineString",
      coordinates: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    });
    expect(parseWKT("  MULTIPOINT (10 40, 4.5e1 -3E-1)  ")).toEqual({
      type: "MultiPoint",
      coordinates: [
        [10, 40],
        [45, -0.3],
      ],
    });
  });

  it("gives null for text that is not a geometry, never a throw", () => {
    for (const text of [
      "",
      "POINT EMPTY",
      "POINT (1)",
      "POINT (1 2 3 4 5)",
      "POINT (1 2) and more",
      "POINT (1 2",
      "POINT (1e999 2)",
      "CIRCLE (1 2)",
      "LINESTRING (1 2)",
      "POLYGON ((0 0, 1 0, 1 1))",
      "POLYGON ((0 0, 1 0, 1 1, 0 1))",
      "MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), )",
      `${"GEOMETRYCOLLECTION (".repeat(100_000)}POINT (1 2)${")".repeat(
        100_000,
      )}`,
    ]) {
      expect(parseWKT(text)).toBeNull();
    }
  });
});
