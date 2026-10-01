// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw.test.ts
// Colocated tests for the .atlasdraw zip writer/reader.

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
    version: 2,
    title: "Round-trip fixture",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    basemap: { type: "registry", id: "osm-standard" },
    camera: { center: [0, 0], zoom: 2, bearing: 0, pitch: 0 },
    world: { z0: 22, origin: { x: 0, y: 0 } },
    layers: [
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

describe("atlasdraw comments", () => {
  const comment = {
    id: "c1",
    authorId: "u1",
    authorName: "Ada",
    text: "survey marker is 2 m east",
    createdAt: 1_700_000_000_000,
    resolved: false,
    anchor: { kind: "map", lng: 13.4, lat: 52.5 },
    schemaVersion: 2,
  };

  it("writes the comments as comments.json and reads them back", async () => {
    const doc = { ...synthAtlasdrawDocument(), comments: [comment] };
    const blob = await write(doc);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("comments.json")).not.toBeNull();
    expect((await read(blob)).comments).toEqual([comment]);
  });

  it("writes no comments.json for a document without comments", async () => {
    const blob = await write(synthAtlasdrawDocument());

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("comments.json")).toBeNull();
    expect((await read(blob)).comments).toEqual([]);
  });

  it("leaves out a comment it cannot read, and keeps the others", async () => {
    const blob = await write({
      ...synthAtlasdrawDocument(),
      comments: [comment, { id: 7 } as unknown as typeof comment],
    });

    expect((await read(blob)).comments).toEqual([comment]);
  });
});

describe("atlasdraw.read — archive limits", () => {
  const SMALL = { entries: 20, entryBytes: 4_000, totalBytes: 10_000 };

  async function zipWith(extra: Record<string, string>): Promise<Uint8Array> {
    const zip = await blobToZip(await write(synthAtlasdrawDocument()));
    for (const [path, text] of Object.entries(extra)) {
      zip.file(path, text);
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  async function codeOf(bytes: Uint8Array, limits = SMALL): Promise<string> {
    try {
      await read(new Blob([bytes as unknown as BlobPart]), { limits });
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      return `${(err as AtlasdrawFormatError).code}: ${(err as Error).message}`;
    }
    return "read";
  }

  it("reads an archive inside the limits", async () => {
    expect(await codeOf(await zipWith({}))).toBe("read");
  });

  it("refuses an archive with more entries than the cap, and names the cap", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      many[`files/f${i}`] = "x";
    }
    expect(await codeOf(await zipWith(many))).toMatch(/^TOO_LARGE: .*20/);
  });

  it("refuses one entry that inflates past the entry cap", async () => {
    const bomb = "a".repeat(50_000); // deflates to a few hundred bytes
    expect(await codeOf(await zipWith({ "files/bomb": bomb }))).toMatch(
      /^TOO_LARGE: .*files\/bomb/,
    );
  });

  it("refuses entries that together inflate past the total cap", async () => {
    const parts: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      parts[`files/p${i}`] = "b".repeat(3_000);
    }
    expect(await codeOf(await zipWith(parts))).toMatch(/^TOO_LARGE: /);
  });

  it("counts the bytes it inflates, not the sizes the archive claims", async () => {
    const bytes = await zipWith({ "files/liar": "c".repeat(50_000) });
    // Rewrite the size the archive declares for "files/liar" to 10 bytes,
    // in its local header and in the central directory.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const name = (at: number, length: number) =>
      new TextDecoder().decode(bytes.subarray(at, at + length));
    let rewritten = 0;
    for (let i = 0; i + 46 <= bytes.length; i++) {
      const sig = view.getUint32(i, true);
      if (
        sig === 0x04034b50 &&
        name(i + 30, view.getUint16(i + 26, true)) === "files/liar"
      ) {
        view.setUint32(i + 22, 10, true);
        rewritten++;
      } else if (
        sig === 0x02014b50 &&
        name(i + 46, view.getUint16(i + 28, true)) === "files/liar"
      ) {
        view.setUint32(i + 24, 10, true);
        rewritten++;
      }
    }
    expect(rewritten).toBe(2);
    expect(await codeOf(bytes)).toMatch(/^TOO_LARGE: .*files\/liar/);
  });

  it("skips a data layer whose GeoJSON is not JSON, and opens the rest", async () => {
    const bytes = await zipWith({
      "data/layer-dl:broken.geojson": "{not json",
    });
    const doc = await read(new Blob([bytes as unknown as BlobPart]));
    expect(doc.layers.has("dl:broken")).toBe(false);
    expect(doc.layers.has(DATA_LAYER_ID)).toBe(true);
  });
});
