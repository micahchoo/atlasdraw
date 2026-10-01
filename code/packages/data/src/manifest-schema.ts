// SPDX-License-Identifier: MIT
// Phase 3 Wave 0 Task 1 — Canonical Zod schema for `manifest.json`.
//
// This is the single source of truth for the persisted manifest shape. The
// `.atlasdraw` zip writer (`atlasdraw.ts`), reader (`atlasdraw.ts`),
// persistence layer (`apps/atlas-app/state/persistence.ts`), and CLI lint
// (`packages/cli/commands/lint.ts`) all parse against `ManifestSchema`.

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
// runtime shape opaquely here so manifest evolution doesn't gate Phase 3.
const LayerStyleSchema = z.record(z.string(), z.unknown());

const DataLayerEntrySchema = z.object({
  kind: z.literal("data"),
  // `dl:` prefix matches the runtime convention from
  // apps/atlas-app/src/state/layerRegistry.ts so a layer id can never
  // collide with an Excalidraw element id.
  id: z.string().regex(/^dl:/, "data layer id must start with 'dl:'"),
  label: z.string(),
  visible: z.boolean(),
  featureCount: z.number().int().nonnegative(),
  // The geometry kind the layer draws, decided at import. Optional because
  // older files do not have it; a reader then takes it from the GeoJSON.
  geometryKind: z.enum(["fill", "line", "circle"]).optional(),
  style: LayerStyleSchema,
  // Path within the zip to the layer's GeoJSON. Atlasdraw.ts writer follows
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
 * FU-1 — a georeferenced picture. Shares almost nothing with a data layer: no
 * `featureCount` (no features), no `style` (fill colour means nothing to
 * pixels), and `source` is replaced by `imageKey`, which addresses the decoded
 * PNG in the zip's `files/` bag rather than a GeoJSON path in `data/`.
 *
 * The original GeoTIFF is deliberately NOT persisted — see `RasterLayerEntry`
 * in the app's layerRegistry for why. `provenance.sourceFile` is the only
 * record of the file that produced this.
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
    layers: z.array(LayerEntrySchema),
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
 * it. Phase 4 Wave 0 (atlasdraw-3601): tightened from `unknown` so the
 * persistence-load hydration path (`updateScene({elements: doc.scene})`) does
 * not have to launder typing.
 *
 * We deliberately do NOT import @atlasdraw/element types here — that would
 * pull the entire Excalidraw type graph into a package the CLI also consumes.
 * Instead we declare the cross-cut properties the writer touches (`id`,
 * `type`, `version`) and leave room for the rest as `unknown` index entries.
 *
 * Excalidraw's `OrderedExcalidrawElement` is a structural subtype of this:
 * the assignment `scene: excalidrawAPI.getSceneElements()` typechecks without
 * a cast. Going the other direction (passing `doc.scene` to `updateScene`)
 * needs a narrowing cast at the boundary — see the app's state/hydrate.ts.
 */
export interface SceneElement {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly [key: string]: unknown;
}

/**
 * Runtime in-memory representation of an atlasdraw document. The zip writer
 * accepts this; the reader returns it. `styleRef` is still typed as `unknown`
 * since basemap shape is a Phase 4 contract still in motion.
 */
export interface AtlasdrawDocument {
  readonly manifest: Manifest;
  readonly scene: ReadonlyArray<SceneElement>;
  readonly layers: Map<string, FeatureCollection>;
  readonly styleRef: unknown;
  readonly files: Map<string, Blob>;
}
