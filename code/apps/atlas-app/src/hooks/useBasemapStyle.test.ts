// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useBasemapStyle (ISSUES.md Issue 6 — coverage climb).
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useLayerRegistryStore } from "../state/layerRegistry";

import { useDataLayerFCStore } from "../state/useDataLayerFCStore";

import { useBasemapStyle } from "./useBasemapStyle";

import type maplibregl from "maplibre-gl";

import type { FeatureCollection } from "geojson";

const { registerPmtilesProtocolMock, resolveStyleMock, GatedErrorCtor } =
  vi.hoisted(() => {
    class GatedErrorCtor extends Error {
      basemapId: string;
      constructor(basemapId: string) {
        super(`Basemap ${basemapId} requires allow_remote=true`);
        this.name = "BasemapRemoteGatedError";
        this.basemapId = basemapId;
      }
    }
    return {
      registerPmtilesProtocolMock: vi.fn(),
      resolveStyleMock: vi.fn(),
      GatedErrorCtor,
    };
  });

vi.mock("@atlasdraw/basemap", () => ({
  registerPmtilesProtocol: registerPmtilesProtocolMock,
  resolveStyle: resolveStyleMock,
  BasemapRemoteGatedError: GatedErrorCtor,
}));

// The re-add itself is unit-tested in lib/dataLayerRender.test.ts; here we
// only assert the hook point — that a style swap schedules a reconcile.
const reconcileDataLayersMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/dataLayerRender", () => ({
  reconcileDataLayers: reconcileDataLayersMock,
}));

// Mirrors what six MapEditor tests do (MapEditor.drop.test.tsx:195 and
// siblings): mock the sync hook down to its hook export. useBasemapStyle used
// to import reconcileDataLayers from there, so under that mock it was
// `undefined` and the styledata listener threw. Keeping the mock here holds the
// module boundary honest — every assertion below passes with it in place.
vi.mock("./useLayerRegistrySync", () => ({
  useLayerRegistrySync: vi.fn(),
}));

const FAKE_STYLE = { version: 8, sources: {}, layers: [] };

type MockMap = maplibregl.Map & {
  setStyle: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  /** Fire every handler currently registered for `event`. */
  fire: (event: string) => void;
  /** How many handlers are live for `event` — leak detector. */
  listenerCount: (event: string) => number;
};

function makeMockMap(): MockMap {
  // Real MapLibre event semantics, minus the once-ness: `on` accumulates and
  // only `off` removes. That is what lets these tests see a leaked listener at
  // all — a stub with `once` semantics would hide the bug being fixed.
  const handlers = new Map<string, Array<() => void>>();
  const map = {
    setStyle: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return map;
    }),
    off: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      const i = list.indexOf(handler);
      if (i !== -1) {
        list.splice(i, 1);
      }
      return map;
    }),
    fire: (event: string) => {
      for (const h of [...(handlers.get(event) ?? [])]) {
        h();
      }
    },
    listenerCount: (event: string) => (handlers.get(event) ?? []).length,
  };
  return map as unknown as MockMap;
}

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

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
  useDataLayerFCStore.getState().clear();
  resolveStyleMock.mockResolvedValue(FAKE_STYLE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useBasemapStyle", () => {
  it("does nothing when map is null", () => {
    renderHook(() => useBasemapStyle(null, "protomaps-light", true));
    expect(registerPmtilesProtocolMock).not.toHaveBeenCalled();
    expect(resolveStyleMock).not.toHaveBeenCalled();
  });

  it("registers the pmtiles protocol and applies the resolved style", async () => {
    const map = makeMockMap();
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));
    expect(registerPmtilesProtocolMock).toHaveBeenCalledTimes(1);
    expect(resolveStyleMock).toHaveBeenCalledWith(
      "protomaps-light",
      expect.objectContaining({ allowRemote: true }),
    );
    expect(map.setStyle).toHaveBeenCalledWith(FAKE_STYLE);
  });

  it("passes allowRemote through to resolveStyle", async () => {
    const map = makeMockMap();
    renderHook(() => useBasemapStyle(map, "openfreemap-bright", false));
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalled());
    expect(resolveStyleMock).toHaveBeenCalledWith(
      "openfreemap-bright",
      expect.objectContaining({ allowRemote: false }),
    );
  });

  it("swallows BasemapRemoteGatedError with a console.warn, and does not call setStyle", async () => {
    const map = makeMockMap();
    resolveStyleMock.mockRejectedValue(
      new GatedErrorCtor("openfreemap-bright"),
    );
    renderHook(() => useBasemapStyle(map, "openfreemap-bright", false));

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("openfreemap-bright"),
    );
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("logs (not throws) unexpected resolveStyle failures instead of rejecting silently", async () => {
    const map = makeMockMap();
    resolveStyleMock.mockRejectedValue(new Error("network unreachable"));
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("protomaps-light"),
      expect.any(Error),
    );
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("re-applies when activeBasemapId changes", async () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ id }) => useBasemapStyle(map, id, true),
      { initialProps: { id: "protomaps-light" } },
    );
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalledTimes(1));

    rerender({ id: "protomaps-dark" });
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalledTimes(2));
    expect(resolveStyleMock).toHaveBeenLastCalledWith(
      "protomaps-dark",
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — setStyle() drops every custom source/layer; the registry survives.
// ---------------------------------------------------------------------------

describe("useBasemapStyle — data-layer re-add after a style swap (P2)", () => {
  it("reconciles the registry's data layers once the new style has loaded", async () => {
    const map = makeMockMap();
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a.geojson",
      style: { fillColor: "#f00" },
    });

    renderHook(() => useBasemapStyle(map, "protomaps-light", true));
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));

    // Not yet — the new style is still loading, addLayer would throw.
    expect(reconcileDataLayersMock).not.toHaveBeenCalled();
    expect(map.on).toHaveBeenCalledWith("styledata", expect.any(Function));

    map.fire("styledata");

    expect(reconcileDataLayersMock).toHaveBeenCalledTimes(1);
    const [passedMap, entries, fcs] = reconcileDataLayersMock.mock.calls[0];
    expect(passedMap).toBe(map);
    expect(entries).toEqual([
      expect.objectContaining({ id: "dl:a", style: { fillColor: "#f00" } }),
    ]);
    expect(fcs).toEqual({ "dl:a": POLY_FC });
  });

  it("does not schedule a reconcile when the style never applies", async () => {
    const map = makeMockMap();
    resolveStyleMock.mockRejectedValue(new Error("network unreachable"));
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    map.fire("styledata");
    expect(reconcileDataLayersMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C — styledata listener lifecycle. MapLibre fires `styledata` for every
// addLayer/setPaintProperty, so a listener that outlives its own swap gets
// consumed by an unrelated event and the swap it belonged to loses its layers.
// ---------------------------------------------------------------------------

describe("useBasemapStyle — styledata listener lifecycle", () => {
  it("removes the styledata listener on unmount", async () => {
    const map = makeMockMap();
    const { unmount } = renderHook(() =>
      useBasemapStyle(map, "protomaps-light", true),
    );
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));
    expect(map.listenerCount("styledata")).toBe(1);

    unmount();

    expect(map.listenerCount("styledata")).toBe(0);
    map.fire("styledata");
    expect(reconcileDataLayersMock).not.toHaveBeenCalled();
  });

  it("removes the listener after it has reconciled once", async () => {
    const map = makeMockMap();
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));

    // The reconcile's own addLayer calls make MapLibre fire styledata again.
    map.fire("styledata");
    map.fire("styledata");

    expect(reconcileDataLayersMock).toHaveBeenCalledTimes(1);
    expect(map.listenerCount("styledata")).toBe(0);
  });

  it("keeps exactly one listener across two switches in quick succession", async () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ id }) => useBasemapStyle(map, id, true),
      { initialProps: { id: "protomaps-light" } },
    );
    rerender({ id: "protomaps-dark" });
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));

    // Only the surviving switch applied, and only it holds a listener — two
    // stacked listeners would let the first styledata consume the wrong one and
    // leave the second swap's layers off the map.
    expect(map.listenerCount("styledata")).toBe(1);
    expect(resolveStyleMock).toHaveBeenLastCalledWith(
      "protomaps-dark",
      expect.anything(),
    );

    map.fire("styledata");
    expect(reconcileDataLayersMock).toHaveBeenCalledTimes(1);
  });

  it("does not apply a stale style when the basemap changed mid-resolve", async () => {
    const map = makeMockMap();
    let releaseFirst: (style: unknown) => void = () => {};
    resolveStyleMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const { rerender } = renderHook(
      ({ id }) => useBasemapStyle(map, id, true),
      { initialProps: { id: "protomaps-light" } },
    );
    rerender({ id: "protomaps-dark" });
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));

    // The abandoned switch finally resolves — it must not overwrite the style
    // the surviving switch already applied.
    releaseFirst({ version: 8, sources: {}, layers: [], stale: true });
    await Promise.resolve();
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(FAKE_STYLE);
  });

  it("still applies the style when listener registration throws", async () => {
    const map = makeMockMap();
    map.on.mockImplementationOnce(() => {
      throw new Error("map.on exploded");
    });
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    // Registration used to sit inside the same try as setStyle, so a throw here
    // aborted the whole basemap switch with only a console.error to show. The
    // reconcile is what's lost now, not the basemap.
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));
    expect(map.setStyle).toHaveBeenCalledWith(FAKE_STYLE);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reconcile"),
      expect.any(Error),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs a setStyle failure instead of rejecting silently", async () => {
    const map = makeMockMap();
    map.setStyle.mockImplementationOnce(() => {
      throw new Error("style is not valid");
    });
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("protomaps-light"),
      expect.any(Error),
    );
  });
});
