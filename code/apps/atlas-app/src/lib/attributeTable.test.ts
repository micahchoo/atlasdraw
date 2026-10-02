// SPDX-License-Identifier: AGPL-3.0-only
// The attribute table's model: the columns and rows of a data layer, the
// rows a search keeps, and their order when a column is sorted.

import { describe, expect, it } from "vitest";

import { buildTable, viewRows } from "./attributeTable";

import type { FeatureCollection } from "geojson";

const fc = (...properties: Array<Record<string, unknown> | null>) =>
  ({
    type: "FeatureCollection",
    features: properties.map((p, i) => ({
      type: "Feature",
      properties: p,
      geometry: { type: "Point", coordinates: [i, i] },
    })),
  } as FeatureCollection);

const SITES = fc(
  { name: "Well 10", depth: 10 },
  { name: "well 2", depth: 2, tags: ["dry"] },
  { name: "Spring", depth: null },
  null,
  { name: "Bore", depth: 33.5, note: "Near the ROAD" },
);

describe("buildTable", () => {
  it("has a column per property key, in the order first seen, and cells as the popup shows them", () => {
    const table = buildTable(SITES);
    expect(table.columns).toEqual(["name", "depth", "tags", "note"]);
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["Well 10", "10", "", ""],
      ["well 2", "2", '["dry"]', ""],
      ["Spring", "", "", ""],
      ["", "", "", ""],
      ["Bore", "33.5", "", "Near the ROAD"],
    ]);
    expect(table.rows.map((r) => r.feature)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("viewRows", () => {
  const table = buildTable(SITES);
  const names = (rows: ReturnType<typeof viewRows>) =>
    rows.map((r) => r.cells[0]);

  it("keeps the rows with the search in any cell, without regard to case", () => {
    expect(names(viewRows(table, "", null))).toEqual([
      "Well 10",
      "well 2",
      "Spring",
      "",
      "Bore",
    ]);
    expect(names(viewRows(table, "WELL", null))).toEqual(["Well 10", "well 2"]);
    expect(names(viewRows(table, "road", null))).toEqual(["Bore"]);
    expect(names(viewRows(table, "dry", null))).toEqual(["well 2"]);
  });

  it("sorts numbers as numbers and text by its digits too, with empty cells last both ways", () => {
    expect(
      names(viewRows(table, "", { column: 1, direction: "ascending" })),
    ).toEqual(["well 2", "Well 10", "Bore", "Spring", ""]);
    expect(
      names(viewRows(table, "", { column: 1, direction: "descending" })),
    ).toEqual(["Bore", "Well 10", "well 2", "Spring", ""]);
    expect(
      names(viewRows(table, "", { column: 0, direction: "ascending" })),
    ).toEqual(["Bore", "Spring", "well 2", "Well 10", ""]);
  });
});
