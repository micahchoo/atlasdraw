// SPDX-License-Identifier: AGPL-3.0-only
// MapEditor builds the drawing's right-click menus from the command list
// (commands/contextMenus.ts), through the fork's
// `excalidrawAPI.registerContextMenuItem`.
//
// The `<Excalidraw>` here is a stub, so the real menu DOM does not render
// (the e2e `context-menus.spec.ts` drives it). Instead we capture the items
// MapEditor registers and drive one directly:
//   - Convert selection to data layer is registered for the element menu;
//   - its `perform` runs the convert pipeline (a data layer added to the
//     document, the shape deleted as an undoable step);
//   - unmount calls every unregister function.
// Which selection converts is commands' business (session/convertToLayer.test.ts).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { ToastProvider } from "../ToastProvider";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

import type { DocumentCommand } from "../../state/document";

import type * as maplibregl from "maplibre-gl";

/** The command an import or a convert sends to the open document. */
type AddDataLayer = Extract<DocumentCommand, { type: "add-data-layer" }>;

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

// Fake selected element — a rectangle in world coordinates. Mutated per-test.
const fakeRectangleEl = {
  id: "anno-1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 2048,
  height: 1024,
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
// perform directly without rendering the real ContextMenu.
const registerContextMenuItemUnregister = vi.fn();
const capturedContextMenuItems: Array<{
  name: string;
  label: string;
  contexts?: string[];
  perform: (elements: unknown, appState: unknown, at: unknown) => unknown;
}> = [];

const registerContextMenuItemSpy = vi.fn(
  (item: (typeof capturedContextMenuItems)[number]) => {
    capturedContextMenuItems.push(item);
    return registerContextMenuItemUnregister;
  },
);

// `mock` prefix lets these top-level consts survive Vitest's vi.mock hoisting.
const EMPTY_SIDEBAR_TABS: never[] = [];

const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => currentScene,
  getSceneElementsIncludingDeleted: () => currentScene,
  getAppState: () => ({ selectedElementIds: currentSelectedIds }),
  updateScene: updateSceneSpy,
  toggleSidebar: vi.fn(),
  registerContextMenuItem: registerContextMenuItemSpy,
  // Sidebar-tab fork — MapEditor's layers-tab effect calls this on mount.
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

vi.mock("@atlasdraw/excalidraw", () => {
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
  // useCameraRotation reads the live camera's bearing on mount. A map
  // without getBearing is not a map.
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
  currentScene = [fakeRectangleEl];
  currentSelectedIds = { "anno-1": true };
  capturedContextMenuItems.length = 0;
});

afterEach(() => {
  cleanup();
});

const CONVERT = "element:edit.convert-to-layer";

// Helper — wait for MapEditor's registration effect to fire and return
// the captured item. Throws (via waitFor) if not registered.
const awaitConvertItem = async () => {
  await waitFor(() => {
    expect(
      capturedContextMenuItems.find((i) => i.name === CONVERT),
    ).toBeTruthy();
  });
  const item = capturedContextMenuItems.find((i) => i.name === CONVERT);
  if (!item) {
    throw new Error("convert item not registered");
  }
  return item;
};

describe("MapEditor — the right-click items come from the commands", () => {
  it("registers Convert selection to data layer for the element menu", async () => {
    render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    const item = await awaitConvertItem();
    expect(item.label).toBe("Convert selection to data layer");
    expect(item.contexts).toEqual(["element"]);
  });

  it("perform with polygon selection runs the full convert pipeline", async () => {
    const registerSpy = vi.spyOn(currentDocument(), "dispatch");

    render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    const item = await awaitConvertItem();

    // Wait for excalidrawAPI wiring to complete (handleConvert reads it).
    await waitFor(() => {
      expect(mockFakeExcalidrawAPI.getSceneElements()).toContain(
        fakeRectangleEl,
      );
    });

    // The command reads the selection through the API, so the module-level
    // `currentSelectedIds` / `currentScene` drive it.
    const result = item.perform([], {}, { clientX: 0, clientY: 0 });
    // perform returns false: the command writes the scene itself.
    expect(result).toBe(false);

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    const arg = registerSpy.mock.calls[0][0] as AddDataLayer;
    expect(arg.id).toMatch(/^dl:/);
    expect(arg.fc.type).toBe("FeatureCollection");
    expect(arg.fc.features[0].geometry.type).toBe("Polygon");

    // The element is deleted as an undoable step: a tombstone, not a filter.
    expect(updateSceneSpy).toHaveBeenCalledTimes(1);
    const sceneArg = updateSceneSpy.mock.calls[0][0];
    expect(sceneArg.elements).toEqual([
      expect.objectContaining({ id: "anno-1", isDeleted: true }),
    ]);
  });

  it("unmount calls the unregister function of every item", async () => {
    const { unmount } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    await awaitConvertItem();
    expect(registerContextMenuItemUnregister).not.toHaveBeenCalled();
    unmount();
    expect(registerContextMenuItemUnregister).toHaveBeenCalledTimes(
      capturedContextMenuItems.length,
    );
  });
});
