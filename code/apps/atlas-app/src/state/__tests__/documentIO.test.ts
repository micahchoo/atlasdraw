// SPDX-License-Identifier: AGPL-3.0-only
//
// The document's file form: what a save writes (toFile, encode) and what an
// open reads and applies (decode, fromFile, loadDocument). Run at the
// Document interface with a stateful scene stand-in.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { write } from "@atlasdraw/data";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import {
  createDocument,
  currentDocument,
  openDocument,
  type Document,
  type RasterCorners,
} from "../document";
import {
  decode,
  encode,
  fromFile,
  hasUnsavedWork,
  loadDocument,
  markSavedToFile,
  toFile,
} from "../documentIO";
import { sceneOf } from "../scene";
import { useBasemapStore } from "../basemap";
import { useMapInstanceStore } from "../mapInstance";

import {
  FakeCameraMap,
  geoRect,
  makeFakeExcalidraw,
  savedDocument,
  savedManifest,
} from "./fixtures/documentWorld";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";

const FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { n: 1 },
      geometry: { type: "Point", coordinates: [13.4, 52.5] },
    },
  ],
};

const CORNERS: RasterCorners = [
  [13, 53],
  [14, 53],
  [14, 52],
  [13, 52],
];

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

function withLayers(doc: Document): Document {
  doc.dispatch({
    type: "add-data-layer",
    id: "dl:wells",
    fc: FC,
    label: "Wells",
    style: { fillColor: "#0aa" },
    provenance: { sourceFile: "wells.csv", droppedCount: 2 },
  });
  doc.dispatch({
    type: "add-raster-layer",
    id: "rl:sheet",
    label: "Sheet",
    corners: CORNERS,
    imageKey: "raster-sheet.png",
    image: new Blob(["png-bytes"], { type: "image/png" }),
  });
  return doc;
}

// jsdom's Blob has no arrayBuffer(), which the zip writer and reader call.
// Browsers and Node have it; FileReader gives the same bytes.
beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

beforeEach(() => {
  useBasemapStore.setState({ activeBasemapId: "protomaps-light" });
  useMapInstanceStore.setState({ map: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toFile", () => {
  it("writes identity, title, layers, payloads, and the live camera and basemap", () => {
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const doc = withLayers(
      createDocument(
        {
          id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
          createdAt: "2026-05-06T00:00:00.000Z",
          title: "Field notes",
        },
        sceneOf(fx.api),
      ),
    );
    useBasemapStore.setState({ activeBasemapId: "protomaps-dark" });
    useMapInstanceStore.setState({
      map: new FakeCameraMap({
        center: [-74, 40.7],
        zoom: 12.5,
        bearing: 15,
      }) as unknown as maplibregl.Map,
    });

    const file = toFile(doc, "2026-10-01T09:00:00.000Z");

    expect(file.manifest).toMatchObject({
      id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
      version: 2,
      title: "Field notes",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
      basemap: { type: "registry", id: "protomaps-dark" },
      camera: { center: [-74, 40.7], zoom: 12.5, bearing: 15, pitch: 0 },
    });
    expect(file.manifest.layers).toEqual([
      {
        kind: "data",
        id: "dl:wells",
        label: "Wells",
        visible: true,
        featureCount: 1,
        geometryKind: "circle",
        style: { fillColor: "#0aa" },
        source: "data/layer-dl:wells.geojson",
        provenance: { sourceFile: "wells.csv", droppedCount: 2 },
      },
      {
        kind: "raster",
        id: "rl:sheet",
        label: "Sheet",
        visible: true,
        corners: CORNERS,
        opacity: 1,
        imageKey: "raster-sheet.png",
      },
    ]);
    expect(file.layers.get("dl:wells")).toBe(FC);
    expect(file.files.has("raster-sheet.png")).toBe(true);
    expect(file.scene.map((e) => e.id)).toEqual(["rect-1"]);
  });

  it("writes only the scene files a live element uses, beside the raster images", () => {
    const fx = makeFakeExcalidraw([
      { ...geoRect("photo"), type: "image", fileId: "img-live" },
      {
        ...geoRect("gone"),
        type: "image",
        fileId: "img-dead",
        isDeleted: true,
      },
    ]);
    fx.api.addFiles([
      { id: "img-live", mimeType: "image/png", dataURL: PNG, created: 0 },
      { id: "img-dead", mimeType: "image/png", dataURL: PNG, created: 0 },
      { id: "img-orphan", mimeType: "image/png", dataURL: PNG, created: 0 },
    ] as never);
    const doc = withLayers(createDocument({}, sceneOf(fx.api)));

    const file = toFile(doc);

    expect([...file.files.keys()].sort()).toEqual([
      "img-live",
      "raster-sheet.png",
    ]);
  });

  it("keeps updatedAt when nothing changed, and moves it when something did", () => {
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const doc = createDocument(
      { createdAt: "2026-05-06T00:00:00.000Z" },
      sceneOf(fx.api),
    );

    const first = toFile(doc, "2026-10-01T09:00:00.000Z").manifest.updatedAt;
    const again = toFile(doc, "2026-10-01T09:00:10.000Z").manifest.updatedAt;
    doc.dispatch({ type: "rename-document", title: "Renamed" });
    const after = toFile(doc, "2026-10-01T09:00:20.000Z").manifest.updatedAt;

    expect(again).toBe(first);
    expect(after).toBe("2026-10-01T09:00:20.000Z");
  });
});

describe("encode", () => {
  it("gives the same bytes for the same document, whatever the clock", async () => {
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const doc = withLayers(createDocument({}, sceneOf(fx.api)));
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
    const first = new Uint8Array(await (await encode(doc)).arrayBuffer());
    vi.setSystemTime(new Date("2026-10-01T09:05:00.000Z"));
    const second = new Uint8Array(await (await encode(doc)).arrayBuffer());

    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });
});

describe("decode", () => {
  it("reads a file a v1 build saved, through the migrations", async () => {
    const result = await decode(await write(savedDocument()));

    expect(result.ok).toBe(true);
    const file = result.ok ? result.file : null;
    expect(file?.manifest.version).toBe(2);
    expect(file?.manifest.layers).toEqual([]);
  });

  it("returns an error, not a throw, for bytes that are not a document", async () => {
    const result = await decode(new Blob(["not a zip"]));

    expect(result.ok).toBe(false);
  });
});

describe("fromFile", () => {
  async function v2File(
    layers: AtlasdrawDocument["manifest"]["layers"],
    payloads: Partial<Pick<AtlasdrawDocument, "layers" | "files">> = {},
  ): Promise<AtlasdrawDocument> {
    const result = await decode(
      await write(
        savedDocument({
          manifest: savedManifest({ layers }),
          layers: payloads.layers ?? new Map(),
          files: payloads.files ?? new Map(),
        }),
      ),
    );
    if (!result.ok) {
      throw result.error;
    }
    return result.file;
  }

  it("keeps a saved geometry kind, and decides it for a file without one", async () => {
    const polygons: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: null },
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
                [0, 0],
              ],
            ],
          },
        },
      ],
    } as unknown as FeatureCollection;
    const layer = (id: string, extra: Record<string, unknown> = {}) => ({
      kind: "data" as const,
      id,
      label: id,
      visible: true,
      featureCount: 2,
      style: {},
      source: `data/layer-${id}.geojson`,
      ...extra,
    });
    const file = await v2File(
      [layer("dl:old"), layer("dl:saved", { geometryKind: "line" })],
      {
        layers: new Map([
          ["dl:old", polygons],
          ["dl:saved", polygons],
        ]),
      },
    );

    const kinds = fromFile(file).overlays?.map((e) =>
      e.kind === "data" ? [e.id, e.geometryKind] : [],
    );
    expect(kinds).toEqual([
      ["dl:old", "fill"],
      ["dl:saved", "line"],
    ]);
  });

  it("rebuilds layers with their payloads, visibility and provenance", async () => {
    const image = new Blob(["png"], { type: "image/png" });
    const file = await v2File(
      [
        {
          kind: "data",
          id: "dl:wells",
          label: "Wells",
          visible: false,
          featureCount: 1,
          style: {},
          source: "data/layer-dl:wells.geojson",
          provenance: { sourceFile: "wells.csv", droppedCount: 0 },
        },
        {
          kind: "raster",
          id: "rl:sheet",
          label: "Sheet",
          visible: true,
          corners: CORNERS,
          opacity: 0.5,
          imageKey: "raster-sheet.png",
        },
      ],
      {
        layers: new Map([["dl:wells", FC]]),
        files: new Map([["raster-sheet.png", image]]),
      },
    );

    const state = fromFile(file);

    expect(state.overlays).toMatchObject([
      {
        id: "dl:wells",
        visible: false,
        provenance: { sourceFile: "wells.csv" },
      },
      { id: "rl:sheet", opacity: 0.5 },
    ]);
    expect(state.featureCollections?.["dl:wells"]).toEqual(FC);
    expect(state.images?.["rl:sheet"]).toBeInstanceOf(Blob);
  });

  it("skips a layer whose payload is missing rather than show a row that cannot draw", async () => {
    const file = await v2File([
      {
        kind: "data",
        id: "dl:empty",
        label: "x",
        visible: true,
        featureCount: 1,
        style: {},
        source: "data/layer-dl:empty.geojson",
      },
      {
        kind: "raster",
        id: "rl:empty",
        label: "x",
        visible: true,
        corners: CORNERS,
        opacity: 1,
        imageKey: "missing.png",
      },
    ]);

    expect(fromFile(file).overlays).toEqual([]);
  });
});

describe("tile layers in the file (W9d)", () => {
  const URL_T = "https://tiles.example.org/{z}/{x}/{y}.png";
  const withTiles = (doc: Document): Document => {
    doc.dispatch({
      type: "add-tile-layer",
      id: "tl:aerial",
      label: "Aerial",
      url: URL_T,
      attribution: "© Example",
      opacity: 0.7,
    });
    doc.dispatch({
      type: "add-tile-layer",
      id: "tl:topo",
      label: "Topo",
      url: URL_T.replace(".png", ".jpg"),
    });
    doc.dispatch({ type: "set-visibility", id: "tl:topo", visible: false });
    return doc;
  };

  it("a document without tile layers writes no tileLayers field", () => {
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const file = toFile(withLayers(createDocument({}, sceneOf(fx.api))));
    expect("tileLayers" in file.manifest).toBe(false);
  });

  it("writes tile layers bottom first, apart from the other layers", () => {
    const fx = makeFakeExcalidraw([]);
    const file = toFile(withTiles(createDocument({}, sceneOf(fx.api))));

    expect(file.manifest.layers).toEqual([]);
    expect(file.manifest.tileLayers).toEqual([
      {
        kind: "tile",
        id: "tl:aerial",
        label: "Aerial",
        visible: true,
        opacity: 0.7,
        url: URL_T,
        attribution: "© Example",
      },
      {
        kind: "tile",
        id: "tl:topo",
        label: "Topo",
        visible: false,
        opacity: 1,
        url: URL_T.replace(".png", ".jpg"),
      },
    ]);
  });

  it("comes back from the bytes as the same tile layers", async () => {
    const fx = makeFakeExcalidraw([]);
    const doc = withTiles(createDocument({}, sceneOf(fx.api)));
    const result = await decode(await encode(doc));
    expect(result.ok).toBe(true);
    const reopened = createDocument(
      fromFile(result.ok ? result.file : savedDocument()),
    );

    expect(reopened.snapshot().overlays).toEqual(doc.snapshot().overlays);
  });

  it("skips a tile layer whose URL the editor would refuse", async () => {
    const fx = makeFakeExcalidraw([]);
    const file = toFile(withTiles(createDocument({}, sceneOf(fx.api))));
    const tampered = {
      ...file,
      manifest: {
        ...file.manifest,
        tileLayers: file.manifest.tileLayers?.map((t) =>
          t.id === "tl:topo"
            ? { ...t, url: "http://tracker.example.org/{z}/{x}/{y}" }
            : t,
        ),
      },
    };
    const result = await decode(await write(tampered));
    const state = fromFile(result.ok ? result.file : savedDocument());

    expect(state.overlays?.map((e) => e.id)).toEqual(["tl:aerial"]);
  });
});

describe("loadDocument", () => {
  it("opens a new document with the file's identity and layers, at revision 0", async () => {
    const fx = makeFakeExcalidraw();
    const before = currentDocument();
    const file = (await decode(await write(savedDocument()))) as {
      ok: true;
      file: AtlasdrawDocument;
    };

    const doc = await loadDocument(file.file, fx.api);

    expect(currentDocument()).toBe(doc);
    expect(doc).not.toBe(before);
    expect(doc?.id).toBe("01HZ8KQR5Z3MV7BJ4N6XPYD9TF");
    expect(doc?.revision).toBe(0);
    expect(doc?.snapshot().title).toBe("Field notes");
    expect(useBasemapStore.getState().activeBasemapId).toBe("protomaps-dark");
    expect(fx.api.getSceneElements().map((e) => e.id)).toEqual(["rect-1"]);
  });

  it("changes nothing when the editor went away before the apply", async () => {
    const fx = makeFakeExcalidraw();
    const before = currentDocument();
    const abort = new AbortController();
    abort.abort();

    const doc = await loadDocument(savedDocument(), fx.api, {
      signal: abort.signal,
    });

    expect(doc).toBeNull();
    expect(currentDocument()).toBe(before);
    expect(fx.api.getSceneElements()).toEqual([]);
  });

  it("leaves a document that opened while the files were read, such as a room", async () => {
    const fx = makeFakeExcalidraw();

    const pending = loadDocument(savedDocument(), fx.api);
    const room = createDocument({ title: "Shared survey" });
    openDocument(room);

    expect(await pending).toBeNull();
    expect(currentDocument()).toBe(room);
    expect(fx.api.getSceneElements()).toEqual([]);
  });

  it("of two opens, the later one wins, whichever finishes first", async () => {
    const fx = makeFakeExcalidraw();
    const second: AtlasdrawDocument = {
      ...savedDocument(),
      manifest: { ...savedDocument().manifest, title: "Second" },
    };

    const results = await Promise.all([
      loadDocument(savedDocument(), fx.api),
      loadDocument(second, fx.api),
    ]);

    expect(results[0]).toBeNull();
    expect(currentDocument()).toBe(results[1]);
    expect(currentDocument().snapshot().title).toBe("Second");
  });

  it("hands Excalidraw the drawing as one step that undo does not take back", async () => {
    const fx = makeFakeExcalidraw();
    const update = vi.spyOn(fx.api, "updateScene");

    await loadDocument(savedDocument(), fx.api);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: "NEVER" }),
    );
  });

  it("gives Excalidraw the scene's files but not the raster images", async () => {
    const fx = makeFakeExcalidraw();
    const add = vi.spyOn(fx.api, "addFiles");
    const file: AtlasdrawDocument = {
      ...savedDocument(),
      manifest: {
        ...savedDocument().manifest,
        version: 2,
        layers: [
          {
            kind: "raster",
            id: "rl:sheet",
            label: "Sheet",
            visible: true,
            corners: CORNERS,
            opacity: 1,
            imageKey: "raster-sheet.png",
          },
        ],
      },
      files: new Map([
        ["raster-sheet.png", new Blob(["png"], { type: "image/png" })],
        ["img-1", new Blob(["img"], { type: "image/png" })],
      ]),
    };

    await loadDocument(file, fx.api);

    const given = add.mock.calls.flatMap(([files]) =>
      (files as Array<{ id: string }>).map((f) => f.id),
    );
    expect(given).toEqual(["img-1"]);
  });
});

describe("unsaved work", () => {
  it("a blank document has none", () => {
    const doc = createDocument({}, sceneOf(makeFakeExcalidraw().api));
    expect(hasUnsavedWork(doc)).toBe(false);
  });

  it("a drawing not written to a file is unsaved work, until it is written", () => {
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const doc = createDocument({}, sceneOf(fx.api));
    expect(hasUnsavedWork(doc)).toBe(true);

    markSavedToFile(doc);
    expect(hasUnsavedWork(doc)).toBe(false);

    doc.dispatch({ type: "rename-document", title: "Changed" });
    expect(hasUnsavedWork(doc)).toBe(true);
  });

  it("loading alone does not say the document is in a file", async () => {
    // loadDocument also opens the autosave and share links; only Open from
    // a file marks it saved (MapEditor.openAtlasDocument).
    const fx = makeFakeExcalidraw();
    const doc = await loadDocument(savedDocument(), fx.api);
    expect(doc && hasUnsavedWork(doc)).toBe(true);
  });
});

describe("comments in the file", () => {
  it("a comment is saved with the document and comes back on open", async () => {
    const doc = createDocument({ title: "With a comment" });
    doc.comments.addComment({
      text: "survey marker is 2 m east",
      anchor: { kind: "map", lng: 13.4, lat: 52.5 },
      authorId: "u1",
      authorName: "Ada",
    });

    const result = await decode(await encode(doc));
    if (!result.ok) {
      throw result.error;
    }
    const reopened = createDocument(fromFile(result.file));

    expect(reopened.comments.comments).toEqual(doc.comments.comments);
  });

  it("a comment change is unsaved work", () => {
    const doc = createDocument();
    markSavedToFile(doc);
    doc.comments.addComment({
      text: "late note",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "u1",
      authorName: "Ada",
    });

    expect(hasUnsavedWork(doc)).toBe(true);
  });
});
