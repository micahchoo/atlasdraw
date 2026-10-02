// SPDX-License-Identifier: AGPL-3.0-only
//
// StylePanel — how a point layer draws (points, clusters or a heatmap) and
// a point's size from a number property. The panel writes `style.points`
// and `style.size` through a restyle command; the range of the size comes
// from the layer's own values.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StylePanel } from "../StylePanel";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

const style = (id = "dl:w") => {
  const entry = currentDocument()
    .snapshot()
    .overlays.find((e) => e.id === id);
  expect(entry?.kind).toBe("data");
  return entry?.kind === "data" ? entry.style : undefined;
};

const well = (depth: number, coordinates: [number, number]) => ({
  type: "Feature" as const,
  properties: { name: `Well ${depth}`, depth },
  geometry: { type: "Point" as const, coordinates },
});

beforeEach(() => {
  openDocument(createDocument());
  currentDocument().dispatch({
    type: "add-data-layer",
    id: "dl:w",
    fc: {
      type: "FeatureCollection",
      features: [well(12, [0, 0]), well(40, [1, 1]), well(25, [2, 2])],
    },
    label: "Wells",
    style: { fillColor: "#0aa" },
  });
});

afterEach(cleanup);

describe("StylePanel — points", () => {
  it("shows the points as clusters or a heatmap as soon as the choice changes", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("points-display"), {
      target: { value: "clusters" },
    });
    expect(style()?.points).toBe("clusters");
    fireEvent.change(screen.getByTestId("points-display"), {
      target: { value: "heatmap" },
    });
    expect(style()?.points).toBe("heatmap");
  });

  it("sizes the points by a number property over the layer's own range", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("size-property"), {
      target: { value: "depth" },
    });
    fireEvent.change(screen.getByTestId("size-min-radius"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("size-max-radius"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByTestId("size-apply"));
    expect(style()?.size).toEqual({
      property: "depth",
      min: 12,
      max: 40,
      minRadius: 3,
      maxRadius: 18,
    });

    fireEvent.click(screen.getByTestId("size-remove"));
    expect(style()?.size).toBeUndefined();
  });

  it("refuses a size the map cannot draw, and says why", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("size-max-radius"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByTestId("size-apply"));
    expect(style()?.size).toBeUndefined();
    expect(screen.getByTestId("style-rejected").textContent).toMatch(
      /point size/i,
    );
  });

  it("is not offered for a line layer", () => {
    currentDocument().dispatch({
      type: "add-data-layer",
      id: "dl:road",
      fc: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { lanes: 2 },
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      },
      label: "Road",
      style: {},
    });
    render(<StylePanel layerId="dl:road" />);
    expect(screen.queryByTestId("style-points")).toBeNull();
    expect(screen.getByTestId("style-labels")).toBeTruthy();
  });
});
