// SPDX-License-Identifier: MIT
// packages/data/src/migrations.ts
//
// Format migrations. Every reader runs `migrate` on the raw JSON of a stored
// document before it validates the manifest, so a file saved by an older
// build opens in this one.
//
// `MIGRATIONS[v]` is the list of steps that lift a document from version v to
// v + 1. The steps run in order, then the version rises. A later change that
// belongs to the same version bump adds a step to the same list.
//
// A document from a newer build is refused, not guessed at: this build cannot
// know what the newer fields mean, and a save would drop them.

import {
  documentFrame,
  isGeoCustomData,
  migrateElementV1,
  savedCameraTurn,
  type V1Element,
  type WorldFrame,
} from "@atlasdraw/geo";

/** Raw JSON of a stored document: what a migration may read and rewrite. */
export interface StoredDocument {
  readonly manifest: Record<string, unknown>;
  readonly scene: readonly unknown[];
}

export type MigrationStep = (doc: StoredDocument) => StoredDocument;

export const CURRENT_MANIFEST_VERSION = 2;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// v1 → v2
// ---------------------------------------------------------------------------

/**
 * Version 1 kept one manifest entry per drawn element: its label, whether
 * the label was the user's, and whether it was hidden. Hiding wrote opacity 0
 * on the element and kept the real opacity in `customData.atlasOriginalOpacity`.
 *
 * Version 2 keeps these facts on the element only, in `customData.atlas`:
 * `label` when the user named it, `hidden` when it is hidden. A generated
 * label is not stored. The manifest keeps data and raster layers only.
 */
const liftAnnotationEntries: MigrationStep = ({ manifest, scene }) => {
  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const entries = new Map<string, Record<string, unknown>>();
  for (const layer of layers) {
    if (isRecord(layer) && layer.kind === "annotation") {
      entries.set(String(layer.id), layer);
    }
  }
  return {
    manifest: {
      ...manifest,
      layers: layers.filter((l) => !(isRecord(l) && l.kind === "annotation")),
    },
    scene: scene.map((el) => {
      if (!isRecord(el)) {
        return el;
      }
      const entry = entries.get(String(el.id));
      const customData = isRecord(el.customData) ? el.customData : {};
      const stash = customData.atlasOriginalOpacity;
      if (!entry && stash === undefined) {
        return el;
      }
      const { atlasOriginalOpacity: _stash, ...rest } = customData;
      const atlas: Record<string, unknown> = isRecord(rest.atlas)
        ? { ...rest.atlas }
        : {};
      if (entry?.renamedByUser === true && typeof entry.label === "string") {
        atlas.label = entry.label;
      }
      if (entry?.visible === false) {
        atlas.hidden = true;
      }
      return {
        ...el,
        ...(typeof stash === "number" ? { opacity: stash } : {}),
        customData: { ...rest, atlas },
      };
    }),
  };
};

/**
 * Where a v1 document's frame starts: the first anchored element, or the saved
 * camera's centre when nothing is anchored. Any point works; one near the
 * drawing keeps scene numbers small.
 */
function v1Origin(
  scene: readonly unknown[],
  manifest: Record<string, unknown>,
): { lng: number; lat: number } {
  for (const el of scene) {
    const cd = isRecord(el) ? el.customData : undefined;
    if (!isGeoCustomData(cd)) {
      continue;
    }
    const geo = cd.geo;
    if (geo.kind === "point") {
      return { lng: geo.lng, lat: geo.lat };
    }
    if (geo.kind === "bbox") {
      return { lng: geo.west, lat: geo.north };
    }
    if (geo.coordinates.length > 0) {
      const [lng, lat] = geo.coordinates[0];
      return { lng, lat };
    }
  }
  const camera = isRecord(manifest.camera) ? manifest.camera : {};
  const center = Array.isArray(camera.center) ? camera.center : [];
  const lng = typeof center[0] === "number" ? center[0] : 0;
  const lat = typeof center[1] === "number" ? center[1] : 0;
  return { lng, lat };
}

/**
 * Version 1 stored a drawn element in the screen pixels of whoever saved it,
 * plus its place on Earth in `customData.geo` and its sizes in
 * `customData._lastSync`. Version 2 stores it in world coordinates: Web
 * Mercator pixels at the reference zoom, from the origin in `manifest.world`
 * (ADR-0015). Each anchored element is moved there from its anchor; an
 * element without one is kept as it is.
 */
const worldCoordinates: MigrationStep = ({ manifest, scene }) => {
  const { lng, lat } = v1Origin(scene, manifest);
  const world: WorldFrame = documentFrame(lng, lat);
  const turn = savedCameraTurn(scene);
  return {
    manifest: { ...manifest, world },
    scene: scene.map((el) =>
      isRecord(el) && isGeoCustomData(el.customData)
        ? migrateElementV1(el as unknown as V1Element, world, turn)
        : el,
    ),
  };
};

/** `MIGRATIONS[v]`: the steps from version v to v + 1, in order. */
export const MIGRATIONS: Readonly<Record<number, readonly MigrationStep[]>> = {
  1: [liftAnnotationEntries, worldCoordinates],
};

/**
 * Bring a stored document to `CURRENT_MANIFEST_VERSION`. A current document
 * comes back as the same object. Throws `MigrationError` for a newer version,
 * a version with no path, or a manifest with no numeric version.
 */
export function migrate(doc: StoredDocument): StoredDocument {
  let version = doc.manifest.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new MigrationError("manifest has no integer version");
  }
  if (version > CURRENT_MANIFEST_VERSION) {
    throw new MigrationError(
      `document version ${version} is newer than this build reads (${CURRENT_MANIFEST_VERSION})`,
    );
  }
  let out = doc;
  while (version < CURRENT_MANIFEST_VERSION) {
    const steps = MIGRATIONS[version];
    if (!steps) {
      throw new MigrationError(`no migration from version ${version}`);
    }
    for (const step of steps) {
      out = step(out);
    }
    version += 1;
    out = { ...out, manifest: { ...out.manifest, version } };
  }
  return out;
}
