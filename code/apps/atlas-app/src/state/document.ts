// SPDX-License-Identifier: AGPL-3.0-only
//
// The document: the one owner of what a saved map is, apart from the drawing.
//
// The Excalidraw scene owns the drawing (elements, their files, and what the
// layer panel stores on an element in customData.atlas). This module owns
// the rest, as plain data:
//
//   identity   — id and createdAt, fixed when the document is created or
//                loaded, never minted again; updatedAt (see `stamp`)
//   title      — the sheet name
//   camera     — the camera the document was saved with
//   world      — the world frame: what a scene coordinate means (ADR-0015),
//                fixed when the document is created
//   overlays   — the data, raster and tile layers, in order; each kind is
//                its own z-order stack
//   payloads   — each data layer's FeatureCollection and each raster's PNG
//
// Every change goes through `dispatch`. A command that changes something
// raises `revision` by one and tells subscribers; a command that changes
// nothing does neither. A pan is not a command, so it never raises it.
//
// The reducer keeps every entry it did not change, object for object, and a
// FeatureCollection is replaced, never edited. The map overlays
// (lib/mapOverlays) depend on that: they find a changed payload by identity.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { ulid } from "ulid";

import { geometryKindOf } from "@atlasdraw/data";
import { documentFrame, type WorldFrame } from "@atlasdraw/geo";

import type { LayerStyle } from "@atlasdraw/basemap";

import type { AtlasGeometryKind, Camera } from "@atlasdraw/data";

import { editorScene, type SceneAccess } from "./scene";

import type { FeatureCollection } from "geojson";

export type { LayerStyle };

export const DEFAULT_DOCUMENT_TITLE = "Untitled atlasdraw";

/** Where a document opens when nothing better is known. */
export const DEFAULT_CAMERA: Camera = {
  center: [0, 0],
  zoom: 2,
  bearing: 0,
  pitch: 0,
};

/**
 * Rasters land fully opaque. Fading is a decision the user makes while
 * tracing, not a greeting.
 */
const DEFAULT_RASTER_OPACITY = 1;

// ---------------------------------------------------------------------------
// Layer entries
// ---------------------------------------------------------------------------

/**
 * Where a layer came from, and what the import could not keep.
 *
 * `label` changes with a rename, so it cannot answer "which file was this?";
 * `sourceFile` can. `droppedCount` is the number of input records that did
 * not reach the map: CSV rows with no usable coordinates, and features whose
 * geometry is null. It is a count, not a ratio, because the two kinds of drop
 * sit on opposite sides of `featureCount`.
 */
export type LayerProvenance = {
  /** File name as the user supplied it, before any rename. */
  sourceFile: string;
  /** Input records that did not survive into the FeatureCollection. */
  droppedCount: number;
};

/**
 * A data layer: a GeoJSON FeatureCollection drawn by MapLibre. The id is
 * `dl:<uuid>`, so it never equals an Excalidraw element id. `featureCount`
 * is kept for the panel.
 */
export type DataLayerEntry = {
  kind: "data";
  id: string;
  label: string;
  visible: boolean;
  /** Position within the data-layer stack, 0 at the bottom. */
  order: number;
  featureCount: number;
  /**
   * The kind of geometry the layer draws, decided once when the layer is
   * added. It picks the MapLibre layer type, the paint properties and the
   * legend swatch.
   */
  geometryKind: AtlasGeometryKind;
  style: LayerStyle;
  provenance?: LayerProvenance;
};

/**
 * A raster's four corners in lng/lat, in the order MapLibre's `image` source
 * takes them: top-left, top-right, bottom-right, bottom-left. Corners, not a
 * bbox, because a bbox cannot hold a raster that is not axis-aligned.
 */
export type RasterCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * A raster layer: a georeferenced picture (a scanned sheet, a plate). It has
 * no features and no paint style; `opacity` is its whole style. The decoded
 * PNG is in `images` under the layer id and is saved as `files/<imageKey>`.
 * The original GeoTIFF is not kept. The id is `rl:<uuid>`.
 */
export type RasterLayerEntry = {
  kind: "raster";
  id: string;
  label: string;
  visible: boolean;
  /** Position within the raster stack, 0 at the bottom. */
  order: number;
  corners: RasterCorners;
  /** 0..1. Separate from LayerStyle.opacity, which is a vector paint value. */
  opacity: number;
  /** Name of the PNG in the saved file's `files/` folder. */
  imageKey: string;
  provenance?: LayerProvenance;
};

/**
 * W9d — an XYZ tile layer: map tiles fetched from `url`, a template with
 * {z}, {x} and {y} (lib/tileLayers validates it). It has no payload in the
 * document; the tiles stay on their server. `attribution` is the credit the
 * provider asks for. The id is `tl:<uuid>`.
 */
export type TileLayerEntry = {
  kind: "tile";
  id: string;
  label: string;
  visible: boolean;
  /** Position within the tile stack, 0 at the bottom. */
  order: number;
  /** 0..1. */
  opacity: number;
  url: string;
  attribution?: string;
};

export type OverlayEntry = DataLayerEntry | RasterLayerEntry | TileLayerEntry;

// ---------------------------------------------------------------------------
// State and commands
// ---------------------------------------------------------------------------

export interface DocumentState {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly title: string;
  /**
   * The camera the document was saved with. The live map owns the camera
   * while the editor runs; this value is used only when no map can be read.
   */
  readonly camera: Camera;
  /**
   * The world frame: a scene coordinate is a Web Mercator pixel at zoom
   * `z0`, minus `origin`. Fixed for the life of the document, because every
   * element's x/y is measured in it.
   */
  readonly world: WorldFrame;
  readonly overlays: readonly OverlayEntry[];
  /** Data-layer id → its FeatureCollection. */
  readonly featureCollections: Readonly<Record<string, FeatureCollection>>;
  /** Raster-layer id → its decoded PNG. */
  readonly images: Readonly<Record<string, Blob>>;
}

export type DocumentCommand =
  | { type: "rename-document"; title: string }
  | {
      type: "add-data-layer";
      id: string;
      fc: FeatureCollection;
      label: string;
      style: LayerStyle;
      /** Omitted: taken from the first feature that has a geometry. */
      geometryKind?: AtlasGeometryKind;
      provenance?: LayerProvenance;
    }
  | {
      type: "add-raster-layer";
      id: string;
      label: string;
      corners: RasterCorners;
      imageKey: string;
      image: Blob;
      opacity?: number;
      provenance?: LayerProvenance;
    }
  | {
      type: "add-tile-layer";
      id: string;
      label: string;
      url: string;
      attribution?: string;
      opacity?: number;
    }
  | { type: "rename-layer"; id: string; label: string }
  | { type: "set-visibility"; id: string; visible: boolean }
  /** Move to `order` within the entry's own kind. Out-of-range clamps. */
  | { type: "reorder"; id: string; order: number }
  | { type: "restyle"; id: string; patch: Partial<LayerStyle> }
  /** A raster's or tile layer's opacity, clamped to 0..1. */
  | { type: "set-opacity"; id: string; opacity: number }
  | { type: "remove-layer"; id: string };

export interface Document {
  /** Fixed at creation. */
  readonly id: string;
  /** The drawing this document is saved with. */
  readonly scene: SceneAccess;
  /** Rises by one on every change; 0 for a document just created or loaded. */
  readonly revision: number;
  snapshot(): DocumentState;
  dispatch(command: DocumentCommand): void;
  subscribe(listener: () => void): () => void;
  /**
   * Record the current content key as the saved baseline without moving
   * updatedAt. A load calls this once the loaded content is in place.
   */
  settle(contentKey: string): void;
  /**
   * The updatedAt to write for a save of content with this key. It moves to
   * `now` only when the key differs from the last settled or stamped key,
   * and never to a time before createdAt. It does not raise the revision.
   */
  stamp(contentKey: string, now: string): string;
}

/**
 * Re-number `order` per kind, in array order. An entry whose number does not
 * change is kept, object for object.
 */
function reindex(entries: readonly OverlayEntry[]): OverlayEntry[] {
  const next: Record<OverlayEntry["kind"], number> = {
    data: 0,
    raster: 0,
    tile: 0,
  };
  return entries.map((e) => {
    const order = next[e.kind]++;
    return e.order === order ? e : { ...e, order };
  });
}

function clampOpacity(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Replace one entry by id. Returns null when there is no such entry. */
function updateEntry(
  entries: readonly OverlayEntry[],
  id: string,
  update: (e: OverlayEntry) => OverlayEntry,
): OverlayEntry[] | null {
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) {
    return null;
  }
  const next = update(entries[i]);
  if (next === entries[i]) {
    return null;
  }
  const out = entries.slice();
  out[i] = next;
  return out;
}

function withoutKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/**
 * The next state for a command, or the same state when the command changes
 * nothing. Throws for an id with the wrong prefix: that is a caller's bug.
 */
function reduce(state: DocumentState, command: DocumentCommand): DocumentState {
  switch (command.type) {
    case "rename-document": {
      const title = command.title.trim() || DEFAULT_DOCUMENT_TITLE;
      return title === state.title ? state : { ...state, title };
    }
    case "add-data-layer": {
      if (!command.id.startsWith("dl:")) {
        throw new Error(
          `data layer id must start with dl: prefix (received "${command.id}")`,
        );
      }
      if (state.overlays.some((e) => e.id === command.id)) {
        return state;
      }
      const entry: DataLayerEntry = {
        kind: "data",
        id: command.id,
        label: command.label,
        visible: true,
        order: 0,
        featureCount: command.fc.features.length,
        geometryKind: command.geometryKind ?? geometryKindOf(command.fc),
        style: command.style,
        ...(command.provenance ? { provenance: command.provenance } : {}),
      };
      return {
        ...state,
        overlays: reindex([...state.overlays, entry]),
        featureCollections: {
          ...state.featureCollections,
          [command.id]: command.fc,
        },
      };
    }
    case "add-raster-layer": {
      if (!command.id.startsWith("rl:")) {
        throw new Error(
          `raster layer id must start with rl: prefix (received "${command.id}")`,
        );
      }
      if (state.overlays.some((e) => e.id === command.id)) {
        return state;
      }
      const entry: RasterLayerEntry = {
        kind: "raster",
        id: command.id,
        label: command.label,
        visible: true,
        order: 0,
        corners: command.corners,
        opacity: command.opacity ?? DEFAULT_RASTER_OPACITY,
        imageKey: command.imageKey,
        ...(command.provenance ? { provenance: command.provenance } : {}),
      };
      return {
        ...state,
        overlays: reindex([...state.overlays, entry]),
        images: { ...state.images, [command.id]: command.image },
      };
    }
    case "add-tile-layer": {
      if (!command.id.startsWith("tl:")) {
        throw new Error(
          `tile layer id must start with tl: prefix (received "${command.id}")`,
        );
      }
      if (state.overlays.some((e) => e.id === command.id)) {
        return state;
      }
      const attribution = command.attribution?.trim();
      const entry: TileLayerEntry = {
        kind: "tile",
        id: command.id,
        label: command.label,
        visible: true,
        order: 0,
        opacity: clampOpacity(command.opacity ?? 1),
        url: command.url,
        ...(attribution ? { attribution } : {}),
      };
      return { ...state, overlays: reindex([...state.overlays, entry]) };
    }
    case "set-opacity": {
      const opacity = clampOpacity(command.opacity);
      const overlays = updateEntry(state.overlays, command.id, (e) =>
        e.kind === "data" || e.opacity === opacity ? e : { ...e, opacity },
      );
      return overlays ? { ...state, overlays } : state;
    }
    case "rename-layer": {
      const overlays = updateEntry(state.overlays, command.id, (e) =>
        e.label === command.label ? e : { ...e, label: command.label },
      );
      return overlays ? { ...state, overlays } : state;
    }
    case "set-visibility": {
      const overlays = updateEntry(state.overlays, command.id, (e) =>
        e.visible === command.visible ? e : { ...e, visible: command.visible },
      );
      return overlays ? { ...state, overlays } : state;
    }
    case "restyle": {
      const overlays = updateEntry(state.overlays, command.id, (e) =>
        e.kind === "data"
          ? { ...e, style: { ...e.style, ...command.patch } }
          : e,
      );
      return overlays ? { ...state, overlays } : state;
    }
    case "reorder": {
      const at = state.overlays.findIndex((e) => e.id === command.id);
      if (at === -1) {
        return state;
      }
      const { kind } = state.overlays[at];
      const slots: number[] = [];
      state.overlays.forEach((e, i) => {
        if (e.kind === kind) {
          slots.push(i);
        }
      });
      const from = slots.indexOf(at);
      const to = Math.max(0, Math.min(command.order, slots.length - 1));
      if (from === to) {
        return state;
      }
      const group = slots.map((i) => state.overlays[i]);
      const [moved] = group.splice(from, 1);
      group.splice(to, 0, moved);
      const next = state.overlays.slice();
      slots.forEach((slot, i) => {
        next[slot] = group[i];
      });
      return { ...state, overlays: reindex(next) };
    }
    case "remove-layer": {
      if (!state.overlays.some((e) => e.id === command.id)) {
        return state;
      }
      return {
        ...state,
        overlays: reindex(state.overlays.filter((e) => e.id !== command.id)),
        featureCollections: withoutKey(state.featureCollections, command.id),
        images: withoutKey(state.images, command.id),
      };
    }
  }
}

export function createDocument(
  initial: Partial<DocumentState> = {},
  scene: SceneAccess = editorScene,
): Document {
  const createdAt = initial.createdAt ?? new Date().toISOString();
  let state: DocumentState = {
    id: initial.id ?? ulid(),
    createdAt,
    updatedAt: initial.updatedAt ?? createdAt,
    title: initial.title?.trim() || DEFAULT_DOCUMENT_TITLE,
    camera: initial.camera ?? DEFAULT_CAMERA,
    world:
      initial.world ??
      documentFrame(
        (initial.camera ?? DEFAULT_CAMERA).center[0],
        (initial.camera ?? DEFAULT_CAMERA).center[1],
      ),
    overlays: reindex(initial.overlays ?? []),
    featureCollections: initial.featureCollections ?? {},
    images: initial.images ?? {},
  };
  let revision = 0;
  let lastKey: string | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  return {
    id: state.id,
    scene,
    get revision() {
      return revision;
    },
    snapshot: () => state,
    dispatch: (command) => {
      const next = reduce(state, command);
      if (next === state) {
        return;
      }
      state = next;
      revision += 1;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settle: (contentKey) => {
      lastKey = contentKey;
    },
    stamp: (contentKey, now) => {
      if (contentKey !== lastKey) {
        lastKey = contentKey;
        const updatedAt =
          Date.parse(now) < Date.parse(state.createdAt) ? state.createdAt : now;
        if (updatedAt !== state.updatedAt) {
          state = { ...state, updatedAt };
          notify();
        }
      }
      return state.updatedAt;
    },
  };
}

// ---------------------------------------------------------------------------
// The open document
// ---------------------------------------------------------------------------

/**
 * The document the editor has open. Opening a file replaces it with a new
 * Document; nothing edits the identity of the one that is open.
 */
export const useDocumentStore = create<{ doc: Document }>(() => ({
  doc: createDocument(),
}));

export function currentDocument(): Document {
  return useDocumentStore.getState().doc;
}

export function openDocument(doc: Document): void {
  useDocumentStore.setState({ doc });
}

/**
 * Call `listener` with the open document now, after each of its changes, and
 * whenever another document opens. Returns the unsubscribe function.
 */
export function followDocument(listener: (doc: Document) => void): () => void {
  let doc = currentDocument();
  let unsubscribeDoc = doc.subscribe(() => listener(doc));
  listener(doc);
  const unsubscribeStore = useDocumentStore.subscribe((state) => {
    if (state.doc === doc) {
      return;
    }
    unsubscribeDoc();
    doc = state.doc;
    unsubscribeDoc = doc.subscribe(() => listener(doc));
    listener(doc);
  });
  return () => {
    unsubscribeStore();
    unsubscribeDoc();
  };
}

/** Run a command on the open document. */
export function dispatch(command: DocumentCommand): void {
  currentDocument().dispatch(command);
}

/** Tell `onChange` about every change of the open document, or a swap. */
function subscribeOpenDocument(onChange: () => void): () => void {
  let doc = currentDocument();
  let unsubscribeDoc = doc.subscribe(onChange);
  const unsubscribeStore = useDocumentStore.subscribe((state) => {
    if (state.doc !== doc) {
      unsubscribeDoc();
      doc = state.doc;
      unsubscribeDoc = doc.subscribe(onChange);
      onChange();
    }
  });
  return () => {
    unsubscribeStore();
    unsubscribeDoc();
  };
}

/**
 * Read the open document in a component. The component renders again when
 * the selected value changes. The selector must return a value the state
 * already holds (a field, an entry), not a new object on each call.
 */
export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useSyncExternalStore(subscribeOpenDocument, () =>
    selector(currentDocument().snapshot()),
  );
}
