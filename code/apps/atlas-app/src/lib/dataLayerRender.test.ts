// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for dataLayerRender — every write the app makes to the `dl:` layers in
// a MapLibre style: add, visibility, remove, restack, and the whole-registry
// reconcile. The registry-snapshot diffs that decide *when* to call these live
// in hooks/useLayerRegistrySync.test.ts.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  addDataLayerToMap,
  addRasterLayerToMap,
  applyOrderToMap,
  applyVisibilityToMap,
  reconcileDataLayers,
  removeDataLayersFromMap,
  type DataLayerMapSurface,
  type DataLayerRemovalSurface,
  type MapLayoutSurface,
  type MapOrderSurface,
} from "./dataLayerRender";

import type {
  LayerRegistryEntry,
  LayerStyle,
  RasterCorners,
} from "../state/layerRegistry";
import type { FeatureCollection } from "geojson";

const POLY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

const LINE_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ],
};

const POINT_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [1, 2] },
    },
  ],
};

const TEAL: LayerStyle = {
  fillColor: "#0aa",
  strokeColor: "#077",
  strokeWidth: 1,
  opacity: 0.5,
};

function makeStubMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, { id: string; type: string }>();
  const raw = {
    addSource: vi.fn((id: string, spec: unknown) => {
      if (sources.has(id)) {
        throw new Error(`There is already a source with ID "${id}"`);
      }
      sources.set(id, spec);
    }),
    addLayer: vi.fn((spec: { id: string; type: string }) => {
      layers.set(spec.id, spec);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    setLayoutProperty: vi.fn(),
  };
  return { map: raw as unknown as DataLayerMapSurface, raw, sources, layers };
}

describe("addDataLayerToMap", () => {
  it("adds the geojson source and a geometry-matched layer", () => {
    const { map, raw, sources, layers } = makeStubMap();
    addDataLayerToMap(map, "dl:a", POLY_FC, TEAL);
    expect(raw.addSource).toHaveBeenCalledWith("dl:a", {
      type: "geojson",
      data: POLY_FC,
    });
    expect(sources.get("dl:a")).toEqual({ type: "geojson", data: POLY_FC });
    expect(layers.get("dl:a")).toMatchObject({
      id: "dl:a",
      type: "fill",
      source: "dl:a",
    });
  });

  it("infers a line layer for linestring features", () => {
    const { map, layers } = makeStubMap();
    addDataLayerToMap(map, "dl:l", LINE_FC, TEAL);
    expect(layers.get("dl:l")).toMatchObject({ type: "line" });
  });

  it("infers a circle layer for point features", () => {
    const { map, layers } = makeStubMap();
    addDataLayerToMap(map, "dl:p", POINT_FC, TEAL);
    expect(layers.get("dl:p")).toMatchObject({ type: "circle" });
  });

  it("bakes the given style into the layer's paint block", () => {
    const { map, layers } = makeStubMap();
    addDataLayerToMap(map, "dl:a", POLY_FC, { ...TEAL, fillColor: "#f00" });
    expect(layers.get("dl:a")).toMatchObject({
      paint: expect.objectContaining({ "fill-color": "#f00" }),
    });
  });

  it("rolls back the orphan source when addLayer throws, then rethrows", () => {
    const { map, raw, sources } = makeStubMap();
    raw.addLayer.mockImplementationOnce(() => {
      throw new Error("bad layer spec");
    });
    expect(() => addDataLayerToMap(map, "dl:a", POLY_FC, TEAL)).toThrow(
      "bad layer spec",
    );
    expect(raw.removeSource).toHaveBeenCalledWith("dl:a");
    expect(sources.has("dl:a")).toBe(false);
  });

  it("still rethrows the addLayer error when the rollback itself fails", () => {
    const { map, raw } = makeStubMap();
    raw.addLayer.mockImplementationOnce(() => {
      throw new Error("bad layer spec");
    });
    raw.removeSource.mockImplementationOnce(() => {
      throw new Error("removeSource exploded");
    });
    expect(() => addDataLayerToMap(map, "dl:a", POLY_FC, TEAL)).toThrow(
      "bad layer spec",
    );
  });
});

// ---------------------------------------------------------------------------
// Shared entry fixture for the reconcile / restack tests
// ---------------------------------------------------------------------------

function dataEntry(
  id: string,
  style: LayerStyle = TEAL,
  visible = true,
  order = 0,
): LayerRegistryEntry {
  return {
    kind: "data",
    id,
    label: id,
    visible,
    order,
    featureCount: 1,
    style,
  };
}

function annotationEntry(id: string, order = 0): LayerRegistryEntry {
  return { kind: "annotation", id, label: id, visible: true, order };
}

// ---------------------------------------------------------------------------
// applyVisibilityToMap — the data-layer half of a visibility toggle
// ---------------------------------------------------------------------------

describe("applyVisibilityToMap — MapLibre setLayoutProperty (Bug B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMap(impl?: (id: string, name: string, value: unknown) => void) {
    const setLayoutProperty = vi.fn(impl ?? (() => {}));
    const map: MapLayoutSurface = { setLayoutProperty };
    return { map, setLayoutProperty };
  }

  it("calls setLayoutProperty with 'none' when hidden", () => {
    const { map, setLayoutProperty } = makeMap();
    applyVisibilityToMap(map, "dl:foo", false);
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "dl:foo",
      "visibility",
      "none",
    );
  });

  it("calls setLayoutProperty with 'visible' when shown", () => {
    const { map, setLayoutProperty } = makeMap();
    applyVisibilityToMap(map, "dl:foo", true);
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "dl:foo",
      "visibility",
      "visible",
    );
  });

  it("swallows errors when the layer doesn't exist (logs warn, no throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map } = makeMap(() => {
      throw new Error("Layer 'dl:missing' does not exist");
    });

    expect(() => applyVisibilityToMap(map, "dl:missing", false)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dl:missing");

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// reconcileDataLayers — rebuild the registry's layers in a fresh style (P2)
// ---------------------------------------------------------------------------

/**
 * Stub MapLibre style store. `wipeStyle()` models what `map.setStyle()` does to
 * custom sources/layers: it drops all of them while the registry survives.
 */
function makeStyleStubMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<
    string,
    { id: string; type: string; paint?: unknown }
  >();
  const map = {
    addSource: vi.fn((id: string, spec: unknown) => {
      if (sources.has(id)) {
        throw new Error(`There is already a source with ID "${id}"`);
      }
      sources.set(id, spec);
    }),
    addLayer: vi.fn((spec: { id: string; type: string; paint?: unknown }) => {
      layers.set(spec.id, spec);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    setLayoutProperty: vi.fn(),
  };
  return {
    map: map as unknown as DataLayerMapSurface,
    raw: map,
    sources,
    layers,
    wipeStyle: () => {
      sources.clear();
      layers.clear();
    },
  };
}

describe("reconcileDataLayers — re-add after setStyle/reload (P2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-adds every data layer with its source and CURRENT style after a style swap", () => {
    const { map, raw, sources, layers, wipeStyle } = makeStyleStubMap();
    const red: LayerStyle = { ...TEAL, fillColor: "#f00" };
    const entries = [dataEntry("dl:a", red, true, 0)];
    const fcs = { "dl:a": POLY_FC };

    // First render — layer is on the map.
    reconcileDataLayers(map, entries, fcs);
    expect(layers.has("dl:a")).toBe(true);

    // A basemap switch calls setStyle(), which drops custom sources/layers.
    wipeStyle();
    raw.addSource.mockClear();
    raw.addLayer.mockClear();

    reconcileDataLayers(map, entries, fcs);

    expect(raw.addSource).toHaveBeenCalledWith("dl:a", {
      type: "geojson",
      data: POLY_FC,
    });
    expect(sources.has("dl:a")).toBe(true);
    expect(layers.get("dl:a")).toMatchObject({
      type: "fill",
      paint: expect.objectContaining({ "fill-color": "#f00" }),
    });
  });

  it("preserves registry order when re-adding multiple layers", () => {
    const { map, raw } = makeStyleStubMap();
    reconcileDataLayers(
      map,
      [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
      { "dl:a": POLY_FC, "dl:b": POINT_FC },
    );
    expect(raw.addLayer.mock.calls.map((c) => c[0].id)).toEqual([
      "dl:a",
      "dl:b",
    ]);
  });

  it("re-applies hidden visibility on a re-added layer", () => {
    const { map, raw } = makeStyleStubMap();
    reconcileDataLayers(map, [dataEntry("dl:a", TEAL, false)], {
      "dl:a": POLY_FC,
    });
    expect(raw.setLayoutProperty).toHaveBeenCalledWith(
      "dl:a",
      "visibility",
      "none",
    );
  });

  it("leaves a visible re-added layer's visibility untouched", () => {
    const { map, raw } = makeStyleStubMap();
    reconcileDataLayers(map, [dataEntry("dl:a", TEAL, true)], {
      "dl:a": POLY_FC,
    });
    expect(raw.setLayoutProperty).not.toHaveBeenCalled();
  });

  it("is idempotent — a layer already on the map is skipped", () => {
    const { map, raw } = makeStyleStubMap();
    const entries = [dataEntry("dl:a", TEAL)];
    const fcs = { "dl:a": POLY_FC };
    reconcileDataLayers(map, entries, fcs);
    raw.addSource.mockClear();
    raw.addLayer.mockClear();
    reconcileDataLayers(map, entries, fcs);
    expect(raw.addSource).not.toHaveBeenCalled();
    expect(raw.addLayer).not.toHaveBeenCalled();
  });

  it("ignores annotation entries", () => {
    const { map, raw } = makeStyleStubMap();
    reconcileDataLayers(
      map,
      [{ kind: "annotation", id: "x", label: "x", visible: true, order: 0 }],
      {},
    );
    expect(raw.addSource).not.toHaveBeenCalled();
  });

  it("warns and continues when the FC mirror has no geometry for an entry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, raw } = makeStyleStubMap();
    reconcileDataLayers(
      map,
      [dataEntry("dl:gone", TEAL, true, 0), dataEntry("dl:ok", TEAL, true, 1)],
      { "dl:ok": POLY_FC },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe("dl:gone");
    // The healthy layer still lands.
    expect(raw.addLayer).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns and continues when MapLibre rejects one layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, raw } = makeStyleStubMap();
    raw.addLayer.mockImplementationOnce(() => {
      throw new Error("Style is not done loading");
    });
    expect(() =>
      reconcileDataLayers(
        map,
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        { "dl:a": POLY_FC, "dl:b": POINT_FC },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(raw.addLayer).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// removeDataLayersFromMap — the missing half of reconcile (P2)
// ---------------------------------------------------------------------------

function makeRemovalStubMap(present: string[]) {
  const layers = new Set(present);
  const sources = new Set(present);
  const calls: string[] = [];
  const map = {
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    removeLayer: vi.fn((id: string) => {
      calls.push(`removeLayer:${id}`);
      layers.delete(id);
    }),
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    removeSource: vi.fn((id: string) => {
      calls.push(`removeSource:${id}`);
      sources.delete(id);
    }),
  };
  return {
    map: map as DataLayerRemovalSurface,
    raw: map,
    layers,
    sources,
    calls,
  };
}

describe("removeDataLayersFromMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the layer before its source", () => {
    const { map, calls } = makeRemovalStubMap(["dl:a"]);
    removeDataLayersFromMap(map, ["dl:a"]);
    expect(calls).toEqual(["removeLayer:dl:a", "removeSource:dl:a"]);
  });

  it("drops every id it is given", () => {
    const { map, layers, sources } = makeRemovalStubMap(["dl:a", "dl:b"]);
    removeDataLayersFromMap(map, ["dl:a", "dl:b"]);
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it("leaves ids it was not given alone", () => {
    const { map, layers } = makeRemovalStubMap(["dl:a", "dl:keep"]);
    removeDataLayersFromMap(map, ["dl:a"]);
    expect(layers.has("dl:keep")).toBe(true);
  });

  it("skips an id that is not in the style at all", () => {
    const { map, raw } = makeRemovalStubMap([]);
    removeDataLayersFromMap(map, ["dl:gone"]);
    expect(raw.removeLayer).not.toHaveBeenCalled();
    expect(raw.removeSource).not.toHaveBeenCalled();
  });

  it("warns and continues when MapLibre rejects one removal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, raw } = makeRemovalStubMap(["dl:bad", "dl:ok"]);
    raw.removeLayer.mockImplementationOnce(() => {
      throw new Error("Layer 'dl:bad' does not exist");
    });
    expect(() =>
      removeDataLayersFromMap(map, ["dl:bad", "dl:ok"]),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dl:bad");
    expect(raw.removeLayer).toHaveBeenCalledWith("dl:ok");
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// applyOrderToMap — registry array order → MapLibre z-order (P3)
// ---------------------------------------------------------------------------

/**
 * Stub that models MapLibre's layer list, so these tests can assert the
 * resulting *order* rather than a sequence of moveLayer calls — the order is
 * the behaviour under test; the call sequence is an implementation detail.
 */
function makeOrderStubMap(initial: string[]) {
  const order = [...initial];
  const map = {
    getLayersOrder: vi.fn(() => [...order]),
    moveLayer: vi.fn((id: string, beforeId?: string) => {
      const from = order.indexOf(id);
      if (from === -1) {
        throw new Error(`The layer '${id}' does not exist in the map's style`);
      }
      order.splice(from, 1);
      if (beforeId === undefined) {
        order.push(id);
        return;
      }
      const at = order.indexOf(beforeId);
      if (at === -1) {
        throw new Error(
          `The layer '${beforeId}' does not exist in the map's style`,
        );
      }
      order.splice(at, 0, id);
    }),
  };
  return { map: map as MapOrderSurface, raw: map, order: () => [...order] };
}

describe("applyOrderToMap — registry order → MapLibre z-order (P3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restacks the style to match registry array order", () => {
    const { map, order } = makeOrderStubMap([
      "basemap-fill",
      "dl:a",
      "dl:b",
      "dl:c",
    ]);
    applyOrderToMap(map, [
      dataEntry("dl:c", TEAL, true, 0),
      dataEntry("dl:a", TEAL, true, 1),
      dataEntry("dl:b", TEAL, true, 2),
    ]);
    expect(order()).toEqual(["basemap-fill", "dl:c", "dl:a", "dl:b"]);
  });

  it("handles a full reversal", () => {
    const { map, order } = makeOrderStubMap(["dl:a", "dl:b", "dl:c"]);
    applyOrderToMap(map, [
      dataEntry("dl:c"),
      dataEntry("dl:b"),
      dataEntry("dl:a"),
    ]);
    expect(order()).toEqual(["dl:c", "dl:b", "dl:a"]);
  });

  it("issues no moveLayer at all when the style already agrees", () => {
    const { map, raw } = makeOrderStubMap(["basemap-fill", "dl:a", "dl:b"]);
    applyOrderToMap(map, [dataEntry("dl:a"), dataEntry("dl:b")]);
    expect(raw.moveLayer).not.toHaveBeenCalled();
  });

  it("leaves non-registry layers above and below the stack where they are", () => {
    const { map, order } = makeOrderStubMap([
      "basemap-fill",
      "dl:a",
      "dl:b",
      "collab-data",
    ]);
    applyOrderToMap(map, [dataEntry("dl:b"), dataEntry("dl:a")]);
    expect(order()).toEqual(["basemap-fill", "dl:b", "dl:a", "collab-data"]);
  });

  it("never passes an annotation id to moveLayer", () => {
    // Annotation entries are Excalidraw elements, not MapLibre layers — the
    // stub throws for an unknown id, which is what MapLibre does.
    const { map, raw, order } = makeOrderStubMap(["dl:a", "dl:b"]);
    applyOrderToMap(map, [
      annotationEntry("elem-1", 0),
      dataEntry("dl:b", TEAL, true, 0),
      annotationEntry("elem-2", 1),
      dataEntry("dl:a", TEAL, true, 1),
    ]);
    expect(order()).toEqual(["dl:b", "dl:a"]);
    for (const [id, beforeId] of raw.moveLayer.mock.calls) {
      expect(id.startsWith("dl:")).toBe(true);
      expect(beforeId === undefined || beforeId.startsWith("dl:")).toBe(true);
    }
  });

  it("orders the layers that are present when a registry id is missing from the style", () => {
    const { map, order } = makeOrderStubMap(["dl:a", "dl:b"]);
    applyOrderToMap(map, [
      dataEntry("dl:b", TEAL, true, 0),
      dataEntry("dl:gone", TEAL, true, 1),
      dataEntry("dl:a", TEAL, true, 2),
    ]);
    expect(order()).toEqual(["dl:b", "dl:a"]);
  });

  it("does nothing with fewer than two data layers", () => {
    const { map, raw } = makeOrderStubMap(["dl:a"]);
    applyOrderToMap(map, [dataEntry("dl:a"), annotationEntry("elem-1")]);
    expect(raw.moveLayer).not.toHaveBeenCalled();
    expect(raw.getLayersOrder).not.toHaveBeenCalled();
  });

  it("warns and continues when MapLibre rejects one move", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, raw } = makeOrderStubMap(["dl:a", "dl:b", "dl:c"]);
    raw.moveLayer.mockImplementationOnce(() => {
      throw new Error("Style is not done loading");
    });
    expect(() =>
      applyOrderToMap(map, [
        dataEntry("dl:c"),
        dataEntry("dl:b"),
        dataEntry("dl:a"),
      ]),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(raw.moveLayer).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("warns and gives up when the style can't be read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, raw } = makeOrderStubMap(["dl:a", "dl:b"]);
    raw.getLayersOrder.mockImplementationOnce(() => {
      throw new Error("style is not loaded");
    });
    expect(() =>
      applyOrderToMap(map, [dataEntry("dl:b"), dataEntry("dl:a")]),
    ).not.toThrow();
    expect(raw.moveLayer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// FU-1 — rasters.
//
// Three claims, and the second is the one that would go wrong quietly:
// a raster renders at all; a raster survives a basemap switch; and a raster
// never sits above a vector layer no matter what order the registry is in.
// ---------------------------------------------------------------------------

const CORNERS: RasterCorners = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

function rasterEntry(
  id: string,
  visible = true,
  opacity = 1,
  order = 0,
): LayerRegistryEntry {
  return {
    kind: "raster",
    id,
    label: id,
    visible,
    order,
    corners: CORNERS,
    opacity,
    imageKey: `${id}.png`,
  };
}

describe("addRasterLayerToMap", () => {
  it("adds an image source with the four corners and a raster layer", () => {
    const { map, sources, layers } = makeStubMap();
    addRasterLayerToMap(map, "rl:a", "blob:x", CORNERS, 0.6);

    expect(sources.get("rl:a")).toEqual({
      type: "image",
      url: "blob:x",
      coordinates: CORNERS,
    });
    expect(layers.get("rl:a")).toMatchObject({
      id: "rl:a",
      type: "raster",
      source: "rl:a",
      // Carried at add time, not applied afterwards: a raster that flashes in
      // at full strength and then fades is worse than one that arrives right.
      paint: { "raster-opacity": 0.6 },
    });
  });

  it("rolls the source back when addLayer rejects", () => {
    const { map, raw, sources } = makeStubMap();
    raw.addLayer.mockImplementationOnce(() => {
      throw new Error("layer rejected");
    });

    expect(() =>
      addRasterLayerToMap(map, "rl:a", "blob:x", CORNERS, 1),
    ).toThrow(/layer rejected/);
    // Without the rollback the orphan source makes the NEXT attempt fail with
    // "there is already a source with ID", so one bad add poisons every retry.
    expect(sources.has("rl:a")).toBe(false);
  });
});

describe("reconcileDataLayers — rasters (FU-1)", () => {
  it("puts a raster back after a style swap dropped it", () => {
    const { map, layers } = makeStubMap();
    reconcileDataLayers(map, [rasterEntry("rl:a")], {}, { "rl:a": "blob:x" });

    // The FU-3 failure by another door: without this a basemap switch leaves
    // the row in the panel and the sheet off the map.
    expect(layers.get("rl:a")).toMatchObject({ type: "raster" });
  });

  it("skips a raster with no decoded image rather than adding a blank layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, layers } = makeStubMap();

    reconcileDataLayers(map, [rasterEntry("rl:a")], {}, {});

    expect(layers.has("rl:a")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("re-hides a raster that was hidden before the swap", () => {
    const { map, raw } = makeStubMap();
    reconcileDataLayers(
      map,
      [rasterEntry("rl:a", false)],
      {},
      { "rl:a": "blob:x" },
    );

    expect(raw.setLayoutProperty).toHaveBeenCalledWith(
      "rl:a",
      "visibility",
      "none",
    );
  });

  it("rebuilds rasters below data layers, whatever order the registry is in", () => {
    const { map, raw } = makeStubMap();
    // Registry lists the data layer FIRST — if reconcile just walked the array
    // the raster would land on top of it and hide it.
    reconcileDataLayers(
      map,
      [dataEntry("dl:a"), rasterEntry("rl:a")],
      { "dl:a": POLY_FC },
      { "rl:a": "blob:x" },
    );

    const added = raw.addLayer.mock.calls.map((c) => c[0].id);
    expect(added).toEqual(["rl:a", "dl:a"]);
  });

  it("leaves the existing callers' three-argument form working", () => {
    // rasterUrls is optional so the callers with no rasters in scope are not
    // made to pass `{}` to say they have none.
    const { map, layers } = makeStubMap();
    expect(() =>
      reconcileDataLayers(map, [dataEntry("dl:a")], { "dl:a": POLY_FC }),
    ).not.toThrow();
    expect(layers.has("dl:a")).toBe(true);
  });
});

describe("applyOrderToMap — rasters stay under the vector band (FU-1)", () => {
  it("pushes a raster below the data layers even when the style has it on top", () => {
    const { map, order } = makeOrderStubMap(["basemap-fill", "dl:a", "rl:a"]);

    applyOrderToMap(map, [rasterEntry("rl:a"), dataEntry("dl:a")]);

    expect(order()).toEqual(["basemap-fill", "rl:a", "dl:a"]);
  });

  it("keeps rasters below even when the registry lists them last", () => {
    // The rule is not "whatever order the array is in". A raster that can be
    // dragged above an annotation or a data layer is a way to lose work
    // without deleting anything.
    const { map, order } = makeOrderStubMap(["rl:a", "dl:a", "rl:b"]);

    applyOrderToMap(map, [
      dataEntry("dl:a"),
      rasterEntry("rl:a"),
      rasterEntry("rl:b"),
    ]);

    expect(order()).toEqual(["rl:a", "rl:b", "dl:a"]);
  });

  it("still orders two rasters relative to each other", () => {
    const { map, order } = makeOrderStubMap(["rl:a", "rl:b"]);
    applyOrderToMap(map, [rasterEntry("rl:b"), rasterEntry("rl:a")]);
    expect(order()).toEqual(["rl:b", "rl:a"]);
  });
});
