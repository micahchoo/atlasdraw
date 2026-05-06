// SPDX-License-Identifier: AGPL-3.0-only
// W-B — MainMenu "Layers panel" item wiring test for MapEditor.
//
// Replaces the T22 free-floating Layers button test. The button is now a
// MainMenu.Item rendered inside <Excalidraw> via the MainMenu slot. The
// real MainMenu mounts via tunnels and DropdownMenu — too heavy for jsdom
// — so we stub it as a passthrough that renders Item children directly,
// exposing onSelect as the click handler. We then assert
// excalidrawAPI.toggleSidebar({name:"layers"}) fires on click.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks rather
// than mutating the contextmenu/drop test fixtures.

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
  compileLayer: vi.fn(),
  defaultLayerStyle: vi.fn(),
}));

const mockToggleSidebarSpy = vi.fn();

const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => [],
  getAppState: () => ({ selectedElementIds: {} }),
  updateScene: vi.fn(),
  toggleSidebar: mockToggleSidebarSpy,
  // W-C — MapEditor calls excalidrawAPI.registerContextMenuItem in a
  // useEffect to wire the Convert action. Stub returns an unregister fn.
  registerContextMenuItem: vi.fn(() => vi.fn()),
};

// MainMenu / MainMenu.Item passthrough is defined INSIDE the vi.mock factory
// because vi.mock is hoisted to module top — referencing module-top consts
// from inside the factory throws "Cannot access X before initialization".
// Same applies to mockFakeExcalidrawAPI usage: we capture it via dynamic ref
// (Vitest spec exception: prefixing with `mock` lets module-top consts
// survive hoisting).

vi.mock("@excalidraw/excalidraw", () => {
  // Local React import — the hoisted factory runs before the file's top
  // import binding is initialized.
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
});

afterEach(() => {
  cleanup();
});

describe("MapEditor — MainMenu Layers item (W-B)", () => {
  it("renders the Layers panel MainMenu item", async () => {
    const { getByTestId } = render(<MapEditor />);
    await waitFor(() => {
      expect(getByTestId("main-menu-layers")).toBeTruthy();
    });
  });

  it("clicking the Layers item calls excalidrawAPI.toggleSidebar({name:'layers'})", async () => {
    const { getByTestId } = render(<MapEditor />);
    const item = await waitFor(() => getByTestId("main-menu-layers"));

    // Wait for the Excalidraw stub's useEffect to fire setExcalidrawAPI so
    // the onSelect handler has a non-null api reference.
    await waitFor(() => {
      expect(mockFakeExcalidrawAPI.toggleSidebar).toBeDefined();
    });

    fireEvent.click(item);

    await waitFor(() => {
      expect(mockToggleSidebarSpy).toHaveBeenCalledTimes(1);
    });
    expect(mockToggleSidebarSpy).toHaveBeenCalledWith({ name: "layers" });
  });

  it("clicking a second time fires toggleSidebar again (Excalidraw owns visibility state)", async () => {
    const { getByTestId } = render(<MapEditor />);
    const item = await waitFor(() => getByTestId("main-menu-layers"));

    fireEvent.click(item);
    fireEvent.click(item);

    await waitFor(() => {
      expect(mockToggleSidebarSpy).toHaveBeenCalledTimes(2);
    });
    expect(mockToggleSidebarSpy).toHaveBeenNthCalledWith(1, { name: "layers" });
    expect(mockToggleSidebarSpy).toHaveBeenNthCalledWith(2, { name: "layers" });
  });
});
