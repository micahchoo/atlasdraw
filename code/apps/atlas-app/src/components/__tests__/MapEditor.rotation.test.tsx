// SPDX-License-Identifier: AGPL-3.0-only
// RT-9 — the drawing gate, and the way out of it.
//
// D6: drawing is blocked while the camera is turned. Unprojecting the pointer
// is correct at any rotation but the *shape* is not — drag a rectangle at 30°
// and unprojecting its corners yields a north-aligned bbox that is not the box
// you dragged. This suite covers the wiring: the gate closes only when a
// drawing tool is actually selected, it says why, and the way out is one click.
//
// The gate's own arithmetic is trivial; what is worth locking is that it is
// connected to the two things it reads and the two things it drives. Hence a
// mounted MapEditor rather than a unit test of a boolean.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

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
  ];
  return {
    MapCanvas: () =>
      React.createElement("div", { "data-testid": "map-canvas-stub" }),
    compileLayer: vi.fn(),
    defaultLayerStyle: vi.fn(),
    registerPmtilesProtocol: vi.fn(),
    // MapCompass imports this; the compass is real here, so it must exist.
    setCameraRotation: vi.fn(),
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

const EMPTY_SIDEBAR_TABS: never[] = [];

const mockFakeExcalidrawAPI = {
  isDestroyed: false,
  getSceneElements: () => [],
  getAppState: () => ({ selectedElementIds: {}, activeTool: { type: "hand" } }),
  updateScene: vi.fn(),
  toggleSidebar: vi.fn(),
  registerContextMenuItem: vi.fn(() => vi.fn()),
  registerSidebarTab: vi.fn(() => vi.fn()),
  onChange: vi.fn(() => vi.fn()),
  getSidebarTabs: () => EMPTY_SIDEBAR_TABS,
  onSidebarTabsChange: vi.fn(() => vi.fn()),
};

vi.mock("@atlasdraw/excalidraw", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require("react") as typeof import("react");
  const MainMenuStub = Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      ReactInner.createElement("div", null, children),
    {
      Item: () => null,
      Separator: () => null,
      DefaultItems: new Proxy({}, { get: () => () => null }),
    },
  );
  const SidebarStub = Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      ReactInner.createElement("div", null, children),
    { Header: ({ children }: { children?: React.ReactNode }) => children },
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

const mockResetNorth = vi.fn();

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
  resetNorth: mockResetNorth,
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
vi.mock("../../hooks/useGeoAnchor", () => ({ useGeoAnchor: vi.fn() }));
vi.mock("../../hooks/useLayerRegistrySync", () => ({
  useLayerRegistrySync: vi.fn(),
}));
vi.mock("../../hooks/useAtlasdrawTool", () => ({
  useAtlasdrawTool: () => ({
    activeAtlasTool: null,
    setActiveAtlasTool: vi.fn(),
    dispatchPointerDown: vi.fn(),
  }),
}));

// The two inputs to the gate, both controllable per test.
const toolState = { isDrawingMode: false };
const rotationState = { degrees: 0, isRotated: false };

vi.mock("../../hooks/useToolState", () => ({
  useToolState: () => toolState,
}));
vi.mock("../../hooks/useCameraRotation", () => ({
  useCameraRotation: () => rotationState,
}));

beforeEach(() => {
  vi.clearAllMocks();
  toolState.isDrawingMode = false;
  rotationState.degrees = 0;
  rotationState.isRotated = false;
  useLayerRegistryStore.setState({ entries: [] });
  useBasemapStore.setState({
    activeBasemapId: "protomaps-light",
    styleEditorOpen: false,
  });
});

afterEach(() => {
  cleanup();
});

async function renderEditor() {
  const utils = render(
    <ToastProvider>
      <MapEditor />
    </ToastProvider>,
  );
  await waitFor(() => {
    expect(utils.getByTestId("excalidraw-stub")).toBeTruthy();
  });
  return utils;
}

/**
 * The Excalidraw plate. `.excalidrawLayerActive` on it is the gate itself —
 * the class that flips `pointer-events` from `none` to `auto`, and therefore
 * the difference between a drag reaching the canvas and a drag reaching
 * MapLibre. Read off the stub's parent because the stub renders *inside* the
 * layer, which is what makes it the layer.
 */
function plateClassName(utils: { getByTestId: (id: string) => HTMLElement }) {
  return utils.getByTestId("excalidraw-stub").parentElement?.className ?? "";
}

describe("MapEditor — RT-9 drawing gate", () => {
  it("shuts the pointer-events gate while the camera is turned", async () => {
    toolState.isDrawingMode = true;
    rotationState.degrees = -30;
    rotationState.isRotated = true;

    const utils = await renderEditor();

    // Not merely "the app knows it is rotated" — the plate must actually stop
    // taking the drag, or the block is a label on a door that still opens.
    expect(plateClassName(utils)).not.toContain("excalidrawLayerActive");
    expect(
      utils.getByTestId("map-editor-root").getAttribute("data-drawing-blocked"),
    ).toBe("true");
  });

  it("leaves drawing alone at north-up", async () => {
    toolState.isDrawingMode = true;

    const utils = await renderEditor();

    expect(plateClassName(utils)).toContain("excalidrawLayerActive");
    expect(
      utils.getByTestId("map-editor-root").getAttribute("data-drawing-blocked"),
    ).toBeNull();
    expect(utils.queryByTestId("draw-blocked-hint")).toBeNull();
  });

  it("keeps the gate shut for a non-drawing tool, rotated or not", async () => {
    // Guards the gate against being rewritten as `!drawingBlocked` alone.
    rotationState.isRotated = true;

    const utils = await renderEditor();

    expect(plateClassName(utils)).not.toContain("excalidrawLayerActive");
  });

  it("says why the tool went dead, rather than doing nothing visible", async () => {
    toolState.isDrawingMode = true;
    rotationState.isRotated = true;

    const utils = await renderEditor();

    expect(utils.getByTestId("draw-blocked-hint").textContent).toContain(
      "Drawing is off while the map is turned",
    );
  });

  it("does not nag about a rotated map when no drawing tool is selected", async () => {
    // Panning a turned map is a perfectly good thing to be doing. A hint about
    // a block the user is not hitting is noise.
    rotationState.isRotated = true;

    const utils = await renderEditor();

    expect(utils.queryByTestId("draw-blocked-hint")).toBeNull();
    expect(
      utils.getByTestId("map-editor-root").getAttribute("data-drawing-blocked"),
    ).toBe("true");
  });

  it("offers the way out in the hint itself", async () => {
    toolState.isDrawingMode = true;
    rotationState.isRotated = true;

    const utils = await renderEditor();
    fireEvent.click(utils.getByText("Reset north"));

    expect(mockResetNorth).toHaveBeenCalledOnce();
  });
});

describe("MapEditor — RT-3 compass", () => {
  it("mounts the compass at north-up too, since it is the only mouse rotation", async () => {
    const utils = await renderEditor();

    expect(utils.getByTestId("map-compass")).toBeTruthy();
  });

  it("keeps the compass up while drawing is blocked — it is the escape hatch", async () => {
    toolState.isDrawingMode = true;
    rotationState.isRotated = true;

    const utils = await renderEditor();

    expect(utils.getByTestId("map-compass")).toBeTruthy();
    expect(utils.getByTestId("map-compass").getAttribute("data-rotated")).toBe(
      "true",
    );
  });
});
