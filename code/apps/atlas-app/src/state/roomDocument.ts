// SPDX-License-Identifier: AGPL-3.0-only
//
// The document in a room: everything a Document holds besides the drawing,
// in the room doc.
//
//   meta      id (the room's document id, a ULID minted when the room is
//             made, so a saved copy is a valid file and never takes the id
//             of anyone's own map), title, world (the frame, fixed when the
//             room is made), camera (where a joiner first looks), basemap
//   overlays  layer entry by id, as the Document holds it
//   features  data layer id → its FeatureCollection, replaced whole
//   images    raster layer id → its PNG bytes and type
//
// Records are plain values, replaced whole, so the last writer of an entry
// wins. A Document finds a changed entry by identity, and a Y.Map gives back
// the same object until the entry changes, so a room keeps that promise.
//
// A raster entry goes into the room only together with its image: a
// collaborator never sees a raster row with nothing to draw.
//
// Any client can write any value into the room doc, so every entry read from
// it goes through roomValidation.ts. An entry that fails is left out of the
// Document (a data layer without valid features, a raster without a valid
// image, too), and this client never deletes it from the room: a newer
// client may have written a kind this one does not know.

import { ulid } from "ulid";
import * as Y from "yjs";
import { documentFrame, type WorldFrame } from "@atlasdraw/geo";

import { ROOM_SIZE, sizeText, type RoomSize } from "@atlasdraw/protocol";

import type { Camera } from "@atlasdraw/data";

import { seedComments } from "./comments";
import {
  DEFAULT_CAMERA,
  DEFAULT_DOCUMENT_TITLE,
  createDocument,
  type Document,
  type OverlayEntry,
} from "./document";
import {
  ELEMENTS_KEY,
  FILES_KEY,
  elementRecord,
  fileRecord,
  type RoomEditor,
} from "./roomScene";

import {
  checkBasemap,
  checkCamera,
  checkDocumentId,
  checkFeatures,
  checkImage,
  checkOverlay,
  checkTitle,
  checkWorld,
  rejectFrom,
  writerOfKey,
  type RoomImage,
} from "./roomValidation";

import type { SceneAccess } from "./scene";
import type { FeatureCollection } from "geojson";

export const META_KEY = "meta";
export const OVERLAYS_KEY = "overlays";
export const FEATURES_KEY = "features";
export const IMAGES_KEY = "images";

function maps(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>(META_KEY),
    overlays: doc.getMap<unknown>(OVERLAYS_KEY),
    features: doc.getMap<unknown>(FEATURES_KEY),
    images: doc.getMap<unknown>(IMAGES_KEY),
  };
}

/** True once a room has been made: its world frame is written. */
export function roomIsMade(doc: Y.Doc): boolean {
  return maps(doc).meta.get("world") !== undefined;
}

/** A Blob per image record, the same Blob for as long as the record stays. */
const blobs = new WeakMap<RoomImage, Blob>();
function blobOf(image: RoomImage): Blob {
  let blob = blobs.get(image);
  if (!blob) {
    blob = new Blob([image.bytes as Uint8Array<ArrayBuffer>], {
      type: image.mimeType,
    });
    blobs.set(image, blob);
  }
  return blob;
}

/**
 * The valid content of the room, as Document data, and the ids of the
 * layer entries left out of it: entries that fail their check, and valid
 * entries whose payload (features, image) this client cannot read.
 */
function readContent(doc: Y.Doc, fallbackTitle = DEFAULT_DOCUMENT_TITLE) {
  const m = maps(doc);
  const reject = (map: Y.Map<unknown>, key: string, what: string): null => {
    rejectFrom(doc, writerOfKey(map, key), what);
    return null;
  };
  const featureCollections: Record<string, FeatureCollection> = {};
  for (const id of m.features.keys()) {
    const fc =
      checkFeatures(id, m.features.get(id)) ??
      reject(m.features, id, "data layer");
    if (fc) {
      featureCollections[id] = fc;
    }
  }
  const overlays: OverlayEntry[] = [];
  const images: Record<string, Blob> = {};
  const skipped = new Set<string>();
  for (const key of m.overlays.keys()) {
    skipped.add(key);
    const entry =
      checkOverlay(key, m.overlays.get(key)) ??
      reject(m.overlays, key, "layer");
    if (!entry) {
      continue;
    }
    if (entry.kind === "raster") {
      // A raster's image may still be on its way from an honest writer
      // (toRoom below), so a missing one is no reason to warn.
      const raw = m.images.get(entry.id);
      const image =
        raw === undefined
          ? null
          : checkImage(entry.id, raw) ??
            reject(m.images, entry.id, "raster image");
      if (!image) {
        continue;
      }
      images[entry.id] = blobOf(image);
    }
    if (entry.kind === "data" && !featureCollections[entry.id]) {
      continue;
    }
    overlays.push(entry);
    skipped.delete(key);
  }
  const rawTitle = m.meta.get("title");
  const title =
    rawTitle === undefined
      ? DEFAULT_DOCUMENT_TITLE
      : checkTitle(rawTitle) ?? reject(m.meta, "title", "title");
  return {
    content: {
      title: title ?? fallbackTitle,
      overlays,
      featureCollections,
      images,
    },
    skipped,
  };
}

/** The room's basemap, or null when it has none or a malformed one. */
function readBasemap(doc: Y.Doc): string | null {
  const meta = maps(doc).meta;
  const raw = meta.get("basemap");
  if (raw === undefined) {
    return null;
  }
  const basemap = checkBasemap(raw);
  if (!basemap) {
    rejectFrom(doc, writerOfKey(meta, "basemap"), "basemap");
  }
  return basemap;
}

async function imageRecord(blob: Blob): Promise<RoomImage> {
  return {
    mimeType: blob.type || "image/png",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

// ---------------------------------------------------------------------------
// Seed: a room made from the user's map
// ---------------------------------------------------------------------------

/** One write of a seed, and the bytes it adds to a room doc. */
interface SeedWrite {
  readonly bytes: number;
  write(doc: Y.Doc): void;
}

/**
 * A map planned as a room: writes packed into transactions, each one
 * message on the wire within the relay's message cap. Or the reason the map
 * cannot be a room, with its size and the cap.
 */
export type SeedPlan =
  | {
      readonly ok: true;
      /** The whole seed, in bytes of room state. */
      readonly bytes: number;
      readonly batches: ReadonlyArray<readonly SeedWrite[]>;
    }
  | { readonly ok: false; readonly reason: string };

/** A seed that fits. */
export type Seed = Extract<SeedPlan, { ok: true }>;

/** `write` and what it adds, measured in a doc of its own. */
function measured(write: (doc: Y.Doc) => void): SeedWrite {
  const scratch = new Y.Doc();
  scratch.transact(() => write(scratch));
  const bytes = Y.encodeStateAsUpdate(scratch).byteLength;
  scratch.destroy();
  return { bytes, write };
}

function tooLarge(what: string, bytes: number, cap: number): SeedPlan {
  return {
    ok: false,
    reason: `${what} is ${sizeText(
      bytes,
    )}; a shared map takes at most ${sizeText(cap)}.`,
  };
}

/**
 * Plan a room made from `seed`: its frame, title, camera and basemap first,
 * so a joiner never meets a room without a frame; then each layer with its
 * payload, the comments and the drawing. A record over its cap in `size`,
 * or a map over the room cap, gives the reason instead. Nothing connects
 * here: the caller refuses before joining.
 */
export async function planSeed(
  seed: Document,
  camera: Camera | null,
  size: RoomSize = ROOM_SIZE,
): Promise<SeedPlan> {
  const state = seed.snapshot();
  const writes: SeedWrite[] = [];
  const id = ulid();
  writes.push(
    measured((doc) => {
      const { meta } = maps(doc);
      meta.set("id", id);
      meta.set("title", state.title);
      meta.set("world", state.world);
      meta.set("camera", camera ?? state.camera);
      meta.set("basemap", state.basemap);
    }),
  );

  for (const entry of state.overlays) {
    const name = `The layer "${entry.label}"`;
    if (entry.kind === "raster") {
      const blob = state.images[entry.id];
      if (!blob) {
        // A raster entry goes into the room only with its image.
        continue;
      }
      const image = await imageRecord(blob);
      if (image.bytes.byteLength > size.rasterBytes) {
        return tooLarge(name, image.bytes.byteLength, size.rasterBytes);
      }
      writes.push(
        measured((doc) => {
          maps(doc).images.set(entry.id, image);
          maps(doc).overlays.set(entry.id, entry);
        }),
      );
      continue;
    }
    const fc =
      entry.kind === "data" ? state.featureCollections[entry.id] : null;
    // A data layer's entry travels with its features: a peer that read the
    // entry alone would skip it.
    const layer = measured((doc) => {
      if (fc) {
        maps(doc).features.set(entry.id, fc);
      }
      maps(doc).overlays.set(entry.id, entry);
    });
    if (fc && layer.bytes > size.featureBytes) {
      return tooLarge(name, layer.bytes, size.featureBytes);
    }
    writes.push(layer);
  }
  const entries = new Set(state.overlays.map((e) => e.id));
  for (const [layerId, fc] of Object.entries(state.featureCollections)) {
    if (!entries.has(layerId)) {
      writes.push(measured((doc) => maps(doc).features.set(layerId, fc)));
    }
  }

  for (const comment of seed.comments.comments) {
    writes.push(measured((doc) => seedComments(doc, [comment])));
  }

  const drawing = sceneEditor(seed.scene);
  const used = new Set<string>();
  for (const el of drawing.elements()) {
    const record = elementRecord(el);
    writes.push(
      measured((doc) => doc.getMap(ELEMENTS_KEY).set(record.id, record)),
    );
    const fileId = (el as { fileId?: string | null }).fileId;
    if (fileId && !el.isDeleted) {
      used.add(fileId);
    }
  }
  const files = drawing.files();
  for (const fileId of used) {
    const file = files[fileId];
    if (!file) {
      continue;
    }
    const record = fileRecord(file);
    if (record.dataURL.length > size.imageDataUrlChars) {
      return tooLarge(
        "An image in the drawing",
        record.dataURL.length,
        size.imageDataUrlChars,
      );
    }
    writes.push(measured((doc) => doc.getMap(FILES_KEY).set(fileId, record)));
  }

  // Pack the writes in order, each transaction one message under the cap.
  const room = writes.reduce((n, w) => n + w.bytes, 0);
  if (room > size.roomBytes) {
    return tooLarge("This map", room, size.roomBytes);
  }
  const budget = size.messageBytes - size.frameBytes;
  const batches: SeedWrite[][] = [];
  let batch: SeedWrite[] = [];
  let bytes = 0;
  for (const w of writes) {
    if (w.bytes > budget) {
      return tooLarge("One part of this map", w.bytes, budget);
    }
    if (bytes + w.bytes > budget) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(w);
    bytes += w.bytes;
  }
  batches.push(batch);
  return { ok: true, bytes: room, batches };
}

/** Write a planned seed into `doc`: one transaction, one message, per batch. */
export function writeSeed(doc: Y.Doc, seed: Seed, origin: unknown): void {
  for (const batch of seed.batches) {
    doc.transact(() => {
      for (const w of batch) {
        w.write(doc);
      }
    }, origin);
  }
}

/** Plan and write a seed; throws the reason when the map cannot be a room. */
export async function seedRoom(
  doc: Y.Doc,
  seed: Document,
  origin: unknown,
  camera: Camera | null = null,
): Promise<void> {
  const plan = await planSeed(seed, camera);
  if (!plan.ok) {
    throw new Error(plan.reason);
  }
  writeSeed(doc, plan, origin);
}

/** The drawing of a SceneAccess, as the scene writer reads an editor. */
function sceneEditor(
  scene: SceneAccess,
): Pick<RoomEditor, "elements" | "files"> {
  return {
    elements: scene.elements,
    files: () => {
      const out: ReturnType<RoomEditor["files"]> = {};
      for (const [id, f] of Object.entries(scene.files())) {
        if (f?.dataURL && f.mimeType) {
          out[id] = {
            id,
            dataURL: f.dataURL,
            mimeType: f.mimeType,
            created: Date.now(),
          } as ReturnType<RoomEditor["files"]>[string];
        }
      }
      return out;
    },
  };
}

/** Make an empty room: a frame at the default camera and no content. */
export function makeEmptyRoom(doc: Y.Doc, origin: unknown): void {
  const m = maps(doc);
  doc.transact(() => {
    m.meta.set("id", ulid());
    m.meta.set(
      "world",
      documentFrame(DEFAULT_CAMERA.center[0], DEFAULT_CAMERA.center[1]),
    );
    m.meta.set("camera", DEFAULT_CAMERA);
  }, origin);
}

/**
 * The room's Document, bound to the room doc: a change made through the
 * Document is written with `origin`, and a change from any other origin is
 * applied to it. The basemap follows the room the same way. The comments
 * are the room doc's own.
 */
export function bindRoomDocument(
  doc: Y.Doc,
  scene: SceneAccess,
  origin: unknown,
): { document: Document; unbind: () => void } {
  const m = maps(doc);
  const read = readContent(doc);
  const content = read.content;
  /**
   * Layer entries in the room that this client left out of its Document.
   * toRoom never deletes one: a newer client may have written a kind or a
   * geometry this one does not know, and its user did not remove it.
   */
  let skipped = read.skipped;
  const camera: Camera = checkCamera(m.meta.get("camera")) ?? DEFAULT_CAMERA;
  let world = checkWorld(m.meta.get("world")) as WorldFrame | null;
  if (!world) {
    // Every element is measured in the frame. Without a valid one the
    // drawing cannot be placed; the default keeps the editor working.
    rejectFrom(doc, writerOfKey(m.meta, "world"), "world frame");
    world = documentFrame(DEFAULT_CAMERA.center[0], DEFAULT_CAMERA.center[1]);
  }
  const document = createDocument(
    {
      id: checkDocumentId(m.meta.get("id")) ?? undefined,
      ...content,
      basemap: readBasemap(doc) ?? undefined,
      world,
      camera,
    },
    scene,
    doc,
  );
  // Raster images the room holds, so a raster is not written back.
  const known = new WeakSet<Blob>(Object.values(content.images));

  // A remote transaction runs observers before `afterTransaction`. The
  // comments' observer changes the Document, and toRoom then runs while the
  // Document does not hold the transaction's layers yet: it would delete a
  // peer's new layer. So toRoom waits while a remote transaction is open.
  let remote: Y.Transaction | null = null;
  const beforeTransaction = (tr: Y.Transaction): void => {
    if (tr.origin !== origin) {
      remote = tr;
    }
  };
  doc.on("beforeTransaction", beforeTransaction);

  const watched = new Set<unknown>([m.meta, m.overlays, m.features, m.images]);
  const fromRoom = (tr: Y.Transaction): void => {
    if (tr.origin === origin) {
      return;
    }
    try {
      if (Array.from(tr.changed.keys()).some((type) => watched.has(type))) {
        const next = readContent(doc, document.snapshot().title);
        skipped = next.skipped;
        for (const blob of Object.values(next.content.images)) {
          known.add(blob);
        }
        document.dispatch({ type: "replace-content", ...next.content });
        const basemap = readBasemap(doc);
        if (basemap) {
          document.dispatch({ type: "set-basemap", id: basemap });
        }
      }
    } finally {
      remote = null;
    }
  };
  doc.on("afterTransaction", fromRoom);

  const toRoom = (): void => {
    if (remote) {
      return;
    }
    const state = document.snapshot();
    const ids = new Set(state.overlays.map((e) => e.id));
    const rasters: Array<{ entry: OverlayEntry; blob: Blob }> = [];
    doc.transact(() => {
      if (m.meta.get("title") !== state.title) {
        m.meta.set("title", state.title);
      }
      if (m.meta.get("basemap") !== state.basemap) {
        m.meta.set("basemap", state.basemap);
      }
      for (const entry of state.overlays) {
        if (m.overlays.get(entry.id) === entry) {
          continue;
        }
        const blob = entry.kind === "raster" ? state.images[entry.id] : null;
        if (blob && !known.has(blob)) {
          rasters.push({ entry, blob });
          continue;
        }
        m.overlays.set(entry.id, entry);
      }
      // Only an entry this client showed can have been removed by its
      // user; an entry it skipped stays for the clients that can read it.
      for (const key of Array.from(m.overlays.keys())) {
        if (!ids.has(key) && !skipped.has(key)) {
          m.overlays.delete(key);
          m.images.delete(key);
        }
      }
      for (const [layerId, fc] of Object.entries(state.featureCollections)) {
        if (m.features.get(layerId) !== fc) {
          m.features.set(layerId, fc);
        }
      }
      for (const key of Array.from(m.features.keys())) {
        if (
          !(key in state.featureCollections) &&
          checkFeatures(key, m.features.get(key))
        ) {
          m.features.delete(key);
        }
      }
    }, origin);
    for (const { entry, blob } of rasters) {
      known.add(blob);
      void imageRecord(blob).then((image) => {
        // The layer may have gone while its bytes were read.
        if (!document.snapshot().overlays.some((e) => e.id === entry.id)) {
          return;
        }
        doc.transact(() => {
          m.images.set(entry.id, image);
          m.overlays.set(entry.id, entry);
        }, origin);
      });
    }
  };
  const unsubscribeDocument = document.subscribe(toRoom);

  return {
    document,
    unbind: () => {
      doc.off("beforeTransaction", beforeTransaction);
      doc.off("afterTransaction", fromRoom);
      unsubscribeDocument();
      document.comments.destroy();
    },
  };
}
