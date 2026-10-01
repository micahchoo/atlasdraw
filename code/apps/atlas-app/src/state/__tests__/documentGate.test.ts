// SPDX-License-Identifier: AGPL-3.0-only
//
// The document gate: every document from outside this tab (a file, a share
// link, a server copy, a room snapshot) enters through admit(). Run on real
// archive bytes made by the format's own writer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { write, type AtlasdrawDocument, type Manifest } from "@atlasdraw/data";
import { defaultLayerStyle } from "@atlasdraw/basemap";
import { LIMITS } from "@atlasdraw/protocol";

import { admit, droppedMessage, type Admitted } from "../documentGate";

import type { FeatureCollection } from "geojson";

const ID = "01HZ8KQR5Z3MV7BJ4N6XPYD9TF";
const FRAME = { z0: 22, origin: { x: 1_172_000_000, y: 700_000_000 } };

function element(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    version: 2,
    versionNonce: 7,
    isDeleted: false,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    ...extra,
  };
}

const POINTS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "well" },
      geometry: { type: "Point", coordinates: [13.4, 52.5] },
    },
  ],
};

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    id: ID,
    version: 2,
    title: "Field notes",
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    basemap: { type: "registry", id: "protomaps-light" },
    camera: { center: [13.4, 52.5], zoom: 11, bearing: 0, pitch: 0 },
    world: FRAME,
    layers: [
      {
        kind: "data",
        id: "dl:wells",
        label: "Wells",
        visible: true,
        featureCount: 1,
        geometryKind: "circle",
        style: { fillColor: "#0aa" },
        source: "data/layer-dl:wells.geojson",
      },
    ],
    permissions: { publicView: false },
    ...overrides,
  } as Manifest;
}

function document(
  overrides: Partial<AtlasdrawDocument> = {},
): AtlasdrawDocument {
  return {
    manifest: manifest(),
    scene: [element("a"), element("b")] as AtlasdrawDocument["scene"],
    layers: new Map([["dl:wells", POINTS]]),
    styleRef: {},
    files: new Map(),
    ...overrides,
  };
}

async function bytesOf(doc: AtlasdrawDocument): Promise<Blob> {
  return write(doc);
}

/** The archive of `doc`, open for changes. */
async function zipOf(doc: AtlasdrawDocument): Promise<JSZip> {
  const blob = await write(doc);
  const buffer = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
  return JSZip.loadAsync(buffer);
}

function admitted(result: Awaited<ReturnType<typeof admit>>): Admitted {
  if (!result.ok) {
    throw new Error(`refused: ${result.reason}`);
  }
  return result;
}

describe("admit: what passes", () => {
  it("admits a valid map whole, and reports nothing dropped", async () => {
    const result = admitted(await admit(await bytesOf(document()), "file"));
    expect(result.dropped).toEqual({ elements: 0, layers: 0, files: 0 });
    expect(result.doc.scene.map((e) => e.id)).toEqual(["a", "b"]);
    expect(result.doc.manifest.layers.map((l) => l.id)).toEqual(["dl:wells"]);
    expect(result.doc.layers.get("dl:wells")).toEqual(POINTS);
    expect(droppedMessage(result)).toBeNull();
  });

  it("admits an already-read document the same way as its bytes", async () => {
    const result = admitted(await admit(document(), "share"));
    expect(result.dropped).toEqual({ elements: 0, layers: 0, files: 0 });
    expect(result.doc.scene).toHaveLength(2);
  });

  it("admits a version 1 map through the format migrations", async () => {
    const bytes = readFileSync(
      resolve(
        __dirname,
        "../../../../../packages/data/src/__tests__/fixtures/v1-delhi.atlasdraw",
      ),
    );
    const result = admitted(
      await admit(new Blob([bytes as unknown as BlobPart]), "file"),
    );
    expect(result.doc.manifest.version).toBe(2);
    expect(result.dropped.elements).toBe(0);
    expect(result.doc.scene.length).toBeGreaterThan(0);
  });

  it("admits a map twice with the same result: a second pass drops nothing", async () => {
    const first = admitted(
      await admit(
        document({ scene: [element("a"), { id: "x" }] as never }),
        "file",
      ),
    );
    const second = admitted(await admit(first.doc, "file"));
    expect(second.dropped).toEqual({ elements: 0, layers: 0, files: 0 });
    expect(second.doc.scene.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("admit: what is dropped and counted", () => {
  it("drops embedded web pages and elements that cannot be drawn", async () => {
    const scene = [
      element("a"),
      element("frame", { type: "iframe" }),
      element("web", { type: "embeddable", link: "https://example.org" }),
      element("bad-x", { x: "10" }),
      { id: "no-geometry", type: "rectangle" },
      null,
    ];
    const result = admitted(
      await admit(await bytesOf(document({ scene: scene as never })), "file"),
    );
    expect(result.doc.scene.map((e) => e.id)).toEqual(["a"]);
    expect(result.dropped.elements).toBe(5);
    expect(droppedMessage(result)).toMatch(/5 drawing elements/);
  });

  it("repairs a wrong style field of an element, as a room does", async () => {
    const scene = [element("a", { strokeWidth: -3, opacity: 900 })];
    const result = admitted(
      await admit(await bytesOf(document({ scene: scene as never })), "file"),
    );
    expect(result.dropped.elements).toBe(0);
    const [a] = result.doc.scene as unknown as Array<Record<string, unknown>>;
    expect(a.strokeWidth).toBe(2);
    expect(a.opacity).toBe(100);
  });

  it("skips a layer whose GeoJSON is not JSON, and opens the rest", async () => {
    const zip = await zipOf(
      document({
        manifest: manifest({
          layers: [
            ...manifest().layers,
            {
              kind: "data",
              id: "dl:broken",
              label: "Broken",
              visible: true,
              featureCount: 1,
              style: {},
              source: "data/layer-dl:broken.geojson",
            },
          ],
        }),
      }),
    );
    zip.file("data/layer-dl:broken.geojson", "{not json");
    const bytes = await zip.generateAsync({ type: "blob" });
    const result = admitted(await admit(bytes, "file"));
    expect(result.doc.manifest.layers.map((l) => l.id)).toEqual(["dl:wells"]);
    expect(result.dropped.layers).toBe(1);
  });

  it("skips a data layer with no GeoJSON, or features that are not RFC 7946", async () => {
    const badFeatures = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: ["east", "north"] },
        },
      ],
    } as unknown as FeatureCollection;
    const layers = [
      ...manifest().layers,
      {
        kind: "data" as const,
        id: "dl:missing",
        label: "Missing",
        visible: true,
        featureCount: 1,
        style: {},
        source: "data/layer-dl:missing.geojson",
      },
      {
        kind: "data" as const,
        id: "dl:bad",
        label: "Bad",
        visible: true,
        featureCount: 1,
        style: {},
        source: "data/layer-dl:bad.geojson",
      },
    ];
    const result = admitted(
      await admit(
        document({
          manifest: manifest({ layers }),
          layers: new Map([
            ["dl:wells", POINTS],
            ["dl:bad", badFeatures],
          ]),
        }),
        "file",
      ),
    );
    expect(result.doc.manifest.layers.map((l) => l.id)).toEqual(["dl:wells"]);
    expect(result.doc.layers.has("dl:bad")).toBe(false);
    expect(result.dropped.layers).toBe(2);
  });

  it("skips a raster with no image and a tile layer with a refused address", async () => {
    const result = admitted(
      await admit(
        document({
          manifest: manifest({
            layers: [
              ...manifest().layers,
              {
                kind: "raster",
                id: "rl:scan",
                label: "Scan",
                visible: true,
                corners: [
                  [13, 53],
                  [14, 53],
                  [14, 52],
                  [13, 52],
                ],
                opacity: 1,
                imageKey: "rl:scan.png",
              },
            ],
            tileLayers: [
              {
                kind: "tile",
                id: "tl:evil",
                label: "Evil",
                visible: true,
                opacity: 1,
                url: "http://tracker.example.org/{z}/{x}/{y}",
              },
            ],
          }),
        }),
        "file",
      ),
    );
    expect(result.doc.manifest.layers.map((l) => l.id)).toEqual(["dl:wells"]);
    expect(result.doc.manifest.tileLayers ?? []).toEqual([]);
    expect(result.dropped.layers).toBe(2);
  });

  it("drops a drawing file that is not an image or is over the image cap", async () => {
    const files = new Map<string, Blob>([
      ["ok", new Blob([PNG_BYTES])],
      ["script", new Blob(["<script>alert(1)</script>"])],
      ["huge", new Blob([PNG_BYTES, new Uint8Array(LIMITS.record.image)])],
    ]);
    const scene = ["ok", "script", "huge"].map((fileId) =>
      element(`img-${fileId}`, { type: "image", fileId, status: "saved" }),
    );
    const result = admitted(
      await admit(
        await bytesOf(document({ scene: scene as never, files })),
        "file",
      ),
    );
    expect(Array.from(result.doc.files.keys())).toEqual(["ok"]);
    expect(result.doc.files.get("ok")?.type).toBe("image/png");
    expect(result.dropped.files).toBe(2);
    expect(droppedMessage(result)).toMatch(/2 images/);
  });

  it("resets a data layer's style that the map cannot draw, and keeps the layer", async () => {
    const result = admitted(
      await admit(
        document({
          manifest: manifest({
            layers: [
              {
                ...manifest().layers[0],
                style: {
                  strokeWidth: -5,
                  filter: { property: "name", op: "contains", value: 5 },
                },
              } as Manifest["layers"][number],
            ],
          }),
        }),
        "file",
      ),
    );
    expect(result.doc.manifest.layers.map((l) => l.id)).toEqual(["dl:wells"]);
    expect(result.repaired.styles).toBe(1);
    const entry = result.doc.manifest.layers[0];
    expect(entry.kind === "data" && entry.style).toEqual(
      defaultLayerStyle(POINTS),
    );
    expect(droppedMessage(result)).toMatch(/1 layer style/);
  });
});

describe("admit: what is refused", () => {
  it("refuses bytes that are not a map, and says so", async () => {
    const result = await admit(new Blob(["hello"]), "file");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/not/) });
  });

  it("refuses a map larger than its source may send, and names the cap", async () => {
    const big = new Blob([new Uint8Array(LIMITS.upload + 1)]);
    const result = await admit(big, "share");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("50.0 MB");
  });

  it("refuses a map with no world frame: the drawing cannot be placed", async () => {
    const { world: _world, ...noFrame } = manifest();
    const result = await admit(
      document({ manifest: noFrame as Manifest }),
      "file",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/world frame/);
  });

  it("refuses a reference zoom the renderer does not draw, and names both", async () => {
    const result = await admit(
      document({ manifest: manifest({ world: { ...FRAME, z0: 12 } }) }),
      "share",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/12.*22/);
  });

  it("refuses a map a newer Atlasdraw wrote", async () => {
    const result = await admit(
      document({ manifest: { ...manifest(), version: 99 } as never }),
      "file",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/newer/);
  });

  it("refuses an archive that expands past its caps", async () => {
    const zip = await zipOf(document());
    for (let i = 0; i <= LIMITS.archive.entries; i++) {
      zip.file(`files/${i}`, "");
    }
    const result = await admit(
      await zip.generateAsync({ type: "blob" }),
      "file",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/entries/);
  });
});
