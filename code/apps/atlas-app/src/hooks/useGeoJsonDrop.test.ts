// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useGeoJsonDrop (ISSUES.md Issue 6 — coverage climb, priority 2).
//
// This hook is the app's ONLY external-input trust boundary (drag-drop
// GeoJSON/CSV importer). MapEditor.drop.test.tsx already covers the happy
// paths indirectly (mounting the whole MapEditor tree); this file drives
// the hook in isolation via a minimal harness component so branch coverage
// doesn't depend on MapEditor's unrelated wiring, and adds the error/edge
// paths MapEditor.drop.test.tsx doesn't reach: map-null early return, the
// addLayer-failure rollback, the GeoJSONParseError toast path, the
// configured-geocoder CSV branch, and listener cleanup on unmount.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import React, { useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { ToastProvider } from "../components/ToastProvider";

import { useGeoJsonDrop } from "./useGeoJsonDrop";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { LayerStyle } from "../state/layerRegistry";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  FakeGeoJSONParseError,
  FakeCSVParseError,
  parseMock,
  parseCSVMock,
  requireHomogeneousGeometryMock,
  photonGeocoderCtor,
  compileLayerMock,
  defaultLayerStyleMock,
  getAppConfigMock,
} = vi.hoisted(() => {
  class FakeGeoJSONParseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GeoJSONParseError";
    }
  }
  class FakeCSVParseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "CSVParseError";
      this.code = code;
    }
  }
  return {
    FakeGeoJSONParseError,
    FakeCSVParseError,
    parseMock: vi.fn(),
    parseCSVMock: vi.fn(),
    requireHomogeneousGeometryMock: vi.fn(),
    photonGeocoderCtor: vi.fn(),
    compileLayerMock: vi.fn(
      (id: string, _style: unknown, geomType: string) => ({
        id,
        type: geomType,
        source: id,
        paint: {},
      }),
    ),
    defaultLayerStyleMock: vi.fn(() => ({} as LayerStyle)),
    getAppConfigMock: vi.fn(() => ({ geocoder: undefined } as unknown)),
  };
});

vi.mock("@atlasdraw/data", () => ({
  parse: parseMock,
  parseCSV: parseCSVMock,
  GeoJSONParseError: FakeGeoJSONParseError,
  CSVParseError: FakeCSVParseError,
  PhotonGeocoder: class {
    constructor(...args: unknown[]) {
      photonGeocoderCtor(...args);
    }
  },
  requireHomogeneousGeometry: requireHomogeneousGeometryMock,
}));

vi.mock("@atlasdraw/basemap", () => ({
  compileLayer: compileLayerMock,
  defaultLayerStyle: defaultLayerStyleMock,
}));

vi.mock("../config/app-config", () => ({
  getAppConfig: getAppConfigMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POLY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

function makeFile(name: string, text = ""): File {
  return { name, text: () => Promise.resolve(text) } as unknown as File;
}

function makeMockMap(): maplibregl.Map & {
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
} {
  return {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeSource: vi.fn(),
  } as unknown as maplibregl.Map & {
    addSource: ReturnType<typeof vi.fn>;
    addLayer: ReturnType<typeof vi.fn>;
    removeSource: ReturnType<typeof vi.fn>;
  };
}

function Harness({
  map,
  registerDataLayer,
}: {
  map: maplibregl.Map | null;
  registerDataLayer: (opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useGeoJsonDrop(rootRef, map, registerDataLayer);
  return React.createElement("div", { ref: rootRef, "data-testid": "root" });
}

function renderHarness(
  map: maplibregl.Map | null,
  registerDataLayer = vi.fn(),
) {
  const { getByTestId, findByTestId, unmount } = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Harness, { map, registerDataLayer }),
    ),
  );
  return {
    root: getByTestId("root"),
    registerDataLayer,
    findByTestId,
    unmount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue({ geocoder: undefined });
  parseMock.mockResolvedValue(POLY_FC);
  requireHomogeneousGeometryMock.mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

describe("useGeoJsonDrop", () => {
  it("dragover always calls preventDefault, regardless of file type", () => {
    const map = makeMockMap();
    const { root } = renderHarness(map);
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores drops with no file (dataTransfer.files empty)", () => {
    const map = makeMockMap();
    const { root } = renderHarness(map);
    fireEvent.drop(root, { dataTransfer: { files: [] } });
    expect(parseMock).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("passes through unrecognized extensions (no preventDefault, no parse)", () => {
    const map = makeMockMap();
    const { root } = renderHarness(map);
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [makeFile("notes.txt")] },
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("does not parse when map is null (early return in processDataDrop)", async () => {
    const { root } = renderHarness(null);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("happy path: parses .geojson, adds source/layer, registers the data layer, and toasts success", async () => {
    const map = makeMockMap();
    const { root, registerDataLayer } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(requireHomogeneousGeometryMock).toHaveBeenCalledWith(POLY_FC);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    const callArg = registerDataLayer.mock.calls[0][0];
    expect(callArg.label).toBe("test.geojson");
    expect(callArg.fc).toBe(POLY_FC);
  });

  it("CSV path with no geocoder configured calls parseCSV without geocoder options", async () => {
    parseCSVMock.mockResolvedValue(POLY_FC);
    const map = makeMockMap();
    const { root, registerDataLayer } = renderHarness(map);
    fireEvent.drop(root, { dataTransfer: { files: [makeFile("pts.csv")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(parseCSVMock).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(photonGeocoderCtor).not.toHaveBeenCalled();
  });

  it("CSV path with a configured geocoder passes a PhotonGeocoder to parseCSV", async () => {
    getAppConfigMock.mockReturnValue({
      geocoder: { endpoint: "https://photon.example.test" },
    });
    parseCSVMock.mockResolvedValue(POLY_FC);
    const map = makeMockMap();
    const { root, registerDataLayer } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("addresses.csv")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(photonGeocoderCtor).toHaveBeenCalledWith({
      endpoint: "https://photon.example.test",
    });
    const [, opts] = parseCSVMock.mock.calls[0];
    expect(opts).toMatchObject({ geocoder: expect.anything() });
  });

  it("GeoJSONParseError surfaces a toast and does not register a data layer", async () => {
    parseMock.mockRejectedValue(
      new FakeGeoJSONParseError("bad geometry at feature 2"),
    );
    const map = makeMockMap();
    const { root, registerDataLayer, findByTestId } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("broken.geojson")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/GeoJSON import failed/);
    expect(toast.textContent).toMatch(/bad geometry at feature 2/);
    expect(registerDataLayer).not.toHaveBeenCalled();
    // Confirm no layer/source mutation happened for the failed import.
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("CSV NO_COORD_COLUMNS without a geocoder appends the geocoder hint to the toast", async () => {
    parseCSVMock.mockRejectedValue(
      new FakeCSVParseError(
        "NO_COORD_COLUMNS",
        "Could not identify latitude and longitude columns.",
      ),
    );
    getAppConfigMock.mockReturnValue({ geocoder: undefined });
    const map = makeMockMap();
    const { root, registerDataLayer, findByTestId } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("addresses.csv")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/CSV import failed/);
    expect(toast.textContent).toMatch(/geocoder/);
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it("rolls back addSource via removeSource when addLayer throws, and surfaces a toast", async () => {
    const map = makeMockMap();
    map.addLayer.mockImplementation(() => {
      throw new Error("invalid layer spec");
    });
    const { root, registerDataLayer, findByTestId } = renderHarness(map);

    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/import failed unexpectedly/);
    expect(map.removeSource).toHaveBeenCalledWith(
      expect.stringMatching(/^dl:/),
    );
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it("removes the drop/dragover listeners on unmount (no parse after unmount)", () => {
    const map = makeMockMap();
    const { root, unmount } = renderHarness(map);
    unmount();
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [makeFile("test.geojson")] },
    });
    root.dispatchEvent(event);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("infers 'line' geometry type for LineString/MultiLineString features", async () => {
    const lineFc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    };
    parseMock.mockResolvedValue(lineFc);
    const map = makeMockMap();
    const { root, registerDataLayer } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    const layerSpec = map.addLayer.mock.calls[0][0] as { type: string };
    expect(layerSpec.type).toBe("line");
  });

  it("CSV NO_COORD_COLUMNS WITH a geocoder configured omits the geocoder hint", async () => {
    parseCSVMock.mockRejectedValue(
      new FakeCSVParseError(
        "NO_COORD_COLUMNS",
        "Could not identify latitude and longitude columns.",
      ),
    );
    getAppConfigMock.mockReturnValue({
      geocoder: { endpoint: "https://photon.example.test" },
    });
    const map = makeMockMap();
    const { root, findByTestId } = renderHarness(map);
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("addresses.csv")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/CSV import failed/);
    expect(toast.textContent).not.toMatch(/geocoder/);
  });

  it("swallows a removeSource failure during addLayer-failure rollback (rollback is best-effort) and still toasts", async () => {
    const map = makeMockMap();
    map.addLayer.mockImplementation(() => {
      throw new Error("invalid layer spec");
    });
    map.removeSource.mockImplementation(() => {
      throw new Error("source already gone");
    });
    const { root, registerDataLayer, findByTestId } = renderHarness(map);

    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/import failed unexpectedly/);
    expect(map.removeSource).toHaveBeenCalledTimes(1);
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it("does nothing when the root ref never attaches to a DOM node", () => {
    const map = makeMockMap();
    // Harness that calls the hook but never renders the ref'd element —
    // exercises the `if (!root) return;` guard inside the effect.
    function UnattachedHarness({ mapArg }: { mapArg: maplibregl.Map | null }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      useGeoJsonDrop(rootRef, mapArg, vi.fn());
      return null;
    }
    // No throw = the effect's `if (!root) return;` guard was taken cleanly.
    expect(() =>
      render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(UnattachedHarness, { mapArg: map }),
        ),
      ),
    ).not.toThrow();
  });
});
