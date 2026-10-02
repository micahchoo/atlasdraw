// SPDX-License-Identifier: MIT
// How a point layer draws: each point, clusters or a heatmap, and a point's
// size from a number property. The compiler turns `style.points` and
// `style.size` into layers and source options; `pointProblem` refuses a
// value the map cannot draw.

import { describe, expect, it } from "vitest";

import {
  clusterCountLayerId,
  clusterLayerId,
  compileFilter,
  compileLayers,
  compileSourceOptions,
  pointProblem,
} from "../style-compiler";

import type { LayerStyle } from "../style";

const FONT = ["Noto Sans Regular"];
const SIZE = {
  property: "pop",
  min: 10,
  max: 1000,
  minRadius: 3,
  maxRadius: 18,
};

describe("size by property", () => {
  it("interpolates the radius over the property, and a feature with no number keeps the plain radius", () => {
    const [layer] = compileLayers("pts", { size: SIZE }, "circle");
    expect((layer as { paint: Record<string, unknown> }).paint).toMatchObject({
      "circle-radius": [
        "case",
        ["==", ["typeof", ["get", "pop"]], "number"],
        ["interpolate", ["linear"], ["get", "pop"], 10, 3, 1000, 18],
        5,
      ],
    });
  });
});

describe("clusters", () => {
  const style: LayerStyle = {
    points: "clusters",
    filter: { property: "kind", op: "==", value: "school" },
    label: { property: "name", size: 12, halo: true },
  };

  it("clusters in the source, and filters there, so a cluster counts only the points that pass", () => {
    expect(compileSourceOptions(style, "circle")).toEqual({
      cluster: true,
      clusterRadius: 50,
      filter: compileFilter(style.filter!),
    });
  });

  it("draws the clusters, their counts, then the single points and their labels", () => {
    const layers = compileLayers("pts", style, "circle", { labelFont: FONT });
    expect(layers.map((l) => [l.id, l.type])).toEqual([
      [clusterLayerId("pts"), "circle"],
      [clusterCountLayerId("pts"), "symbol"],
      ["pts", "circle"],
      ["pts::label", "symbol"],
    ]);
    const filters = layers.map((l) => (l as { filter?: unknown }).filter);
    expect(filters).toEqual([
      ["has", "point_count"],
      ["has", "point_count"],
      ["!", ["has", "point_count"]],
      ["!", ["has", "point_count"]],
    ]);
  });

  it("leaves out the counts when the basemap has no font", () => {
    const layers = compileLayers("pts", { points: "clusters" }, "circle");
    expect(layers.map((l) => l.id)).toEqual([clusterLayerId("pts"), "pts"]);
  });
});

describe("heatmap", () => {
  it("is one heatmap layer in the layer's id, with the filter and no labels", () => {
    const layers = compileLayers(
      "pts",
      {
        points: "heatmap",
        opacity: 0.6,
        filter: { property: "kind", op: "==", value: "a" },
        label: { property: "name", size: 12, halo: true },
      },
      "circle",
      { labelFont: FONT },
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      id: "pts",
      type: "heatmap",
      filter: compileFilter({ property: "kind", op: "==", value: "a" }),
      paint: { "heatmap-opacity": 0.6 },
    });
  });

  it("has no source options: only clusters change the source", () => {
    expect(compileSourceOptions({ points: "heatmap" }, "circle")).toEqual({});
    expect(compileSourceOptions({}, "circle")).toEqual({});
  });
});

describe("pointProblem", () => {
  it("is null for what the map can draw", () => {
    expect(pointProblem({}, "fill")).toBeNull();
    expect(pointProblem({ points: "points" }, "line")).toBeNull();
    expect(pointProblem({ points: "heatmap", size: SIZE }, "circle")).toBe(
      null,
    );
  });

  it("refuses clusters, heatmaps and sizes on lines and areas", () => {
    expect(pointProblem({ points: "clusters" }, "line")).toBe(
      "Only a point layer can show clusters or a heatmap.",
    );
    expect(pointProblem({ size: SIZE }, "fill")).toBe(
      "Only a point layer can size its points by a property.",
    );
  });

  it("refuses a display it does not know and a size it cannot draw", () => {
    expect(
      pointProblem({ points: "hexbins" as never }, "circle"),
    ).not.toBeNull();
    for (const size of [
      { ...SIZE, property: "" },
      { ...SIZE, min: 5, max: 5 },
      { ...SIZE, max: Number.NaN },
      { ...SIZE, minRadius: 0 },
      { ...SIZE, maxRadius: 500 },
      { ...SIZE, min: "1" as never },
    ]) {
      expect(pointProblem({ size }, "circle")).not.toBeNull();
    }
  });
});
