// SPDX-License-Identifier: AGPL-3.0-only
//
// StylePanel — labels from a property and a filter by property (W9d). The
// panel writes `style.label` and `style.filter` through a restyle command,
// refuses what the map cannot apply with the reason, and says when the
// basemap has no glyphs to draw labels with.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StylePanel } from "../StylePanel";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";
import { useOverlayReport } from "../../hooks/useMapOverlays";

const style = () => {
  const entry = currentDocument()
    .snapshot()
    .overlays.find((e) => e.id === "dl:w");
  expect(entry?.kind).toBe("data");
  return entry?.kind === "data" ? entry.style : undefined;
};

beforeEach(() => {
  openDocument(createDocument());
  currentDocument().dispatch({
    type: "add-data-layer",
    id: "dl:w",
    fc: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Well 4", depth: 12 },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
    },
    label: "Wells",
    style: { fillColor: "#0aa" },
  });
  useOverlayReport.setState({ labelFont: ["Noto Sans Regular"] });
});

afterEach(() => {
  cleanup();
  useOverlayReport.setState({ labelFont: undefined });
});

describe("StylePanel — labels", () => {
  it("writes a label from the chosen property, size and halo", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("label-property"), {
      target: { value: "name" },
    });
    fireEvent.change(screen.getByTestId("label-size"), {
      target: { value: "16" },
    });
    fireEvent.click(screen.getByTestId("label-halo"));
    fireEvent.click(screen.getByTestId("label-apply"));

    expect(style()?.label).toEqual({ property: "name", size: 16, halo: false });
  });

  it("refuses a size the map cannot use, and says why", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("label-size"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("label-apply"));

    expect(style()?.label).toBeUndefined();
    expect(screen.getByTestId("style-rejected").textContent).toContain(
      "Use a label size from 6 to 48.",
    );
  });

  it("removes the labels", () => {
    currentDocument().dispatch({
      type: "restyle",
      id: "dl:w",
      patch: { label: { property: "name", size: 12, halo: true } },
    });
    render(<StylePanel layerId="dl:w" />);
    fireEvent.click(screen.getByTestId("label-remove"));
    expect(style()?.label).toBeUndefined();
  });

  it("says so when the basemap has no glyphs, and not otherwise", () => {
    render(<StylePanel layerId="dl:w" />);
    expect(screen.queryByTestId("label-no-glyphs")).toBeNull();

    act(() => useOverlayReport.setState({ labelFont: null }));
    expect(screen.getByTestId("label-no-glyphs").textContent).toMatch(
      /basemap has no font/i,
    );
  });
});

describe("StylePanel — filter", () => {
  it("writes a filter from property, comparison and value", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("filter-property"), {
      target: { value: "depth" },
    });
    fireEvent.change(screen.getByTestId("filter-op"), {
      target: { value: ">" },
    });
    fireEvent.change(screen.getByTestId("filter-value"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("filter-apply"));

    expect(style()?.filter).toEqual({
      property: "depth",
      op: ">",
      value: "10",
    });
  });

  it("offers =, ≠, <, > and contains", () => {
    render(<StylePanel layerId="dl:w" />);
    const op = screen.getByTestId("filter-op") as HTMLSelectElement;
    expect(Array.from(op.options).map((o) => o.textContent)).toEqual([
      "=",
      "≠",
      "<",
      ">",
      "contains",
    ]);
  });

  it("refuses < with a value that is not a number, and says why", () => {
    render(<StylePanel layerId="dl:w" />);
    fireEvent.change(screen.getByTestId("filter-op"), {
      target: { value: "<" },
    });
    fireEvent.change(screen.getByTestId("filter-value"), {
      target: { value: "deep" },
    });
    fireEvent.click(screen.getByTestId("filter-apply"));

    expect(style()?.filter).toBeUndefined();
    expect(screen.getByTestId("style-rejected").textContent).toContain(
      "Type a number to compare with < or >.",
    );
  });

  it("removes the filter", () => {
    currentDocument().dispatch({
      type: "restyle",
      id: "dl:w",
      patch: { filter: { property: "name", op: "contains", value: "well" } },
    });
    render(<StylePanel layerId="dl:w" />);
    expect((screen.getByTestId("filter-value") as HTMLInputElement).value).toBe(
      "well",
    );
    fireEvent.click(screen.getByTestId("filter-remove"));
    expect(style()?.filter).toBeUndefined();
  });
});
