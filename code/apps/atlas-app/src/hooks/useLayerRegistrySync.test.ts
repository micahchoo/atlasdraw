// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for useLayerRegistrySync, the bridge from the layer registry to MapLibre.
//
// We test the exported factory functions directly rather than driving the
// React hook — same approach as useGeoAnchor.test.ts and useAtlasdrawTool.test.ts.
// The one exception is the store→map subscriber at the bottom of this file: the
// bug it closes (a reorder that never reached MapLibre) lives in the wiring, not
// in any one factory, so it is only observable through the real hook.
//
// The map-writing side of this pair (addDataLayerToMap / applyVisibilityToMap /
// reconcileDataLayers / removeDataLayersFromMap / applyOrderToMap) is unit
// tested in lib/dataLayerRender.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useLayerRegistryStore } from "../state/layerRegistry";

import { createDocument, openDocument } from "../state/document";

import {
  applyStyleToMap,
  diffVisibility,
  diffStyles,
  diffDataLayerIds,
  useLayerRegistrySync,
  type MapPaintSurface,
} from "./useLayerRegistrySync";

import type { LayerRegistryEntry, LayerStyle } from "../state/layerRegistry";
import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
//
// Per project rule (.claude/rules/test-fixtures.md): if a test needs a
// different shape, construct a NEW fixture (never mutate to fix one test).

// ---------------------------------------------------------------------------
// diffVisibility — entry-flip detector used by the registry subscriber
// ---------------------------------------------------------------------------

describe("diffVisibility — registry entry visibility flips", () => {
  it("returns empty when nothing changed", () => {
    const a = rasterEntry("x", true);
    const b = rasterEntry("y", true);
    expect(diffVisibility([a, b], [a, b])).toEqual([]);
  });

  it("returns flipped entries only", () => {
    const flips = diffVisibility(
      [rasterEntry("x", true), rasterEntry("y", true)],
      [rasterEntry("x", false), rasterEntry("y", true)],
    );
    expect(flips).toHaveLength(1);
    expect(flips[0]).toMatchObject({ id: "x", visible: false });
  });

  it("ignores newly-added entries (no prior visibility to flip from)", () => {
    const flips = diffVisibility(
      [rasterEntry("x", true)],
      [rasterEntry("x", true), rasterEntry("y", true)],
    );
    expect(flips).toEqual([]);
  });

  it("ignores removed entries", () => {
    const flips = diffVisibility(
      [rasterEntry("x", true), rasterEntry("y", true)],
      [rasterEntry("x", true)],
    );
    expect(flips).toEqual([]);
  });

  it("detects multiple simultaneous flips", () => {
    const flips = diffVisibility(
      [rasterEntry("x", true), rasterEntry("y", false)],
      [rasterEntry("x", false), rasterEntry("y", true)],
    );
    expect(flips).toHaveLength(2);
    expect(flips.map((f) => f.id).sort()).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for the data-layer render tests (P1 + P2)
// ---------------------------------------------------------------------------

const POLY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { cat: "a" },
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

function rasterEntry(
  id: string,
  visible: boolean,
  order = 0,
): LayerRegistryEntry {
  return {
    kind: "raster",
    id,
    label: id,
    visible,
    order,
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    opacity: 1,
    imageKey: `${id}.png`,
  };
}

function dataEntry(
  id: string,
  style: LayerStyle,
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

// ---------------------------------------------------------------------------
// P1 — applyStyleToMap (MapLibre setPaintProperty)
// ---------------------------------------------------------------------------

describe("applyStyleToMap — MapLibre setPaintProperty (P1)", () => {
  function makePaintMap(impl?: (id: string, name: string, v: unknown) => void) {
    const setPaintProperty = vi.fn(impl ?? (() => {}));
    const map: MapPaintSurface = { setPaintProperty };
    return { map, setPaintProperty };
  }

  it("pushes only the paint property that actually changed", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(map, "dl:a", TEAL, { ...TEAL, fillColor: "#f00" }, "fill");
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", "#f00"],
    ]);
  });

  it("pushes nothing when the style is unchanged", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(map, "dl:a", TEAL, { ...TEAL }, "fill");
    expect(setPaintProperty).not.toHaveBeenCalled();
  });

  it("pushes every changed property in one patch", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, fillColor: "#f00", opacity: 0.9 },
      "fill",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", "#f00"],
      ["dl:a", "fill-opacity", 0.9],
    ]);
  });

  it("routes opacity + width onto the line geometry's own paint names", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, strokeWidth: 4, opacity: 0.25 },
      "line",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "line-width", 4],
      ["dl:a", "line-opacity", 0.25],
    ]);
  });

  it("routes fillColor onto circle-color for point layers", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, fillColor: "#123" },
      "circle",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "circle-color", "#123"],
    ]);
  });

  it("pushes a compiled data-driven expression on the primary color", () => {
    const { map, setPaintProperty } = makePaintMap();
    const next: LayerStyle = {
      ...TEAL,
      expression: {
        kind: "categorical",
        property: "cat",
        stops: [{ value: "a", color: "#111" }],
        fallback: "#999",
      },
    };
    applyStyleToMap(map, "dl:a", TEAL, next, "fill");
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", ["match", ["get", "cat"], "a", "#111", "#999"]],
    ]);
  });

  it("does not re-push a structurally identical expression", () => {
    const { map, setPaintProperty } = makePaintMap();
    const expression: LayerStyle["expression"] = {
      kind: "categorical",
      property: "cat",
      stops: [{ value: "a", color: "#111" }],
      fallback: "#999",
    };
    // Fresh object with the same shape — a re-render must not thrash the map.
    applyStyleToMap(
      map,
      "dl:a",
      { ...TEAL, expression },
      { ...TEAL, expression: { ...expression } },
      "fill",
    );
    expect(setPaintProperty).not.toHaveBeenCalled();
  });

  it("swallows errors when the layer doesn't exist (logs warn, no throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map } = makePaintMap(() => {
      throw new Error("Layer 'dl:missing' does not exist");
    });

    expect(() =>
      applyStyleToMap(
        map,
        "dl:missing",
        TEAL,
        { ...TEAL, fillColor: "#f00" },
        "fill",
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dl:missing");

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// P1 — diffStyles (entry-style change detector used by the subscriber)
// ---------------------------------------------------------------------------

describe("diffStyles — registry entry style changes (P1)", () => {
  it("returns empty when the style object is referentially identical", () => {
    const a = dataEntry("dl:a", TEAL);
    expect(diffStyles([a], [a])).toEqual([]);
  });

  it("reports the previous and next style for a changed entry", () => {
    const prevStyle = TEAL;
    const nextStyle = { ...TEAL, fillColor: "#f00" };
    const changes = diffStyles(
      [dataEntry("dl:a", prevStyle)],
      [dataEntry("dl:a", nextStyle)],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      id: "dl:a",
      prevStyle,
      nextStyle,
    });
  });

  it("ignores raster entries (no style field)", () => {
    const prev: LayerRegistryEntry[] = [rasterEntry("rl:x", true)];
    const next: LayerRegistryEntry[] = [
      { ...rasterEntry("rl:x", true), label: "renamed" },
    ];
    expect(diffStyles(prev, next)).toEqual([]);
  });

  it("ignores newly-added entries (their style is baked into addLayer)", () => {
    const changes = diffStyles([], [dataEntry("dl:a", TEAL)]);
    expect(changes).toEqual([]);
  });

  it("ignores label/visibility-only changes", () => {
    const changes = diffStyles(
      [dataEntry("dl:a", TEAL, true)],
      [dataEntry("dl:a", TEAL, false)],
    );
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diffDataLayerIds — membership + stacking detector used by the subscriber
// ---------------------------------------------------------------------------

describe("diffDataLayerIds — data-layer id set and sequence (P2/P3)", () => {
  it("reports nothing for identical snapshots", () => {
    const prev = [dataEntry("dl:a", TEAL, true, 0)];
    expect(diffDataLayerIds(prev, prev)).toEqual({
      added: [],
      removed: [],
      orderChanged: false,
    });
  });

  it("reports an added id", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL)],
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
      ),
    ).toEqual({ added: ["dl:b"], removed: [], orderChanged: false });
  });

  it("reports a removed id", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [dataEntry("dl:a", TEAL, true, 0)],
      ),
    ).toEqual({ added: [], removed: ["dl:b"], orderChanged: false });
  });

  it("detects a same-length swap", () => {
    // One entry out and one in leaves `entries.length` unchanged. A length
    // heuristic sees nothing, and the new layer never reaches the map.
    const prev: LayerRegistryEntry[] = [rasterEntry("rl:old", true)];
    const next: LayerRegistryEntry[] = [dataEntry("dl:new", TEAL, true, 0)];
    expect(prev.length).toBe(next.length);
    expect(diffDataLayerIds(prev, next)).toEqual({
      added: ["dl:new"],
      removed: [],
      orderChanged: false,
    });
  });

  it("detects a whole-document swap — hydrate()'s shape", () => {
    expect(
      diffDataLayerIds(
        [
          dataEntry("dl:old1", TEAL, true, 0),
          dataEntry("dl:old2", TEAL, true, 1),
        ],
        [
          dataEntry("dl:new1", TEAL, true, 0),
          dataEntry("dl:new2", TEAL, true, 1),
        ],
      ),
    ).toEqual({
      added: ["dl:new1", "dl:new2"],
      removed: ["dl:old1", "dl:old2"],
      orderChanged: false,
    });
  });

  it("reports a permutation as orderChanged", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [dataEntry("dl:b", TEAL, true, 0), dataEntry("dl:a", TEAL, true, 1)],
      ),
    ).toEqual({ added: [], removed: [], orderChanged: true });
  });

  it("ignores raster entries entirely", () => {
    const withRasters: LayerRegistryEntry[] = [
      rasterEntry("rl:a", true),
      dataEntry("dl:a", TEAL, true, 0),
    ];
    expect(diffDataLayerIds([dataEntry("dl:a", TEAL)], withRasters)).toEqual({
      added: [],
      removed: [],
      orderChanged: false,
    });
  });

  it("does not call an interleaved raster removal a reorder", () => {
    const prev: LayerRegistryEntry[] = [
      dataEntry("dl:a", TEAL, true, 0),
      rasterEntry("rl:a", true),
      dataEntry("dl:b", TEAL, true, 1),
    ];
    const next: LayerRegistryEntry[] = [
      dataEntry("dl:a", TEAL, true, 0),
      dataEntry("dl:b", TEAL, true, 1),
    ];
    expect(diffDataLayerIds(prev, next).orderChanged).toBe(false);
  });

  it("does not call a mid-array insertion a reorder of the survivors", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [
          dataEntry("dl:a", TEAL, true, 0),
          dataEntry("dl:mid", TEAL, true, 1),
          dataEntry("dl:b", TEAL, true, 2),
        ],
      ),
    ).toEqual({ added: ["dl:mid"], removed: [], orderChanged: false });
  });
});

// ---------------------------------------------------------------------------
// The store → map subscriber, through the real hook.
//
// The factories above are all pure; the bugs this section pins are in the
// wiring — a store mutation that never reaches MapLibre. Only the hook can show
// that, so this is the one place we mount it.
// ---------------------------------------------------------------------------

/** Stub map that models MapLibre's layer list well enough to assert z-order. */
function makeSubscriberStubMap() {
  const order: string[] = [];
  const sources = new Set<string>();
  const map = {
    addSource: vi.fn((id: string) => {
      sources.add(id);
    }),
    addLayer: vi.fn((spec: { id: string }) => {
      order.push(spec.id);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    removeLayer: vi.fn((id: string) => {
      const i = order.indexOf(id);
      if (i !== -1) {
        order.splice(i, 1);
      }
    }),
    getLayer: vi.fn((id: string) => (order.includes(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
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
  return {
    map: map as unknown as maplibregl.Map,
    raw: map,
    order: () => [...order],
  };
}

describe("useLayerRegistrySync — store → map subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openDocument(createDocument());
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function mountWith(map: maplibregl.Map) {
    return renderHook(() => useLayerRegistrySync(map));
  }

  it("reorder repaints — a permuted registry restacks the MapLibre style (P3)", () => {
    const { map, order } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });
    expect(order()).toEqual(["dl:a", "dl:b"]);

    // "Move dl:b up" in the panel — index 0 within the data-layer stack.
    useLayerRegistryStore.getState().reorder("dl:b", 0);

    expect(order()).toEqual(["dl:b", "dl:a"]);
  });

  it("removes the previous document's layers when the registry drops them (D)", () => {
    const { map, raw, order } = makeSubscriberStubMap();
    mountWith(map);
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:old",
      fc: POLY_FC,
      label: "old",
      style: TEAL,
    });
    expect(order()).toEqual(["dl:old"]);

    // What opening a file does: another document replaces this one.
    openDocument(
      createDocument({
        overlays: [dataEntry("dl:new", TEAL, true, 0)],
        featureCollections: { "dl:new": POINT_FC },
      }),
    );

    expect(raw.removeLayer).toHaveBeenCalledWith("dl:old");
    expect(raw.removeSource).toHaveBeenCalledWith("dl:old");
    expect(order()).toEqual(["dl:new"]);
  });

  it("removes a single deleted data layer from the style", () => {
    const { map, raw, order } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });

    useLayerRegistryStore.getState().remove("dl:a");

    expect(raw.removeLayer).toHaveBeenCalledWith("dl:a");
    expect(order()).toEqual(["dl:b"]);
  });

  it("issues no moveLayer for a plain visibility toggle", () => {
    const { map, raw } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });
    raw.moveLayer.mockClear();

    useLayerRegistryStore.getState().setVisibility("dl:a", false);

    expect(raw.setLayoutProperty).toHaveBeenCalledWith(
      "dl:a",
      "visibility",
      "none",
    );
    expect(raw.moveLayer).not.toHaveBeenCalled();
  });

  it("stops touching the map after unmount", () => {
    const { map, raw } = makeSubscriberStubMap();
    const { unmount } = mountWith(map);
    unmount();
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    expect(raw.addLayer).not.toHaveBeenCalled();
  });
});
