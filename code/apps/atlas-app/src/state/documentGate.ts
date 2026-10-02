// SPDX-License-Identifier: AGPL-3.0-only
//
// The document gate: the one door for a document that comes from outside
// this tab. A file the user opens, a share link, a server copy, the
// browser's own saved copy and a room's frame all pass here before the
// editor, the Document or the map sees them.
//
//   admit(input, from)   Admitted { doc, dropped, repaired } | Refused { reason }
//
// What it refuses, with a reason that names the limit or the field:
//   - bytes over the cap for their source (protocol LIMITS)
//   - an archive that expands past LIMITS.archive (the zip reader counts)
//   - bytes that are not a map, a manifest that fails its schema, a map a
//     newer Atlasdraw wrote
//   - a world frame that is missing, or a reference zoom other than the
//     renderer's (geo REFERENCE_ZOOM): every element is measured in the
//     frame, so no guess can place the drawing
//
// What it drops and counts, so the rest of the map opens:
//   - elements: an element roomValidation#checkElement refuses (an embedded
//     web page, a wrong type, no geometry). A wrong style field is repaired.
//   - layers: a data layer with no GeoJSON, GeoJSON that is not JSON or not
//     RFC 7946; a raster with no image; a tile layer whose address the user
//     could not add; an entry roomValidation#checkOverlay refuses
//   - files: a drawing file that is not an image, or is over the image cap
//
// What it repairs, and says so:
//   - a data layer's style the map cannot draw (lib/layerStyle.ts) is
//     replaced by the default style. The layer and its data stay.
//
// The record checks are roomValidation's: a room checks each record as it
// arrives with the same functions, so each rule has one copy.

import {
  AtlasdrawFormatError,
  SavedCommentSchema,
  geometryKindOf,
  parseManifest,
  read,
  type AtlasdrawDocument,
  type Manifest,
  type SavedComment,
  type SceneElement,
  type TileLayerEntry,
} from "@atlasdraw/data";
import { defaultLayerStyle } from "@atlasdraw/basemap";
import { REFERENCE_ZOOM } from "@atlasdraw/geo";
import { LIMITS, sizeText } from "@atlasdraw/protocol";

import type { WorldFrameData } from "@atlasdraw/data";

import { validateLayerStyle } from "../lib/layerStyle";
import { validateTileTemplate } from "../lib/tileLayers";

import { elementFileIds } from "./pinDetails";
import {
  checkElement,
  checkFeatures,
  checkOverlay,
  checkWorld,
  isImageType,
} from "./roomValidation";

import type { FeatureCollection } from "geojson";

/** Where a document comes from. */
export type GateSource = "file" | "share" | "room";

export interface Dropped {
  /** Drawing elements left out. */
  readonly elements: number;
  /** Map layers left out. */
  readonly layers: number;
  /** Image files of the drawing left out. */
  readonly files: number;
}

export interface Repaired {
  /** Data-layer styles replaced by the default style. */
  readonly styles: number;
}

declare const admittedBrand: unique symbol;

/**
 * A document that passed the gate. Only admit() makes one, so a function
 * that takes an Admitted cannot be handed a document that skipped it.
 */
export interface Admitted {
  readonly ok: true;
  readonly doc: AtlasdrawDocument;
  readonly dropped: Dropped;
  readonly repaired: Repaired;
  readonly [admittedBrand]: true;
}

export interface Refused {
  readonly ok: false;
  /** For the user: names the limit or the field. */
  readonly reason: string;
}

/** The largest input each source may send, in bytes. */
const SOURCE_CAP: Readonly<Record<GateSource, number>> = {
  file: LIMITS.archive.totalBytes,
  share: LIMITS.upload,
  room: LIMITS.room,
};

function refused(reason: string): Refused {
  return { ok: false, reason };
}

/** The bytes of `input` when it is bytes; null for any other value. */
function bytesOf(input: unknown): Blob | null {
  if (input instanceof Blob) {
    return input;
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return new Blob([input as BlobPart]);
  }
  return null;
}

/** A format error in the user's words. */
function reasonOf(err: unknown): string {
  if (!(err instanceof AtlasdrawFormatError)) {
    return "This is not an Atlasdraw map.";
  }
  switch (err.code) {
    case "UNSUPPORTED_VERSION":
      return "A newer version of Atlasdraw made this map. Update Atlasdraw to open it.";
    case "TOO_LARGE":
      return `This map is too large to open: ${err.message}.`;
    case "INVALID_MANIFEST":
      if (err.field?.startsWith("world")) {
        return (
          worldProblem(undefined) ?? "This map's world frame is not valid."
        );
      }
      return err.field
        ? `This map's description is damaged: the field "${err.field}" is not valid.`
        : "This map's description is damaged.";
    case "BAD_ZIP":
    case "MISSING_MANIFEST":
    case "MISSING_SCENE":
      return "This is not an Atlasdraw map, or it is damaged.";
  }
}

/**
 * Why a world frame cannot place a drawing, or null when it can. Every
 * element is stored in the frame, so a missing frame is refused, never
 * replaced by a default.
 */
export function worldProblem(value: unknown): string | null {
  const world: WorldFrameData | null = checkWorld(value);
  if (!world) {
    return "This map has no valid world frame, so its drawing cannot be placed.";
  }
  if (world.z0 !== REFERENCE_ZOOM) {
    return `This map's reference zoom is ${world.z0}. Atlasdraw draws maps at reference zoom ${REFERENCE_ZOOM} only.`;
  }
  return null;
}

/** The manifest and scene of a document given as an object. */
function parsedObject(input: unknown): {
  manifest: Manifest;
  scene: ReadonlyArray<SceneElement>;
  layers: Map<string, FeatureCollection>;
  files: Map<string, Blob>;
  styleRef: unknown;
  comments: SavedComment[];
} {
  const obj = (input ?? {}) as Partial<
    Record<keyof AtlasdrawDocument, unknown>
  >;
  const { manifest, scene } = parseManifest(
    obj.manifest,
    Array.isArray(obj.scene) ? obj.scene : [],
  );
  const comments: SavedComment[] = [];
  for (const item of Array.isArray(obj.comments) ? obj.comments : []) {
    const parsed = SavedCommentSchema.safeParse(item);
    if (parsed.success) {
      comments.push(parsed.data);
    }
  }
  return {
    manifest,
    scene,
    layers:
      obj.layers instanceof Map
        ? (obj.layers as Map<string, FeatureCollection>)
        : new Map(),
    files:
      obj.files instanceof Map ? (obj.files as Map<string, Blob>) : new Map(),
    styleRef: obj.styleRef ?? {},
    comments,
  };
}

// ---------------------------------------------------------------------------
// File types, from the bytes
// ---------------------------------------------------------------------------

/** A Blob's bytes. FileReader, because not every runtime has Blob.arrayBuffer. */
function bufferOf(blob: Blob): Promise<ArrayBuffer> {
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

function startsWith(head: Uint8Array, bytes: readonly number[], at = 0) {
  return bytes.every((b, i) => head[at + i] === b);
}

/**
 * The image type of `blob` from its first bytes, or null. A file in an
 * archive carries no type, and a declared type proves nothing.
 */
async function sniffImageType(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await bufferOf(blob.slice(0, 512)));
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) {
    return "image/gif";
  }
  if (
    startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)) {
    return "image/avif";
  }
  if (startsWith(head, [0x42, 0x4d])) {
    return "image/bmp";
  }
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) {
    return "image/x-icon";
  }
  const text = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart();
  if (
    /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(
      text,
    )
  ) {
    return "image/svg+xml";
  }
  return null;
}

/** The raster image types a raster layer may hold (roomValidation's set). */
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Check a document from outside this tab. `input` is the bytes of a
 * `.atlasdraw` file, or a document already read (an old share link's JSON,
 * a document made from an `.excalidraw` file, one admitted before).
 * Never throws.
 */
export async function admit(
  input: unknown,
  from: GateSource,
): Promise<Admitted | Refused> {
  let parsed: ReturnType<typeof parsedObject>;
  try {
    const bytes = bytesOf(input);
    if (bytes) {
      const cap = SOURCE_CAP[from];
      if (bytes.size > cap) {
        return refused(
          `This map is ${sizeText(bytes.size)}; a map from ${
            from === "file" ? "a file" : from === "share" ? "a link" : "a room"
          } may be at most ${sizeText(cap)}.`,
        );
      }
      const file = await read(bytes);
      parsed = {
        ...file,
        comments: [...(file.comments ?? [])],
      };
    } else {
      parsed = parsedObject(input);
    }
  } catch (err) {
    return refused(reasonOf(err));
  }
  const frame = worldProblem(parsed.manifest.world);
  if (frame) {
    return refused(frame);
  }
  try {
    return await admitContent(parsed);
  } catch (err) {
    // A check that throws is a defect here, not in the map; refuse rather
    // than let the map past.
    // eslint-disable-next-line no-console
    console.error("[atlasdraw] the document gate failed", err);
    return refused("This map could not be checked, so it was not opened.");
  }
}

async function admitContent(
  file: ReturnType<typeof parsedObject>,
): Promise<Admitted> {
  const dropped = { elements: 0, layers: 0, files: 0 };
  const repaired = { styles: 0 };

  const scene: SceneElement[] = [];
  for (const raw of file.scene as readonly unknown[]) {
    const key =
      typeof raw === "object" && raw !== null && "id" in raw
        ? String((raw as { id: unknown }).id)
        : "";
    const el = checkElement(key, raw);
    if (el) {
      scene.push(el as unknown as SceneElement);
    } else {
      dropped.elements += 1;
    }
  }

  const keptFiles = new Map<string, Blob>();
  const layers = new Map<string, FeatureCollection>();
  const manifestLayers: Manifest["layers"] = [];
  for (const entry of file.manifest.layers) {
    if (entry.kind === "raster") {
      const image = file.files.get(entry.imageKey);
      const type = image && image.size > 0 ? await sniffImageType(image) : null;
      if (
        !image ||
        !type ||
        !RASTER_TYPES.has(type) ||
        !checkOverlay(entry.id, { ...entry, order: 0 })
      ) {
        dropped.layers += 1;
        continue;
      }
      keptFiles.set(entry.imageKey, new Blob([image], { type }));
      manifestLayers.push(entry);
      continue;
    }
    const fc = checkFeatures(
      entry.id,
      file.layers.get(entry.id),
      Number.POSITIVE_INFINITY,
    );
    if (!fc) {
      dropped.layers += 1;
      continue;
    }
    const geometryKind = entry.geometryKind ?? geometryKindOf(fc);
    let style = entry.style;
    if (validateLayerStyle(style, geometryKind).length > 0) {
      style = defaultLayerStyle(fc) as Record<string, unknown>;
      repaired.styles += 1;
    }
    const checked = { ...entry, geometryKind, style };
    if (
      !checkOverlay(entry.id, {
        ...checked,
        order: 0,
        featureCount: fc.features.length,
      })
    ) {
      dropped.layers += 1;
      continue;
    }
    layers.set(entry.id, fc);
    manifestLayers.push(checked);
  }

  const tileLayers: TileLayerEntry[] = [];
  for (const entry of file.manifest.tileLayers ?? []) {
    const check = validateTileTemplate(entry.url);
    if (
      !check.ok ||
      !checkOverlay(entry.id, { ...entry, url: check.url, order: 0 })
    ) {
      dropped.layers += 1;
      continue;
    }
    tileLayers.push({ ...entry, url: check.url });
  }

  // Drawing files: only those a kept element uses (an image, a pin's
  // photo); a file nothing uses is not written at the next save either, so
  // it is not counted.
  const used = new Set(scene.flatMap(elementFileIds));
  for (const fileId of used) {
    const blob = file.files.get(fileId);
    if (!blob || keptFiles.has(fileId)) {
      continue;
    }
    const type =
      blob.size <= LIMITS.record.image ? await sniffImageType(blob) : null;
    if (!type || !isImageType(type)) {
      dropped.files += 1;
      continue;
    }
    keptFiles.set(fileId, new Blob([blob], { type }));
  }

  const { tileLayers: _tiles, ...manifest } = file.manifest;
  const doc: AtlasdrawDocument = {
    manifest: {
      ...manifest,
      layers: manifestLayers,
      ...(tileLayers.length > 0 ? { tileLayers } : {}),
    },
    scene,
    layers,
    styleRef: file.styleRef,
    files: keptFiles,
    ...(file.comments.length > 0 ? { comments: file.comments } : {}),
  };
  return { ok: true, doc, dropped, repaired } as unknown as Admitted;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the user is told when the gate left something out or repaired it;
 * null when the map came in whole.
 */
export function droppedMessage(admitted: Admitted): string | null {
  const { elements, layers, files } = admitted.dropped;
  const parts = [
    elements > 0 ? plural(elements, "drawing element", "drawing elements") : "",
    layers > 0 ? plural(layers, "layer", "layers") : "",
    files > 0 ? plural(files, "image", "images") : "",
  ].filter(Boolean);
  const sentences: string[] = [];
  if (parts.length > 0) {
    sentences.push(
      `Some parts of this map could not be read and were left out: ${parts.join(
        ", ",
      )}.`,
    );
  }
  const { styles } = admitted.repaired;
  if (styles > 0) {
    sentences.push(
      `${plural(
        styles,
        "layer style",
        "layer styles",
      )} could not be drawn and ${
        styles === 1 ? "was" : "were"
      } reset to the default.`,
    );
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}
