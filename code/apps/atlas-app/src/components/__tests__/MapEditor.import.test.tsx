// SPDX-License-Identifier: AGPL-3.0-only
// ISSUES.md Direction 1 — "Import…" menu action integration test.
//
// useDataFileImport.test.ts already drives importFile() in isolation via a
// minimal harness; this file exercises the real end-to-end path MapEditor
// wires it into: click "Import…" in MainMenu → a hidden
// <input type="file"> is created and .click()'d → simulate the user
// picking a file (jsdom can't drive a real native file dialog, so we set
// `.files` on the created input directly and fire `change`) → the same
// parse/registerDataLayer/map.addSource+addLayer pipeline
// MapEditor.drop.test.tsx already covers for drag-drop.
//
// MainMenu.Item's stub here wires onSelect -> onClick (unlike
// MapEditor.drop.test.tsx's stub, which deliberately doesn't — that file
// only needs drag-drop, not click-driven menu actions). Per
// .claude/rules/test-fixtures.md this file owns its own mock scaffold
// rather than modifying either existing fixture.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { MapEditor } from "../MapEditor";
import { ToastProvider } from "../ToastProvider";
import { useLayerRegistryStore } from "../../state/layerRegistry";

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

// `mock` prefix lets this survive Vitest's vi.mock hoisting. Must be a
// STABLE reference — MapEditor.tsx's `onExcalidrawAPI` prop is passed as an
// inline arrow (a fresh function every render), so if the stub called
// setExcalidrawAPI with a freshly-allocated object on every effect fire, the
// state change would re-render MapEditor, produce a new inline arrow,
// re-trigger the effect (deps=[onExcalidrawAPI]), and loop forever (OOM'd
// this file until fixed — same reference in means setState no-ops and React
// bails out of re-rendering, exactly like MapEditor.contextmenu.test.tsx's
// mockFakeExcalidrawAPI const already does it).
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate the user picking `file` in the native dialog the "Import…"
 * click opened: locate the hidden <input type="file"> MapEditor appended
 * to document.body, set its files, and fire change. */
function pickFileInNativeDialog(file: File): void {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input!);
}

function makeFile(name: string, text: string): File {
  return { name, text: () => Promise.resolve(text) } as unknown as File;
}

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
});

afterEach(() => {
  cleanup();
  // Clean up any hidden <input type="file"> a test left behind.
  document
    .querySelectorAll('input[type="file"]')
    .forEach((el) => el.parentNode?.removeChild(el));
});

describe("MapEditor — 'Import…' menu action (ISSUES.md Direction 1)", () => {
  it("clicking Import… opens a native file picker, and picking a .geojson imports it", async () => {
    const registerSpy = vi.spyOn(
      useLayerRegistryStore.getState(),
      "registerDataLayer",
    );
    const { getByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );

    fireEvent.click(getByTestId("main-menu-import"));
    expect(document.querySelector('input[type="file"]')).not.toBeNull();

    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
    };
    pickFileInNativeDialog(makeFile("picked.geojson", JSON.stringify(fc)));

    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1));
    expect(registerSpy.mock.calls[0][0].label).toBe("picked.geojson");
    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    expect(mockMap.addLayer).toHaveBeenCalledTimes(1);
  });

  it("the hidden file input is removed from the DOM after a pick resolves", async () => {
    const { getByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    fireEvent.click(getByTestId("main-menu-import"));
    const fc = { type: "FeatureCollection", features: [] };
    pickFileInNativeDialog(makeFile("empty.geojson", JSON.stringify(fc)));

    await waitFor(() => {
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });
  });

  it("picking an unsupported file type toasts an explicit error (unlike drag-drop's silent no-op)", async () => {
    const { getByTestId, findByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    fireEvent.click(getByTestId("main-menu-import"));
    pickFileInNativeDialog(makeFile("readme.txt", "hello"));

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/unsupported file type/i);
  });
});
