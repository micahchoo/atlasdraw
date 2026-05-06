// SPDX-License-Identifier: MIT
// Phase 3 Wave 0 Task 1 — Canonical Zod schema for `manifest.json`.
//
// This is the single source of truth for the persisted manifest shape. The
// `.atlasdraw` zip writer (`atlasdraw.ts`), reader (`atlasdraw.ts`),
// persistence layer (`apps/atlas-app/state/persistence.ts`), and CLI lint
// (`packages/cli/commands/lint.ts`) all parse against `ManifestSchema`.

import { z } from "zod";
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

const AnnotationLayerEntrySchema = z.object({
  kind: z.literal("annotation"),
  id: z.string().min(1),
  label: z.string(),
  visible: z.boolean(),
});

const DataLayerEntrySchema = z.object({
  kind: z.literal("data"),
  // `dl:` prefix matches the runtime convention from
  // apps/atlas-app/src/state/layerRegistry.ts so annotation ids
  // (= Excalidraw element ids) can never collide with data layer ids.
  id: z.string().regex(/^dl:/, "data layer id must start with 'dl:'"),
  label: z.string(),
  visible: z.boolean(),
  featureCount: z.number().int().nonnegative(),
  style: LayerStyleSchema,
  // Path within the zip to the layer's GeoJSON. Atlasdraw.ts writer follows
  // the convention `data/layer-<id>.geojson`.
  source: z.string().min(1),
});

export const LayerEntrySchema = z.discriminatedUnion("kind", [
  AnnotationLayerEntrySchema,
  DataLayerEntrySchema,
]);
export type LayerEntry = z.infer<typeof LayerEntrySchema>;

export const PermissionsSchema = z.object({
  publicView: z.boolean().default(false),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

export const ManifestSchema = z
  .object({
    id: ULIDSchema,
    version: z.literal(1),
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
 * We deliberately do NOT import @excalidraw/element types here — that would
 * pull the entire Excalidraw type graph into a package the CLI also consumes.
 * Instead we declare the cross-cut properties the writer touches (`id`,
 * `type`, `version`) and leave room for the rest as `unknown` index entries.
 *
 * Excalidraw's `OrderedExcalidrawElement` is a structural subtype of this:
 * the assignment `scene: excalidrawAPI.getSceneElements()` typechecks without
 * a cast. Going the other direction (passing `doc.scene` to `updateScene`)
 * needs a narrowing cast at the boundary — see MapEditor.tsx hydration path.
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
