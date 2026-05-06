// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task T9 — AtlasdrawDocument selector.
//
// Pure synthesis function: assembles an `AtlasdrawDocument` from the live
// runtime sources (Excalidraw imperative API + LayerRegistry Zustand state).
// Called every auto-save tick by `startAutoSave(store, () => selectDocument(...))`.
//
// Open question for Phase 4 — data-layer FeatureCollection storage:
//   The LayerRegistry only persists metadata + featureCount; it does NOT keep
//   the underlying GeoJSON FeatureCollection in memory beyond the MapLibre
//   source. To round-trip a .atlasdraw zip we need the FCs. For Phase 3 we
//   ship `layers: new Map()` and document the gap. Phase 4 introduces a
//   FeatureCollection registry (likely keyed by `dl:` id) keyed off the same
//   layer registry so this selector can populate `layers` non-destructively.

import { ulid } from "ulid";

import type {
  AtlasdrawDocument,
  Manifest,
} from "@atlasdraw/data";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { FeatureCollection } from "geojson";

import type { LayerRegistryState } from "./layerRegistry";

export type SelectDocumentOptions = {
  /**
   * Manifest carried over from a previously-loaded document. When present we
   * preserve `id` + `createdAt` and only refresh `updatedAt` + the layer list.
   * When absent we mint a new ULID and stamp createdAt = updatedAt = now.
   */
  baseManifest?: Manifest | null;
  /** Override `new Date().toISOString()` for deterministic tests. */
  now?: () => string;
};

const DEFAULT_TITLE = "Untitled atlasdraw";
const DEFAULT_BASEMAP_ID = "default";
const DEFAULT_CAMERA = {
  center: [0, 0] as [number, number],
  zoom: 4,
  bearing: 0,
  pitch: 0,
};

/**
 * Synthesize a runtime AtlasdrawDocument snapshot.
 *
 * Contract:
 *   - `manifest` — re-uses baseManifest.id/createdAt if provided; otherwise mints.
 *   - `scene`   — Excalidraw scene elements (camera state lives in appState
 *                 separately and is round-tripped through Excalidraw's own
 *                 .excalidraw save path; we don't duplicate it into the manifest).
 *   - `layers`  — empty Map for v1 (see file-header note).
 *   - `styleRef`— empty record placeholder; basemap style snapshot is Phase 4.
 *   - `files`   — Excalidraw embedded BinaryFiles (images, etc.) coerced to Blob
 *                 entries via dataURL → Blob conversion.
 */
export function selectDocument(
  excalidrawAPI: ExcalidrawImperativeAPI,
  layerRegistryState: LayerRegistryState,
  options: SelectDocumentOptions = {},
): AtlasdrawDocument {
  const now = (options.now ?? (() => new Date().toISOString()))();

  const elements = excalidrawAPI.getSceneElements();

  const manifestLayers = layerRegistryState.entries.map((entry) => {
    if (entry.kind === "annotation") {
      return {
        kind: "annotation" as const,
        id: entry.id,
        label: entry.label,
        visible: entry.visible,
      };
    }
    return {
      kind: "data" as const,
      id: entry.id,
      label: entry.label,
      visible: entry.visible,
      featureCount: entry.featureCount,
      style: entry.style as Record<string, unknown>,
      // Convention from manifest-schema: `data/layer-<id>.geojson` — the zip
      // writer in @atlasdraw/data follows the same template.
      source: `data/layer-${entry.id}.geojson`,
    };
  });

  const manifest: Manifest =
    options.baseManifest != null
      ? {
          ...options.baseManifest,
          updatedAt: now,
          layers: manifestLayers,
        }
      : {
          id: ulid(),
          version: 1,
          title: DEFAULT_TITLE,
          createdAt: now,
          updatedAt: now,
          basemap: { type: "registry", id: DEFAULT_BASEMAP_ID },
          camera: { ...DEFAULT_CAMERA },
          layers: manifestLayers,
          permissions: { publicView: false },
        };

  // Phase 4: replace empty Map with real FCs once the registry tracks them.
  const layers: Map<string, FeatureCollection> = new Map();

  // Excalidraw's embedded files (images). API surface returns BinaryFiles
  // (id → { mimeType, dataURL, ... }); we convert dataURLs to Blobs so the
  // .atlasdraw zip writer can stream them straight in. The BinaryFiles type
  // is loosely typed at this boundary (Phase 0 schema deferred coupling), so
  // we narrow with a runtime shape check before reading.
  const files: Map<string, Blob> = new Map();
  const binaryFiles = excalidrawAPI.getFiles?.() as
    | Record<string, { dataURL?: string; mimeType?: string }>
    | undefined;
  if (binaryFiles) {
    for (const [id, file] of Object.entries(binaryFiles)) {
      if (
        !file ||
        typeof file.dataURL !== "string" ||
        typeof file.mimeType !== "string"
      ) {
        continue;
      }
      const blob = dataUrlToBlob(file.dataURL, file.mimeType);
      if (blob) files.set(id, blob);
    }
  }

  return {
    manifest,
    scene: elements,
    layers,
    styleRef: {},
    files,
  };
}

/**
 * Convert a `data:` URL into a Blob. Returns null on malformed input rather
 * than throwing — file embedding is best-effort in v1; a missing thumbnail
 * shouldn't kill the auto-save.
 */
function dataUrlToBlob(dataURL: string, mimeType: string): Blob | null {
  if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) return null;
  const commaIdx = dataURL.indexOf(",");
  if (commaIdx < 0) return null;
  const meta = dataURL.slice(5, commaIdx); // strip leading "data:"
  const payload = dataURL.slice(commaIdx + 1);
  const isBase64 = meta.includes(";base64");
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
}
