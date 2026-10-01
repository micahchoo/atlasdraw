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
import { getByTestId } from "@testing-library/dom";

// ---------------------------------------------------------------------------
// SUT import — must come AFTER vi.mock declarations.
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { ToastProvider } from "../ToastProvider";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

import type { DocumentCommand } from "../../state/document";

import type maplibregl from "maplibre-gl";

/** The command an import or a convert sends to the open document. */
type AddDataLayer = Extract<DocumentCommand, { type: "add-data-layer" }>;

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
}));

// Synthetic map instance shared by useMapRef stub + assertions.
const mapHandlers = new Map<string, Array<() => void>>();

function fireMapEvent(event: string): void {
  for (const handler of [...(mapHandlers.get(event) ?? [])]) {
    handler();
  }
}

const mockMap = {
  addSource: vi.fn(),
  addLayer: vi.fn(),
  setStyle: vi.fn(),
  // The real MapEditor renders other hooks (useCoordinateSync, useMapWheelRouter,
  // useGeoAnchor) that may probe `map.on / off / project / etc`. `on`/`off`
  // record into mapHandlers so a test can fire a map event.
  on: vi.fn((event: string, handler: () => void) => {
    const list = mapHandlers.get(event) ?? [];
    list.push(handler);
    mapHandlers.set(event, list);
  }),
  off: vi.fn((event: string, handler: () => void) => {
    const list = mapHandlers.get(event) ?? [];
    const i = list.indexOf(handler);
    if (i !== -1) {
      list.splice(i, 1);
    }
  }),
  project: vi.fn(() => ({ x: 0, y: 0 })),
  unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
  getZoom: vi.fn(() => 12),
  getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
  // RT-3 — useCameraRotation reads the live camera on mount, via
  // cameraRotation()'s north-up fast path. A map without it is not a map.
  getBearing: vi.fn(() => 0),
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
vi.mock("../../hooks/useMapOverlays", () => ({
  useMapOverlays: vi.fn(),
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
  mapHandlers.clear();
  openDocument(createDocument());
});

describe("MapEditor — GeoJSON drag-and-drop import (T13)", () => {
  it("parses dropped .geojson and registers a data layer", async () => {
    const registerSpy = vi.spyOn(currentDocument(), "dispatch");

    const { container } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    // The drop surface is the map-editor root (the Collar plate content),
    // not the outer CollarShell frame.
    const root = getByTestId(container, "map-editor-root");
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

    const callArg = registerSpy.mock.calls[0][0] as AddDataLayer;
    expect(callArg.id).toMatch(/^dl:/);
    expect(callArg.label).toBe("test.geojson");
    expect(callArg.fc.type).toBe("FeatureCollection");
    expect(callArg.fc.features).toHaveLength(1);
  });

  it("ignores non-.geojson files (no parse, no registry mutation)", async () => {
    const registerSpy = vi.spyOn(currentDocument(), "dispatch");

    const { container } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    const root = getByTestId(container, "map-editor-root");

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
  });

  it("parses a dropped .csv with lat/lng columns and registers a point layer", async () => {
    const registerSpy = vi.spyOn(currentDocument(), "dispatch");

    const { container } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    const root = getByTestId(container, "map-editor-root");

    const csv =
      "name,lat,lng\nCity Hall,37.7793,-122.4193\nFerry Building,37.7955,-122.3937\n";
    const csvFileLike = {
      name: "places.csv",
      type: "text/csv",
      text: () => Promise.resolve(csv),
    } as unknown as File;
    fireEvent.drop(root, { dataTransfer: { files: [csvFileLike] } });

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    const callArg = registerSpy.mock.calls[0][0] as AddDataLayer;
    expect(callArg.label).toBe("places.csv");
    expect(callArg.fc.features).toHaveLength(2);
    expect(callArg.fc.features[0].geometry.type).toBe("Point");

    // The coordinate columns become the geometry, not properties.
    expect(callArg.fc.features[0].properties).toEqual({ name: "City Hall" });
  });

  it("surfaces a toast (no layer) for an address-only .csv when no geocoder is configured", async () => {
    const registerSpy = vi.spyOn(currentDocument(), "dispatch");

    const { container, findByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    const root = getByTestId(container, "map-editor-root");

    const csv = "name,address\nCity Hall,1 Dr Carlton B Goodlett Pl\n";
    const csvFileLike = {
      name: "addresses.csv",
      type: "text/csv",
      text: () => Promise.resolve(csv),
    } as unknown as File;
    fireEvent.drop(root, { dataTransfer: { files: [csvFileLike] } });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/CSV import failed/);
    expect(toast.textContent).toMatch(/geocoder/);
    expect(registerSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A basemap swap applies the style, and the styledata that follows is safe.
// ---------------------------------------------------------------------------

describe("MapEditor — basemap swap", () => {
  it("applies the resolved style and survives the post-swap styledata event", async () => {
    render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(mockMap.setStyle).toHaveBeenCalledTimes(1);
    });

    expect(() => fireMapEvent("styledata")).not.toThrow();
  });
});
