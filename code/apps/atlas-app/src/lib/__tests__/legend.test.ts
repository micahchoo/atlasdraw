// SPDX-License-Identifier: AGPL-3.0-only
// FU-13 — the export legend must describe the exported page, not the document.

import { describe, it, expect, vi } from "vitest";

import {
  buildLegendEntries,
  renderedDataLayerIds,
  visibleAnnotationIds,
  type LegendSource,
  visibleRasterIds,
} from "../legend";

import type { OverlayEntry } from "../../state/document";

function dataLayer(
  id: string,
  overrides: Partial<Extract<OverlayEntry, { kind: "data" }>> = {},
): OverlayEntry {
  return {
    kind: "data",
    id,
    label: id,
    visible: true,
    order: 0,
    featureCount: 1,
    geometryKind: "fill",
    style: { fillColor: "#0aa" },
    ...overrides,
  } as OverlayEntry;
}

function annotation(id: string): LegendSource {
  return {
    kind: "annotation",
    id,
    label: id,
    visible: true,
    renamedByUser: false,
    order: 0,
  };
}

function raster(
  id: string,
  overrides: Partial<Extract<OverlayEntry, { kind: "raster" }>> = {},
): OverlayEntry {
  return {
    kind: "raster",
    id,
    label: id,
    visible: true,
    order: 0,
    // A 1° square with its top-left at (0°, 1°N).
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    opacity: 1,
    imageKey: "k",
    ...overrides,
  } as OverlayEntry;
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

describe("visibleRasterIds", () => {
  // 100 screen px per degree, lng right and lat up, origin at (0°, 0°) + offset.
  const project =
    (offsetX: number, offsetY: number) =>
    ([lng, lat]: [number, number]) => ({
      x: offsetX + lng * 100,
      y: offsetY - lat * 100,
    });

  it("keeps a raster whose corners overlap the frame, drops one beside it", () => {
    const entries = [raster("rl:in"), raster("rl:hidden", { visible: false })];
    // The square spans x 50..150, y 100..200 in an 800 × 600 frame.
    expect(visibleRasterIds(entries, project(50, 200), 800, 600)).toEqual(
      new Set(["rl:in", "rl:hidden"]),
    );
    // Moved to x 900..1000: wholly right of the frame.
    expect(visibleRasterIds(entries, project(900, 200), 800, 600)).toEqual(
      new Set(),
    );
  });

  it("keeps a raster that covers the whole frame", () => {
    const big = raster("rl:big", {
      corners: [
        [-10, 10],
        [10, 10],
        [10, -10],
        [-10, -10],
      ],
    });
    expect(visibleRasterIds([big], project(400, 300), 800, 600)).toEqual(
      new Set(["rl:big"]),
    );
  });
});

describe("buildLegendEntries", () => {
  it("draws a line layer's swatch in its stroke colour, the colour on the map", () => {
    const entries = buildLegendEntries(
      [
        dataLayer("dl:roads", {
          geometryKind: "line",
          style: { fillColor: "#0aa", strokeColor: "#c00" },
        }),
        dataLayer("dl:parcels", {
          style: { fillColor: "#0aa", strokeColor: "#c00" },
        }),
      ],
      {
        renderedDataLayerIds: new Set(["dl:roads", "dl:parcels"]),
        visibleAnnotationIds: new Set(),
        visibleRasterIds: new Set(),
      },
    );
    expect(entries.map((e) => [e.id, e.color])).toEqual([
      ["dl:roads", "#c00"],
      ["dl:parcels", "#0aa"],
    ]);
  });

  const ctx = {
    renderedDataLayerIds: new Set(["dl:painted"]),
    visibleAnnotationIds: new Set(["ann-in"]),
    visibleRasterIds: new Set(["rl:in"]),
  };

  it("never lists a tile layer: it is a backdrop, credited in the attribution", () => {
    const entries = buildLegendEntries(
      [
        {
          kind: "tile",
          id: "tl:aerial",
          label: "Aerial",
          visible: true,
          order: 0,
          opacity: 1,
          url: "https://t.example.org/{z}/{x}/{y}.png",
        },
        dataLayer("dl:painted"),
      ],
      {
        ...ctx,
        // Even an id that some other set holds by mistake.
        visibleAnnotationIds: new Set(["tl:aerial"]),
      },
    );
    expect(entries.map((e) => e.id)).toEqual(["dl:painted"]);
  });

  it("lists a visible raster in view and drops one out of view", () => {
    const entries = buildLegendEntries(
      [raster("rl:in"), raster("rl:out")],
      ctx,
    );
    expect(entries.map((e) => e.id)).toEqual(["rl:in"]);
  });

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
