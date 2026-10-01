// SPDX-License-Identifier: AGPL-3.0-only
// The Layers tab: MapEditor registers it with the drawing's sidebar, and the
// registered element reads the session (the basemap picker in it writes
// the document). The real MainMenu and sidebar are too heavy for jsdom, so
// Excalidraw is a stub here; e2e drives the real ones.
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
import { withSession } from "../../session/__tests__/sessionFixture";
import { ToastProvider } from "../ToastProvider";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

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

const EMPTY_SIDEBAR_TABS: never[] = [];

const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => [],
  getSceneElementsIncludingDeleted: () => [],
  getAppState: () => ({ selectedElementIds: {} }),
  updateScene: vi.fn(),
  toggleSidebar: mockToggleSidebarSpy,
  // W-C — MapEditor calls excalidrawAPI.registerContextMenuItem in a
  // useEffect to wire the Convert action. Stub returns an unregister fn.
  registerContextMenuItem: vi.fn(() => vi.fn()),
  // Sidebar-tab fork — MapEditor mounts LayerPanel as a tab inside
  // Excalidraw's DefaultSidebar via this API. Stub returns an unregister fn.
  registerSidebarTab: vi.fn(() => vi.fn()),
  // Collar shell — SheetRail subscribes to appState commits via onChange to
  // track the open sidebar tab. Stub returns an unsubscribe fn.
  onChange: vi.fn(() => vi.fn()),
  // ...and reads the tab list off the imperative API (getSidebarTabs /
  // onSidebarTabsChange, the fork's `useSyncExternalStore` pair). Empty list
  // ⇒ SheetRail renders nothing, which is all these suites need. The snapshot
  // reference MUST be stable — a fresh `[]` per call makes
  // `useSyncExternalStore` re-render forever.
  getSidebarTabs: () => EMPTY_SIDEBAR_TABS,
  onSidebarTabsChange: vi.fn(() => vi.fn()),
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
  // RT-3 — useCameraRotation reads the live camera on mount, via
  // useCameraRotation reads it. A map without it is not a map.
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

vi.mock("../../hooks/useCameraBridge", () => ({
  useCameraBridge: () => ({ bridge: null, onZoomAction: () => false }),
}));
vi.mock("../../hooks/useMapWheelRouter", () => ({
  useMapWheelRouter: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  openDocument(createDocument());
});

afterEach(() => {
  cleanup();
});

// The Layers command and its palette entry are tested against the session
// in commands/commands.test.ts and EditorDialogs.test.tsx.
describe("MapEditor — the Layers tab", () => {
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
    return render(withSession(arg.content as React.ReactElement));
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

  it("selecting a basemap sets the document's basemap and collapses the picker", async () => {
    const utils = await renderLayersTabContent();
    fireEvent.click(utils.getByTestId("layer-basemap-toggle"));
    fireEvent.click(utils.getByTestId("basemap-option-protomaps-dark"));

    expect(currentDocument().snapshot().basemap).toBe("protomaps-dark");
    expect(utils.queryByTestId("basemap-option-protomaps-light")).toBeNull();
  });
});
