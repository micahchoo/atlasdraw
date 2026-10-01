// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useDataFileImport, the app's import boundary for dropped and
// picked files. The hook runs in a harness component. jsdom has no Worker,
// so the import client runs the pipeline on this thread, with the parsers
// mocked: each parser's error message, the geocoder branch, layer naming,
// provenance, multi-file drops, listener cleanup and the picker path.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import React, { useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { ToastProvider } from "../components/ToastProvider";

import { useDataFileImport } from "./useDataFileImport";

import type { FeatureCollection } from "geojson";
import type { LayerStyle } from "../state/document";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  FakeGeoJSONParseError,
  FakeCSVParseError,
  FakeShapefileParseError,
  FakeGeoXmlParseError,
  parseMock,
  parseKMLMock,
  parseKMZMock,
  parseGPXMock,
  parseCSVMock,
  parseShapefileMock,
  requireHomogeneousGeometryMock,
  photonGeocoderCtor,
  defaultLayerStyleMock,
  getAppConfigMock,
  decodeGeoTiffMock,
  encodeRasterPngMock,
  FakeRasterDecodeError,
  FakeUnsupportedRasterCrsError,
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
  class FakeShapefileParseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "ShapefileParseError";
      this.code = code;
    }
  }
  class FakeGeoXmlParseError extends Error {
    format: string;
    code: string;
    constructor(format: string, code: string, message: string) {
      super(message);
      this.name = "GeoXmlParseError";
      this.format = format;
      this.code = code;
    }
  }
  return {
    FakeGeoJSONParseError,
    FakeCSVParseError,
    FakeShapefileParseError,
    FakeGeoXmlParseError,
    parseMock: vi.fn(),
    parseKMLMock: vi.fn(),
    parseKMZMock: vi.fn(),
    parseGPXMock: vi.fn(),
    parseCSVMock: vi.fn(),
    parseShapefileMock: vi.fn(),
    requireHomogeneousGeometryMock: vi.fn(),
    photonGeocoderCtor: vi.fn(),
    defaultLayerStyleMock: vi.fn(() => ({} as LayerStyle)),
    getAppConfigMock: vi.fn(() => ({ geocoder: undefined } as unknown)),
    decodeGeoTiffMock: vi.fn(),
    encodeRasterPngMock: vi.fn(),
    FakeRasterDecodeError: class extends Error {},
    FakeUnsupportedRasterCrsError: class extends Error {
      crs: string;
      constructor(crs: string) {
        super(`raster is in ${crs}`);
        this.crs = crs;
      }
    },
  };
});

// splitByGeometryKind is the real function: the layers that a mixed file
// makes are the behaviour under test, and a mock would only repeat it.
vi.mock("@atlasdraw/data", async (importActual) => ({
  splitByGeometryKind: (await importActual<typeof import("@atlasdraw/data")>())
    .splitByGeometryKind,
  parseKML: parseKMLMock,
  parseKMZ: parseKMZMock,
  parseGPX: parseGPXMock,
  GeoXmlParseError: FakeGeoXmlParseError,
  parse: parseMock,
  parseCSV: parseCSVMock,
  parseShapefile: parseShapefileMock,
  GeoJSONParseError: FakeGeoJSONParseError,
  CSVParseError: FakeCSVParseError,
  ShapefileParseError: FakeShapefileParseError,
  PhotonGeocoder: class {
    constructor(...args: unknown[]) {
      photonGeocoderCtor(...args);
    }
  },
  requireHomogeneousGeometry: requireHomogeneousGeometryMock,
  decodeGeoTiff: decodeGeoTiffMock,
  encodeRasterPng: encodeRasterPngMock,
  RasterDecodeError: FakeRasterDecodeError,
  UnsupportedRasterCrsError: FakeUnsupportedRasterCrsError,
}));

vi.mock("@atlasdraw/basemap", () => ({
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

const LINE_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Morning climb" },
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

const POINT_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "East Peak" },
      geometry: { type: "Point", coordinates: [1, 1] },
    },
    {
      type: "Feature",
      properties: { name: "Rock Spring" },
      geometry: { type: "Point", coordinates: [2, 2] },
    },
  ],
};

/** A GPX-like collection with points first, then a line. */
const MIXED_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [...POINT_FC.features, ...LINE_FC.features],
};

function makeFile(name: string, text = "", type = ""): File {
  return {
    name,
    type,
    text: () => Promise.resolve(text),
    // The raster path reads bytes, not text. Present on every fixture so a
    // `.tif` case does not need its own factory.
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as File;
}

let lastImportFile: ((file: File) => void) | null = null;

function Harness({
  registerDataLayer,
  onImported,
  registerRasterLayer,
}: {
  registerDataLayer: (opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }) => void;
  onImported?: () => void;
  registerRasterLayer?: (opts: {
    id: string;
    label: string;
    corners: unknown;
    imageKey: string;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { importFile } = useDataFileImport(
    rootRef,
    registerDataLayer,
    onImported,
    registerRasterLayer as never,
  );
  lastImportFile = importFile;
  return React.createElement("div", { ref: rootRef, "data-testid": "root" });
}

function renderHarness(
  registerDataLayer = vi.fn(),
  onImported = vi.fn(),
  registerRasterLayer = vi.fn(),
) {
  const { getByTestId, findByTestId, unmount } = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Harness, {
        registerDataLayer,
        onImported,
        registerRasterLayer,
      }),
    ),
  );
  return {
    root: getByTestId("root"),
    registerDataLayer,
    registerRasterLayer,
    onImported,
    findByTestId,
    unmount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lastImportFile = null;
  getAppConfigMock.mockReturnValue({ geocoder: undefined });
  parseMock.mockResolvedValue(POLY_FC);
  requireHomogeneousGeometryMock.mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

describe("useDataFileImport — drag-and-drop", () => {
  it("dragover always calls preventDefault, regardless of file type", () => {
    const { root } = renderHarness();
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores drops with no file (dataTransfer.files empty)", () => {
    const { root } = renderHarness();
    fireEvent.drop(root, { dataTransfer: { files: [] } });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("passes through unrecognized extensions (no preventDefault, no parse)", () => {
    const { root } = renderHarness();
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [makeFile("notes.txt")] },
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("happy path: parses .geojson, registers the data layer, and toasts success", async () => {
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("test.geojson")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(requireHomogeneousGeometryMock).toHaveBeenCalledWith(POLY_FC);
    const callArg = registerDataLayer.mock.calls[0][0];
    expect(callArg.label).toBe("test.geojson");
    expect(callArg.fc).toBe(POLY_FC);
  });

  // Provenance: a toast is gone in seconds, and `label` stops answering
  // "which file?" the first time anyone renames the layer.
  it("records the source filename on the layer entry, separately from the label", async () => {
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("parcels.geojson")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(registerDataLayer.mock.calls[0][0].provenance).toEqual({
      sourceFile: "parcels.geojson",
      droppedCount: 0,
    });
  });

  it("counts null-geometry features as dropped — they pass validation but never render", async () => {
    parseMock.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: null },
        POLY_FC.features[0],
        { type: "Feature", properties: {}, geometry: null },
      ],
    });
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("sparse.geojson")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(registerDataLayer.mock.calls[0][0].provenance.droppedCount).toBe(2);
  });

  it("records CSV rows the parser skipped, which the FeatureCollection cannot report", async () => {
    // parseCSV drops unparseable rows internally; the only way out is onStats.
    parseCSVMock.mockImplementation(
      async (_blob: Blob, opts?: { onStats?: (s: unknown) => void }) => {
        opts?.onStats?.({ read: 12, emitted: 9, dropped: 3 });
        return POLY_FC;
      },
    );
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, { dataTransfer: { files: [makeFile("sites.csv")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(registerDataLayer.mock.calls[0][0].provenance).toEqual({
      sourceFile: "sites.csv",
      droppedCount: 3,
    });
  });

  it("CSV path with no geocoder configured calls parseCSV without geocoder options", async () => {
    parseCSVMock.mockResolvedValue(POLY_FC);
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, { dataTransfer: { files: [makeFile("pts.csv")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    // Options are always passed (the hook needs `onStats` to record how many
    // rows the parse dropped), but `geocoder` must stay absent so the reader
    // makes no network calls (docs/architecture/adr/0006-telemetry.md,
    // 0011-hosted-mode-telemetry.md).
    const [, csvOpts] = parseCSVMock.mock.calls[0];
    expect(csvOpts.geocoder).toBeUndefined();
    expect(photonGeocoderCtor).not.toHaveBeenCalled();
  });

  it("CSV path with a configured geocoder passes a PhotonGeocoder to parseCSV", async () => {
    getAppConfigMock.mockReturnValue({
      geocoder: { endpoint: "https://photon.example.test" },
    });
    parseCSVMock.mockResolvedValue(POLY_FC);
    const { root, registerDataLayer } = renderHarness();
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

  it("Shapefile path: drops a .zip, parses via parseShapefile, registers the data layer", async () => {
    parseShapefileMock.mockResolvedValue(POLY_FC);
    const { root, registerDataLayer } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("parcels.zip")] },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(parseShapefileMock).toHaveBeenCalledTimes(1);
    const callArg = registerDataLayer.mock.calls[0][0];
    expect(callArg.label).toBe("parcels.zip");
  });

  it("GeoJSONParseError surfaces a toast and does not register a data layer", async () => {
    parseMock.mockRejectedValue(
      new FakeGeoJSONParseError("bad geometry at feature 2"),
    );
    const { root, registerDataLayer, findByTestId } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("broken.geojson")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/GeoJSON import failed/);
    expect(toast.textContent).toMatch(/bad geometry at feature 2/);
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it("CSV NO_COORD_COLUMNS without a geocoder appends the geocoder hint to the toast", async () => {
    parseCSVMock.mockRejectedValue(
      new FakeCSVParseError(
        "NO_COORD_COLUMNS",
        "Could not identify latitude and longitude columns.",
      ),
    );
    getAppConfigMock.mockReturnValue({ geocoder: undefined });
    const { root, registerDataLayer, findByTestId } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("addresses.csv")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/CSV import failed/);
    expect(toast.textContent).toMatch(/geocoder/);
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it.each([
    ["BAD_ZIP", "not a valid zip"],
    ["NO_SHP_FILE", "no shp entry"],
    ["PARSE_FAILED", "shpjs threw"],
  ] as const)(
    "ShapefileParseError code %s surfaces a toast and does not register a data layer",
    async (code, message) => {
      parseShapefileMock.mockRejectedValue(
        new FakeShapefileParseError(code, message),
      );
      const { root, registerDataLayer, findByTestId } = renderHarness();
      fireEvent.drop(root, {
        dataTransfer: { files: [makeFile("parcels.zip")] },
      });

      const toast = await findByTestId("toast-error");
      expect(toast.textContent).toMatch(/Shapefile import failed/);
      expect(registerDataLayer).not.toHaveBeenCalled();
    },
  );

  it("removes the drop/dragover listeners on unmount (no parse after unmount)", () => {
    const { root, unmount } = renderHarness();
    unmount();
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [makeFile("test.geojson")] },
    });
    root.dispatchEvent(event);
    expect(parseMock).not.toHaveBeenCalled();
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
    const { root, findByTestId } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: { files: [makeFile("addresses.csv")] },
    });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/CSV import failed/);
    expect(toast.textContent).not.toMatch(/geocoder/);
  });

  it("does nothing when the root ref never attaches to a DOM node", () => {
    // Harness that calls the hook but never renders the ref'd element —
    // exercises the `if (!root) return;` guard inside the effect.
    function UnattachedHarness() {
      const rootRef = useRef<HTMLDivElement | null>(null);
      useDataFileImport(rootRef, vi.fn());
      return null;
    }
    // No throw = the effect's `if (!root) return;` guard was taken cleanly.
    expect(() =>
      render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(UnattachedHarness),
        ),
      ),
    ).not.toThrow();
  });
});

describe("useDataFileImport — importFile (deliberate file-picker action)", () => {
  it("imports a .geojson file picked via importFile the same way a drop would", async () => {
    const { registerDataLayer } = renderHarness();

    lastImportFile!(makeFile("picked.geojson"));

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(registerDataLayer.mock.calls[0][0].label).toBe("picked.geojson");
  });

  it("imports a .zip Shapefile bundle picked via importFile", async () => {
    parseShapefileMock.mockResolvedValue(POLY_FC);
    const { registerDataLayer } = renderHarness();

    lastImportFile!(makeFile("parcels.zip"));

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(parseShapefileMock).toHaveBeenCalledTimes(1);
  });

  it("toasts an explicit 'unsupported file type' error for an unrecognized extension — unlike drag-drop's silent no-op", async () => {
    const { registerDataLayer, findByTestId } = renderHarness();

    lastImportFile!(makeFile("notes.txt"));

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/unsupported file type/i);
    expect(toast.textContent).toMatch(/notes\.txt/);
    expect(parseMock).not.toHaveBeenCalled();
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  // A format with no import path yet is a gap in this app, not a mistake by
  // the person holding the file — and "unsupported file type" sends them off
  // to convert a file that was already correct. The list holds only formats
  // that genuinely have no path; `detectExt` claims every importable
  // extension (GeoTIFF included) before this message is reached.
  it.each([["wards.gpkg", "GeoPackage"]])(
    "names the format and says 'not yet' for %s, rather than blaming the file",
    async (fileName, label) => {
      const { registerDataLayer, findByTestId } = renderHarness();

      lastImportFile!(makeFile(fileName));

      const toast = await findByTestId("toast-error");
      expect(toast.textContent).toContain(label);
      expect(toast.textContent).toMatch(/isn't supported yet/i);
      expect(toast.textContent).not.toMatch(/unsupported file type/i);
      expect(registerDataLayer).not.toHaveBeenCalled();
    },
  );
});

describe("useDataFileImport — KML, KMZ and GPX", () => {
  it("imports a file with one geometry kind as one layer named after the file", async () => {
    parseKMLMock.mockResolvedValue({ fc: LINE_FC, droppedCount: 0 });
    const { root, registerDataLayer } = renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("trail.kml")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(parseKMLMock).toHaveBeenCalledTimes(1);
    const arg = registerDataLayer.mock.calls[0][0];
    expect(arg.label).toBe("trail.kml");
    expect(arg.fc).toEqual(LINE_FC);
    expect(arg.provenance).toEqual({
      sourceFile: "trail.kml",
      droppedCount: 0,
    });
  });

  it("imports a file with points and lines as one layer per kind, lines first", async () => {
    parseGPXMock.mockResolvedValue({ fc: MIXED_FC, droppedCount: 0 });
    const { root, registerDataLayer, onImported, findByTestId } =
      renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("hike.gpx")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(2));
    const [lines, points] = registerDataLayer.mock.calls.map((c) => c[0]);
    expect(lines.label).toBe("hike.gpx — lines");
    expect(lines.fc).toEqual(LINE_FC);
    expect(points.label).toBe("hike.gpx — points");
    expect(points.fc).toEqual(POINT_FC);
    expect(lines.id).not.toBe(points.id);
    expect(registerDataLayer).toHaveBeenCalledTimes(2);
    expect(onImported).toHaveBeenCalledTimes(1);
    const toast = await findByTestId("toast-success");
    expect(toast.textContent).toMatch(/3 features imported as 2 layers/);
  });

  it("records the dropped count once, on the first layer, so the total stays true", async () => {
    parseGPXMock.mockResolvedValue({ fc: MIXED_FC, droppedCount: 4 });
    const { root, registerDataLayer } = renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("hike.gpx")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(2));
    expect(registerDataLayer.mock.calls.map((c) => c[0].provenance)).toEqual([
      { sourceFile: "hike.gpx", droppedCount: 4 },
      { sourceFile: "hike.gpx", droppedCount: 0 },
    ]);
  });

  it("names a polygon layer 'areas'", async () => {
    parseKMZMock.mockResolvedValue({
      fc: {
        type: "FeatureCollection",
        features: [...POLY_FC.features, ...POINT_FC.features],
      },
      droppedCount: 0,
    });
    const { registerDataLayer } = renderHarness();

    lastImportFile!(makeFile("Parks.KMZ"));

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(2));
    expect(parseKMZMock).toHaveBeenCalledTimes(1);
    expect(registerDataLayer.mock.calls.map((c) => c[0].label)).toEqual([
      "Parks.KMZ — areas",
      "Parks.KMZ — points",
    ]);
  });

  it.each([
    ["application/gpx+xml", parseGPXMock],
    ["application/vnd.google-earth.kml+xml", parseKMLMock],
    ["application/vnd.google-earth.kmz", parseKMZMock],
  ])(
    "detects a file with no known extension by its MIME type %s",
    async (type, parser) => {
      parser.mockResolvedValue({ fc: LINE_FC, droppedCount: 0 });
      const { registerDataLayer } = renderHarness();

      lastImportFile!(makeFile("download", "", type));

      await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
      expect(parser).toHaveBeenCalledTimes(1);
    },
  );

  it("shows the parser's message and registers nothing on a GeoXmlParseError", async () => {
    parseKMLMock.mockRejectedValue(
      new FakeGeoXmlParseError(
        "KML",
        "MALFORMED_XML",
        "The file is not well-formed XML.",
      ),
    );
    const { root, registerDataLayer, onImported, findByTestId } =
      renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("bad.kml")] } });

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(
      /KML import failed — The file is not well-formed XML\./,
    );
    expect(registerDataLayer).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});

// The sheet panel defaults closed, and a successful import is the one moment
// a user wants it open. So `onImported` has to be exactly "a layer reached
// the map AND the document" — firing it on a failure would pop a panel open
// to show the user nothing.
describe("useDataFileImport — onImported (success-only signal)", () => {
  it("fires after the layer is registered", async () => {
    const { root, registerDataLayer, onImported } = renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("a.geojson")] } });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("fires once per import, not once per feature", async () => {
    const { root, onImported } = renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("a.geojson")] } });
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it("does NOT fire when the parse fails", async () => {
    parseMock.mockRejectedValueOnce(new FakeGeoJSONParseError("bad json"));
    const { root, onImported, findByTestId } = renderHarness();

    fireEvent.drop(root, { dataTransfer: { files: [makeFile("a.geojson")] } });

    await findByTestId("toast-error");
    expect(onImported).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The raster path.
//
// The decoder has its own tests against real GeoTIFF bytes; these are about the
// wiring around it. What can go wrong here is not decoding — it is ordering
// (the image must reach its store before the map reads a URL from it), routing
// (a .tif must not reach the FeatureCollection parser), and error translation
// (an unplaceable CRS has to arrive as advice, not as "import failed").
// ---------------------------------------------------------------------------

const DECODED = {
  rgba: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
  corners: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  crs: "EPSG:4326",
};

describe("useDataFileImport — GeoTIFF", () => {
  beforeEach(() => {
    decodeGeoTiffMock.mockResolvedValue(DECODED);
    encodeRasterPngMock.mockResolvedValue(new Blob([new Uint8Array([1])]));
  });

  it("registers a raster layer with its image", async () => {
    const { registerRasterLayer, registerDataLayer, onImported } =
      renderHarness();

    lastImportFile!(makeFile("survey-sheet.tif"));

    await waitFor(() => expect(registerRasterLayer).toHaveBeenCalledTimes(1));
    const [args] = registerRasterLayer.mock.calls[0];
    expect(args).toMatchObject({
      label: "survey-sheet.tif",
      corners: DECODED.corners,
      provenance: { sourceFile: "survey-sheet.tif", droppedCount: 0 },
    });
    expect(args.id).toMatch(/^rl:/);

    expect(args.image).toBeInstanceOf(Blob);
    // Never the vector path: a .tif that reached parseDroppedFile would be
    // read as JSON and fail with a message about GeoJSON.
    expect(registerDataLayer).not.toHaveBeenCalled();
    expect(parseMock).not.toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it.each([".tif", ".tiff", ".geotiff"])(
    "routes %s to the raster path",
    async (ext) => {
      const { registerRasterLayer } = renderHarness();

      lastImportFile!(makeFile(`sheet${ext}`));

      await waitFor(() => expect(registerRasterLayer).toHaveBeenCalledTimes(1));
    },
  );

  it("tells the user to reproject, rather than that the import failed", async () => {
    decodeGeoTiffMock.mockRejectedValue(
      new FakeUnsupportedRasterCrsError("EPSG:32643"),
    );
    const { registerRasterLayer, findByTestId } = renderHarness();

    lastImportFile!(makeFile("utm-survey.tif"));

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toContain("EPSG:32643");
    expect(toast.textContent).toMatch(/reproject/i);
    // The distinction the separate error type exists for. "Import failed"
    // sends someone to check a file that was never the problem.
    expect(toast.textContent).not.toMatch(/failed unexpectedly/i);
    expect(registerRasterLayer).not.toHaveBeenCalled();
  });

  it("passes a decode failure's own sentence through", async () => {
    decodeGeoTiffMock.mockRejectedValue(
      new FakeRasterDecodeError("this TIFF states no position"),
    );
    const { findByTestId } = renderHarness();

    lastImportFile!(makeFile("plain.tif"));

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toContain("states no position");
  });

  it("says so when the browser cannot encode the image", async () => {
    encodeRasterPngMock.mockResolvedValue(null);
    const { registerRasterLayer, findByTestId } = renderHarness();

    lastImportFile!(makeFile("sheet.tif"));

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/cannot encode/i);
    // Nothing half-registered: no row in the panel for a layer with no image.
    expect(registerRasterLayer).not.toHaveBeenCalled();
  });
});

describe("useDataFileImport — limits, many files, cancel", () => {
  it("refuses a file over the size limit and states the limit", async () => {
    const { registerDataLayer, findByTestId } = renderHarness();
    const big = Object.assign(makeFile("huge.geojson"), {
      size: 300 * 1024 * 1024,
    });

    lastImportFile!(big);

    const toast = await findByTestId("toast-error");
    expect(toast.textContent).toMatch(/huge\.geojson is 300 MB/);
    expect(toast.textContent).toMatch(/up to 256 MB/);
    expect(parseMock).not.toHaveBeenCalled();
    expect(registerDataLayer).not.toHaveBeenCalled();
  });

  it("reads a .json file as GeoJSON", async () => {
    const { registerDataLayer } = renderHarness();
    lastImportFile!(makeFile("parcels.json"));
    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(1));
    expect(registerDataLayer.mock.calls[0][0].label).toBe("parcels.json");
  });

  it("imports every data file of a drop and says which files it skipped", async () => {
    const { root, registerDataLayer, findByTestId } = renderHarness();
    fireEvent.drop(root, {
      dataTransfer: {
        files: [
          makeFile("a.geojson"),
          makeFile("notes.txt"),
          makeFile("b.geojson"),
        ],
      },
    });

    await waitFor(() => expect(registerDataLayer).toHaveBeenCalledTimes(2));
    expect(registerDataLayer.mock.calls.map((c) => c[0].label)).toEqual([
      "a.geojson",
      "b.geojson",
    ]);
    expect((await findByTestId("toast-warning")).textContent).toMatch(
      /1 of the dropped files is not a data file/,
    );
  });

  it("Cancel on the progress toast stops the import", async () => {
    parseMock.mockReturnValue(new Promise(() => {}));
    const { registerDataLayer, findByTestId, onImported } = renderHarness();

    lastImportFile!(makeFile("slow.geojson"));
    fireEvent.click(await findByTestId("toast-action"));

    await waitFor(() =>
      expect(document.body.textContent).toMatch(
        /slow\.geojson: import cancelled/,
      ),
    );
    expect(registerDataLayer).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});
