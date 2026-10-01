// SPDX-License-Identifier: MIT
// Labels from a property, and a filter by property. The compiler turns
// `style.label` into a symbol layer and `style.filter` into a filter
// expression on every layer of the data layer.

import { describe, expect, it } from "vitest";

import {
  compileFilter,
  compileLayers,
  filterProblem,
  labelLayerId,
  labelProblem,
  outlineLayerId,
} from "../style-compiler";

import type { LayerStyle } from "../style";

const FONT = ["Noto Sans Regular"];

describe("compileFilter", () => {
  it('compares = and ≠ as text, so 2025 matches "2025"', () => {
    expect(
      compileFilter({ property: "year", op: "==", value: "2025" }),
    ).toEqual(["==", ["to-string", ["get", "year"]], "2025"]);
    expect(
      compileFilter({ property: "year", op: "!=", value: "2025" }),
    ).toEqual(["!=", ["to-string", ["get", "year"]], "2025"]);
  });

  it("compares < and > as numbers, and a feature without a number never matches", () => {
    expect(compileFilter({ property: "pop", op: "<", value: "10" })).toEqual([
      "all",
      ["!=", ["get", "pop"], null],
      ["<", ["to-number", ["get", "pop"], 1e308], 10],
    ]);
    expect(compileFilter({ property: "pop", op: ">", value: " 2.5 " })).toEqual(
      [
        "all",
        ["!=", ["get", "pop"], null],
        [">", ["to-number", ["get", "pop"], -1e308], 2.5],
      ],
    );
  });

  it("matches contains without regard to case", () => {
    expect(
      compileFilter({ property: "name", op: "contains", value: "Oak" }),
    ).toEqual(["in", "oak", ["downcase", ["to-string", ["get", "name"]]]]);
  });
});

describe("filterProblem", () => {
  it("is null for a filter the map can apply", () => {
    expect(filterProblem({ property: "n", op: "<", value: "3" })).toBeNull();
    expect(filterProblem({ property: "n", op: "==", value: "" })).toBeNull();
  });

  it("names what is missing or wrong", () => {
    expect(filterProblem({ property: "", op: "==", value: "x" })).toBe(
      "Choose a property to filter by.",
    );
    expect(filterProblem({ property: "n", op: ">", value: "ten" })).toBe(
      "Type a number to compare with < or >.",
    );
  });
});

describe("labelProblem", () => {
  it("names a missing property and a size out of range", () => {
    expect(labelProblem({ property: "name", size: 12, halo: true })).toBeNull();
    expect(labelProblem({ property: "", size: 12, halo: true })).toBe(
      "Choose a property for the labels.",
    );
    expect(labelProblem({ property: "name", size: 2, halo: true })).toBe(
      "Use a label size from 6 to 48.",
    );
  });
});

describe("compileLayers — labels and filter", () => {
  const filtered: LayerStyle = {
    fillColor: "#0aa",
    filter: { property: "kind", op: "==", value: "school" },
  };

  it("puts the filter on every layer of the data layer", () => {
    const layers = compileLayers("dl:a", filtered, "fill");
    expect(layers.map((l) => l.id)).toEqual(["dl:a", outlineLayerId("dl:a")]);
    for (const layer of layers) {
      expect((layer as { filter?: unknown }).filter).toEqual([
        "==",
        ["to-string", ["get", "kind"]],
        "school",
      ]);
    }
  });

  it("adds no filter for a style without one", () => {
    const [layer] = compileLayers("dl:a", { fillColor: "#0aa" }, "circle");
    expect("filter" in layer).toBe(false);
  });

  it("adds a symbol layer on top for a label, in the basemap's font", () => {
    const style: LayerStyle = {
      ...filtered,
      label: { property: "name", size: 14, halo: true },
    };
    const layers = compileLayers("dl:a", style, "circle", { labelFont: FONT });
    expect(layers.map((l) => l.id)).toEqual(["dl:a", labelLayerId("dl:a")]);
    expect(layers[1]).toEqual({
      id: labelLayerId("dl:a"),
      type: "symbol",
      source: "dl:a",
      filter: ["==", ["to-string", ["get", "kind"]], "school"],
      layout: {
        "text-field": ["to-string", ["get", "name"]],
        "text-font": FONT,
        "text-size": 14,
        "text-anchor": "top",
        "text-offset": [0, 0.6],
      },
      paint: {
        "text-color": "#212529",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  });

  it("runs a line's label along the line, and draws no halo when it is off", () => {
    const style: LayerStyle = {
      label: { property: "ref", size: 11, halo: false },
    };
    const label = compileLayers("dl:r", style, "line", { labelFont: FONT })[1];
    expect(label).toMatchObject({
      layout: { "symbol-placement": "line" },
      paint: { "text-halo-width": 0 },
    });
  });

  it("draws no label without a font: the basemap has no glyphs", () => {
    const style: LayerStyle = {
      label: { property: "name", size: 12, halo: true },
    };
    expect(compileLayers("dl:a", style, "fill").map((l) => l.id)).toEqual([
      "dl:a",
      outlineLayerId("dl:a"),
    ]);
  });
});
