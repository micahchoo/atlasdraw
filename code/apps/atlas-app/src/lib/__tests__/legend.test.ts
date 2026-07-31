// SPDX-License-Identifier: AGPL-3.0-only
// FU-13 — the export legend must describe the exported page, not the document.

import { describe, it, expect, vi } from "vitest";

import {
  buildLegendEntries,
  renderedDataLayerIds,
  visibleAnnotationIds,
} from "../legend";

import type { LayerRegistryEntry } from "../../state/layerRegistry";

function dataLayer(
  id: string,
  overrides: Partial<Extract<LayerRegistryEntry, { kind: "data" }>> = {},
): LayerRegistryEntry {
  return {
    kind: "data",
    id,
    label: id,
    visible: true,
    order: 0,
    featureCount: 1,
    style: { fillColor: "#0aa" },
    ...overrides,
  } as LayerRegistryEntry;
}

function annotation(
  id: string,
  overrides: Partial<Extract<LayerRegistryEntry, { kind: "annotation" }>> = {},
): LayerRegistryEntry {
  return {
    kind: "annotation",
    id,
    label: id,
    visible: true,
    order: 0,
    ...overrides,
  } as LayerRegistryEntry;
}

const APPSTATE = { scrollX: 0, scrollY: 0, zoom: { value: 1 } };

describe("renderedDataLayerIds", () => {
  it("keeps only layers with a feature painted in the current view", () => {
    const map = {
      queryRenderedFeatures: vi.fn(({ layers }: { layers: string[] }) =>
        layers[0] === "dl:in" ? [{}] : [],
      ),
    } as unknown as import("maplibre-gl").Map;

    expect(renderedDataLayerIds(map, ["dl:in", "dl:out"])).toEqual(
      new Set(["dl:in"]),
    );
  });

  it("asks per layer, so a stale id cannot blank the whole legend", () => {
    // Models MapLibre 4.7.1: an id absent from the style does not throw — it
    // fires an ErrorEvent and returns [] for the ENTIRE query. Batching all
    // ids into one call would therefore return nothing at all here.
    const map = {
      queryRenderedFeatures: vi.fn(({ layers }: { layers: string[] }) =>
        layers.includes("dl:gone") ? [] : [{}],
      ),
    } as unknown as import("maplibre-gl").Map;

    expect(renderedDataLayerIds(map, ["dl:a", "dl:gone", "dl:b"])).toEqual(
      new Set(["dl:a", "dl:b"]),
    );
    // One call per id is the mechanism, not an implementation detail: assert
    // it, or a future "optimisation" back to a single call passes this test
    // while reintroducing the blanking bug.
    expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(3);
  });

  it("survives a query that throws, for a future MapLibre that does", () => {
    const map = {
      queryRenderedFeatures: vi.fn(({ layers }: { layers: string[] }) => {
        if (layers[0] === "dl:gone") {
          throw new Error("Layer 'dl:gone' does not exist in the map's style");
        }
        return [{}];
      }),
    } as unknown as import("maplibre-gl").Map;

    expect(renderedDataLayerIds(map, ["dl:a", "dl:gone", "dl:b"])).toEqual(
      new Set(["dl:a", "dl:b"]),
    );
  });
});

describe("visibleAnnotationIds", () => {
  const inside = { id: "in", x: 10, y: 10, width: 50, height: 50 };
  const offRight = { id: "right", x: 900, y: 10, width: 20, height: 20 };
  const offTop = { id: "top", x: 10, y: -200, width: 20, height: 20 };
  const straddling = { id: "straddle", x: -10, y: 10, width: 40, height: 40 };

  it("keeps elements inside or straddling the frame, drops those outside", () => {
    const ids = visibleAnnotationIds(
      [inside, offRight, offTop, straddling],
      APPSTATE,
      800,
      600,
    );
    expect(ids).toEqual(new Set(["in", "straddle"]));
  });

  it("applies scroll and zoom, not raw scene coordinates", () => {
    // Scene x=900 is off-frame at scroll 0, but scrolling the canvas left by
    // 400 brings it to screen x=500 — inside an 800px frame.
    const ids = visibleAnnotationIds(
      [offRight],
      { scrollX: -400, scrollY: 0, zoom: { value: 1 } },
      800,
      600,
    );
    expect(ids).toEqual(new Set(["right"]));

    // At 0.5 zoom the same element lands at screen x=250, also inside.
    const zoomed = visibleAnnotationIds(
      [offRight],
      { scrollX: 0, scrollY: 0, zoom: { value: 0.5 } },
      800,
      600,
    );
    expect(zoomed).toEqual(new Set(["right"]));
  });

  it("ignores deleted elements", () => {
    const ids = visibleAnnotationIds(
      [{ ...inside, isDeleted: true }],
      APPSTATE,
      800,
      600,
    );
    expect(ids.size).toBe(0);
  });
});

describe("buildLegendEntries", () => {
  const ctx = {
    renderedDataLayerIds: new Set(["dl:painted"]),
    visibleAnnotationIds: new Set(["ann-in"]),
  };

  it("drops hidden layers even when they are in view", () => {
    const entries = buildLegendEntries(
      [dataLayer("dl:painted", { visible: false })],
      ctx,
    );
    expect(entries).toEqual([]);
  });

  it("drops visible layers that painted nothing in this view", () => {
    const entries = buildLegendEntries(
      [dataLayer("dl:painted"), dataLayer("dl:elsewhere")],
      ctx,
    );
    expect(entries.map((e) => e.id)).toEqual(["dl:painted"]);
  });

  it("drops annotations outside the exported frame", () => {
    const entries = buildLegendEntries(
      [annotation("ann-in"), annotation("ann-out")],
      ctx,
    );
    expect(entries.map((e) => e.id)).toEqual(["ann-in"]);
  });

  it("carries the data layer's fill colour and greys annotations", () => {
    const entries = buildLegendEntries(
      [
        dataLayer("dl:painted", { style: { fillColor: "#3a3" } }),
        annotation("ann-in"),
      ],
      ctx,
    );
    expect(entries).toEqual([
      { id: "dl:painted", name: "dl:painted", color: "#3a3" },
      { id: "ann-in", name: "ann-in", color: "#868e96" },
    ]);
  });

  it("falls back to the neutral swatch when a data layer has no fill", () => {
    const entries = buildLegendEntries(
      [dataLayer("dl:painted", { style: {} })],
      ctx,
    );
    expect(entries[0].color).toBe("#868e96");
  });
});
