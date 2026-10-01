// SPDX-License-Identifier: AGPL-3.0-only
//
// The document's file form.
//
//   toFile(doc)            the `.atlasdraw` content of a Document and its scene
//   encode(doc)            those contents as bytes; the same document gives
//                          the same bytes
//   decode(bytes)          bytes to file contents, through the format
//                          migrations, or an error
//   fromFile(file)         the Document state a file describes
//   loadDocument(file, api) open a file: a new Document, its drawing handed to
//                          Excalidraw, its camera and basemap restored
//
// The editor, the share view and the embed open files through loadDocument,
// so there is one way to apply a file.

import { ulid } from "ulid";

import { CaptureUpdateAction, syncInvalidIndices } from "@atlasdraw/element";
import { CURRENT_MANIFEST_VERSION, read, write } from "@atlasdraw/data";

import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  FileId,
} from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument, Camera, Manifest } from "@atlasdraw/data";

import {
  DEFAULT_CAMERA,
  DEFAULT_DOCUMENT_TITLE,
  createDocument,
  openDocument,
  type Document,
  type DocumentState,
  type OverlayEntry,
} from "./document";
import { sceneOf } from "./scene";
import { sceneSignature } from "./sceneSignature";
import { useBasemapStore } from "./basemap";
import { useMapInstanceStore } from "./mapInstance";

import type { FeatureCollection } from "geojson";

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/** The camera half of a MapLibre map: what a save reads. */
interface CameraSource {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
}

/** The live camera, or null when no map is mounted. */
function liveCamera(): Camera | null {
  const map = useMapInstanceStore.getState().map as CameraSource | null;
  if (!map) {
    return null;
  }
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

/**
 * A key that changes when the saved content changes: the document's revision
 * (layers, payloads, title), the drawing's signature and the basemap. The
 * camera is not in it: a pan is not an edit, so it must not move updatedAt.
 */
export function contentKey(doc: Document): string {
  return [
    doc.revision,
    sceneSignature(doc.scene.elements()),
    useBasemapStore.getState().activeBasemapId,
  ].join("|");
}

function manifestLayer(entry: OverlayEntry): Manifest["layers"][number] {
  if (entry.kind === "raster") {
    return {
      kind: "raster",
      id: entry.id,
      label: entry.label,
      visible: entry.visible,
      corners: entry.corners,
      opacity: entry.opacity,
      imageKey: entry.imageKey,
      ...(entry.provenance ? { provenance: entry.provenance } : {}),
    };
  }
  return {
    kind: "data",
    id: entry.id,
    label: entry.label,
    visible: entry.visible,
    featureCount: entry.featureCount,
    style: entry.style as Record<string, unknown>,
    source: `data/layer-${entry.id}.geojson`,
    ...(entry.provenance ? { provenance: entry.provenance } : {}),
  };
}

/**
 * The `.atlasdraw` content of a document. `now` is the save time; it becomes
 * updatedAt only when the content changed since the last save or load.
 *
 * The file bag holds each raster's PNG under its imageKey, and the scene
 * files that a live element uses. Excalidraw keeps every file it was ever
 * given; a pasted image whose element was deleted is not written.
 */
export function toFile(
  doc: Document,
  now: string = new Date().toISOString(),
): AtlasdrawDocument {
  const state = doc.snapshot();
  const elements = doc.scene.elements();
  const updatedAt = doc.stamp(contentKey(doc), now);

  const layers = new Map<string, FeatureCollection>();
  const files = new Map<string, Blob>();
  for (const entry of state.overlays) {
    if (entry.kind === "data") {
      const fc = state.featureCollections[entry.id];
      if (fc) {
        layers.set(entry.id, fc);
      }
    } else {
      const image = state.images[entry.id];
      if (image) {
        files.set(entry.imageKey, image);
      }
    }
  }

  const used = new Set<string>();
  for (const el of elements) {
    const fileId = (el as { fileId?: string | null }).fileId;
    if (fileId && !el.isDeleted) {
      used.add(fileId);
    }
  }
  for (const [id, file] of Object.entries(doc.scene.files())) {
    if (!used.has(id) || files.has(id)) {
      continue;
    }
    const blob =
      file &&
      typeof file.dataURL === "string" &&
      typeof file.mimeType === "string"
        ? dataUrlToBlob(file.dataURL, file.mimeType)
        : null;
    if (blob) {
      files.set(id, blob);
    }
  }

  return {
    manifest: {
      id: doc.id,
      version: CURRENT_MANIFEST_VERSION,
      title: state.title,
      createdAt: state.createdAt,
      updatedAt,
      basemap: {
        type: "registry",
        id: useBasemapStore.getState().activeBasemapId,
      },
      camera: liveCamera() ?? state.camera,
      layers: state.overlays.map(manifestLayer),
      permissions: { publicView: false },
    },
    scene: elements,
    layers,
    styleRef: {},
    files,
  };
}

/**
 * The document as `.atlasdraw` bytes. Every zip entry is stamped with
 * updatedAt, so the same content gives the same bytes.
 */
export function encode(doc: Document): Promise<Blob> {
  return write(toFile(doc));
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export type DecodeResult =
  | { ok: true; file: AtlasdrawDocument }
  | { ok: false; error: Error };

/** Bytes to file contents, through the format migrations. Never throws. */
export async function decode(bytes: Blob): Promise<DecodeResult> {
  try {
    return { ok: true, file: await read(bytes) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * The Document state a file describes. A layer whose payload is missing (a
 * data layer with no GeoJSON, a raster with no image) is left out: a row in
 * the panel that can never draw is worse than no row.
 */
export function fromFile(file: AtlasdrawDocument): Partial<DocumentState> {
  const overlays: OverlayEntry[] = [];
  const featureCollections: Record<string, FeatureCollection> = {};
  const images: Record<string, Blob> = {};
  for (const entry of file.manifest.layers) {
    if (entry.kind === "raster") {
      const image = file.files.get(entry.imageKey);
      if (!image) {
        // eslint-disable-next-line no-console
        console.warn(
          "[atlasdraw] raster layer has no image, skipped",
          entry.id,
        );
        continue;
      }
      images[entry.id] = image;
      overlays.push({
        kind: "raster",
        id: entry.id,
        label: entry.label,
        visible: entry.visible,
        order: 0,
        corners: entry.corners,
        opacity: entry.opacity,
        imageKey: entry.imageKey,
        ...(entry.provenance ? { provenance: entry.provenance } : {}),
      });
      continue;
    }
    const fc = file.layers.get(entry.id);
    if (!fc) {
      // eslint-disable-next-line no-console
      console.warn("[atlasdraw] data layer has no GeoJSON, skipped", entry.id);
      continue;
    }
    featureCollections[entry.id] = fc;
    overlays.push({
      kind: "data",
      id: entry.id,
      label: entry.label,
      visible: entry.visible,
      order: 0,
      featureCount: fc.features.length,
      style: entry.style,
      ...(entry.provenance ? { provenance: entry.provenance } : {}),
    });
  }
  return {
    id: file.manifest.id,
    createdAt: file.manifest.createdAt,
    updatedAt: file.manifest.updatedAt,
    title: file.manifest.title,
    camera: file.manifest.camera,
    overlays,
    featureCollections,
    images,
  };
}

/**
 * Move the map to a saved camera. Returns false when no map is mounted yet;
 * the caller that owns the editor's lifetime then applies it when the map
 * arrives (see usePersistenceWiring).
 */
export function restoreCamera(camera: Camera): boolean {
  const map = useMapInstanceStore.getState().map;
  if (!map) {
    return false;
  }
  map.jumpTo({
    center: camera.center,
    zoom: camera.zoom,
    bearing: camera.bearing,
    pitch: camera.pitch,
  });
  return true;
}

async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Open a file in an editor. A new Document replaces the open one (its
 * layers, payloads and raster URLs go with it), the basemap and camera are
 * restored, and Excalidraw gets the drawing and its files.
 *
 * The drawing goes in as one update that undo does not record, and the undo
 * history is cleared: an undo after opening a file must not take the file
 * back, nor reach into the previous document. Raster PNGs are not given to
 * Excalidraw; they are the document's, not the drawing's.
 *
 * The new Document settles on the loaded content, so a save with no edit
 * keeps the file's updatedAt.
 */
export async function loadDocument(
  file: AtlasdrawDocument,
  api: ExcalidrawImperativeAPI,
): Promise<Document> {
  // The document is bound to the Excalidraw it is opened into.
  const doc = createDocument(fromFile(file), sceneOf(api));
  const rasterKeys = new Set(
    file.manifest.layers.flatMap((l) =>
      l.kind === "raster" ? [l.imageKey] : [],
    ),
  );
  const sceneFiles: BinaryFileData[] = await Promise.all(
    Array.from(file.files.entries())
      .filter(([key]) => !rasterKeys.has(key))
      .map(async ([id, blob]) => ({
        id: id as FileId,
        mimeType: (blob.type ||
          "application/octet-stream") as BinaryFileData["mimeType"],
        dataURL: (await blobToDataURL(blob)) as DataURL,
        created: Date.now(),
        lastRetrieved: Date.now(),
      })),
  );

  openDocument(doc);
  useBasemapStore.getState().setActiveBasemapId(file.manifest.basemap.id);
  restoreCamera(file.manifest.camera);

  // syncInvalidIndices repairs missing fractional indices in older files; it
  // is a no-op when they are valid.
  api.updateScene({
    elements: syncInvalidIndices(
      file.scene as unknown as Parameters<typeof syncInvalidIndices>[0],
    ) as unknown as Parameters<typeof api.updateScene>[0]["elements"],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  api.history?.clear();
  if (sceneFiles.length > 0) {
    api.addFiles(sceneFiles);
  }

  doc.settle(contentKey(doc));
  return doc;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * A bare `.excalidraw` file as a new document: the drawing comes in, with no
 * map layers, the current basemap and the default camera. Import only: the
 * caller must not keep a writable handle to the source file, or a later save
 * would write zip bytes over it.
 *
 * Throws on malformed input; the caller reports it like any open failure.
 */
export function documentFromExcalidrawJson(text: string): AtlasdrawDocument {
  const parsed: unknown = JSON.parse(text);
  const obj = parsed as {
    type?: unknown;
    elements?: unknown;
    files?: Record<string, { dataURL?: string; mimeType?: string }>;
  };
  if (obj?.type !== "excalidraw" || !Array.isArray(obj.elements)) {
    throw new Error("not a valid .excalidraw file (missing type/elements)");
  }

  const files: Map<string, Blob> = new Map();
  if (obj.files && typeof obj.files === "object") {
    for (const [id, file] of Object.entries(obj.files)) {
      if (
        !file ||
        typeof file.dataURL !== "string" ||
        typeof file.mimeType !== "string"
      ) {
        continue;
      }
      const blob = dataUrlToBlob(file.dataURL, file.mimeType);
      if (blob) {
        files.set(id, blob);
      }
    }
  }

  const now = new Date().toISOString();
  return {
    manifest: {
      id: ulid(),
      version: CURRENT_MANIFEST_VERSION,
      // A .excalidraw file carries no title.
      title: DEFAULT_DOCUMENT_TITLE,
      createdAt: now,
      updatedAt: now,
      basemap: {
        type: "registry",
        id: useBasemapStore.getState().activeBasemapId,
      },
      camera: DEFAULT_CAMERA,
      layers: [],
      permissions: { publicView: false },
    },
    scene: obj.elements as AtlasdrawDocument["scene"],
    layers: new Map(),
    styleRef: {},
    files,
  };
}

/**
 * A `data:` URL as a Blob, or null for malformed input: one bad image must
 * not stop a save.
 */
function dataUrlToBlob(dataURL: string, mimeType: string): Blob | null {
  if (!dataURL.startsWith("data:")) {
    return null;
  }
  const commaIdx = dataURL.indexOf(",");
  if (commaIdx < 0) {
    return null;
  }
  const meta = dataURL.slice(5, commaIdx);
  const payload = dataURL.slice(commaIdx + 1);
  try {
    if (meta.includes(";base64")) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
}
