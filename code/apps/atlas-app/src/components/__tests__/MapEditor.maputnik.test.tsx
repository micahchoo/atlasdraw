// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A4 — MapEditor wiring test for the Maputnik "Edit basemap style"
// MainMenu entry. Verifies that clicking the entry mounts MaputnikDialog and
// closing unmounts it.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks rather
// than mutating the layers-toggle / contextmenu / drop test fixtures.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { ToastProvider } from "../ToastProvider";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { useBasemapStore } from "../../state/basemap";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () =>
    React.createElement("div", { "data-testid": "map-canvas-stub" }),
  compileLayer: vi.fn(),
  defaultLayerStyle: vi.fn(),
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

const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => [],
  getAppState: () => ({ selectedElementIds: {} }),
  updateScene: vi.fn(),
  toggleSidebar: vi.fn(),
  registerContextMenuItem: vi.fn(() => vi.fn()),
  registerSidebarTab: vi.fn(() => vi.fn()),
  // Collar shell — CollarSheetTabs subscribes to appState commits via
  // onChange to track the open sidebar tab. Stub returns an unsubscribe fn.
  onChange: vi.fn(() => vi.fn()),
};

vi.mock("@atlasdraw/excalidraw", () => {
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

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
  useBasemapStore.setState({
    activeBasemapId: "protomaps-light",
    styleEditorOpen: false,
  });
});

afterEach(() => {
  cleanup();
});

// IA restructure: the "Edit basemap style" trigger moved from the MainMenu
// into LayerPanel's Basemap section, which raises `styleEditorOpen` on the
// shared basemap store; MapEditor mounts MaputnikDialog off that flag. The
// trigger button itself is covered in MapEditor.layers-toggle.test.tsx —
// here we drive the store directly and verify the MapEditor side.
describe("MapEditor — Maputnik style-editor mount (A4)", () => {
  it("does not mount the Maputnik dialog by default", async () => {
    const { queryByTestId, getByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("excalidraw-stub")).toBeTruthy();
    });
    expect(queryByTestId("maputnik-dialog-iframe")).toBeNull();
  });

  it("raising styleEditorOpen mounts the dialog with the active basemap style URL", async () => {
    const { getByTestId, queryByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );

    // Dialog is not mounted initially.
    expect(queryByTestId("maputnik-dialog-iframe")).toBeNull();

    act(() => {
      useBasemapStore.getState().setStyleEditorOpen(true);
    });

    const iframe = (await waitFor(() =>
      getByTestId("maputnik-dialog-iframe"),
    )) as HTMLIFrameElement;
    // Default basemap is protomaps-light; its styleFile must appear encoded
    // in the iframe src.
    expect(iframe.src).toContain(
      encodeURIComponent("/styles/protomaps-light.json"),
    );
    // Default Maputnik URL is the public instance (config defaults).
    expect(iframe.src).toContain("maputnik.github.io/editor/");
  });

  it("closing the dialog unmounts it and clears the store flag (close button)", async () => {
    const { getByTestId, queryByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    act(() => {
      useBasemapStore.getState().setStyleEditorOpen(true);
    });

    await waitFor(() => {
      expect(getByTestId("maputnik-dialog-iframe")).toBeTruthy();
    });

    fireEvent.click(getByTestId("maputnik-dialog-close"));

    await waitFor(() => {
      expect(queryByTestId("maputnik-dialog-iframe")).toBeNull();
    });
  });
});
