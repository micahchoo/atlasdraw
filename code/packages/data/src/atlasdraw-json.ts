// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw-json.ts
// Phase 3 Wave 1 Task 4 — pure-JSON variant of `.atlasdraw`.
//
// Used for tiny share-via-URL maps that have no binary attachments. The zip
// variant (`atlasdraw.ts`) is the canonical container; this JSON form trades
// binary capability for embeddability (URL hash, single-string transport).

import {
  ManifestSchema,
  type AtlasdrawDocument,
  type SceneElement,
} from "./manifest-schema.js";

import type { FeatureCollection } from "geojson";

export type AtlasdrawJSONErrorCode =
  | "HAS_BINARY_ATTACHMENTS"
  | "INVALID_JSON"
  | "INVALID_MANIFEST"
  | "INVALID_STRUCTURE";

export class AtlasdrawJSONError extends Error {
  public readonly code: AtlasdrawJSONErrorCode;

  constructor(code: AtlasdrawJSONErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AtlasdrawJSONError";
  }
}

const JSON_MIME = "application/atlasdraw+json";

/**
 * Serialize an `AtlasdrawDocument` to a single JSON Blob.
 *
 * Throws `AtlasdrawJSONError("HAS_BINARY_ATTACHMENTS", ...)` if `doc.files`
 * is non-empty — the JSON variant has no carrier for Blobs. Callers that
 * need binary attachments must use the zip variant (`writeAtlasdraw`).
 */
export async function writeJSON(doc: AtlasdrawDocument): Promise<Blob> {
  if (doc.files.size > 0) {
    throw new AtlasdrawJSONError(
      "HAS_BINARY_ATTACHMENTS",
      `atlasdraw-json cannot carry binary attachments (files.size=${doc.files.size}); use writeAtlasdraw (zip) instead`,
    );
  }

  const payload = {
    manifest: doc.manifest,
    scene: doc.scene,
    layers: Object.fromEntries(doc.layers),
    styleRef: doc.styleRef ?? null,
  };

  return new Blob([JSON.stringify(payload)], { type: JSON_MIME });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse an `application/atlasdraw+json` Blob back into an `AtlasdrawDocument`.
 * `files` is always returned as an empty Map — JSON cannot carry binaries.
 */
export async function readJSON(blob: Blob): Promise<AtlasdrawDocument> {
  const text = await blob.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new AtlasdrawJSONError(
      "INVALID_JSON",
      `failed to parse atlasdraw-json: ${(err as Error).message}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new AtlasdrawJSONError(
      "INVALID_STRUCTURE",
      "atlasdraw-json payload must be a JSON object",
    );
  }

  const { manifest, scene, layers, styleRef } = parsed as {
    manifest?: unknown;
    scene?: unknown;
    layers?: unknown;
    styleRef?: unknown;
  };

  if (!isPlainObject(manifest)) {
    throw new AtlasdrawJSONError(
      "INVALID_STRUCTURE",
      "atlasdraw-json: `manifest` must be an object",
    );
  }
  if (!Array.isArray(scene)) {
    throw new AtlasdrawJSONError(
      "INVALID_STRUCTURE",
      "atlasdraw-json: `scene` must be an array",
    );
  }
  if (!isPlainObject(layers)) {
    throw new AtlasdrawJSONError(
      "INVALID_STRUCTURE",
      "atlasdraw-json: `layers` must be an object",
    );
  }

  const manifestParse = ManifestSchema.safeParse(manifest);
  if (!manifestParse.success) {
    throw new AtlasdrawJSONError(
      "INVALID_MANIFEST",
      `atlasdraw-json: manifest failed validation: ${manifestParse.error.message}`,
    );
  }

  const layersMap = new Map<string, FeatureCollection>(
    Object.entries(layers as Record<string, FeatureCollection>),
  );

  return {
    manifest: manifestParse.data,
    scene: scene as ReadonlyArray<SceneElement>,
    layers: layersMap,
    styleRef: styleRef ?? null,
    files: new Map<string, Blob>(),
  };
}
