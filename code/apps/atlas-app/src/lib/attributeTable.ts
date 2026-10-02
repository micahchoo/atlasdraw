// SPDX-License-Identifier: AGPL-3.0-only
//
// The attribute table of a data layer, as data: its columns and rows
// (buildTable), and the rows a search keeps in the order a sort asks for
// (viewRows). Pure: no DOM, no map, no document. The dialog
// (components/AttributeTable.tsx) shows it and edits nothing.
//
// A layer can hold 50,000 features. Each row's search text is made once, in
// buildTable, so a keystroke is one pass of `includes` over the rows. The
// dialog shows at most TABLE_ROW_CAP of them.

import { attributeText } from "./featureHit";

import type { FeatureCollection } from "geojson";

/** The most rows the dialog shows. A search narrows what is over it. */
export const TABLE_ROW_CAP = 500;

export interface TableRow {
  /** The feature's index in the layer's FeatureCollection. */
  feature: number;
  /** One text per column, as the feature popup shows the value. */
  cells: string[];
  /** One value per column, for a numeric sort. */
  values: unknown[];
  /** Every cell, lower case, for the search. */
  search: string;
}

export interface AttributeTable {
  /** Property keys, in the order first seen across the features. */
  columns: string[];
  /** One row per feature, in the layer's order. */
  rows: TableRow[];
}

export interface TableSort {
  column: number;
  direction: "ascending" | "descending";
}

export function buildTable(fc: FeatureCollection): AttributeTable {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const f of fc.features) {
    for (const key of Object.keys(f.properties ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const rows = fc.features.map((f, feature) => {
    const props = f.properties ?? {};
    const values = columns.map((key) => props[key]);
    const cells = values.map(attributeText);
    return {
      feature,
      cells,
      values,
      search: cells.join("\n").toLowerCase(),
    };
  });
  return { columns, rows };
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Two cells of one column, ascending: numbers as numbers, text as words. */
function compareCells(a: TableRow, b: TableRow, column: number): number {
  const x = a.values[column];
  const y = b.values[column];
  return typeof x === "number" && typeof y === "number"
    ? x - y
    : collator.compare(a.cells[column], b.cells[column]);
}

/**
 * The rows whose text holds `query`, without regard to case, in the order
 * `sort` asks for, or in the layer's order. An empty cell sorts last in
 * both directions. Equal cells keep the layer's order.
 */
export function viewRows(
  table: AttributeTable,
  query: string,
  sort: TableSort | null,
): TableRow[] {
  const q = query.trim().toLowerCase();
  const kept = q ? table.rows.filter((r) => r.search.includes(q)) : table.rows;
  if (!sort) {
    return kept;
  }
  const { column } = sort;
  const sign = sort.direction === "ascending" ? 1 : -1;
  return kept.slice().sort((a, b) => {
    const emptyA = a.cells[column] === "";
    const emptyB = b.cells[column] === "";
    if (emptyA !== emptyB) {
      return emptyA ? 1 : -1;
    }
    return (
      (emptyA ? 0 : sign * compareCells(a, b, column)) || a.feature - b.feature
    );
  });
}
