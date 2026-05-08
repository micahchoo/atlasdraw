// SPDX-License-Identifier: AGPL-3.0-only
// W-C — Convert-to-data-layer right-click context-menu integration test.
//
// History: T14 surfaced Convert via a custom <div role="menu">; W-B
// pivoted it to a MainMenu.Item; W-C moves it to its proper home —
// the right-click element context menu — via the atlasdraw fork's
// new `excalidrawAPI.registerContextMenuItem` API
// (packages/excalidraw/components/App.tsx).
//
// We can't drive the real Excalidraw context-menu DOM in unit tests
// (the `<Excalidraw>` here is a stub). Instead we capture the item
// MapEditor passes to `registerContextMenuItem` and exercise it
// directly:
//   - assert the item registered with name === "atlasConvertToDataLayer".
//   - invoke `predicate(elements, appState)` with selection fixtures:
//       single geo polygon  → true
//       text selection      → false
//       multi-selection     → false
//   - invoke `perform(elements, appState)` with the polygon fixture and
//     assert the same downstream pipeline (registerDataLayer →
//     map.addSource/addLayer → updateScene) the W-B test exercised.
//   - assert the unregister fn returned by the API is invoked on unmount.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
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
  registerPmtilesProtocol: vi.fn(),
  getBasemap: vi.fn((id: string) =>
    ({ id, label: id, styleFile: `${id}.json`, requiresRemote: false }),
  ),
  buildStyle: vi.fn(() => Promise.resolve({ version: 8, sources: {}, layers: [] })),
  BASEMAPS: [
    { id: "protomaps-light", label: "Light", styleFile: "protomaps-light.json", requiresRemote: false },
    { id: "protomaps-dark", label: "Dark", styleFile: "protomaps-dark.json", requiresRemote: false },
    { id: "openfreemap-bright", label: "Bright", styleFile: "openfreemap-bright.json", requiresRemote: true },
  ],
}));

// Fake selected element — a rectangle with valid bbox geo. Mutated per-test.
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

// Captures the unregister fn the registerContextMenuItem call returns;
// also captures the registered item itself so tests can drive its
// predicate/perform directly without rendering the real ContextMenu.
const registerContextMenuItemUnregister = vi.fn();
const capturedContextMenuItems: Array<{
  name: string;
  label: string;
  predicate: (elements: unknown, appState: unknown) => boolean;
  perform: (elements: unknown, appState: unknown) => unknown;
}> = [];

const registerContextMenuItemSpy = vi.fn((item: {
  name: string;
  label: string;
  predicate: (elements: unknown, appState: unknown) => boolean;
  perform: (elements: unknown, appState: unknown) => unknown;
}) => {
  capturedContextMenuItems.push(item);
  return registerContextMenuItemUnregister;
});

// `mock` prefix lets these top-level consts survive Vitest's vi.mock hoisting.
const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => currentScene,
  getAppState: () => ({ selectedElementIds: currentSelectedIds }),
  updateScene: updateSceneSpy,
  toggleSidebar: vi.fn(),
  registerContextMenuItem: registerContextMenuItemSpy,
  // Sidebar-tab fork — MapEditor's layers-tab effect calls this on mount.
  registerSidebarTab: vi.fn(() => vi.fn()),
};

vi.mock("@excalidraw/excalidraw", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require("react") as typeof import("react");
  const MainMenuStub = Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      ReactInner.createElement(
        "div",
        { "data-testid": "main-menu-stub" },
        children,
      ),
    {
      Item: ({
        children,
        onSelect,
        ...rest
      }: {
        children?: React.ReactNode;
        onSelect?: (e: Event) => void;
      } & Record<string, unknown>) =>
        ReactInner.createElement(
          "button",
          {
            type: "button",
            ...rest,
            onClick: () => onSelect?.(new Event("select")),
          },
          children,
        ),
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
  );
  const SidebarStub = Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      ReactInner.createElement(
        "div",
        { "data-testid": "sidebar-stub" },
        children,
      ),
    {
      Header: ({ children }: { children?: React.ReactNode }) =>
        ReactInner.createElement(
          "div",
          { "data-testid": "sidebar-header-stub" },
          children,
        ),
    },
  );
  return {
    Excalidraw: ({
      onExcalidrawAPI,
      children,
    }: {
      onExcalidrawAPI?: (api: unknown) => void;
      children?: React.ReactNode;
    }) => {
      ReactInner.useEffect(() => {
        onExcalidrawAPI?.(mockFakeExcalidrawAPI);
      }, [onExcalidrawAPI]);
      return ReactInner.createElement(
        "div",
        { "data-testid": "excalidraw-stub" },
        children,
      );
    },
    MainMenu: MainMenuStub,
    Sidebar: SidebarStub,
    setExportElementTransformer: vi.fn(),
  };
});

const mockMap = {
  addSource: vi.fn(),
  addLayer: vi.fn(),
  setStyle: vi.fn(),
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
// SUT
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { useLayerRegistryStore } from "../../state/layerRegistry";

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
  currentScene = [fakeRectangleEl];
  currentSelectedIds = { "anno-1": true };
  capturedContextMenuItems.length = 0;
});

afterEach(() => {
  cleanup();
});

// Helper — wait for MapEditor's registration effect to fire and return
// the captured item. Throws (via waitFor) if not registered.
const awaitConvertItem = async () => {
  await waitFor(() => {
    expect(
      capturedContextMenuItems.find(
        (i) => i.name === "atlasConvertToDataLayer",
      ),
    ).toBeTruthy();
  });
  const item = capturedContextMenuItems.find(
    (i) => i.name === "atlasConvertToDataLayer",
  );
  if (!item) throw new Error("convert item not registered");
  return item;
};

describe("MapEditor — Convert context-menu item (W-C: registerContextMenuItem)", () => {
  it("registers the convert item with the expected name + label", async () => {
    render(<MapEditor />);
    const item = await awaitConvertItem();
    expect(item.name).toBe("atlasConvertToDataLayer");
    expect(item.label).toBe("Convert selection to data layer");
    expect(typeof item.predicate).toBe("function");
    expect(typeof item.perform).toBe("function");
  });

  it("predicate returns true for a single geo polygon selection", async () => {
    render(<MapEditor />);
    const item = await awaitConvertItem();
    const result = item.predicate([fakeRectangleEl], {
      selectedElementIds: { "anno-1": true },
    });
    expect(result).toBe(true);
  });

  it("predicate returns false for a text selection (non-convertible type)", async () => {
    render(<MapEditor />);
    const item = await awaitConvertItem();
    const textEl = { ...fakeRectangleEl, id: "anno-text", type: "text" };
    const result = item.predicate([textEl], {
      selectedElementIds: { "anno-text": true },
    });
    expect(result).toBe(false);
  });

  it("predicate returns true for a single geo arrow selection", async () => {
    render(<MapEditor />);
    const item = await awaitConvertItem();
    const arrowEl = { ...fakeRectangleEl, id: "anno-arrow", type: "arrow" };
    const result = item.predicate([arrowEl], {
      selectedElementIds: { "anno-arrow": true },
    });
    expect(result).toBe(true);
  });

  it("predicate returns false for multi-selection", async () => {
    render(<MapEditor />);
    const item = await awaitConvertItem();
    const result = item.predicate(
      [fakeRectangleEl, { ...fakeRectangleEl, id: "anno-2" }],
      { selectedElementIds: { "anno-1": true, "anno-2": true } },
    );
    expect(result).toBe(false);
  });

  it("perform with polygon selection runs the full convert pipeline", async () => {
    const registerSpy = vi.spyOn(
      useLayerRegistryStore.getState(),
      "registerDataLayer",
    );

    render(<MapEditor />);
    const item = await awaitConvertItem();

    // Wait for excalidrawAPI wiring to complete (handleConvert reads it).
    await waitFor(() => {
      expect(mockFakeExcalidrawAPI.getSceneElements()).toContain(
        fakeRectangleEl,
      );
    });

    // perform reads selection from currentConvertibleSelection, which
    // pulls from excalidrawAPI.getAppState/getSceneElements — so module-
    // level `currentSelectedIds` / `currentScene` drive the gate.
    const result = item.perform([fakeRectangleEl], {
      selectedElementIds: { "anno-1": true },
    });
    // perform returns false (handleConvert mutates the scene directly).
    expect(result).toBe(false);

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    const arg = registerSpy.mock.calls[0][0];
    expect(arg.id).toMatch(/^dl:/);
    expect(arg.fc.type).toBe("FeatureCollection");
    expect(arg.fc.features[0].geometry.type).toBe("Polygon");

    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    expect(mockMap.addLayer).toHaveBeenCalledTimes(1);

    expect(updateSceneSpy).toHaveBeenCalledTimes(1);
    const sceneArg = updateSceneSpy.mock.calls[0][0];
    expect(sceneArg.elements).toEqual([]);
  });

  it("unmount invokes the unregister fn returned by registerContextMenuItem", async () => {
    const { unmount } = render(<MapEditor />);
    await awaitConvertItem();
    expect(registerContextMenuItemUnregister).not.toHaveBeenCalled();
    unmount();
    expect(registerContextMenuItemUnregister).toHaveBeenCalled();
  });
});
