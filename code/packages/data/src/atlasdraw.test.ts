// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw.test.ts
// Phase 3 Wave 1 T2 + T3 — colocated tests for the .atlasdraw zip writer/reader.

import JSZip from "jszip";

import { describe, expect, it } from "vitest";

import { AtlasdrawFormatError, read, write } from "./atlasdraw.js";

import type { FeatureCollection } from "geojson";
import type { AtlasdrawDocument, Manifest } from "./manifest-schema.js";

// ---------------------------------------------------------------------------
// fixture builder

const VALID_ULID = "01HZX4N6S2K8Q5ZTABCDEFGHJK"; // 26 Crockford-base32 chars
const DATA_LAYER_ID = "dl:01HZX4N6S2K8Q5ZTABCDEFGHJK";

function synthAtlasdrawDocument(
  overrides: { manifest?: Partial<Manifest> } = {},
): AtlasdrawDocument {
  const baseManifest: Manifest = {
    id: VALID_ULID,
    version: 1,
    title: "Round-trip fixture",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    basemap: { type: "registry", id: "osm-standard" },
    camera: { center: [0, 0], zoom: 2, bearing: 0, pitch: 0 },
    layers: [
      {
        kind: "annotation",
        id: "anno-1",
        label: "Annotations",
        visible: true,
      },
      {
        kind: "data",
        id: DATA_LAYER_ID,
        label: "Cities",
        visible: true,
        featureCount: 1,
        style: { color: "#ff0000" },
        source: `data/layer-${DATA_LAYER_ID}.geojson`,
      },
    ],
    permissions: { publicView: false },
    ...(overrides.manifest ?? {}),
  } as Manifest;

  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.4, 37.8] },
        properties: { name: "SF" },
      },
    ],
  };

  const layers = new Map<string, FeatureCollection>([[DATA_LAYER_ID, fc]]);

  // synthetic asset — bytes don't matter, presence does.
  const fileBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
    type: "image/png",
  });
  const files = new Map<string, Blob>([["sketch.png", fileBlob]]);

  const scene = [
    {
      id: "el-1",
      type: "rectangle",
      version: 1,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    },
  ];

  return {
    manifest: baseManifest,
    scene,
    layers,
    styleRef: { name: "test-style" },
    files,
  };
}

// ---------------------------------------------------------------------------
// tests

// JSZip's Blob support is browser-only; in node tests we re-hydrate via
// arrayBuffer() before handing it back to JSZip.loadAsync.
async function blobToZip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe("atlasdraw.write + read — round-trip", () => {
  it("preserves manifest, scene, layers, and files", async () => {
    const doc = synthAtlasdrawDocument();
    const blob = await write(doc);
    expect(blob).toBeInstanceOf(Blob);

    const round = await read(blob);
    expect(round.manifest.id).toBe(VALID_ULID);
    expect(round.manifest.title).toBe("Round-trip fixture");
    expect(round.scene.length).toBe(1);
    expect(Array.from(round.layers.keys())).toEqual([DATA_LAYER_ID]);
    expect(round.layers.get(DATA_LAYER_ID)?.features.length).toBe(1);
    expect(Array.from(round.files.keys())).toEqual(["sketch.png"]);
    expect(round.styleRef).toEqual({ name: "test-style" });
  });

  it("write produces a re-loadable zip", async () => {
    const doc = synthAtlasdrawDocument();
    const blob = await write(doc);
    // Should not throw — the output is a valid PKZIP archive.
    await expect(blobToZip(blob)).resolves.toBeInstanceOf(JSZip);
  });

  it("uses DEFLATE for geojson and STORE for files/", async () => {
    const doc = synthAtlasdrawDocument();
    const blob = await write(doc);
    const zip = await blobToZip(blob);

    const layerEntry = zip.file(`data/layer-${DATA_LAYER_ID}.geojson`);
    expect(layerEntry).not.toBeNull();
    // JSZip exposes the internal compression option on the entry as `_data.compression`
    // OR via the `options.compression` field on older builds. Read defensively.
    const layerCompression =
      (
        layerEntry as unknown as {
          _data?: { compression?: { magic?: string } };
        }
      )._data?.compression?.magic ??
      (layerEntry as unknown as { options?: { compression?: string } }).options
        ?.compression;
    // DEFLATE magic in JSZip is "\x08\x00"; the named "DEFLATE" string is also accepted.
    expect(["\x08\x00", "DEFLATE"]).toContain(layerCompression);

    const fileEntry = zip.file("files/sketch.png");
    expect(fileEntry).not.toBeNull();
    const fileCompression =
      (fileEntry as unknown as { _data?: { compression?: { magic?: string } } })
        ._data?.compression?.magic ??
      (fileEntry as unknown as { options?: { compression?: string } }).options
        ?.compression;
    // STORE magic is "\x00\x00".
    expect(["\x00\x00", "STORE"]).toContain(fileCompression);
  });
});

describe("atlasdraw.write — thumbnail option", () => {
  it("omits meta/thumbnail.png when no thumbnail is supplied", async () => {
    const doc = synthAtlasdrawDocument();
    const blob = await write(doc);
    const zip = await blobToZip(blob);
    expect(zip.file("meta/thumbnail.png")).toBeNull();
  });

  it("includes meta/thumbnail.png when a thumbnail is supplied", async () => {
    const doc = synthAtlasdrawDocument();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    const blob = await write(doc, { thumbnail: thumb });
    const zip = await blobToZip(blob);
    expect(zip.file("meta/thumbnail.png")).not.toBeNull();
  });
});

describe("atlasdraw.read — error mapping", () => {
  it("throws BAD_ZIP for a non-zip blob", async () => {
    const garbage = new Blob(["not a zip"]);
    try {
      await read(garbage);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("BAD_ZIP");
    }
  });

  it("throws MISSING_MANIFEST when manifest.json is absent", async () => {
    const zip = new JSZip();
    zip.file("scene.excalidraw.json", JSON.stringify({ elements: [] }));
    const buf = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([buf as unknown as BlobPart]);
    try {
      await read(blob);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("MISSING_MANIFEST");
    }
  });

  it("throws INVALID_MANIFEST when manifest.json is unparseable JSON", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", "{not valid json,");
    zip.file("scene.excalidraw.json", JSON.stringify({ elements: [] }));
    const buf = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([buf as unknown as BlobPart]);
    try {
      await read(blob);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("INVALID_MANIFEST");
    }
  });

  it("throws INVALID_MANIFEST when manifest fails schema (bad ULID)", async () => {
    const doc = synthAtlasdrawDocument();
    const badManifest = { ...doc.manifest, id: "not-a-ulid" };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(badManifest));
    zip.file("scene.excalidraw.json", JSON.stringify({ elements: [] }));
    const buf = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([buf as unknown as BlobPart]);
    try {
      await read(blob);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("INVALID_MANIFEST");
    }
  });

  it("throws MISSING_SCENE when scene.excalidraw.json is absent", async () => {
    const doc = synthAtlasdrawDocument();
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(doc.manifest));
    const buf = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([buf as unknown as BlobPart]);
    try {
      await read(blob);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("MISSING_SCENE");
    }
  });
});
