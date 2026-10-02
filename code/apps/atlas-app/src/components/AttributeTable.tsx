// SPDX-License-Identifier: AGPL-3.0-only
//
// AttributeTable: a data layer's features as a table, in the one dialog
// slot (session/view.ts `attribute-table`, shown by EditorDialogs). Search
// narrows the rows; a column header sorts them; a row's Zoom button hands
// its feature to the caller, which frames the map on it.
//
// Read-only: the table edits nothing. The model is lib/attributeTable.ts.
// At most TABLE_ROW_CAP rows render, so a layer of 50,000 features opens at
// once; the count line says so.

import React, { useMemo, useState } from "react";

import {
  TABLE_ROW_CAP,
  buildTable,
  viewRows,
  type TableSort,
} from "../lib/attributeTable";
import { useDocument } from "../state/document";

import styles from "../styles/AttributeTable.module.css";

import { Modal } from "./Modal";

import type { Feature } from "geojson";

export interface AttributeTableProps {
  layerId: string;
  onClose: () => void;
  /** Frame the map on this feature. */
  onZoom: (feature: Feature) => void;
}

const count = (n: number) => n.toLocaleString("en-US");

/** No sort, then ascending, then descending, then no sort again. */
function nextSort(sort: TableSort | null, column: number): TableSort | null {
  if (sort?.column !== column) {
    return { column, direction: "ascending" };
  }
  return sort.direction === "ascending"
    ? { column, direction: "descending" }
    : null;
}

export function AttributeTable({
  layerId,
  onClose,
  onZoom,
}: AttributeTableProps) {
  const label = useDocument(
    (s) => s.overlays.find((e) => e.id === layerId)?.label ?? "",
  );
  const fc = useDocument((s) => s.featureCollections[layerId]);
  const table = useMemo(
    () => buildTable(fc ?? { type: "FeatureCollection", features: [] }),
    [fc],
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSort | null>(null);
  const rows = useMemo(
    () => viewRows(table, query, sort),
    [table, query, sort],
  );
  const shown = rows.slice(0, TABLE_ROW_CAP);
  const total = table.rows.length;

  const summary =
    rows.length > TABLE_ROW_CAP
      ? `Showing ${count(TABLE_ROW_CAP)} of ${count(rows.length)} ${
          rows.length === total ? "features" : "matches"
        }. Search to find the others.`
      : rows.length === total
      ? `${count(total)} ${total === 1 ? "feature" : "features"}`
      : `${count(rows.length)} of ${count(total)} features match`;

  return (
    <Modal
      labelledBy="attribute-table-title"
      onClose={onClose}
      scrimClassName={styles.scrim}
      scrimTestId="attribute-table-scrim"
      className={styles.panel}
      testId="attribute-table"
    >
      <div className={styles.header}>
        <h2 id="attribute-table-title" className={styles.title}>
          {`Attributes: ${label}`}
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          data-testid="attribute-table-close"
        >
          Close
        </button>
      </div>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          type="search"
          aria-label="Search the features"
          placeholder="Search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="attribute-table-search"
        />
        <span
          className={styles.count}
          role="status"
          data-testid="attribute-table-count"
        >
          {summary}
        </span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="attribute-table-grid">
          <thead>
            <tr>
              {table.columns.map((column, i) => (
                <th
                  key={column}
                  scope="col"
                  className={styles.th}
                  aria-sort={sort?.column === i ? sort.direction : undefined}
                >
                  <button
                    type="button"
                    className={styles.sort}
                    onClick={() => setSort(nextSort(sort, i))}
                    data-testid={`attribute-table-sort-${column}`}
                  >
                    {column}
                    <span aria-hidden="true" className={styles.arrow}>
                      {sort?.column !== i
                        ? ""
                        : sort.direction === "ascending"
                        ? "▲"
                        : "▼"}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className={styles.th}>
                <span className={styles.srOnly}>Zoom</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.feature} className={styles.tr}>
                {row.cells.map((cell, i) => (
                  <td key={table.columns[i]} className={styles.td}>
                    {cell}
                  </td>
                ))}
                <td className={styles.td}>
                  <button
                    type="button"
                    className={styles.zoom}
                    aria-label={`Zoom to ${
                      row.cells[0] || `feature ${row.feature + 1}`
                    }`}
                    onClick={() => fc && onZoom(fc.features[row.feature])}
                    data-testid={`attribute-table-zoom-${row.feature}`}
                  >
                    Zoom
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
