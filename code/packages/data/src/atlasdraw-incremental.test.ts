// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw-incremental.test.ts
// Byte-for-byte contract for the incremental `.atlasdraw` writer.
//
// The optimized `write` (a) pre-encodes text entries to UTF-8, (b) accepts a
// pinned `date` for deterministic archives, and (c) reuses the previous
// archive's compressed bytes for unchanged entries via `AtlasdrawWriteCache`.
// These tests pin all three against the original writer's exact output.
//
// Own fixture builder — do not share with atlasdraw.test.ts (see
// .claude/rules/test-fixtures.md).

import JSZip from "jszip";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AtlasdrawWriteCache, read, write } from "./atlasdraw.js";

import type { FeatureCollection } from "geojson";
import type { AtlasdrawDocument, Manifest } from "./manifest-schema.js";

const VALID_ULID = "01HZX4N6S2K8Q5ZTAAAAAAAAAA";
const LAYER_A = "dl:01HZX4N6S2K8Q5ZTAAAAAAAAAA";
const LAYER_B = "dl:01HZX4N6S2K8Q5ZTBBBBBBBBBB";

const PINNED = new Date("2026-06-01T12:00:00.000Z");

function fc(name: string, n: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: n }, (_, i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [i * 0.01, i * 0.02] },
      // Non-ASCII on purpose: the utf8 pre-encode must match JSZip's own
      // encoder for multi-byte input.
      properties: { name: `${name}-${i} — 東京 🗾` },
    })),
  };
}

function synthDoc(): AtlasdrawDocument {
  const manifest: Manifest = {
    id: VALID_ULID,
    version: 1,
    title: "Incremental fixture ✓",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    basemap: { type: "registry", id: "osm-standard" },
    camera: { center: [0, 0], zoom: 2, bearing: 0, pitch: 0 },
    layers: [
      { kind: "annotation", id: "anno-1", label: "Annotations", visible: true },
    ],
    permissions: { publicView: false },
  } as Manifest;

  return {
    manifest,
    scene: [
      {
        id: "el-1",
        type: "rectangle",
        version: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ],
    layers: new Map([
      [LAYER_A, fc("alpha", 200)],
      [LAYER_B, fc("beta", 300)],
    ]),
    styleRef: { name: "style ☂" },
    files: new Map([
      [
        "asset.png",
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8])], {
          type: "image/png",
        }),
      ],
    ]),
  };
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The writer exactly as it existed before the incremental/utf8 optimization.
 * Entry dates come from `new Date()` (faked to PINNED in these tests), which
 * is what the per-file `date` option pins in the new writer.
 */
async function legacyWrite(
  doc: AtlasdrawDocument,
  options: { thumbnail?: Blob } = {},
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(doc.manifest, null, 2), {
    compression: "DEFLATE",
  });
  const sceneJson = {
    type: "excalidraw",
    version: 2,
    source: "https://atlasdraw.com",
    elements: doc.scene,
    appState: {},
  };
  zip.file("scene.excalidraw.json", JSON.stringify(sceneJson), {
    compression: "DEFLATE",
  });
  for (const [id, layerFc] of doc.layers) {
    zip.file(`data/layer-${id}.geojson`, JSON.stringify(layerFc), {
      compression: "DEFLATE",
    });
  }
  zip.file("style.json", JSON.stringify(doc.styleRef ?? {}), {
    compression: "DEFLATE",
  });
  for (const [name, blob] of doc.files) {
    const buf = await blob.arrayBuffer();
    zip.file(`files/${name}`, buf, { compression: "STORE" });
  }
  if (options.thumbnail) {
    const thumbBuf = await options.thumbnail.arrayBuffer();
    zip.file("meta/thumbnail.png", thumbBuf, { compression: "STORE" });
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.atlasdraw+zip",
  });
}

describe("incremental .atlasdraw writer", () => {
  beforeEach(() => {
    // Fake ONLY Date: JSZip's async generate pumps chunks through real
    // timers and would deadlock under full fake timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PINNED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the legacy writer byte for byte (fresh write)", async () => {
    const doc = synthDoc();
    const thumbnail = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/png",
    });
    const legacy = await bytesOf(await legacyWrite(doc, { thumbnail }));
    const current = await bytesOf(
      await write(doc, { thumbnail, date: PINNED }),
    );
    expect(current).toEqual(legacy);
  });

  it("produces deterministic bytes under a pinned date across clock ticks", async () => {
    const doc = synthDoc();
    const first = await bytesOf(await write(doc, { date: PINNED }));
    // Jump the clock past the zip DOS-time 2 s granularity; folder entries
    // used to pick up `new Date()` here.
    vi.setSystemTime(new Date(PINNED.getTime() + 3000));
    const second = await bytesOf(await write(doc, { date: PINNED }));
    expect(second).toEqual(first);
  });

  it("no-change cached rewrite reproduces the archive byte for byte", async () => {
    const doc = synthDoc();
    const cache = new AtlasdrawWriteCache();
    const first = await bytesOf(await write(doc, { date: PINNED, cache }));
    const again = await bytesOf(await write(doc, { date: PINNED, cache }));
    expect(again).toEqual(first);
  });

  it("cached write after a scene change equals a fresh write", async () => {
    const doc = synthDoc();
    const cache = new AtlasdrawWriteCache();
    await write(doc, { date: PINNED, cache });

    const doc2: AtlasdrawDocument = {
      ...doc,
      scene: [
        ...doc.scene,
        { id: "el-2", type: "ellipse", version: 1, x: 5, y: 5 },
      ],
    };
    const incremental = await bytesOf(
      await write(doc2, { date: PINNED, cache }),
    );
    const fresh = await bytesOf(await write(doc2, { date: PINNED }));
    expect(incremental).toEqual(fresh);
  });

  it("cached write after layer/file/thumbnail removal equals a fresh write", async () => {
    const doc = synthDoc();
    const thumbnail = new Blob([new Uint8Array([9, 9])], { type: "image/png" });
    const cache = new AtlasdrawWriteCache();
    await write(doc, { date: PINNED, cache, thumbnail });

    const doc2: AtlasdrawDocument = {
      ...doc,
      layers: new Map([[LAYER_A, doc.layers.get(LAYER_A)!]]),
      files: new Map(),
    };
    // No thumbnail this time — the meta/ entry must disappear too.
    const incremental = await bytesOf(
      await write(doc2, { date: PINNED, cache }),
    );
    const fresh = await bytesOf(await write(doc2, { date: PINNED }));
    expect(incremental).toEqual(fresh);

    const roundTripped = await read(
      new Blob([incremental as unknown as BlobPart]),
    );
    expect(roundTripped.layers.size).toBe(1);
    expect(roundTripped.layers.get(LAYER_A)).toEqual(doc.layers.get(LAYER_A));
    expect(roundTripped.files.size).toBe(0);
  });

  it("cached write round-trips through read()", async () => {
    const doc = synthDoc();
    const cache = new AtlasdrawWriteCache();
    await write(doc, { date: PINNED, cache });
    const doc2: AtlasdrawDocument = {
      ...doc,
      layers: new Map(doc.layers).set(LAYER_B, fc("beta-edited", 301)),
    };
    const blob = await write(doc2, { date: PINNED, cache });
    const back = await read(blob);
    expect(back.manifest).toEqual(doc2.manifest);
    expect(back.scene).toEqual(doc2.scene);
    expect(back.layers.get(LAYER_A)).toEqual(doc2.layers.get(LAYER_A));
    expect(back.layers.get(LAYER_B)).toEqual(doc2.layers.get(LAYER_B));
    expect(back.styleRef).toEqual(doc2.styleRef);
  });

  it("falls back to a fresh write when the cached archive is corrupt", async () => {
    const doc = synthDoc();
    const cache = new AtlasdrawWriteCache();
    await write(doc, { date: PINNED, cache });
    cache.archive = new Uint8Array([0, 1, 2, 3]); // not a zip
    const fromCorrupt = await bytesOf(
      await write(doc, { date: PINNED, cache }),
    );
    const fresh = await bytesOf(await write(doc, { date: PINNED }));
    expect(fromCorrupt).toEqual(fresh);
  });
});
