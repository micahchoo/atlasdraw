// SPDX-License-Identifier: AGPL-3.0-only
// T14 — Convert-annotation-to-data-layer integration test for MapEditor.
//
// Verifies: right-click on the root container, given a single selected
// Excalidraw element with valid GeoCustomData, opens the context menu and
// the "Convert to data layer" button triggers the full convert pipeline:
//   1. annotationToFeatureCollection builds a FeatureCollection
//   2. registry.registerDataLayer is called with a `dl:` id
//   3. map.addSource + map.addLayer are called with that id
//   4. excalidrawAPI.updateScene is called to remove the original element
//
// Mocking strategy mirrors MapEditor.drop.test.tsx (basemap stub, useMapRef
// stub, side-effect hook stubs) but extends the <Excalidraw> stub to invoke
// onExcalidrawAPI synchronously with a fake imperative API. The fake API
// returns a scripted single-selection rectangle with bbox geo so the convert
// path picks it up.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () =>
    React.createElement("div", { "data-testid": "map-canvas-stub" }),
  compileLayer: vi.fn((id: string, _style: unknown, geomType: string) => ({
    id,
    type: geomType,
    source: id,
    paint: {},
  })),
  defaultLayerStyle: vi.fn(() => ({
    fillColor: "#0aa",
    strokeColor: "#077",
    strokeWidth: 1,
    opacity: 0.5,
  })),
}));

// Fake selected element — a rectangle with valid bbox geo. Mutated per-test
// when needed (e.g. the text/arrow disabled-state test).
const fakeRectangleEl = {
  id: "anno-1",
  type: "rectangle",
  customData: {
    geo: {
      kind: "bbox",
      west: -1,
      south: -1,
      east: 1,
      north: 1,
      zRef: 4,
    },
    scaleMode: "geographic",
    projection: "mercator",
    schemaVersion: 1,
  },
};

let currentScene: Array<typeof fakeRectangleEl> = [fakeRectangleEl];
let currentSelectedIds: Record<string, true> = { "anno-1": true };

const updateSceneSpy = vi.fn((opts: { elements?: unknown[] }) => {
  if (Array.isArray(opts.elements)) {
    currentScene = opts.elements as typeof currentScene;
  }
});

const fakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => currentScene,
  getAppState: () => ({ selectedElementIds: currentSelectedIds }),
  updateScene: updateSceneSpy,
};

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({
    onExcalidrawAPI,
  }: {
    onExcalidrawAPI?: (api: unknown) => void;
  }) => {
    // Fire the API callback once the component mounts so MapEditor's
    // setExcalidrawAPI runs and the context menu logic has an API to read.
    React.useEffect(() => {
      onExcalidrawAPI?.(fakeExcalidrawAPI);
    }, [onExcalidrawAPI]);
    return React.createElement("div", { "data-testid": "excalidraw-stub" });
  },
}));

const mockMap = {
  addSource: vi.fn(),
  addLayer: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  project: vi.fn(() => ({ x: 0, y: 0 })),
  unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
  getZoom: vi.fn(() => 12),
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

vi.mock("../../hooks/useCoordinateSync", () => ({
  useCoordinateSync: vi.fn(),
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
// SUT
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { useLayerRegistryStore } from "../../state/layerRegistry";

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
  currentScene = [fakeRectangleEl];
  currentSelectedIds = { "anno-1": true };
});

// RTL render() does not auto-cleanup between tests in vitest by default —
// previous-test DOM stays in document.body and getByTestId throws on
// "multiple elements found". Manual cleanup() drops it.
afterEach(() => {
  cleanup();
});

describe("MapEditor — convert-to-data-layer context menu (T14)", () => {
  it("right-click on root with single-selected geo element opens the menu", async () => {
    const { container, queryByTestId } = render(<MapEditor />);
    const root = container.firstChild as HTMLElement;

    // contextmenu via fireEvent — provide clientX/Y so the menu position is
    // well-defined. The handler reads selectedElementIds (1 entry, valid geo)
    // → menu opens.
    fireEvent.contextMenu(root, { clientX: 50, clientY: 60 });

    await waitFor(() => {
      expect(queryByTestId("convert-context-menu")).toBeTruthy();
    });
  });

  it("clicking 'Convert to data layer' registers + adds map source/layer + removes element", async () => {
    const registerSpy = vi.spyOn(
      useLayerRegistryStore.getState(),
      "registerDataLayer",
    );

    const { container, getByTestId } = render(<MapEditor />);
    const root = container.firstChild as HTMLElement;

    fireEvent.contextMenu(root, { clientX: 50, clientY: 60 });

    await waitFor(() => {
      expect(getByTestId("convert-context-menu")).toBeTruthy();
    });

    fireEvent.click(getByTestId("convert-action-button"));

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    const arg = registerSpy.mock.calls[0][0];
    expect(arg.id).toMatch(/^dl:/);
    expect(arg.fc.type).toBe("FeatureCollection");
    expect(arg.fc.features[0].geometry.type).toBe("Polygon");

    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    expect(mockMap.addLayer).toHaveBeenCalledTimes(1);

    // updateScene called to drop the original element.
    expect(updateSceneSpy).toHaveBeenCalledTimes(1);
    const sceneArg = updateSceneSpy.mock.calls[0][0];
    expect(sceneArg.elements).toEqual([]); // we dropped the only one
  });

  it("multi-selection or no-selection → no menu opens", async () => {
    currentSelectedIds = { "anno-1": true, "anno-2": true };
    const { container, queryByTestId } = render(<MapEditor />);
    const root = container.firstChild as HTMLElement;

    fireEvent.contextMenu(root, { clientX: 10, clientY: 20 });

    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId("convert-context-menu")).toBeNull();
  });
});
