// SPDX-License-Identifier: AGPL-3.0-only
//
// The Document interface: identity, revision and the updatedAt stamp.

import { describe, expect, it } from "vitest";

import {
  createDocument,
  DEFAULT_DOCUMENT_TITLE,
  type Document,
  type RasterCorners,
} from "../document";

import type { FeatureCollection } from "geojson";

const LOADED = {
  id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
};

describe("document identity", () => {
  it("mints an id when none is given, and starts updatedAt at createdAt", () => {
    const doc = createDocument({ createdAt: "2026-10-01T09:00:00.000Z" });

    expect(doc.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(doc.snapshot().updatedAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("keeps a loaded id and creation time", () => {
    const doc = createDocument(LOADED);

    expect(doc.id).toBe(LOADED.id);
    expect(doc.snapshot()).toMatchObject(LOADED);
  });

  it("two documents get two ids", () => {
    expect(createDocument().id).not.toBe(createDocument().id);
  });
});

describe("updatedAt", () => {
  it("does not move when the content key is the one the document settled on", () => {
    const doc = createDocument(LOADED);
    doc.settle("k0");

    expect(doc.stamp("k0", "2026-10-01T09:00:00.000Z")).toBe(LOADED.updatedAt);
    expect(doc.stamp("k0", "2026-10-01T09:00:10.000Z")).toBe(LOADED.updatedAt);
  });

  it("moves to the save time when the content key changed, then holds", () => {
    const doc = createDocument(LOADED);
    doc.settle("k0");

    expect(doc.stamp("k1", "2026-10-01T09:00:00.000Z")).toBe(
      "2026-10-01T09:00:00.000Z",
    );
    expect(doc.stamp("k1", "2026-10-01T09:00:10.000Z")).toBe(
      "2026-10-01T09:00:00.000Z",
    );
    expect(doc.snapshot().updatedAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("never goes before createdAt, whatever the clock says", () => {
    const doc = createDocument(LOADED);

    expect(doc.stamp("k1", "2020-01-01T00:00:00.000Z")).toBe(LOADED.createdAt);
  });
});

// ---------------------------------------------------------------------------
// Commands: the map layers, their payloads, and the title
// ---------------------------------------------------------------------------

const fc = (n: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    properties: { i },
    geometry: { type: "Point", coordinates: [i, 0] },
  })),
});

const CORNERS: RasterCorners = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

function addData(doc: Document, id: string, label = id): FeatureCollection {
  const payload = fc(2);
  doc.dispatch({ type: "add-data-layer", id, fc: payload, label, style: {} });
  return payload;
}

function addRaster(doc: Document, id: string): Blob {
  const image = new Blob(["png"]);
  doc.dispatch({
    type: "add-raster-layer",
    id,
    label: id,
    corners: CORNERS,
    imageKey: `${id}.png`,
    image,
  });
  return image;
}

const ids = (doc: Document) => doc.snapshot().overlays.map((e) => e.id);

describe("layer commands", () => {
  it("add-data-layer stores the entry and its FeatureCollection", () => {
    const doc = createDocument();
    const payload = addData(doc, "dl:a", "Wells");

    expect(doc.snapshot().overlays).toEqual([
      {
        kind: "data",
        id: "dl:a",
        label: "Wells",
        visible: true,
        order: 0,
        featureCount: 2,
        geometryKind: "circle",
        style: {},
      },
    ]);
    expect(doc.snapshot().featureCollections["dl:a"]).toBe(payload);
  });

  it("refuses a data layer id without the dl: prefix", () => {
    const doc = createDocument();
    expect(() => addData(doc, "a")).toThrow(/dl:/);
    expect(ids(doc)).toEqual([]);
  });

  it("ignores a second layer with the same id", () => {
    const doc = createDocument();
    addData(doc, "dl:a", "first");
    const revision = doc.revision;
    addData(doc, "dl:a", "second");

    expect(doc.snapshot().overlays.map((e) => e.label)).toEqual(["first"]);
    expect(doc.revision).toBe(revision);
  });

  it("add-raster-layer stores the entry and the image, fully opaque", () => {
    const doc = createDocument();
    const image = addRaster(doc, "rl:sheet");

    expect(doc.snapshot().overlays[0]).toMatchObject({
      kind: "raster",
      id: "rl:sheet",
      opacity: 1,
      imageKey: "rl:sheet.png",
    });
    expect(doc.snapshot().images["rl:sheet"]).toBe(image);
    expect(() => addRaster(doc, "sheet")).toThrow(/rl:/);
  });

  it("rename, visibility and restyle change one entry; the others keep their identity", () => {
    const doc = createDocument();
    addData(doc, "dl:a");
    addData(doc, "dl:b");
    const before = doc.snapshot().overlays;

    doc.dispatch({ type: "rename-layer", id: "dl:a", label: "Roads" });
    doc.dispatch({ type: "set-visibility", id: "dl:a", visible: false });
    doc.dispatch({
      type: "restyle",
      id: "dl:a",
      patch: { fillColor: "#f00" },
    });

    const [a, b] = doc.snapshot().overlays;
    expect(a).toMatchObject({
      label: "Roads",
      visible: false,
      style: { fillColor: "#f00" },
    });
    expect(b).toBe(before[1]);
  });

  it("reorder moves an entry within its own kind and clamps", () => {
    const doc = createDocument();
    addData(doc, "dl:a");
    addRaster(doc, "rl:x");
    addData(doc, "dl:b");
    addData(doc, "dl:c");

    doc.dispatch({ type: "reorder", id: "dl:a", order: 99 });

    expect(ids(doc)).toEqual(["dl:b", "rl:x", "dl:c", "dl:a"]);
    const orderOf = (id: string) =>
      doc.snapshot().overlays.find((e) => e.id === id)?.order;
    expect([orderOf("dl:b"), orderOf("dl:c"), orderOf("dl:a")]).toEqual([
      0, 1, 2,
    ]);
    expect(orderOf("rl:x")).toBe(0);
  });

  it("remove-layer drops the entry with its FeatureCollection or image", () => {
    const doc = createDocument();
    addData(doc, "dl:a");
    addRaster(doc, "rl:x");

    doc.dispatch({ type: "remove-layer", id: "dl:a" });
    doc.dispatch({ type: "remove-layer", id: "rl:x" });

    expect(doc.snapshot()).toMatchObject({
      overlays: [],
      featureCollections: {},
      images: {},
    });
  });

  it("rename-document folds a blank title back to the default", () => {
    const doc = createDocument();
    doc.dispatch({ type: "rename-document", title: "Field notes" });
    expect(doc.snapshot().title).toBe("Field notes");

    doc.dispatch({ type: "rename-document", title: "   " });
    expect(doc.snapshot().title).toBe(DEFAULT_DOCUMENT_TITLE);
  });
});

describe("tile layers (W9d)", () => {
  const URL_T = "https://tiles.example.org/{z}/{x}/{y}.png";
  const addTile = (doc: Document, id: string, opacity?: number) =>
    doc.dispatch({
      type: "add-tile-layer",
      id,
      label: id,
      url: URL_T,
      attribution: "© Example",
      ...(opacity !== undefined ? { opacity } : {}),
    });

  it("add-tile-layer stores the entry, visible and fully opaque by default", () => {
    const doc = createDocument();
    addTile(doc, "tl:aerial");

    expect(doc.snapshot().overlays).toEqual([
      {
        kind: "tile",
        id: "tl:aerial",
        label: "tl:aerial",
        visible: true,
        order: 0,
        opacity: 1,
        url: URL_T,
        attribution: "© Example",
      },
    ]);
    expect(() => addTile(doc, "aerial")).toThrow(/tl:/);
  });

  it("tile layers are their own stack", () => {
    const doc = createDocument();
    addTile(doc, "tl:a");
    addData(doc, "dl:x");
    addTile(doc, "tl:b");

    doc.dispatch({ type: "reorder", id: "tl:a", order: 5 });

    const orderOf = (id: string) =>
      doc.snapshot().overlays.find((e) => e.id === id)?.order;
    expect([orderOf("tl:b"), orderOf("tl:a"), orderOf("dl:x")]).toEqual([
      0, 1, 0,
    ]);
  });

  it("set-opacity changes a tile layer's or a raster's opacity, clamped to 0..1", () => {
    const doc = createDocument();
    addTile(doc, "tl:a", 0.5);
    addRaster(doc, "rl:x");
    addData(doc, "dl:d");
    const data = doc.snapshot().overlays[2];

    doc.dispatch({ type: "set-opacity", id: "tl:a", opacity: 0.25 });
    doc.dispatch({ type: "set-opacity", id: "rl:x", opacity: 7 });
    const revision = doc.revision;
    doc.dispatch({ type: "set-opacity", id: "dl:d", opacity: 0.1 });

    const [a, x, d] = doc.snapshot().overlays;
    expect(a).toMatchObject({ opacity: 0.25 });
    expect(x).toMatchObject({ opacity: 1 });
    // A data layer's opacity is its style: set-opacity does not apply.
    expect(d).toBe(data);
    expect(doc.revision).toBe(revision);
  });

  it("remove-layer drops a tile layer", () => {
    const doc = createDocument();
    addTile(doc, "tl:a");
    doc.dispatch({ type: "remove-layer", id: "tl:a" });
    expect(ids(doc)).toEqual([]);
  });
});

describe("revision and subscribers", () => {
  it("rises by one on each real change and tells subscribers", () => {
    const doc = createDocument();
    let heard = 0;
    doc.subscribe(() => {
      heard += 1;
    });

    addData(doc, "dl:a");
    doc.dispatch({ type: "rename-layer", id: "dl:a", label: "Roads" });

    expect(doc.revision).toBe(2);
    expect(heard).toBe(2);
  });

  it("does not move for a command that changes nothing", () => {
    const doc = createDocument();
    addData(doc, "dl:a");
    const snapshot = doc.snapshot();
    let heard = 0;
    doc.subscribe(() => {
      heard += 1;
    });

    doc.dispatch({ type: "set-visibility", id: "dl:a", visible: true });
    doc.dispatch({ type: "rename-layer", id: "dl:missing", label: "x" });
    doc.dispatch({ type: "reorder", id: "dl:a", order: 0 });
    doc.dispatch({ type: "remove-layer", id: "dl:missing" });

    expect(doc.revision).toBe(1);
    expect(heard).toBe(0);
    expect(doc.snapshot()).toBe(snapshot);
  });

  it("a save stamp is not a revision", () => {
    const doc = createDocument();
    doc.stamp("k1", "2030-01-01T00:00:00.000Z");
    expect(doc.revision).toBe(0);
  });

  it("starts from a loaded state with revision 0", () => {
    const loaded = createDocument({
      ...LOADED,
      title: "Field notes",
      overlays: [
        {
          kind: "data",
          id: "dl:a",
          label: "a",
          visible: false,
          order: 0,
          featureCount: 2,
          geometryKind: "circle",
          style: {},
        },
      ],
      featureCollections: { "dl:a": fc(2) },
    });

    expect(loaded.revision).toBe(0);
    expect(loaded.snapshot()).toMatchObject({
      title: "Field notes",
      overlays: [{ id: "dl:a", visible: false }],
    });
  });
});

describe("provenance", () => {
  it("rides on a data or raster entry, and a rename leaves it", () => {
    const doc = createDocument();
    const provenance = { sourceFile: "sites_2026.csv", droppedCount: 7 };
    doc.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: fc(1),
      label: "sites_2026.csv",
      style: {},
      provenance,
    });
    doc.dispatch({ type: "rename-layer", id: "dl:a", label: "Field sites" });

    expect(doc.snapshot().overlays[0]).toMatchObject({
      label: "Field sites",
      provenance,
    });
  });
});
