// SPDX-License-Identifier: AGPL-3.0-only
// Issue 4 (ledgers/DEADWOOD.md) — CursorOverlay + PresenceList wiring.
//
// Both components were built in Phase 5 T11 and mounted only via
// CollabWrapper, which was deleted 2026-05-25 as an "unused gateway" —
// collab wiring moved into MapEditor but the mount never followed, leaving
// two complete, working components with zero non-test consumers. This test
// locks the re-wired mount: gated on collab.active, independent of peer
// count for CursorOverlay, gated on peer count for PresenceList (its own
// internal early return), and offset below WorkspaceSwitcher in managed
// mode so the two top-right z:10 widgets don't overlap.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks rather
// than mutating the contextmenu/drop/layers-toggle test fixtures.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { MapEditor } from "../MapEditor";
import { ToastProvider } from "../ToastProvider";
import { CollabContext } from "../../hooks/useCollab";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import * as appConfig from "../../config/app-config";

import type { CollabContextValue } from "../../hooks/useCollab";
import type { AppConfig } from "../../config/app-config";
import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Mocks (hoisted) — same scaffold as MapEditor.layers-toggle.test.tsx
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
// Fixture: fake CollabContextValue — active + peers are the only fields
// MapEditor's own render path reads (useYjsLayer only reads active/yjsDoc).
// ---------------------------------------------------------------------------

function makeCollabValue(
  overrides: Partial<CollabContextValue> = {},
): CollabContextValue {
  return {
    active: false,
    peers: new Map(),
    localCursor: { x: 0, y: 0 },
    yjsDoc: null,
    commentsLayer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

function makePeer(
  overrides: Partial<import("../../state/collab").PeerMeta> = {},
): import("../../state/collab").PeerMeta {
  return {
    id: "peer-1",
    username: "Ari",
    color: "#1971c2",
    cursor: null,
    camera: null,
    ...overrides,
  };
}

const BASE_CONFIG: AppConfig = {
  buildTarget: "local-only",
  enableShareUI: true,
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: true,
  showDemoBadge: false,
  storageBaseUrl: "",
  maputnikUrl: "https://maputnik.github.io/editor/",
  geocoder: undefined,
  managed: false,
  allowRemoteBasemaps: false,
};

function renderWithCollab(collab: CollabContextValue) {
  return render(
    <ToastProvider>
      <CollabContext.Provider value={collab}>
        <MapEditor />
      </CollabContext.Provider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLayerRegistryStore.setState({ entries: [] });
  vi.spyOn(appConfig, "getAppConfig").mockReturnValue(BASE_CONFIG);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapEditor — collab cursor + presence UI (Phase 5 T11 re-wire)", () => {
  it("mounts neither CursorOverlay nor PresenceList when collab is inactive", async () => {
    const { getByTestId, queryByTestId } = render(
      <ToastProvider>
        <MapEditor />
      </ToastProvider>,
    );
    // Wait for a stable render marker before asserting absence.
    await waitFor(() => {
      expect(getByTestId("excalidraw-stub")).toBeTruthy();
    });
    expect(queryByTestId("cursor-overlay")).toBeNull();
    expect(queryByTestId("presence-list")).toBeNull();
    expect(queryByTestId("presence-list-compact")).toBeNull();
  });

  it("mounts CursorOverlay when collab is active, even with zero peers", async () => {
    const { getByTestId, queryByTestId } = renderWithCollab(
      makeCollabValue({ active: true, peers: new Map() }),
    );
    await waitFor(() => {
      expect(getByTestId("cursor-overlay")).toBeTruthy();
    });
    // PresenceList no-ops internally at zero peers.
    expect(queryByTestId("presence-list")).toBeNull();
  });

  it("mounts PresenceList when collab is active with peers present", async () => {
    const { getByTestId } = renderWithCollab(
      makeCollabValue({
        active: true,
        peers: new Map([["peer-1", makePeer()]]),
      }),
    );
    await waitFor(() => {
      expect(getByTestId("presence-list")).toBeTruthy();
    });
    expect(getByTestId("cursor-overlay")).toBeTruthy();
  });

  it("offsets PresenceList below WorkspaceSwitcher's slot in managed mode", async () => {
    vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
      ...BASE_CONFIG,
      managed: true,
    });
    const { getByTestId } = renderWithCollab(
      makeCollabValue({
        active: true,
        peers: new Map([["peer-1", makePeer()]]),
      }),
    );
    const presence = await waitFor(() => getByTestId("presence-list"));
    expect(presence.style.top).toBe("56px");
  });

  it("does not offset PresenceList in self-host mode (managed=false)", async () => {
    const { getByTestId } = renderWithCollab(
      makeCollabValue({
        active: true,
        peers: new Map([["peer-1", makePeer()]]),
      }),
    );
    const presence = await waitFor(() => getByTestId("presence-list"));
    // No inline `top` override — falls back to the CSS module's 12px.
    expect(presence.style.top).toBe("");
  });
});
