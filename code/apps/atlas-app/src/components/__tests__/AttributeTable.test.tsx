// SPDX-License-Identifier: AGPL-3.0-only
//
// AttributeTable — the read-only table of a data layer's features, in the
// one dialog slot. Search narrows the rows, a column header sorts them, a
// row's Zoom button hands its feature to the caller, and a layer of 50,000
// features shows a capped number of rows.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLE_ROW_CAP } from "../../lib/attributeTable";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";
import { AttributeTable } from "../AttributeTable";

import type { Feature } from "geojson";

const site = (name: string, depth: number, i: number): Feature => ({
  type: "Feature",
  properties: { name, depth },
  geometry: { type: "Point", coordinates: [i, i] },
});

function addLayer(features: Feature[]) {
  currentDocument().dispatch({
    type: "add-data-layer",
    id: "dl:s",
    fc: { type: "FeatureCollection", features },
    label: "Sites",
    style: {},
  });
}

const bodyRows = () =>
  within(screen.getByTestId("attribute-table-grid"))
    .getAllByRole("row")
    .slice(1);
const firstCells = () =>
  bodyRows().map((r) => within(r).getAllByRole("cell")[0].textContent);

beforeEach(() => openDocument(createDocument()));
afterEach(cleanup);

describe("AttributeTable", () => {
  it("lists the features, narrows them by search, and sorts by a column", () => {
    addLayer([
      site("Well 10", 10, 0),
      site("Bore", 2, 1),
      site("Well 3", 3, 2),
    ]);
    render(
      <AttributeTable layerId="dl:s" onClose={() => {}} onZoom={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: /Sites/ })).toBeTruthy();
    expect(firstCells()).toEqual(["Well 10", "Bore", "Well 3"]);

    fireEvent.change(screen.getByTestId("attribute-table-search"), {
      target: { value: "well" },
    });
    expect(firstCells()).toEqual(["Well 10", "Well 3"]);

    const depth = screen.getByTestId("attribute-table-sort-depth");
    fireEvent.click(depth);
    expect(firstCells()).toEqual(["Well 3", "Well 10"]);
    expect(
      screen
        .getByRole("columnheader", { name: "depth" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");
    fireEvent.click(depth);
    expect(firstCells()).toEqual(["Well 10", "Well 3"]);
  });

  it("hands a row's feature to the caller, and has nothing to edit", () => {
    const features = [site("Well 10", 10, 0), site("Bore", 2, 1)];
    addLayer(features);
    const onZoom = vi.fn();
    const { container } = render(
      <AttributeTable layerId="dl:s" onClose={() => {}} onZoom={onZoom} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom to Bore" }));
    expect(onZoom).toHaveBeenCalledWith(features[1]);
    expect(container.ownerDocument.querySelectorAll("input")).toHaveLength(1);
  });

  it("shows a capped number of rows of a large layer, and says how many there are", () => {
    addLayer(
      Array.from({ length: 50_000 }, (_, i) => site(`Site ${i}`, i, i % 80)),
    );
    render(
      <AttributeTable layerId="dl:s" onClose={() => {}} onZoom={() => {}} />,
    );
    expect(bodyRows()).toHaveLength(TABLE_ROW_CAP);
    expect(screen.getByTestId("attribute-table-count").textContent).toBe(
      `Showing ${TABLE_ROW_CAP} of 50,000 features. Search to find the others.`,
    );
  });
});
