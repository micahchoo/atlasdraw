// SPDX-License-Identifier: AGPL-3.0-only
// T13 — GeoJSON drag-and-drop integration test for MapEditor.
//
// Verifies: dropping a .geojson File on the root container parses it,
// registers a data layer in the registry, and adds source+layer to the map.
//
// Mocking strategy: stub the heavy children (<MapCanvas>, <Excalidraw>) so
// we don't need a real WebGL context or Excalidraw mount. Stub useMapRef
// so a synthetic map instance is available immediately. Spy on the
// registry's `registerDataLayer` action via the real Zustand store.
//
// jsdom note (mx-8ec7b9): vitest env is "jsdom" (apps/atlas-app/vitest.config.ts).
// crypto.randomUUID is available on jsdom's globalThis.crypto in modern
// Node/jsdom; if it weren't, we'd polyfill in a setup file.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// SUT import — must come AFTER vi.mock declarations.
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { useLayerRegistryStore } from "../../state/layerRegistry";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Mocks — declared before the import of the SUT so vi.mock factories are
// hoisted by Vitest's module transformer.
// ---------------------------------------------------------------------------

// Stub <MapCanvas> + provide static-style helpers used by MapEditor's drop
// path. We avoid `importActual` here because `@atlasdraw/basemap` re-exports
// from a module that pulls in `maplibre-gl`, whose IIFE blows up under
// jsdom (no WebGL context). The drop test only needs:
//   - MapCanvas (rendered, not exercised)
//   - compileLayer (called → returns a LayerSpecification)
//   - defaultLayerStyle (called → returns a LayerStyle)
vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () =>
    React.createElement("div", { "data-testid": "map-canvas-stub" }),
  compileLayer: vi.fn((id: string, _style: unknown, geomType: string) => ({
    id,
    type: geomType, // "fill" | "line" | "circle"
    source: id,
    paint: {},
  })),
  defaultLayerStyle: vi.fn(() => ({
    fillColor: "#0aa",
    strokeColor: "#077",
    strokeWidth: 1,
    opacity: 0.5,
  })),
  registerPmtilesProtocol: vi.fn(),
  getBasemap: vi.fn((id: string) => ({
    id,
    label: id,
    styleFile: `${id}.json`,
    requiresRemote: false,
  })),
  buildStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BASEMAPS: [
    {
      id: "protomaps-light",
      label: "Light",
      styleFile: "protomaps-light.json",
      requiresRemote: false,
    },
    {
      id: "protomaps-dark",
      label: "Dark",
      styleFile: "protomaps-dark.json",
      requiresRemote: false,
    },
    {
      id: "openfreemap-bright",
      label: "Bright",
      styleFile: "openfreemap-bright.json",
      requiresRemote: true,
    },
  ],
  resolveStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error {
    constructor(public readonly basemapId: string) {
      super(`Basemap ${basemapId} requires allow_remote=true`);
      this.name = "BasemapRemoteGatedError";
    }
  },
}));

// Stub <Excalidraw> — renders children (LayerPanel + MainMenu items) but
// never wires the imperative API. MapEditor's drop handler doesn't touch
// excalidrawAPI, so leaving it null is fine. We must export MainMenu and
// Sidebar (consumed by W-B's MainMenu items + LayerPanel) as passthrough
// stubs or React throws "type is invalid" at mount.
vi.mock("@atlasdraw/excalidraw", () => ({
  Excalidraw: ({
    onExcalidrawAPI: _,
    children,
  }: {
    onExcalidrawAPI?: unknown;
    children?: React.ReactNode;
  }) =>
    React.createElement("div", { "data-testid": "excalidraw-stub" }, children),
  MainMenu: Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "main-menu-stub" }, children),
    {
      Item: ({
        children,
        onSelect: _onSelect,
        ...rest
      }: {
        children?: React.ReactNode;
        onSelect?: (e: Event) => void;
      } & Record<string, unknown>) =>
        React.createElement("button", { type: "button", ...rest }, children),
      Separator: () => null,
      DefaultItems: {
        LoadScene: () => null,
        SaveToActiveFile: () => null,
        Export: () => null,
        SaveAsImage: () => null,
        SearchMenu: () => null,
        Help: () => null,
        ClearCanvas: () => null,
        ChangeCanvasBackground: () => null,
        ToggleTheme: () => null,
      },
    },
  ),
  Sidebar: Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "sidebar-stub" }, children),
    {
      Header: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(
          "div",
          { "data-testid": "sidebar-header-stub" },
          children,
        ),
    },
  ),
  setExportElementTransformer: vi.fn(),
}));

// Synthetic map instance shared by useMapRef stub + assertions.
const mockMap = {
  addSource: vi.fn(),
  addLayer: vi.fn(),
  setStyle: vi.fn(),
  // The real MapEditor renders other hooks (useCoordinateSync, useMapWheelRouter,
  // useGeoAnchor) that may probe `map.on / off / project / etc`. Provide cheap
  // no-ops so they don't blow up on read.
  on: vi.fn(),
  off: vi.fn(),
  project: vi.fn(() => ({ x: 0, y: 0 })),
  unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
  getZoom: vi.fn(() => 12),
  getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
  getBounds: vi.fn(() => ({
    getNorth: () => 1,
    getSouth: () => 0,
    getEast: () => 1,
    getWest: () => 0,
  })),
} as unknown as maplibregl.Map;

vi.mock("../../hooks/useMapRef", () => ({
  useMapRef: () => ({
    mapRef: { current: mockMap },
    map: mockMap,
    onMapReady: vi.fn(),
  }),
}));

// Stub the side-effect hooks so they don't try to do real work in jsdom.
vi.mock("../../hooks/useCoordinateSync", () => ({
  useCoordinateSync: vi.fn(() => ({ syncNow: vi.fn() })),
}));
vi.mock("../../hooks/useMapWheelRouter", () => ({
  useMapWheelRouter: vi.fn(),
}));
vi.mock("../../hooks/useGeoAnchor", () => ({
  useGeoAnchor: vi.fn(),
}));
vi.mock("../../hooks/useLayerRegistrySync", () => ({
  useLayerRegistrySync: vi.fn(),
}));
vi.mock("../../hooks/useToolState", () => ({
  useToolState: () => ({ isDrawingMode: false }),
}));
vi.mock("../../hooks/useAtlasdrawTool", () => ({
  useAtlasdrawTool: () => ({
    activeAtlasTool: null,
    setActiveAtlasTool: vi.fn(),
    dispatchPointerDown: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validPolygonFc = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { name: "fixture-poly" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

beforeEach(() => {
  // Reset spies + store between tests so assertions are isolated.
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
});

describe("MapEditor — GeoJSON drag-and-drop import (T13)", () => {
  it("parses dropped .geojson and registers a data layer + map source/layer", async () => {
    const registerSpy = vi.spyOn(
      useLayerRegistryStore.getState(),
      "registerDataLayer",
    );

    const { container } = render(<MapEditor />);
    // Root div is the immediate child of the test container.
    const root = container.firstChild as HTMLElement;
    expect(root).toBeTruthy();

    // jsdom 22's File polyfill omits Blob.prototype.text(), so building a
    // real `new File(...)` here would make `parse(blob)` reject with
    // "blob.text is not a function". We construct a minimal file-like that
    // satisfies the MapEditor.handleDrop contract: { name, text() }. The
    // production code path uses the real browser File, which DOES have text().
    const text = JSON.stringify(validPolygonFc);
    const fileLike = {
      name: "test.geojson",
      type: "application/geo+json",
      text: () => Promise.resolve(text),
    } as unknown as File;

    // fireEvent.drop — pass dataTransfer.files via the init dict so React's
    // synthetic event reads the same shape as a real browser drop.
    fireEvent.drop(root, {
      dataTransfer: { files: [fileLike] },
    });

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    const callArg = registerSpy.mock.calls[0][0];
    expect(callArg.id).toMatch(/^dl:/);
    expect(callArg.label).toBe("test.geojson");
    expect(callArg.fc.type).toBe("FeatureCollection");
    expect(callArg.fc.features).toHaveLength(1);

    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    const [sourceId, sourceSpec] = (
      mockMap.addSource as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(sourceId).toBe(callArg.id);
    expect(sourceSpec).toMatchObject({ type: "geojson" });

    expect(mockMap.addLayer).toHaveBeenCalledTimes(1);
    const layerSpec = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(layerSpec.id).toBe(callArg.id);
    // Polygon → "fill" (see inferGeometryType in MapEditor.tsx).
    expect(layerSpec.type).toBe("fill");
  });

  it("ignores non-.geojson files (no parse, no registry mutation)", async () => {
    const registerSpy = vi.spyOn(
      useLayerRegistryStore.getState(),
      "registerDataLayer",
    );

    const { container } = render(<MapEditor />);
    const root = container.firstChild as HTMLElement;

    const txtFileLike = {
      name: "notes.txt",
      type: "text/plain",
      text: () => Promise.resolve("hello"),
    } as unknown as File;
    fireEvent.drop(root, { dataTransfer: { files: [txtFileLike] } });

    // Drop handler returns early before any await; give the microtask queue a tick
    // anyway to be safe.
    await new Promise((r) => setTimeout(r, 0));

    expect(registerSpy).not.toHaveBeenCalled();
    expect(mockMap.addSource).not.toHaveBeenCalled();
    expect(mockMap.addLayer).not.toHaveBeenCalled();
  });
});
