// SPDX-License-Identifier: AGPL-3.0-only
// T22 — LayerPanel SidebarTrigger wiring test for MapEditor.
//
// Verifies the Layers toggle button:
//   1. Renders with aria-pressed="false" initially.
//   2. On click, calls excalidrawAPI.toggleSidebar({ name: "layers" }) and
//      flips aria-pressed to "true".
//   3. On second click, re-toggles and aria-pressed returns to "false".
//
// Mocking strategy mirrors MapEditor.contextmenu.test.tsx — extends the
// fakeExcalidrawAPI with a toggleSidebar spy. Excalidraw is stubbed so its
// internal Sidebar render path is irrelevant; we only assert on the API
// invocation and our local aria-pressed reflection.
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

const toggleSidebarSpy = vi.fn();

const fakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => [],
  getAppState: () => ({ selectedElementIds: {} }),
  updateScene: vi.fn(),
  toggleSidebar: toggleSidebarSpy,
};

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({
    onExcalidrawAPI,
    children,
  }: {
    onExcalidrawAPI?: (api: unknown) => void;
    children?: React.ReactNode;
  }) => {
    React.useEffect(() => {
      onExcalidrawAPI?.(fakeExcalidrawAPI);
    }, [onExcalidrawAPI]);
    // Render children so LayerPanel mounts (uses <Sidebar>, mocked below).
    return React.createElement(
      "div",
      { "data-testid": "excalidraw-stub" },
      children,
    );
  },
  // LayerPanel imports Sidebar from @excalidraw/excalidraw — stub it as a
  // passthrough so the component mounts without exploding in jsdom.
  // LayerPanel uses <Sidebar.Header> too, so the stub needs the static
  // member or React throws "type is invalid: undefined".
  Sidebar: Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        "div",
        { "data-testid": "sidebar-stub" },
        children,
      ),
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
});

afterEach(() => {
  cleanup();
});

describe("MapEditor — Layers toggle button (T22)", () => {
  it("renders with aria-pressed='false' initially", async () => {
    const { getByTestId } = render(<MapEditor />);
    const btn = getByTestId("layers-toggle-button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Toggle layers panel");
  });

  it("clicking the toggle calls excalidrawAPI.toggleSidebar({name:'layers'}) and flips aria-pressed", async () => {
    const { getByTestId } = render(<MapEditor />);
    const btn = getByTestId("layers-toggle-button");

    // Wait for the Excalidraw stub's useEffect to wire setExcalidrawAPI so
    // the onClick handler has a non-null api reference.
    await waitFor(() => {
      // After the effect fires, MapEditor re-renders — give it a tick.
      expect(btn).toBeTruthy();
    });

    fireEvent.click(btn);

    await waitFor(() => {
      expect(toggleSidebarSpy).toHaveBeenCalledTimes(1);
    });
    expect(toggleSidebarSpy).toHaveBeenCalledWith({ name: "layers" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking a second time toggles back to aria-pressed='false'", async () => {
    const { getByTestId } = render(<MapEditor />);
    const btn = getByTestId("layers-toggle-button");

    await waitFor(() => {
      expect(btn).toBeTruthy();
    });

    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute("aria-pressed")).toBe("false");
    });

    expect(toggleSidebarSpy).toHaveBeenCalledTimes(2);
    expect(toggleSidebarSpy).toHaveBeenNthCalledWith(1, { name: "layers" });
    expect(toggleSidebarSpy).toHaveBeenNthCalledWith(2, { name: "layers" });
  });
});
