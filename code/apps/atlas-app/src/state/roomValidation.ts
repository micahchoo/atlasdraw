// SPDX-License-Identifier: AGPL-3.0-only
//
// Every record that comes from the room doc is checked here before the
// editor, the Document or the map sees it. Any client with the link can
// write any value into the room doc, so a record is data from a stranger
// until it passes.
//
//   checkElement   an Excalidraw element: dropped when its id, type,
//                  geometry or version is wrong; its style fields are
//                  repaired to Excalidraw's defaults
//   checkFile      an image file of the drawing (type, data URL, size)
//   checkOverlay   a layer entry (kind, id prefix dl:/rl:/tl:, fields, and
//                  a data layer's style, by lib/layerStyle.ts)
//   checkFeatures  a data layer's FeatureCollection (RFC 7946 shapes,
//                  finite coordinates, a feature cap)
//   checkImage     a raster's bytes (type, size)
//   checkComment   one comment row of the comments Y.Array
//   checkTitle, checkCamera, checkWorld, checkBasemap   the meta map
//
// These are the record-level half of the document gate (documentGate.ts):
// a file or a share link is checked record by record with the same
// functions, so each rule has one copy.
//
// Why a zod schema and not Excalidraw's restoreElements: restoreElements
// fills defaults for legacy files, but it passes wrong types through (x: "10"
// stays a string), throws on a null entry, and bumps `version` when it
// repairs, which breaks the per-element conflict rule (roomScene.ts#wins).
// It also reads browser globals when it is imported (appState.ts reads
// devicePixelRatio), so the node tests that run real rooms cannot load it.
//
// Unknown fields pass through: a newer client may add one, and dropping it
// here would show that client's element without it. Nothing here writes to
// the room: an invalid record stays in the room doc, and every client skips
// it. A local edit to the same id is written over it as usual.
//
// A check returns the record itself when nothing was repaired, so a
// Document still finds an unchanged entry by identity. Results are kept per
// record object: a Y.Map gives back the same object until the entry changes.

import { z } from "zod";

import { IMAGE_MIME_TYPES } from "@atlasdraw/common";
import { CameraSchema, ULIDSchema, WorldFrameSchema } from "@atlasdraw/data";
import {
  COMMENT_SCHEMA_VERSION,
  ROOM_SIZE,
  normalizeAnchor,
  type CommentAnchor,
  type CommentSchemaV1,
} from "@atlasdraw/protocol";

import type { BinaryFileData } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { Camera, WorldFrameData } from "@atlasdraw/data";

import { validateLayerStyle } from "../lib/layerStyle";
import { validateTileTemplate } from "../lib/tileLayers";

import type { OverlayEntry } from "./document";

import type { FeatureCollection } from "geojson";
import type * as Y from "yjs";

/** Size limits for what a peer may put in a room. */
export const ROOM_LIMITS = {
  /** Characters of an element's text, or of a comment. */
  text: 100_000,
  /** Points of one line, arrow or freehand stroke. */
  points: 100_000,
  /** Characters of an id. */
  id: 256,
  /** Characters of any other short string (a colour, a name, a label). */
  short: 1_024,
  /** Characters of a link or a URL. */
  url: 8_192,
  /** Characters of the document title. */
  title: 500,
  /** Features of one data layer. */
  features: 250_000,
  /** Characters of a drawing file's data URL (protocol ROOM_SIZE). */
  fileDataUrl: ROOM_SIZE.imageDataUrlChars,
  /** Bytes of a raster image (protocol ROOM_SIZE): fits one relay message. */
  rasterBytes: ROOM_SIZE.rasterBytes,
} as const;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** The Yjs client that last wrote `key` of `map`; null when not known. */
export function writerOfKey(map: Y.Map<unknown>, key: string): number | null {
  // Y.Map keeps its entries as Items with the writer's id. Internal, but
  // stable across Yjs 13.
  const item = (
    map as unknown as { _map?: Map<string, { id?: { client?: number } }> }
  )._map?.get(key);
  return typeof item?.id?.client === "number" ? item.id.client : null;
}

/** The Yjs client that wrote a shared type held in an array or map. */
export function writerOfType(value: unknown): number | null {
  const client = (value as { _item?: { id?: { client?: number } } } | null)
    ?._item?.id?.client;
  return typeof client === "number" ? client : null;
}

const warned = new WeakMap<Y.Doc, Set<number | null>>();

/**
 * Say once per peer per room doc that a record from it was ignored. A peer
 * that writes many bad records fills no console.
 */
export function rejectFrom(
  doc: Y.Doc,
  writer: number | null,
  what: string,
): void {
  let seen = warned.get(doc);
  if (!seen) {
    seen = new Set();
    warned.set(doc, seen);
  }
  if (seen.has(writer)) {
    return;
  }
  seen.add(writer);
  // eslint-disable-next-line no-console
  console.warn(
    `[atlasdraw] room: ignored an invalid ${what} from peer ${
      writer ?? "unknown"
    }; later ones from this peer are ignored without a message`,
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Scene numbers reach 2^31 (docs/architecture/adr/0015-world-coordinates-gate.md);
 * this leaves room and stops Infinity.
 */
const MAX_SCENE_NUMBER = 2 ** 40;

const sceneNumber = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) <= MAX_SCENE_NUMBER);
const finite = z.number().finite();
const id = z.string().min(1).max(ROOM_LIMITS.id);
const short = z.string().max(ROOM_LIMITS.short);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const plainRecord = z.custom<Record<string, unknown>>(isPlainObject);
const point = z.tuple([sceneNumber, sceneNumber]);

/** Results per record object; a Y.Map entry keeps its object until it changes. */
function memo<T>(check: (value: object) => T | null) {
  const results = new WeakMap<object, T | null>();
  return (value: unknown): T | null => {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    if (!results.has(value)) {
      results.set(value, check(value));
    }
    return results.get(value)!;
  };
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/**
 * Style fields: a wrong value is replaced by Excalidraw's default. A field
 * that is not there stays away; Excalidraw writes every field, so only a
 * hand-made record lacks one.
 */
const style = {
  strokeColor: short.optional().catch("#1e1e1e"),
  backgroundColor: short.optional().catch("transparent"),
  fillStyle: z
    .enum(["hachure", "cross-hatch", "solid", "zigzag"])
    .optional()
    .catch("solid"),
  strokeWidth: finite.nonnegative().optional().catch(2),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional().catch("solid"),
  roughness: finite.optional().catch(1),
  opacity: finite.min(0).max(100).optional().catch(100),
  roundness: z
    .object({ type: finite, value: finite.optional() })
    .passthrough()
    .nullable()
    .optional()
    .catch(null),
  seed: z.number().int().optional().catch(1),
  groupIds: z.array(id).max(ROOM_LIMITS.short).optional().catch([]),
  frameId: id.nullable().optional().catch(null),
  boundElements: z
    .array(z.object({ id, type: z.enum(["arrow", "text"]) }).passthrough())
    .max(ROOM_LIMITS.points)
    .nullable()
    .optional()
    .catch(null),
  updated: finite.optional().catch(0),
  link: z.string().max(ROOM_LIMITS.url).nullable().optional().catch(null),
  locked: z.boolean().optional().catch(false),
  customData: plainRecord.optional().catch(undefined),
  index: z.string().max(ROOM_LIMITS.id).nullable().optional().catch(null),
};

/** Fields an element cannot be drawn without: wrong means dropped. */
const base = z
  .object({
    id,
    x: sceneNumber,
    y: sceneNumber,
    width: sceneNumber,
    height: sceneNumber,
    angle: finite.optional().catch(0),
    version: z.number().int().nonnegative(),
    versionNonce: z.number().int(),
    isDeleted: z.boolean(),
    ...style,
  })
  .passthrough();

const points = z.array(point).min(1).max(ROOM_LIMITS.points);
const binding = plainRecord.nullable().optional().catch(null);
const arrowhead = short.nullable().optional().catch(null);

const ElementSchema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("rectangle") }),
  base.extend({ type: z.literal("diamond") }),
  base.extend({ type: z.literal("ellipse") }),
  // `iframe` and `embeddable` are refused: they rendered live web pages
  // (ADR-0010). A type that is not listed fails the check.
  base.extend({
    type: z.literal("frame"),
    name: short.nullable().optional().catch(null),
  }),
  base.extend({
    type: z.literal("magicframe"),
    name: short.nullable().optional().catch(null),
  }),
  base.extend({
    type: z.literal("text"),
    text: z.string().max(ROOM_LIMITS.text),
    originalText: z.string().max(ROOM_LIMITS.text),
    fontSize: finite.positive(),
    fontFamily: z.number().int().optional().catch(1),
    textAlign: z.enum(["left", "center", "right"]).optional().catch("left"),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional().catch("top"),
    containerId: id.nullable().optional().catch(null),
    lineHeight: finite.positive().optional().catch(1.25),
    autoResize: z.boolean().optional().catch(true),
  }),
  base.extend({
    type: z.literal("line"),
    points,
    startBinding: binding,
    endBinding: binding,
    startArrowhead: arrowhead,
    endArrowhead: arrowhead,
  }),
  base.extend({
    type: z.literal("arrow"),
    points,
    startBinding: binding,
    endBinding: binding,
    startArrowhead: arrowhead,
    endArrowhead: arrowhead,
    elbowed: z.boolean().optional().catch(false),
  }),
  base.extend({
    type: z.literal("freedraw"),
    points,
    pressures: z.array(finite).max(ROOM_LIMITS.points).optional().catch([]),
    simulatePressure: z.boolean().optional().catch(true),
  }),
  base.extend({
    type: z.literal("image"),
    fileId: id.nullable().optional().catch(null),
    status: z.enum(["pending", "saved", "error"]).optional().catch("pending"),
    scale: z.tuple([finite, finite]).optional().catch([1, 1]),
    crop: plainRecord.nullable().optional().catch(null),
  }),
]);

const elementOf = memo<ExcalidrawElement>((raw) => {
  const parsed = ElementSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  // Arrays and objects are new after a parse even when equal; the copy the
  // editor takes is made by the caller either way.
  return parsed.data as unknown as ExcalidrawElement;
});

/**
 * The element stored under `key`, repaired where a style field was wrong;
 * null when it cannot be drawn. The result is shared: copy it before the
 * editor may change it.
 */
export function checkElement(
  key: string,
  value: unknown,
): ExcalidrawElement | null {
  const el = elementOf(value);
  return el && el.id === key ? el : null;
}

// ---------------------------------------------------------------------------
// Files of the drawing
// ---------------------------------------------------------------------------

/** A file as the room doc keeps it: what Excalidraw's BinaryFileData holds. */
export type RoomFile = Pick<BinaryFileData, "mimeType" | "dataURL" | "created">;

const IMAGE_TYPES = new Set<string>(Object.values(IMAGE_MIME_TYPES));

/** True for a type the drawing may hold as an image file. */
export function isImageType(mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType);
}

const fileOf = memo<RoomFile>((raw) => {
  const f = raw as Partial<RoomFile>;
  if (
    typeof f.mimeType !== "string" ||
    !IMAGE_TYPES.has(f.mimeType) ||
    typeof f.dataURL !== "string" ||
    f.dataURL.length > ROOM_LIMITS.fileDataUrl ||
    !f.dataURL.startsWith(`data:${f.mimeType}`) ||
    !Number.isFinite(f.created)
  ) {
    return null;
  }
  return raw as RoomFile;
});

/** An image file of the drawing, or null. */
export function checkFile(key: string, value: unknown): RoomFile | null {
  return key.length > 0 && key.length <= ROOM_LIMITS.id ? fileOf(value) : null;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const label = z.string().max(ROOM_LIMITS.short);
const order = z.number().int().nonnegative().max(1_000_000);
const opacity = finite.min(0).max(1);
const provenance = z
  .object({
    sourceFile: z.string().max(ROOM_LIMITS.short),
    droppedCount: z.number().int().nonnegative(),
  })
  .optional();
const lngLat = z.tuple([finite, finite]);

const OverlaySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("data"),
      id: id.regex(/^dl:/),
      label,
      visible: z.boolean(),
      order,
      featureCount: z.number().int().nonnegative(),
      geometryKind: z.enum(["fill", "line", "circle"]),
      style: plainRecord,
      provenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("raster"),
      id: id.regex(/^rl:/),
      label,
      visible: z.boolean(),
      order,
      corners: z.tuple([lngLat, lngLat, lngLat, lngLat]),
      opacity,
      imageKey: id,
      provenance,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("tile"),
      id: id.regex(/^tl:/),
      label,
      visible: z.boolean(),
      order,
      opacity,
      // The same check as when a user adds a tile layer: https, or http
      // on localhost, with {z}, {x} and {y}.
      url: z
        .string()
        .max(ROOM_LIMITS.url)
        .refine((url) => validateTileTemplate(url).ok),
      attribution: z.string().max(ROOM_LIMITS.short).optional(),
    })
    .passthrough(),
]);

const overlayOf = memo<OverlayEntry>((raw) => {
  const parsed = OverlaySchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  // A style the map cannot draw stops that layer from drawing, and one that
  // throws while it compiles stopped every layer.
  const entry = parsed.data;
  return entry.kind === "data" &&
    validateLayerStyle(entry.style, entry.geometryKind).length > 0
    ? null
    : (raw as OverlayEntry);
});

/** The layer entry stored under `key`, or null. */
export function checkOverlay(key: string, value: unknown): OverlayEntry | null {
  const entry = overlayOf(value);
  return entry && entry.id === key ? entry : null;
}

// ---------------------------------------------------------------------------
// Data-layer features (RFC 7946)
// ---------------------------------------------------------------------------

function isPosition(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    (p.length === 2 || p.length === 3) &&
    p.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isPositions(v: unknown, depth: number): boolean {
  if (!Array.isArray(v)) {
    return false;
  }
  return depth === 0
    ? isPosition(v)
    : v.every((child) => isPositions(child, depth - 1));
}

const POSITION_DEPTH: Record<string, number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

function isGeometry(g: unknown, nested = 0): boolean {
  if (!isPlainObject(g) || typeof g.type !== "string") {
    return false;
  }
  if (g.type === "GeometryCollection") {
    return (
      nested < 4 &&
      Array.isArray(g.geometries) &&
      g.geometries.every((child) => isGeometry(child, nested + 1))
    );
  }
  const depth = POSITION_DEPTH[g.type];
  return depth !== undefined && isPositions(g.coordinates, depth);
}

const featuresOf = memo<FeatureCollection>((raw) => {
  const fc = raw as Record<string, unknown>;
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    return null;
  }
  const ok = fc.features.every(
    (f: unknown) =>
      isPlainObject(f) &&
      f.type === "Feature" &&
      (f.properties === null || isPlainObject(f.properties)) &&
      (f.geometry === null || isGeometry(f.geometry)),
  );
  return ok ? (raw as unknown as FeatureCollection) : null;
});

/**
 * The FeatureCollection of data layer `key`, or null. `maxFeatures` is the
 * room's cap unless the caller holds the layer whole in memory already (a
 * file it read).
 */
export function checkFeatures(
  key: string,
  value: unknown,
  maxFeatures: number = ROOM_LIMITS.features,
): FeatureCollection | null {
  const features = (value as { features?: unknown } | null)?.features;
  if (
    !/^dl:/.test(key) ||
    key.length > ROOM_LIMITS.id ||
    (Array.isArray(features) && features.length > maxFeatures)
  ) {
    return null;
  }
  return featuresOf(value);
}

// ---------------------------------------------------------------------------
// Raster images
// ---------------------------------------------------------------------------

export interface RoomImage {
  mimeType: string;
  bytes: Uint8Array;
}

const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const imageOf = memo<RoomImage>((raw) => {
  const image = raw as Partial<RoomImage>;
  return typeof image.mimeType === "string" &&
    RASTER_TYPES.has(image.mimeType) &&
    image.bytes instanceof Uint8Array &&
    image.bytes.byteLength > 0 &&
    image.bytes.byteLength <= ROOM_LIMITS.rasterBytes
    ? (raw as RoomImage)
    : null;
});

/** The image of raster layer `key`, or null. */
export function checkImage(key: string, value: unknown): RoomImage | null {
  return /^rl:/.test(key) ? imageOf(value) : null;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function checkTitle(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= ROOM_LIMITS.title
    ? value
    : null;
}

export function checkDocumentId(value: unknown): string | null {
  return ULIDSchema.safeParse(value).success ? (value as string) : null;
}

export function checkCamera(value: unknown): Camera | null {
  const parsed = CameraSchema.safeParse(value);
  return parsed.success &&
    parsed.data.center.every(Number.isFinite) &&
    Number.isFinite(parsed.data.zoom) &&
    parsed.data.zoom >= 0 &&
    parsed.data.zoom <= 24 &&
    Number.isFinite(parsed.data.bearing) &&
    Number.isFinite(parsed.data.pitch)
    ? parsed.data
    : null;
}

export function checkWorld(value: unknown): WorldFrameData | null {
  const parsed = WorldFrameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A basemap id: the registry's ids are short slugs. */
export function checkBasemap(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : null;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

function anchorOf(raw: unknown): CommentAnchor | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.kind === "map") {
    return Number.isFinite(raw.lng) &&
      Number.isFinite(raw.lat) &&
      Math.abs(raw.lng as number) <= 360 &&
      Math.abs(raw.lat as number) <= 90
      ? { kind: "map", lng: raw.lng as number, lat: raw.lat as number }
      : null;
  }
  const elementId = id.safeParse(raw.elementId);
  if (
    raw.kind === "element" ||
    (raw.kind === "annotation" && raw.source === "element")
  ) {
    return elementId.success
      ? normalizeAnchor({ kind: "element", elementId: elementId.data })
      : null;
  }
  const rasterId = id.safeParse(raw.rasterId);
  if (raw.kind === "annotation" && raw.source === "raster") {
    return rasterId.success
      ? { kind: "annotation", source: "raster", rasterId: rasterId.data }
      : null;
  }
  return null;
}

/**
 * One comment row, read from its fields and its anchor's fields; null when
 * a field is wrong. `get` reads a field of the row (a Y.Map in the room).
 */
export function checkComment(
  get: (key: string) => unknown,
  anchor: unknown,
): CommentSchemaV1 | null {
  const row = {
    id: get("id"),
    authorId: get("authorId"),
    authorName: get("authorName"),
    text: get("text"),
    createdAt: get("createdAt"),
    resolved: get("resolved") ?? false,
  };
  const a = anchorOf(anchor);
  if (
    !a ||
    !id.safeParse(row.id).success ||
    typeof row.authorId !== "string" ||
    row.authorId.length > ROOM_LIMITS.id ||
    typeof row.authorName !== "string" ||
    row.authorName.length > ROOM_LIMITS.short ||
    typeof row.text !== "string" ||
    row.text.length > ROOM_LIMITS.text ||
    !Number.isFinite(row.createdAt) ||
    typeof row.resolved !== "boolean"
  ) {
    return null;
  }
  return {
    id: row.id as string,
    authorId: row.authorId,
    authorName: row.authorName,
    text: row.text,
    createdAt: row.createdAt as number,
    resolved: row.resolved,
    anchor: a,
    schemaVersion: COMMENT_SCHEMA_VERSION,
  };
}
