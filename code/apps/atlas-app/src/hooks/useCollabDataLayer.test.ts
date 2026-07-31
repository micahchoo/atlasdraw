// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for useCollabDataLayer — extracted from MapEditor.tsx
// (DEADWOOD.md god-module split, Cut 1). No test existed for this logic
// before extraction; it previously ran inline as two useEffects in MapEditor.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useCollabDataLayer } from "./useCollabDataLayer";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";

function makeMockMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const handlers = new Map<string, Set<() => void>>();
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => {
      sources.set(id, { setData: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    on: vi.fn((event: string, fn: () => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: () => void) => {
      handlers.get(event)?.delete(fn);
    }),
    /**
     * What `setStyle` actually does to the app's own layers: drops every custom
     * source and layer, then announces the new style. Modelled rather than
     * asserted-around, because the whole of FU-3 lives in what happens between
     * those two halves.
     */
    _swapStyle() {
      sources.clear();
      layers.clear();
      for (const fn of handlers.get("styledata") ?? []) {
        fn();
      }
    },
    _sources: sources,
    _layers: layers,
    _handlers: handlers,
  } as unknown as maplibregl.Map & {
    _swapStyle: () => void;
    _sources: Map<string, { setData: ReturnType<typeof vi.fn> }>;
    _layers: Set<string>;
    _handlers: Map<string, Set<() => void>>;
  };
}

/**
 * `makeMockMap` returns the value typed as a real `maplibregl.Map`, so the mock
 * methods lose their `vi.fn` surface at the type level. Reach it back for the
 * few places that need `mockClear` rather than widening the map's type and
 * making every other call site less honest about what it is talking to.
 */
function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

const POINT_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("useCollabDataLayer", () => {
  it("does nothing when map is null", () => {
    expect(() =>
      renderHook(() => useCollabDataLayer(null, POINT_FC)),
    ).not.toThrow();
  });

  it("does nothing when features is null (no map source created)", () => {
    const map = makeMockMap();
    renderHook(() => useCollabDataLayer(map, null));
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("adds a source + layer once features become available", () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ features }) => useCollabDataLayer(map, features),
      { initialProps: { features: null as FeatureCollection | null } },
    );
    expect(map.addSource).not.toHaveBeenCalled();

    rerender({ features: POINT_FC });
    expect(map.addSource).toHaveBeenCalledWith(
      "collab-data",
      expect.objectContaining({ type: "geojson", data: POINT_FC }),
    );
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it("does not re-add the source on a re-render with the same features", () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ features }) => useCollabDataLayer(map, features),
      { initialProps: { features: POINT_FC } },
    );
    expect(map.addSource).toHaveBeenCalledTimes(1);

    rerender({ features: POINT_FC });
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it("pushes updated features to the existing source via setData", () => {
    const map = makeMockMap();
    const updated: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: {},
        },
      ],
    };
    const { rerender } = renderHook(
      ({ features }) => useCollabDataLayer(map, features),
      { initialProps: { features: POINT_FC } },
    );
    const src = map._sources.get("collab-data");
    expect(src).toBeTruthy();

    rerender({ features: updated });
    expect(src?.setData).toHaveBeenCalledWith(updated);
  });

  it("removes the source + layer when features go from present to null", () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ features }) => useCollabDataLayer(map, features),
      { initialProps: { features: POINT_FC as FeatureCollection | null } },
    );
    expect(map._layers.has("collab-data")).toBe(true);

    rerender({ features: null });
    expect(map.removeLayer).toHaveBeenCalledWith("collab-data");
    expect(map.removeSource).toHaveBeenCalledWith("collab-data");
  });

  it("removes the source + layer on unmount", () => {
    const map = makeMockMap();
    const { unmount } = renderHook(() => useCollabDataLayer(map, POINT_FC));
    expect(map._layers.has("collab-data")).toBe(true);

    unmount();
    expect(map.removeLayer).toHaveBeenCalledWith("collab-data");
    expect(map.removeSource).toHaveBeenCalledWith("collab-data");
  });
});

// ---------------------------------------------------------------------------
// FU-3 — surviving a basemap switch.
//
// This layer is not in the LayerRegistry, so `reconcileDataLayers` — which puts
// every other custom layer back after setStyle drops it — never sees it. In a
// shared session that read as every collaborator's shapes vanishing off the
// map, with the document unchanged underneath.
// ---------------------------------------------------------------------------

describe("useCollabDataLayer — style swaps", () => {
  it("puts the layer back after a basemap switch", () => {
    const map = makeMockMap();
    renderHook(() => useCollabDataLayer(map, POINT_FC));
    expect(map._layers.has("collab-data")).toBe(true);

    map._swapStyle();

    expect(map._layers.has("collab-data")).toBe(true);
    expect(map._sources.has("collab-data")).toBe(true);
  });

  it("survives more than one switch — the listener is not one-shot", () => {
    const map = makeMockMap();
    renderHook(() => useCollabDataLayer(map, POINT_FC));

    map._swapStyle();
    map._swapStyle();
    map._swapStyle();

    expect(map._layers.has("collab-data")).toBe(true);
  });

  it("re-adds the CURRENT features, not the ones present at mount", () => {
    const map = makeMockMap();
    const updated: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [9, 9] },
          properties: {},
        },
      ],
    };
    const { rerender } = renderHook(
      ({ features }) => useCollabDataLayer(map, features),
      { initialProps: { features: POINT_FC as FeatureCollection } },
    );
    rerender({ features: updated });
    asMock(map.addSource).mockClear();

    map._swapStyle();

    expect(map.addSource).toHaveBeenCalledWith(
      "collab-data",
      expect.objectContaining({ data: updated }),
    );
  });

  it("stays away when collab is inactive", () => {
    const map = makeMockMap();
    renderHook(() => useCollabDataLayer(map, null));

    map._swapStyle();

    expect(map._layers.has("collab-data")).toBe(false);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("does not re-add on the styledata that its own addLayer fires", () => {
    // MapLibre fires styledata for ordinary addLayer/setPaintProperty calls too,
    // not just for setStyle. Without the existence check that is an infinite
    // add loop; with it, a styledata on an intact style is a no-op.
    const map = makeMockMap();
    renderHook(() => useCollabDataLayer(map, POINT_FC));
    asMock(map.addSource).mockClear();

    for (const fn of map._handlers.get("styledata") ?? []) {
      fn();
    }

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const map = makeMockMap();
    const { unmount } = renderHook(() => useCollabDataLayer(map, POINT_FC));
    expect(map._handlers.get("styledata")?.size).toBe(1);

    unmount();
    expect(map._handlers.get("styledata")?.size ?? 0).toBe(0);
  });
});
