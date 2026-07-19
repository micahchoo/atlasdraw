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

vi.mock("@atlasdraw/basemap", () => {
  const BASEMAPS_FIXTURE = [
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
  ];
  return {
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
    BASEMAPS: BASEMAPS_FIXTURE,
    listBasemaps: vi.fn(() => BASEMAPS_FIXTURE),
    resolveStyle: vi.fn(() =>
      Promise.resolve({ version: 8, sources: {}, layers: [] }),
    ),
    BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error {
      constructor(public readonly basemapId: string) {
        super(`Basemap ${basemapId} requires allow_remote=true`);
        this.name = "BasemapRemoteGatedError";
      }
    },
  };
});

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
  // Sidebar-tab fork — MapEditor mounts LayerPanel as a tab inside
  // Excalidraw's DefaultSidebar via this API. Stub returns an unregister fn.
  registerSidebarTab: vi.fn(() => vi.fn()),
};

// MainMenu / MainMenu.Item passthrough is defined INSIDE the vi.mock factory
// because vi.mock is hoisted to module top — referencing module-top consts
// from inside the factory throws "Cannot access X before initialization".
// Same applies to mockFakeExcalidrawAPI usage: we capture it via dynamic ref
// (Vitest spec exception: prefixing with `mock` lets module-top consts
// survive hoisting).

vi.mock("@atlasdraw/excalidraw", () => {
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

// IA restructure: the "Layers panel" MainMenu item was ejected (the menu
// holds document/app actions only). The panel's affordances are now the
// vendored sidebar trigger and the ⌘K quick-actions palette; these tests
// drive the palette, which exercises the same toggleSidebar wiring.
describe("MapEditor — Layers panel affordances (W-B)", () => {
  async function renderAndOpenPalette() {
    const utils = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    // Wait for the Excalidraw stub's useEffect to fire setExcalidrawAPI so
    // the palette actions have a non-null api reference.
    await waitFor(() => {
      expect(utils.getByTestId("excalidraw-stub")).toBeTruthy();
    });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(utils.getByTestId("quick-actions-panel")).toBeTruthy();
    });
    return utils;
  }

  it("the quick-actions palette lists the Layers panel action", async () => {
    const utils = await renderAndOpenPalette();
    expect(utils.getByTestId("quick-action-layers")).toBeTruthy();
  });

  it("selecting the action calls excalidrawAPI.toggleSidebar({name:'default', tab:'layers'})", async () => {
    const utils = await renderAndOpenPalette();
    fireEvent.click(utils.getByTestId("quick-action-layers"));

    await waitFor(() => {
      expect(mockToggleSidebarSpy).toHaveBeenCalledTimes(1);
    });
    expect(mockToggleSidebarSpy).toHaveBeenCalledWith({
      name: "default",
      tab: "layers",
    });
  });

  it("re-invoking the action fires toggleSidebar again (Excalidraw owns visibility state)", async () => {
    const utils = await renderAndOpenPalette();
    fireEvent.click(utils.getByTestId("quick-action-layers"));

    // The palette closes on select — reopen and invoke again.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(
      await waitFor(() => utils.getByTestId("quick-action-layers")),
    );

    await waitFor(() => {
      expect(mockToggleSidebarSpy).toHaveBeenCalledTimes(2);
    });
    expect(mockToggleSidebarSpy).toHaveBeenNthCalledWith(1, {
      name: "default",
      tab: "layers",
    });
    expect(mockToggleSidebarSpy).toHaveBeenNthCalledWith(2, {
      name: "default",
      tab: "layers",
    });
  });

  it("registers the Layers tab via registerSidebarTab", async () => {
    render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(mockFakeExcalidrawAPI.registerSidebarTab).toHaveBeenCalled();
    });
    const arg = (
      mockFakeExcalidrawAPI.registerSidebarTab as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(arg.name).toBe("layers");
    expect(arg.label).toBe("Layers");
    expect(arg.content).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// IA restructure: the basemap is presented as a LAYER — bottom of the stack
// in LayerPanel — replacing the MainMenu "Basemap: …" item + standalone
// BasemapPickerDialog. These tests render the registered Layers-tab content
// (the same element MapEditor hands to registerSidebarTab) and drive the
// Basemap section against the shared basemap store.
// ---------------------------------------------------------------------------

describe("LayerPanel Basemap section (IA restructure)", () => {
  async function renderLayersTabContent() {
    render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(mockFakeExcalidrawAPI.registerSidebarTab).toHaveBeenCalled();
    });
    const arg = (
      mockFakeExcalidrawAPI.registerSidebarTab as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    return render(arg.content as React.ReactElement);
  }

  it("shows the active basemap row; picker options expand on toggle", async () => {
    const utils = await renderLayersTabContent();
    expect(utils.getByTestId("layer-basemap-row")).toBeTruthy();
    // Options are collapsed initially.
    expect(utils.queryByTestId("basemap-option-protomaps-light")).toBeNull();

    fireEvent.click(utils.getByTestId("layer-basemap-toggle"));

    expect(utils.getByTestId("basemap-option-protomaps-light")).toBeTruthy();
    expect(utils.getByTestId("basemap-option-protomaps-dark")).toBeTruthy();
    expect(utils.getByTestId("basemap-option-openfreemap-bright")).toBeTruthy();
  });

  it("selecting a basemap updates the shared store and collapses the picker", async () => {
    const utils = await renderLayersTabContent();
    fireEvent.click(utils.getByTestId("layer-basemap-toggle"));
    fireEvent.click(utils.getByTestId("basemap-option-protomaps-dark"));

    expect(useBasemapStore.getState().activeBasemapId).toBe("protomaps-dark");
    expect(utils.queryByTestId("basemap-option-protomaps-light")).toBeNull();
  });

  it("'Edit style' raises the style-editor flag (MapEditor mounts Maputnik)", async () => {
    const utils = await renderLayersTabContent();
    fireEvent.click(utils.getByTestId("layer-basemap-edit-style"));
    expect(useBasemapStore.getState().styleEditorOpen).toBe(true);
  });
});
