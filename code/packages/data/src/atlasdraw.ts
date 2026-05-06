// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw.ts
// Phase 3 Wave 1 T2 + T3 — `.atlasdraw` zip writer + reader.
//
// The `.atlasdraw` file is a zip archive whose layout is:
//
//   manifest.json                 (DEFLATE)  validated against ManifestSchema
//   scene.excalidraw.json         (DEFLATE)  the Excalidraw scene
//   data/layer-<id>.geojson       (DEFLATE)  per data-layer FeatureCollection
//   style.json                    (DEFLATE)  basemap style ref (opaque)
//   files/<name>                  (STORE)    binary assets — already-compressed
//   meta/thumbnail.png            (STORE)    optional preview, write-only here
//
// Boundary contract: this module returns / accepts an in-memory
// `AtlasdrawDocument`. Higher layers translate to/from Yjs and Excalidraw.

import JSZip from "jszip";
import type { FeatureCollection } from "geojson";

import {
  ManifestSchema,
  type AtlasdrawDocument,
  type SceneElement,
} from "./manifest-schema.js";

export const ATLASDRAW_MIME = "application/vnd.atlasdraw+zip";

const MANIFEST_PATH = "manifest.json";
const SCENE_PATH = "scene.excalidraw.json";
const STYLE_PATH = "style.json";
const THUMBNAIL_PATH = "meta/thumbnail.png";
const LAYER_PATH_RE = /^data\/layer-(.+)\.geojson$/;
const FILES_PREFIX = "files/";

export type AtlasdrawFormatErrorCode =
  | "BAD_ZIP"
  | "MISSING_MANIFEST"
  | "INVALID_MANIFEST"
  | "MISSING_SCENE";

/**
 * Error type for `.atlasdraw` format violations. `code` is the machine-readable
 * failure mode; the message is human-readable detail.
 */
export class AtlasdrawFormatError extends Error {
  readonly code: AtlasdrawFormatErrorCode;
  constructor(code: AtlasdrawFormatErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AtlasdrawFormatError";
  }
}

export interface WriteOptions {
  thumbnail?: Blob;
}

/**
 * Serialize an `AtlasdrawDocument` to a `.atlasdraw` zip Blob.
 *
 * - text-ish entries (manifest, scene, geojson, style) are DEFLATE compressed;
 * - already-compressed user assets in `doc.files` are STORE'd to avoid the
 *   double-compression CPU tax, since PNGs/JPEGs/PDFs barely shrink under
 *   DEFLATE.
 */
export async function write(
  doc: AtlasdrawDocument,
  options: WriteOptions = {},
): Promise<Blob> {
  const zip = new JSZip();

  zip.file(MANIFEST_PATH, JSON.stringify(doc.manifest, null, 2), {
    compression: "DEFLATE",
  });

  const sceneJson = {
    type: "excalidraw",
    version: 2,
    source: "https://atlasdraw.com",
    elements: doc.scene,
    appState: {},
  };
  zip.file(SCENE_PATH, JSON.stringify(sceneJson), {
    compression: "DEFLATE",
  });

  for (const [id, fc] of doc.layers) {
    zip.file(`data/layer-${id}.geojson`, JSON.stringify(fc), {
      compression: "DEFLATE",
    });
  }

  zip.file(STYLE_PATH, JSON.stringify(doc.styleRef ?? {}), {
    compression: "DEFLATE",
  });

  // JSZip in non-browser runtimes can't introspect a Blob synchronously, so
  // we materialize bytes to ArrayBuffer before adding. STORE'd entries skip
  // re-compression of already-compressed assets.
  for (const [name, blob] of doc.files) {
    const buf = await blob.arrayBuffer();
    zip.file(`${FILES_PREFIX}${name}`, buf, { compression: "STORE" });
  }

  if (options.thumbnail) {
    const thumbBuf = await options.thumbnail.arrayBuffer();
    zip.file(THUMBNAIL_PATH, thumbBuf, { compression: "STORE" });
  }

  // Generate to a Uint8Array and wrap as a Blob ourselves. JSZip's native
  // "blob" output relies on the global Blob constructor; Node 20+ provides it,
  // but going via uint8array is portable across all test environments and
  // gives us explicit control over the MIME type.
  const bytes = await zip.generateAsync({ type: "uint8array" });
  // Cast: TS lib sees `Uint8Array<ArrayBufferLike>`, but BlobPart requires
  // `ArrayBufferView<ArrayBuffer>`. The bytes are concrete and safe to wrap.
  return new Blob([bytes as unknown as BlobPart], { type: ATLASDRAW_MIME });
}

/**
 * Parse a `.atlasdraw` zip Blob into an `AtlasdrawDocument`.
 *
 * Throws `AtlasdrawFormatError` for any structural violation; the caller is
 * expected to surface `error.code` to the UI ("not a valid atlasdraw file" /
 * "manifest corrupt" / etc).
 */
export async function read(blob: Blob): Promise<AtlasdrawDocument> {
  let zip: JSZip;
  try {
    // JSZip's Blob support is browser-only; in node test runtimes we hand it
    // an ArrayBuffer, which is universally supported.
    const buf = await blob.arrayBuffer();
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    throw new AtlasdrawFormatError(
      "BAD_ZIP",
      `failed to open .atlasdraw archive: ${(err as Error).message ?? String(err)}`,
    );
  }

  // --- manifest.json --------------------------------------------------------
  const manifestEntry = zip.file(MANIFEST_PATH);
  if (!manifestEntry) {
    throw new AtlasdrawFormatError(
      "MISSING_MANIFEST",
      `archive is missing required entry "${MANIFEST_PATH}"`,
    );
  }
  const manifestText = await manifestEntry.async("string");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch (err) {
    throw new AtlasdrawFormatError(
      "INVALID_MANIFEST",
      `manifest.json is not valid JSON: ${(err as Error).message ?? String(err)}`,
    );
  }
  const parsed = ManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw new AtlasdrawFormatError(
      "INVALID_MANIFEST",
      `manifest.json failed schema validation: ${parsed.error.message}`,
    );
  }
  const manifest = parsed.data;

  // --- scene.excalidraw.json ------------------------------------------------
  const sceneEntry = zip.file(SCENE_PATH);
  if (!sceneEntry) {
    throw new AtlasdrawFormatError(
      "MISSING_SCENE",
      `archive is missing required entry "${SCENE_PATH}"`,
    );
  }
  const sceneText = await sceneEntry.async("string");
  let sceneJson: unknown;
  try {
    sceneJson = JSON.parse(sceneText);
  } catch (err) {
    throw new AtlasdrawFormatError(
      "MISSING_SCENE",
      `scene.excalidraw.json is not valid JSON: ${(err as Error).message ?? String(err)}`,
    );
  }
  // Reader stays liberal in what it accepts: persisted JSON could come from a
  // future schema variant, so we don't validate per-element shape here. Cast
  // to SceneElement[] is a structural assertion the writer's invariants held.
  const sceneElements: ReadonlyArray<SceneElement> =
    sceneJson && typeof sceneJson === "object" &&
    Array.isArray((sceneJson as { elements?: unknown }).elements)
      ? ((sceneJson as { elements: unknown[] }).elements as ReadonlyArray<SceneElement>)
      : [];

  // --- data/layer-<id>.geojson ---------------------------------------------
  const layers = new Map<string, FeatureCollection>();
  // --- files/<name> ---------------------------------------------------------
  const files = new Map<string, Blob>();

  // Iterate every entry once. `zip.files` is the canonical bag of entries.
  const entries = Object.entries(zip.files);
  for (const [path, entry] of entries) {
    if (entry.dir) continue;

    const layerMatch = path.match(LAYER_PATH_RE);
    if (layerMatch) {
      const layerId = layerMatch[1]!;
      const text = await entry.async("string");
      // Layer GeoJSON is opaque here — geojson.ts validates content for the
      // import path; round-trip integrity is enough for the format reader.
      const fc = JSON.parse(text) as FeatureCollection;
      layers.set(layerId, fc);
      continue;
    }

    if (path.startsWith(FILES_PREFIX) && path !== FILES_PREFIX) {
      const basename = path.slice(FILES_PREFIX.length);
      // Skip nested-dir names just in case — flat namespace is the contract.
      if (basename.includes("/")) continue;
      const blob = await entry.async("blob");
      files.set(basename, blob);
      continue;
    }
    // manifest.json, scene.excalidraw.json, style.json, meta/thumbnail.png
    // are handled separately or intentionally ignored.
  }

  // --- style.json -----------------------------------------------------------
  let styleRef: unknown = null;
  const styleEntry = zip.file(STYLE_PATH);
  if (styleEntry) {
    const styleText = await styleEntry.async("string");
    try {
      styleRef = JSON.parse(styleText);
    } catch {
      // Treat unparseable style.json as absent — basemap is recoverable.
      styleRef = null;
    }
  }

  return {
    manifest,
    scene: sceneElements,
    layers,
    styleRef,
    files,
  };
}
