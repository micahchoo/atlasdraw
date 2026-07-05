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
    _sources: sources,
    _layers: layers,
  } as unknown as maplibregl.Map & {
    _sources: Map<string, { setData: ReturnType<typeof vi.fn> }>;
    _layers: Set<string>;
  };
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
