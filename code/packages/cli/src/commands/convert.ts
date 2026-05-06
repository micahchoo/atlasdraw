// SPDX-License-Identifier: MIT
// packages/cli/src/commands/convert.ts
// Phase 3 Wave 2 T11 — `atlasdraw convert <in> <out>` subcommand.
//
// Dispatches by extension pair (`<inExt>→<outExt>`) into a small table of
// converters. Each entry takes the input bytes, hands them to a parser /
// reader from @atlasdraw/data, and writes the output to disk.
//
// Like `runLint`, `runConvert(args, streams)` returns the would-be exit code
// rather than calling `process.exit()` itself. The Commander wrapper at the
// bottom of this file is the only place that calls `process.exit()`.
//
// `.atlasdraw.json` disambiguation: `path.extname()` returns `.json` for that
// suffix, so we hand-roll a `getExt()` that prefers the compound suffix when
// the filename actually ends with `.atlasdraw.json`.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Command } from "commander";
import { ulid } from "ulid";
import type { FeatureCollection } from "geojson";
import {
  parse,
  parseCSV,
  parseShapefile,
  read,
  readJSON,
  write,
  writeJSON,
  ManifestSchema,
  GeoJSONParseError,
  CSVParseError,
  ShapefileParseError,
  AtlasdrawFormatError,
  AtlasdrawJSONError,
  type AtlasdrawDocument,
  type Manifest,
} from "@atlasdraw/data";

export interface ConvertStreams {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/** Extension pair → converter. Keys are literal `'<inExt>→<outExt>'`. */
type ConvertFn = (
  buf: Buffer,
  outPath: string,
) => Promise<void>;

/**
 * Run the convert workflow. Returns numeric exit code instead of calling
 * `process.exit()`. The Commander wrapper turns the return value into a real
 * process exit.
 */
export async function runConvert(
  args: [inPath: string, outPath: string],
  streams: ConvertStreams,
): Promise<number> {
  const [inPath, outPath] = args;

  let buf: Buffer;
  try {
    buf = await fs.readFile(inPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") {
      streams.stderr.write(`File not found: ${inPath}\n`);
      return 1;
    }
    streams.stderr.write(
      `File not found: ${inPath} (${(err as Error).message ?? String(err)})\n`,
    );
    return 1;
  }

  const inExt = getExt(inPath);
  const outExt = getExt(outPath);
  const key = `${inExt}→${outExt}`;

  const fn = CONVERTERS.get(key);
  if (!fn) {
    streams.stderr.write(`Unsupported conversion: ${inExt} → ${outExt}\n`);
    return 1;
  }

  try {
    await fn(buf, outPath);
  } catch (err) {
    if (
      err instanceof GeoJSONParseError ||
      err instanceof CSVParseError ||
      err instanceof ShapefileParseError ||
      err instanceof AtlasdrawFormatError ||
      err instanceof AtlasdrawJSONError
    ) {
      streams.stderr.write(`${err.name}: ${err.message}\n`);
      return 1;
    }
    streams.stderr.write(
      `${(err as Error).name ?? "Error"}: ${(err as Error).message ?? String(err)}\n`,
    );
    return 1;
  }

  streams.stdout.write(`Written: ${outPath}\n`);
  return 0;
}

/**
 * Extension extraction. Prefers the compound `.atlasdraw.json` suffix when the
 * filename ends with it; otherwise falls back to `path.extname()` lowercased.
 */
function getExt(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".atlasdraw.json")) return ".atlasdraw.json";
  return path.extname(lower);
}

/** Wrap a Buffer as a Blob without lying about typing. */
function bufferToBlob(buf: Buffer): Blob {
  return new Blob([buf as unknown as BlobPart]);
}

/** Concatenate every layer's features into a single GeoJSON FeatureCollection. */
function flattenLayers(doc: AtlasdrawDocument): FeatureCollection {
  const features = [];
  for (const fc of doc.layers.values()) {
    features.push(...fc.features);
  }
  return { type: "FeatureCollection", features };
}

/**
 * Build a minimal valid `Manifest` for a CLI-authored `.atlasdraw` document
 * containing one data layer. The shape mirrors `apps/atlas-app`'s persistence
 * conventions: ULID id, `version: 1`, registry basemap `default`, zero camera.
 *
 * Exposed as a named helper so T12 (round-trip tests, Wave 3) can call it
 * directly when constructing fresh test fixtures.
 */
export function buildCLIManifest(opts: {
  title: string;
  layerId: string;
  featureCount: number;
}): Manifest {
  const now = new Date().toISOString();
  return ManifestSchema.parse({
    id: ulid(),
    version: 1,
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    basemap: { type: "registry", id: "default" },
    camera: { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 },
    layers: [
      {
        kind: "data",
        id: opts.layerId,
        label: opts.title,
        visible: true,
        featureCount: opts.featureCount,
        style: {},
        source: `data/layer-${opts.layerId}.geojson`,
      },
    ],
    permissions: { publicView: false },
  });
}

/**
 * Build a minimal `AtlasdrawDocument` from a single FeatureCollection. Used
 * for both `.geojson → .atlasdraw` and `.geojson → .atlasdraw.json`.
 */
function docFromFC(fc: FeatureCollection, title: string): AtlasdrawDocument {
  const layerId = `dl:${crypto.randomUUID()}`;
  const manifest = buildCLIManifest({
    title,
    layerId,
    featureCount: fc.features.length,
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

/** Default title for CLI-converted docs: input basename without extension. */
function defaultTitle(inputPath: string): string {
  const base = path.basename(inputPath);
  const dot = base.indexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  return stem.length > 0 ? stem : "Untitled";
}

const CONVERTERS = new Map<string, ConvertFn>();

// .geojson → .atlasdraw  (zip variant)
CONVERTERS.set(".geojson→.atlasdraw", async (buf, outPath) => {
  const fc = await parse(bufferToBlob(buf));
  const doc = docFromFC(fc, defaultTitle(outPath));
  const blob = await write(doc);
  const out = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(outPath, out);
});

// .geojson → .atlasdraw.json  (pure-JSON variant)
CONVERTERS.set(".geojson→.atlasdraw.json", async (buf, outPath) => {
  const fc = await parse(bufferToBlob(buf));
  const doc = docFromFC(fc, defaultTitle(outPath));
  const blob = await writeJSON(doc);
  const text = await blob.text();
  await fs.writeFile(outPath, text, "utf8");
});

// .atlasdraw → .geojson
CONVERTERS.set(".atlasdraw→.geojson", async (buf, outPath) => {
  const doc = await read(bufferToBlob(buf));
  const fc = flattenLayers(doc);
  await fs.writeFile(outPath, JSON.stringify(fc, null, 2), "utf8");
});

// .atlasdraw.json → .geojson
CONVERTERS.set(".atlasdraw.json→.geojson", async (buf, outPath) => {
  const doc = await readJSON(bufferToBlob(buf));
  const fc = flattenLayers(doc);
  await fs.writeFile(outPath, JSON.stringify(fc, null, 2), "utf8");
});

// .zip → .geojson  (Shapefile)
CONVERTERS.set(".zip→.geojson", async (buf, outPath) => {
  const fc = await parseShapefile(bufferToBlob(buf));
  await fs.writeFile(outPath, JSON.stringify(fc, null, 2), "utf8");
});

// .csv → .geojson
CONVERTERS.set(".csv→.geojson", async (buf, outPath) => {
  const fc = await parseCSV(bufferToBlob(buf));
  await fs.writeFile(outPath, JSON.stringify(fc, null, 2), "utf8");
});

export const convertCommand = new Command("convert")
  .description("Convert between geospatial file formats")
  .argument("<in>", "input file path")
  .argument("<out>", "output file path")
  .action(async (inArg: string, outArg: string) => {
    const code = await runConvert(
      [inArg, outArg],
      { stdout: process.stdout, stderr: process.stderr },
    );
    process.exit(code);
  });
