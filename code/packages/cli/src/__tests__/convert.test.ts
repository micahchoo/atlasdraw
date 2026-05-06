// SPDX-License-Identifier: MIT
// packages/cli/src/__tests__/convert.test.ts
// Phase 3 Wave 2 T11 — vitest suite for `runConvert`.
//
// Strategy: build small fixtures in a temp dir (raw GeoJSON, CSV, or
// `write()`-emitted .atlasdraw bytes), then drive `runConvert` directly with
// mock streams. We assert on return value (would-be exit code), captured
// stream writes, and — for round-trip cases — re-read the output via the
// matching reader from @atlasdraw/data.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { FeatureCollection } from "geojson";

import {
  read,
  readJSON,
  write,
  ManifestSchema,
  type AtlasdrawDocument,
} from "@atlasdraw/data";
import { runConvert } from "../commands/convert.js";

/** Capture-and-assert stdio adapter. */
function makeStreams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void err.push(s) },
    },
    out,
    err,
  };
}

/** A two-feature FeatureCollection for round-trip assertions. */
function sampleFC(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "alpha" },
        geometry: { type: "Point", coordinates: [0, 0] },
      },
      {
        type: "Feature",
        properties: { name: "beta" },
        geometry: { type: "Point", coordinates: [1, 1] },
      },
    ],
  };
}

/** Build an `AtlasdrawDocument` with one data layer carrying the given FC. */
function docWithLayer(fc: FeatureCollection): AtlasdrawDocument {
  const layerId = `dl:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const manifest = ManifestSchema.parse({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    version: 1,
    title: "Fixture",
    createdAt: now,
    updatedAt: now,
    basemap: { type: "registry", id: "default" },
    camera: { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 },
    layers: [
      {
        kind: "data",
        id: layerId,
        label: "Fixture",
        visible: true,
        featureCount: fc.features.length,
        style: {},
        source: `data/layer-${layerId}.geojson`,
      },
    ],
    permissions: { publicView: false },
  });
  const layers = new Map<string, FeatureCollection>();
  layers.set(layerId, fc);
  return {
    manifest,
    scene: [],
    layers,
    styleRef: null,
    files: new Map(),
  };
}

describe("atlasdraw convert", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `atlasdraw-cli-test-${crypto.randomUUID()}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it(".geojson → .atlasdraw round-trips: read back has 1 layer with same feature count", async () => {
    const inPath = path.join(tmpDir, "in.geojson");
    const outPath = path.join(tmpDir, "out.atlasdraw");
    await fs.writeFile(inPath, JSON.stringify(sampleFC()), "utf8");

    const { streams, out, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(err.join("")).toBe("");
    expect(code).toBe(0);
    expect(out.join("")).toBe(`Written: ${outPath}\n`);

    const buf = await fs.readFile(outPath);
    const blob = new Blob([buf as unknown as BlobPart]);
    const doc = await read(blob);
    expect(doc.layers.size).toBe(1);
    const [fc] = [...doc.layers.values()];
    expect(fc.features).toHaveLength(2);
    expect(doc.manifest.layers).toHaveLength(1);
    const entry = doc.manifest.layers[0];
    expect(entry.kind).toBe("data");
    if (entry.kind === "data") {
      expect(entry.featureCount).toBe(2);
    }
  });

  it(".geojson → .atlasdraw.json round-trips through readJSON", async () => {
    const inPath = path.join(tmpDir, "in.geojson");
    const outPath = path.join(tmpDir, "out.atlasdraw.json");
    await fs.writeFile(inPath, JSON.stringify(sampleFC()), "utf8");

    const { streams, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(err.join("")).toBe("");
    expect(code).toBe(0);

    const text = await fs.readFile(outPath, "utf8");
    const doc = await readJSON(new Blob([text]));
    expect(doc.layers.size).toBe(1);
    const [fc] = [...doc.layers.values()];
    expect(fc.features).toHaveLength(2);
  });

  it(".atlasdraw → .geojson flattens all layers into one FeatureCollection", async () => {
    // Build an .atlasdraw with two features in one layer via write().
    const blob = await write(docWithLayer(sampleFC()));
    const inPath = path.join(tmpDir, "in.atlasdraw");
    await fs.writeFile(inPath, Buffer.from(await blob.arrayBuffer()));
    const outPath = path.join(tmpDir, "out.geojson");

    const { streams, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(err.join("")).toBe("");
    expect(code).toBe(0);

    const text = await fs.readFile(outPath, "utf8");
    const fc = JSON.parse(text) as FeatureCollection;
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    const names = fc.features.map((f) => f.properties?.name);
    expect(names).toEqual(["alpha", "beta"]);
  });

  it(".csv → .geojson parses lat/lng columns into Point features", async () => {
    const csv =
      "id,name,lat,lng\n" +
      "1,alpha,0,0\n" +
      "2,beta,1,1\n";
    const inPath = path.join(tmpDir, "in.csv");
    const outPath = path.join(tmpDir, "out.geojson");
    await fs.writeFile(inPath, csv, "utf8");

    const { streams, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(err.join("")).toBe("");
    expect(code).toBe(0);

    const text = await fs.readFile(outPath, "utf8");
    const fc = JSON.parse(text) as FeatureCollection;
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.type).toBe("Point");
  });

  it("returns 1 with 'Unsupported conversion:' for unknown extension pair", async () => {
    const inPath = path.join(tmpDir, "in.foo");
    const outPath = path.join(tmpDir, "out.bar");
    await fs.writeFile(inPath, "anything", "utf8");

    const { streams, out, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toBe("Unsupported conversion: .foo → .bar\n");
  });

  it("returns 1 with 'File not found:' when the input path does not exist", async () => {
    const inPath = path.join(tmpDir, "missing.geojson");
    const outPath = path.join(tmpDir, "out.atlasdraw");

    const { streams, out, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain(`File not found: ${inPath}`);
  });

  it("returns 1 and surfaces GeoJSONParseError for malformed input", async () => {
    const inPath = path.join(tmpDir, "bad.geojson");
    const outPath = path.join(tmpDir, "out.atlasdraw");
    await fs.writeFile(inPath, "{ this is not json", "utf8");

    const { streams, out, err } = makeStreams();
    const code = await runConvert([inPath, outPath], streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("GeoJSONParseError:");
  });
});
