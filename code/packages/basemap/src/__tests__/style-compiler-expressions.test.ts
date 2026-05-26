// SPDX-License-Identifier: MIT
// Phase 6 Wave 1b — A6 tests. Cover the data-driven expression branch added to
// compileLayer, plus the determinism + fallback guarantees the compiler owes
// callers (StylePanel writes a LayerStyle; map render reads compileLayer output).

import { describe, expect, it } from "vitest";

import { compileLayer } from "../style-compiler";

import type { LayerStyle } from "../style";

describe("compileLayer — expressions (A6)", () => {
  it("compiles a categorical expression with 3 stops to a MapLibre match array", () => {
    const style: LayerStyle = {
      opacity: 0.7,
      expression: {
        kind: "categorical",
        property: "landuse",
        stops: [
          { value: "park", color: "#2ca02c" },
          { value: "water", color: "#1f77b4" },
          { value: "built", color: "#7f7f7f" },
        ],
        fallback: "#cccccc",
      },
    };

    const spec = compileLayer("dl:x", style, "fill");

    expect(spec.type).toBe("fill");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;
    expect(paint["fill-color"]).toEqual([
      "match",
      ["get", "landuse"],
      "park",
      "#2ca02c",
      "water",
      "#1f77b4",
      "built",
      "#7f7f7f",
      "#cccccc",
    ]);
    expect(paint["fill-opacity"]).toBe(0.7);
  });

  it("emits the fallback color (no match wrapper) when categorical stops are empty", () => {
    const style: LayerStyle = {
      expression: {
        kind: "categorical",
        property: "landuse",
        stops: [],
        fallback: "#abcdef",
      },
    };

    const spec = compileLayer("dl:y", style, "fill");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;

    expect(paint["fill-color"]).toBe("#abcdef");
  });

  it("compiles a graduated linear expression with 4 stops to a MapLibre interpolate array", () => {
    const style: LayerStyle = {
      expression: {
        kind: "graduated",
        property: "population",
        method: "linear",
        stops: [
          { stop: 0, color: "#fef0d9" },
          { stop: 100, color: "#fdcc8a" },
          { stop: 500, color: "#fc8d59" },
          { stop: 1000, color: "#d7301f" },
        ],
        fallback: "#cccccc",
      },
    };

    const spec = compileLayer("dl:z", style, "fill");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;

    expect(paint["fill-color"]).toEqual([
      "interpolate",
      ["linear"],
      ["get", "population"],
      0,
      "#fef0d9",
      100,
      "#fdcc8a",
      500,
      "#fc8d59",
      1000,
      "#d7301f",
    ]);
  });

  it("emits fallback when graduated stops are empty", () => {
    const style: LayerStyle = {
      expression: {
        kind: "graduated",
        property: "pop",
        method: "quantile",
        stops: [],
        fallback: "#dddddd",
      },
    };
    const spec = compileLayer("dl:empty", style, "circle");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((spec as any).paint["circle-color"]).toBe("#dddddd");
  });

  it("preserves the literal-color path when expression is absent", () => {
    const style: LayerStyle = { fillColor: "#ff0000", opacity: 0.5 };
    const spec = compileLayer("dl:lit", style, "fill");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;

    expect(paint["fill-color"]).toBe("#ff0000");
    expect(paint["fill-opacity"]).toBe(0.5);
  });

  it("applies the expression to line-color for line geometry", () => {
    const style: LayerStyle = {
      strokeWidth: 2,
      expression: {
        kind: "categorical",
        property: "class",
        stops: [{ value: "highway", color: "#ff0000" }],
        fallback: "#000000",
      },
    };
    const spec = compileLayer("dl:line", style, "line");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;

    expect(spec.type).toBe("line");
    expect(paint["line-color"]).toEqual([
      "match",
      ["get", "class"],
      "highway",
      "#ff0000",
      "#000000",
    ]);
    expect(paint["line-width"]).toBe(2);
  });

  it("applies the expression to circle-color for circle geometry", () => {
    const style: LayerStyle = {
      expression: {
        kind: "graduated",
        property: "score",
        method: "linear",
        stops: [
          { stop: 0, color: "#000000" },
          { stop: 1, color: "#ffffff" },
        ],
        fallback: "#888888",
      },
    };
    const spec = compileLayer("dl:circ", style, "circle");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (spec as any).paint;

    expect(spec.type).toBe("circle");
    expect(paint["circle-color"]).toEqual([
      "interpolate",
      ["linear"],
      ["get", "score"],
      0,
      "#000000",
      1,
      "#ffffff",
    ]);
  });

  it("is deterministic: same LayerStyle in → byte-equal MapLibre output", () => {
    const style: LayerStyle = {
      opacity: 0.6,
      expression: {
        kind: "categorical",
        property: "kind",
        stops: [
          { value: "a", color: "#111111" },
          { value: 2, color: "#222222" },
        ],
        fallback: "#000000",
      },
    };

    const a = compileLayer("dl:det", style, "fill");
    const b = compileLayer("dl:det", style, "fill");

    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a).toEqual(b);
  });
});
