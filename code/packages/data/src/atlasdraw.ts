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

import {
  ManifestSchema,
  type AtlasdrawDocument,
  type SceneElement,
} from "./manifest-schema.js";

import type { FeatureCollection } from "geojson";

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
  /**
   * Pin the zip mod-time of every entry written by this call. When omitted,
   * JSZip stamps each entry with `new Date()` (DOS time, 2 s granularity), so
   * two writes of the same document straddling a tick differ in bytes.
   * Passing a fixed date makes the archive fully deterministic.
   */
  date?: Date;
  /**
   * Opt-in incremental compression. Create ONE cache per open document and
   * pass it to every `write` call for that document. Text entries whose
   * serialized JSON is string-equal to the previous write are carried over
   * from the previous archive without re-DEFLATE — for layer-heavy documents
   * that is the difference between ~100 ms and ~3 ms per autosave.
   *
   * Unchanged detection compares serialized text, never object identity, so
   * in-place mutation of scene elements (Excalidraw does this) cannot cause
   * a stale entry. A cache carried across a document switch is safe for the
   * same reason: every non-matching entry is rewritten and every entry not
   * in the new document is removed, so output converges regardless of what
   * the cache held. The cache retains the previous archive bytes and text
   * (~2× document size) for the document's lifetime.
   */
  cache?: AtlasdrawWriteCache;
}

/**
 * Holds the previous archive + its serialized text entries for incremental
 * `write`. Opaque to callers; `write` reads and replaces the contents.
 */
export class AtlasdrawWriteCache {
  /** @internal raw bytes of the archive produced by the previous write */
  archive: Uint8Array | null = null;
  /** @internal path → serialized text of the previous write's text entries */
  texts: ReadonlyMap<string, string> = new Map();
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
  // Serialize every text entry up front — both the fresh and the incremental
  // path need the strings, and the incremental path's unchanged-detection is
  // string equality against the previous write.
  const texts = new Map<string, string>();
  texts.set(MANIFEST_PATH, JSON.stringify(doc.manifest, null, 2));
  texts.set(
    SCENE_PATH,
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://atlasdraw.com",
      elements: doc.scene,
      appState: {},
    }),
  );
  for (const [id, fc] of doc.layers) {
    texts.set(`data/layer-${id}.geojson`, JSON.stringify(fc));
  }
  texts.set(STYLE_PATH, JSON.stringify(doc.styleRef ?? {}));

  // Incremental path: reopen the previous archive so JSZip can pass the
  // compressed bytes of untouched entries straight through to the output.
  // A load failure (corrupt cache) falls back to a fresh archive — the
  // result is identical either way, only the DEFLATE work differs.
  let zip = new JSZip();
  let prevTexts: ReadonlyMap<string, string> = new Map();
  if (options.cache?.archive) {
    try {
      zip = await JSZip.loadAsync(options.cache.archive);
      prevTexts = options.cache.texts;
    } catch {
      zip = new JSZip();
    }
  }

  // Pre-encode to UTF-8 ourselves: handing JSZip a string routes through its
  // slower hand-rolled utf8 encoder (~19% of a full write); the bytes are
  // identical (asserted in atlasdraw.test.ts, non-ASCII included).
  const encoder = new TextEncoder();
  for (const [path, text] of texts) {
    if (prevTexts.get(path) === text && zip.file(path) !== null) {
      continue; // untouched loaded entry — compressed bytes reused as-is
    }
    // Zero-copy re-wrap in this realm's Uint8Array: jsdom test environments
    // supply Node's TextEncoder, whose output fails JSZip's cross-realm
    // `instanceof Uint8Array` check.
    const encoded = encoder.encode(text);
    const bytes = new Uint8Array(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );
    zip.file(path, bytes, {
      compression: "DEFLATE",
      ...(options.date ? { date: options.date } : {}),
    });
  }

  // JSZip in non-browser runtimes can't introspect a Blob synchronously, so
  // we materialize bytes to ArrayBuffer before adding. STORE'd entries skip
  // re-compression of already-compressed assets; re-adding them each write
  // costs a copy + CRC, no DEFLATE, so they are not worth cache-tracking.
  const binaryPaths = new Set<string>();
  for (const [name, blob] of doc.files) {
    const buf = await blob.arrayBuffer();
    const path = `${FILES_PREFIX}${name}`;
    binaryPaths.add(path);
    zip.file(path, buf, {
      compression: "STORE",
      ...(options.date ? { date: options.date } : {}),
    });
  }

  if (options.thumbnail) {
    const thumbBuf = await options.thumbnail.arrayBuffer();
    binaryPaths.add(THUMBNAIL_PATH);
    zip.file(THUMBNAIL_PATH, thumbBuf, {
      compression: "STORE",
      ...(options.date ? { date: options.date } : {}),
    });
  }

  // Incremental only: drop loaded entries the document no longer contains
  // (deleted layers/files, a thumbnail no longer supplied). Folder entries
  // are kept — read() skips them, and JSZip recreates them implicitly for a
  // fresh archive anyway.
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir && !texts.has(path) && !binaryPaths.has(path)) {
      zip.remove(path);
    }
  }
  // ...including folder entries left childless by those removals, so an
  // incremental archive stays structurally identical to a fresh write of the
  // same document (a fresh write never creates an empty folder).
  const filePaths = Object.entries(zip.files)
    .filter(([, e]) => !e.dir)
    .map(([p]) => p);
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir && !filePaths.some((p) => p.startsWith(path))) {
      zip.remove(path);
    }
  }

  // JSZip stamps implicitly-created folder entries with `new Date()` and
  // ignores the per-file `date` option for them; pin those too or the
  // "deterministic archive" promise of `options.date` breaks at the DOS-time
  // 2-second granularity.
  if (options.date) {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) {
        entry.date = options.date;
      }
    }
  }

  // Generate to a Uint8Array and wrap as a Blob ourselves. JSZip's native
  // "blob" output relies on the global Blob constructor; Node 20+ provides it,
  // but going via uint8array is portable across all test environments and
  // gives us explicit control over the MIME type.
  //
  // The DEFLATE default is what lets loaded-but-untouched entries pass
  // through without re-compression (JSZip re-encodes an entry whenever its
  // stored method differs from the requested output method). Explicitly
  // STORE'd entries above are unaffected by the default.
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });

  if (options.cache) {
    options.cache.archive = bytes;
    options.cache.texts = texts;
  }

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
      `failed to open .atlasdraw archive: ${
        (err as Error).message ?? String(err)
      }`,
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
      `manifest.json is not valid JSON: ${
        (err as Error).message ?? String(err)
      }`,
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
      `scene.excalidraw.json is not valid JSON: ${
        (err as Error).message ?? String(err)
      }`,
    );
  }
  // Reader stays liberal in what it accepts: persisted JSON could come from a
  // future schema variant, so we don't validate per-element shape here. Cast
  // to SceneElement[] is a structural assertion the writer's invariants held.
  const sceneElements: ReadonlyArray<SceneElement> =
    sceneJson &&
    typeof sceneJson === "object" &&
    Array.isArray((sceneJson as { elements?: unknown }).elements)
      ? ((sceneJson as { elements: unknown[] })
          .elements as ReadonlyArray<SceneElement>)
      : [];

  // --- data/layer-<id>.geojson ---------------------------------------------
  const layers = new Map<string, FeatureCollection>();
  // --- files/<name> ---------------------------------------------------------
  const files = new Map<string, Blob>();

  // Iterate every entry once. `zip.files` is the canonical bag of entries.
  const entries = Object.entries(zip.files);
  for (const [path, entry] of entries) {
    if (entry.dir) {
      continue;
    }

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
      if (basename.includes("/")) {
        continue;
      }
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
