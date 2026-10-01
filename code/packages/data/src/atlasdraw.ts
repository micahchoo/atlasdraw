// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw.ts
// `.atlasdraw` zip writer + reader.
//
// The `.atlasdraw` file is a zip archive whose layout is:
//
//   manifest.json                 (DEFLATE)  validated against ManifestSchema
//   scene.excalidraw.json         (DEFLATE)  the Excalidraw scene
//   data/layer-<id>.geojson       (DEFLATE)  per data-layer FeatureCollection
//   style.json                    (DEFLATE)  basemap style ref (opaque)
//   comments.json                 (DEFLATE)  the comments, when there are any
//   files/<name>                  (STORE)    binary assets — already-compressed
//   meta/thumbnail.png            (STORE)    optional preview, write-only here
//
// Boundary contract: this module returns / accepts an in-memory
// `AtlasdrawDocument`. Higher layers translate it to and from the app's
// document and the Excalidraw scene.

import JSZip from "jszip";
import { LIMITS, type ArchiveLimits } from "@atlasdraw/protocol";

import {
  ManifestSchema,
  SavedCommentSchema,
  type AtlasdrawDocument,
  type SavedComment,
  type SceneElement,
} from "./manifest-schema.js";
import { migrate, MigrationError, type StoredDocument } from "./migrations.js";

import type { FeatureCollection } from "geojson";

export const ATLASDRAW_MIME = "application/vnd.atlasdraw+zip";

const MANIFEST_PATH = "manifest.json";
const SCENE_PATH = "scene.excalidraw.json";
const STYLE_PATH = "style.json";
const COMMENTS_PATH = "comments.json";
const THUMBNAIL_PATH = "meta/thumbnail.png";
const LAYER_PATH_RE = /^data\/layer-(.+)\.geojson$/;
const FILES_PREFIX = "files/";

export type AtlasdrawFormatErrorCode =
  | "BAD_ZIP"
  | "MISSING_MANIFEST"
  | "INVALID_MANIFEST"
  | "MISSING_SCENE"
  | "UNSUPPORTED_VERSION"
  | "TOO_LARGE";

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
   * The zip mod-time of every entry written by this call. When omitted, it is
   * the manifest's `updatedAt`, so the same document always gives the same
   * bytes. (JSZip's own default is `new Date()`, which made two writes of one
   * document differ.)
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
 * A Blob's bytes. `Blob.prototype.arrayBuffer` is in every browser and in
 * Node; jsdom's Blob lacks it, and there FileReader gives the same bytes.
 */
function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
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
  writeOptions: WriteOptions = {},
): Promise<Blob> {
  const options: WriteOptions = {
    ...writeOptions,
    date: writeOptions.date ?? new Date(doc.manifest.updatedAt),
  };
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
  // Written only when there is a comment, so a document without comments
  // gives the same bytes as before comments were saved.
  if (doc.comments && doc.comments.length > 0) {
    texts.set(COMMENTS_PATH, JSON.stringify(doc.comments));
  }

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
    const buf = await blobBytes(blob);
    const path = `${FILES_PREFIX}${name}`;
    binaryPaths.add(path);
    zip.file(path, buf, {
      compression: "STORE",
      ...(options.date ? { date: options.date } : {}),
    });
  }

  if (options.thumbnail) {
    const thumbBuf = await blobBytes(options.thumbnail);
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

/** What `read` takes besides the bytes. */
export interface ReadOptions {
  /** What the archive may expand to. The default is LIMITS.archive. */
  limits?: ArchiveLimits;
}

/**
 * Parse a `.atlasdraw` zip Blob into an `AtlasdrawDocument`.
 *
 * Throws `AtlasdrawFormatError` for any structural violation; the caller is
 * expected to surface `error.code` to the UI ("not a valid atlasdraw file" /
 * "manifest corrupt" / etc). An archive that would expand past `limits` is
 * refused with `TOO_LARGE` before it fills memory: the entry count is read
 * from the archive's directory, and the inflated bytes are counted as they
 * arrive, because the sizes an archive declares can lie.
 *
 * A data layer whose GeoJSON is not JSON is left out of `layers`; its
 * manifest entry stays, so the caller can count it as dropped.
 */
export async function read(
  blob: Blob,
  options: ReadOptions = {},
): Promise<AtlasdrawDocument> {
  const limits = options.limits ?? LIMITS.archive;
  let zip: JSZip;
  try {
    // JSZip's Blob support is browser-only; in node test runtimes we hand it
    // an ArrayBuffer, which is universally supported.
    const buf = await blobBytes(blob);
    refuseEntryCount(declaredEntryCount(buf), limits);
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    if (err instanceof AtlasdrawFormatError) {
      throw err;
    }
    throw new AtlasdrawFormatError(
      "BAD_ZIP",
      `failed to open .atlasdraw archive: ${
        (err as Error).message ?? String(err)
      }`,
    );
  }
  refuseEntryCount(Object.keys(zip.files).length, limits);
  const inflate = inflater(limits);
  refuseDeclaredSizes(zip, limits);
  const text = async (entry: JSZip.JSZipObject): Promise<string> =>
    new TextDecoder().decode(await inflate(entry));

  // --- manifest.json --------------------------------------------------------
  const manifestEntry = zip.file(MANIFEST_PATH);
  if (!manifestEntry) {
    throw new AtlasdrawFormatError(
      "MISSING_MANIFEST",
      `archive is missing required entry "${MANIFEST_PATH}"`,
    );
  }
  const manifestText = await text(manifestEntry);
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
  // --- scene.excalidraw.json ------------------------------------------------
  const sceneEntry = zip.file(SCENE_PATH);
  if (!sceneEntry) {
    throw new AtlasdrawFormatError(
      "MISSING_SCENE",
      `archive is missing required entry "${SCENE_PATH}"`,
    );
  }
  const sceneText = await text(sceneEntry);
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

  // --- migrate, then validate -----------------------------------------------
  // An older file is brought to the current version first (migrations.ts), so
  // the schema below only ever sees the current shape.
  if (
    !manifestJson ||
    typeof manifestJson !== "object" ||
    Array.isArray(manifestJson)
  ) {
    throw new AtlasdrawFormatError(
      "INVALID_MANIFEST",
      "manifest.json is not a JSON object",
    );
  }
  let migrated: StoredDocument;
  try {
    migrated = migrate({
      manifest: manifestJson as Record<string, unknown>,
      scene: sceneElements,
    });
  } catch (err) {
    if (err instanceof MigrationError) {
      throw new AtlasdrawFormatError("UNSUPPORTED_VERSION", err.message);
    }
    throw err;
  }
  const parsed = ManifestSchema.safeParse(migrated.manifest);
  if (!parsed.success) {
    throw new AtlasdrawFormatError(
      "INVALID_MANIFEST",
      `manifest.json failed schema validation: ${parsed.error.message}`,
    );
  }
  const manifest = parsed.data;
  const scene = migrated.scene as ReadonlyArray<SceneElement>;

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
      // The content is checked by the reader's caller (the app's document
      // gate); here a layer that is not JSON is only left out.
      try {
        layers.set(layerId, JSON.parse(await text(entry)) as FeatureCollection);
      } catch (err) {
        if (err instanceof AtlasdrawFormatError) {
          throw err;
        }
      }
      continue;
    }

    if (path.startsWith(FILES_PREFIX) && path !== FILES_PREFIX) {
      const basename = path.slice(FILES_PREFIX.length);
      // Skip nested-dir names just in case — flat namespace is the contract.
      if (basename.includes("/")) {
        continue;
      }
      const bytes = await inflate(entry);
      files.set(basename, new Blob([bytes as Uint8Array<ArrayBuffer>]));
      continue;
    }
    // manifest.json, scene.excalidraw.json, style.json, meta/thumbnail.png
    // are handled separately or intentionally ignored.
  }

  // --- style.json -----------------------------------------------------------
  let styleRef: unknown = null;
  const styleEntry = zip.file(STYLE_PATH);
  if (styleEntry) {
    const styleText = await text(styleEntry);
    try {
      styleRef = JSON.parse(styleText);
    } catch {
      // Treat unparseable style.json as absent — basemap is recoverable.
      styleRef = null;
    }
  }

  // --- comments.json --------------------------------------------------------
  const comments: SavedComment[] = [];
  const commentsEntry = zip.file(COMMENTS_PATH);
  if (commentsEntry) {
    let raw: unknown = [];
    try {
      raw = JSON.parse(await text(commentsEntry));
    } catch {
      // An unreadable comments file loses the comments, not the map.
    }
    for (const item of Array.isArray(raw) ? raw : []) {
      const parsed = SavedCommentSchema.safeParse(item);
      if (parsed.success) {
        comments.push(parsed.data);
      }
    }
  }

  return {
    manifest,
    scene,
    layers,
    styleRef,
    files,
    comments,
  };
}

// ---------------------------------------------------------------------------
// Archive limits
// ---------------------------------------------------------------------------

function tooLarge(message: string): AtlasdrawFormatError {
  return new AtlasdrawFormatError("TOO_LARGE", message);
}

function refuseEntryCount(count: number | null, limits: ArchiveLimits): void {
  if (count !== null && count > limits.entries) {
    throw tooLarge(
      `the archive has ${count} entries; a map may have at most ${limits.entries}`,
    );
  }
}

/**
 * The entry count in the archive's end-of-directory record, or null when
 * there is none (then the zip reader refuses the bytes) or it defers to a
 * zip64 record. Read before the zip reader makes an object per entry.
 */
function declaredEntryCount(buf: ArrayBuffer): number | null {
  const view = new DataView(buf);
  const last = buf.byteLength - 22;
  // The record is 22 bytes plus a comment of up to 65535.
  for (let at = last; at >= 0 && at >= last - 0xffff; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      const count = view.getUint16(at + 10, true);
      return count === 0xffff ? null : count;
    }
  }
  return null;
}

/** The size JSZip read from the directory: internal, but stable in 3.x. */
function declaredSize(entry: JSZip.JSZipObject): number {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })
    ._data?.uncompressedSize;
  return typeof size === "number" && size > 0 ? size : 0;
}

/** Refuse at once what the directory already says is too large. */
function refuseDeclaredSizes(zip: JSZip, limits: ArchiveLimits): void {
  let total = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    const size = declaredSize(entry);
    if (size > limits.entryBytes) {
      throw entryTooLarge(path, limits);
    }
    total += size;
  }
  if (total > limits.totalBytes) {
    throw totalTooLarge(limits);
  }
}

function entryTooLarge(path: string, limits: ArchiveLimits) {
  return tooLarge(
    `"${path}" expands past ${limits.entryBytes} bytes, the cap for one entry`,
  );
}

function totalTooLarge(limits: ArchiveLimits) {
  return tooLarge(
    `the archive expands past ${limits.totalBytes} bytes, the cap for a map`,
  );
}

/** JSZip's entry stream: present on every entry, absent from its types. */
interface EntryStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): EntryStream;
  on(event: "error", listener: (err: Error) => void): EntryStream;
  on(event: "end", listener: () => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
}

/**
 * A function that inflates one entry and counts what it inflates, against
 * the entry cap and against the total of every entry it inflated before.
 * It stops the moment a cap is passed.
 */
function inflater(limits: ArchiveLimits) {
  let total = 0;
  return (entry: JSZip.JSZipObject): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      let settled = false;
      const stream = (
        entry as unknown as { internalStream(type: "uint8array"): EntryStream }
      ).internalStream("uint8array");
      const fail = (err: Error): void => {
        if (!settled) {
          settled = true;
          stream.pause();
          reject(err);
        }
      };
      stream
        .on("data", (chunk) => {
          if (settled) {
            return;
          }
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (size > limits.entryBytes) {
            fail(entryTooLarge(entry.name, limits));
          } else if (total > limits.totalBytes) {
            fail(totalTooLarge(limits));
          } else {
            chunks.push(chunk);
          }
        })
        .on("error", (err) =>
          fail(
            new AtlasdrawFormatError(
              "BAD_ZIP",
              `"${entry.name}" could not be read: ${err.message}`,
            ),
          ),
        )
        .on("end", () => {
          if (settled) {
            return;
          }
          settled = true;
          const out = new Uint8Array(size);
          let at = 0;
          for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.byteLength;
          }
          resolve(out);
        })
        .resume();
    });
}
