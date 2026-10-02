// SPDX-License-Identifier: MIT
// Canonical Zod schema for `manifest.json`.
//
// This is the single source of truth for the persisted manifest shape. The
// `.atlasdraw` zip reader and writer (`atlasdraw.ts`), the bare-JSON variant
// (`atlasdraw-json.ts`) and the CLI's lint and convert
// (`packages/cli/src/commands/`) all parse against `ManifestSchema`.

import { z } from "zod";

import { CURRENT_MANIFEST_VERSION } from "./migrations.js";

import type { FeatureCollection } from "geojson";

// ULID = 26 characters in Crockford base32 (digits + uppercase letters minus
// I, L, O, U). https://github.com/ulid/spec
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const ULIDSchema = z.string().regex(ULID_REGEX, "Invalid ULID");

const ISOTimestampSchema = z.string().datetime({ offset: true });

export const BasemapRefSchema = z.object({
  type: z.literal("registry"),
  id: z.string().min(1),
});
export type BasemapRef = z.infer<typeof BasemapRefSchema>;

export const CameraSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number(),
  bearing: z.number().default(0),
  pitch: z.number().default(0),
});
export type Camera = z.infer<typeof CameraSchema>;

// LayerStyle is owned by @atlasdraw/basemap and may grow. We accept its
// runtime shape opaquely here so the manifest need not change when it grows.
const LayerStyleSchema = z.record(z.string(), z.unknown());

const DataLayerEntrySchema = z.object({
  kind: z.literal("data"),
  // `dl:` prefix matches the runtime convention in
  // apps/atlas-app/src/state/document.ts so a layer id can never
  // collide with an Excalidraw element id.
  id: z.string().regex(/^dl:/, "data layer id must start with 'dl:'"),
  label: z.string(),
  visible: z.boolean(),
  featureCount: z.number().int().nonnegative(),
  // The geometry kind the layer draws, decided at import. Optional because
  // older files do not have it; a reader then takes it from the GeoJSON.
  geometryKind: z.enum(["fill", "line", "circle"]).optional(),
  style: LayerStyleSchema,
  // Path within the zip to the layer's GeoJSON. The atlasdraw.ts writer follows
  // the convention `data/layer-<id>.geojson`.
  source: z.string().min(1),
  // Import provenance — the original file name and how many input records the
  // import dropped. Optional because documents written before this field
  // existed, converted annotations, and collaboratively-received layers have
  // no import event to describe; the panel renders "unknown" rather than
  // inventing one.
  provenance: z
    .object({
      sourceFile: z.string().min(1),
      droppedCount: z.number().int().nonnegative(),
    })
    .optional(),
});

/** lng/lat, in the order MapLibre's `image` source wants: TL, TR, BR, BL. */
const RasterCornersSchema = z.tuple([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number()]),
]);

/**
 * A georeferenced picture. Shares almost nothing with a data layer: no
 * `featureCount` (no features), no `style` (fill colour means nothing to
 * pixels), and `source` is replaced by `imageKey`, which addresses the decoded
 * PNG in the zip's `files/` bag rather than a GeoJSON path in `data/`.
 *
 * The original GeoTIFF is deliberately NOT saved. `provenance.sourceFile` is
 * the only record of the file that produced this.
 */
const RasterLayerEntrySchema = z.object({
  kind: z.literal("raster"),
  // `rl:` for the same reason `dl:` exists — the stack an id belongs to should
  // be answerable from the id alone.
  id: z.string().regex(/^rl:/, "raster layer id must start with 'rl:'"),
  label: z.string(),
  visible: z.boolean(),
  corners: RasterCornersSchema,
  opacity: z.number().min(0).max(1),
  /** Name within the zip's `files/` bag. */
  imageKey: z.string().min(1),
  provenance: z
    .object({
      sourceFile: z.string().min(1),
      droppedCount: z.number().int().nonnegative(),
    })
    .optional(),
});

/**
 * An XYZ raster tile layer: map tiles fetched from a URL template
 * (`{z}/{x}/{y}`), such as aerial imagery or a historic map. It has no
 * payload in the file; the tiles stay on their server. `attribution` is the
 * credit the tile provider asks for; it is printed with the basemap's.
 *
 * Kept out of `layers`, in the optional top-level `tileLayers`, so the
 * manifest version does not change: a file without tile layers is byte for
 * byte what it was, and an older reader drops the field instead of refusing
 * the file over an unknown layer kind. Array order is stack order, bottom
 * first, like `layers`.
 */
const TileLayerEntrySchema = z.object({
  kind: z.literal("tile"),
  id: z.string().regex(/^tl:/, "tile layer id must start with 'tl:'"),
  label: z.string(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  /** The tile URL template, with {z}, {x} and {y}. */
  url: z.string().min(1),
  attribution: z.string().optional(),
});
export type TileLayerEntry = z.infer<typeof TileLayerEntrySchema>;

/**
 * The manifest lists the map layers: data and raster. A drawn element is not
 * listed; what the layer panel adds to it (a user label, a hidden flag) is in
 * the element's `customData.atlas`. Version 1 listed elements too; the v1 → v2
 * migration (migrations.ts) moves those entries onto their elements.
 */
export const LayerEntrySchema = z.discriminatedUnion("kind", [
  DataLayerEntrySchema,
  RasterLayerEntrySchema,
]);
export type LayerEntry = z.infer<typeof LayerEntrySchema>;

/**
 * The world frame (docs/architecture/adr/0015-world-coordinates-gate.md): a
 * scene coordinate is a Web Mercator pixel at
 * zoom `z0`, minus `origin` (a world pixel at z0). Integers, so the frame
 * adds no rounding error.
 */
export const WorldFrameSchema = z.object({
  z0: z.number().int().min(0).max(30),
  origin: z.object({ x: z.number().int(), y: z.number().int() }),
});
export type WorldFrameData = z.infer<typeof WorldFrameSchema>;

export const PermissionsSchema = z.object({
  publicView: z.boolean().default(false),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

export const ManifestSchema = z
  .object({
    id: ULIDSchema,
    // Readers run migrations.ts first, so an older file arrives here at the
    // current version.
    version: z.literal(CURRENT_MANIFEST_VERSION),
    title: z.string().min(1),
    createdAt: ISOTimestampSchema,
    updatedAt: ISOTimestampSchema,
    basemap: BasemapRefSchema,
    camera: CameraSchema,
    world: WorldFrameSchema,
    layers: z.array(LayerEntrySchema),
    /** Optional: see TileLayerEntrySchema. */
    tileLayers: z.array(TileLayerEntrySchema).optional(),
    permissions: PermissionsSchema,
  })
  .superRefine((m, ctx) => {
    if (Date.parse(m.updatedAt) < Date.parse(m.createdAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "updatedAt must be >= createdAt",
      });
    }
  });

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Structural minimum of an Excalidraw scene element as @atlasdraw/data sees
 * it. Typed, not `unknown`, so the load path
 * (`updateScene({elements: doc.scene})`) needs no laundering of types.
 *
 * We deliberately do NOT import @atlasdraw/element types here — that would
 * pull the entire Excalidraw type graph into a package the CLI also consumes.
 * Instead we declare the cross-cut properties the writer touches (`id`,
 * `type`, `version`) and leave room for the rest as `unknown` index entries.
 *
 * Excalidraw's `OrderedExcalidrawElement` is a structural subtype of this:
 * the assignment `scene: excalidrawAPI.getSceneElements()` typechecks without
 * a cast. Going the other direction (passing `doc.scene` to `updateScene`)
 * needs a narrowing cast at the boundary — see the app's state/documentIO.ts.
 */
export interface SceneElement {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly [key: string]: unknown;
}

/**
 * A comment as the file stores it (`comments.json`). The anchor is kept as
 * written; the app normalises it (protocol `normalizeAnchor`).
 */
export const SavedCommentSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  createdAt: z.number(),
  resolved: z.boolean(),
  anchor: z.record(z.unknown()),
  schemaVersion: z.number(),
});

export type SavedComment = z.infer<typeof SavedCommentSchema>;

/**
 * Runtime in-memory representation of an atlasdraw document. The zip writer
 * accepts this; the reader returns it. `styleRef` is opaque (`unknown`): this
 * package does not read it.
 */
export interface AtlasdrawDocument {
  readonly manifest: Manifest;
  readonly scene: ReadonlyArray<SceneElement>;
  readonly layers: Map<string, FeatureCollection>;
  readonly styleRef: unknown;
  readonly files: Map<string, Blob>;
  /** Written to `comments.json` only when there is one. */
  readonly comments?: ReadonlyArray<SavedComment>;
}
