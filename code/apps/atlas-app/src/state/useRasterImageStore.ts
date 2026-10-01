// SPDX-License-Identifier: AGPL-3.0-only
//
// Object URLs for the open document's raster images, keyed by layer id.
//
// The document (state/document.ts) owns each raster's PNG. MapLibre's
// `image` source takes a URL, not pixels, so every raster needs an object
// URL, and an object URL keeps its Blob alive until it is revoked. This store
// is that URL cache and its lifetime: a URL is minted when an image appears,
// revoked when its image is replaced or its layer is removed, and all are
// revoked when another document opens.
//
// `set(id, blob)` hands an importer's image to the next registerRasterLayer
// for the same id (state/layerRegistry.ts).

import { create } from "zustand";

import { followDocument } from "./document";

export type RasterImage = {
  /** The decoded PNG, as the document holds it. */
  blob: Blob;
  /** Object URL over `blob`, handed to MapLibre's `image` source. */
  url: string;
};

export type RasterImageState = {
  images: Readonly<Record<string, RasterImage>>;
  /** Give the image for the raster layer about to be registered under `id`. */
  set: (id: string, blob: Blob) => void;
  get: (id: string) => RasterImage | undefined;
  /** A shallow copy, safe to iterate while commands run. */
  getAll: () => Record<string, RasterImage>;
};

/**
 * `URL.createObjectURL` is absent in plain Node. A marker string is honest
 * about a URL nothing can fetch, and keeps the bookkeeping testable.
 */
function createUrl(blob: Blob): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(blob);
  }
  return `blob:unavailable/${blob.size}`;
}

function revokeUrl(url: string): void {
  if (
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function" &&
    url.startsWith("blob:") &&
    !url.startsWith("blob:unavailable/")
  ) {
    URL.revokeObjectURL(url);
  }
}

const pending = new Map<string, Blob>();

/** The image given with `set` for this id, once. */
export function takePendingRasterImage(id: string): Blob | undefined {
  const blob = pending.get(id);
  pending.delete(id);
  return blob;
}

export const useRasterImageStore = create<RasterImageState>()((set, get) => ({
  images: {},
  // The URL is minted now, so an importer can put the image on the map before
  // it registers the layer. The registration keeps it: same id, same blob.
  set: (id, blob) => {
    pending.set(id, blob);
    const prev = get().images[id];
    if (prev?.blob === blob) {
      return;
    }
    if (prev) {
      revokeUrl(prev.url);
    }
    set({ images: { ...get().images, [id]: { blob, url: createUrl(blob) } } });
  },
  get: (id) => get().images[id],
  getAll: () => ({ ...get().images }),
}));

/**
 * Bring the URL cache in step with the document's images. An image given
 * with `set` and not yet registered keeps its URL.
 */
function syncUrls(blobs: Readonly<Record<string, Blob>>): void {
  const prev = useRasterImageStore.getState().images;
  let changed = Object.keys(prev).length !== Object.keys(blobs).length;
  const next: Record<string, RasterImage> = {};
  for (const [id, blob] of Object.entries(blobs)) {
    const cached = prev[id];
    if (cached && cached.blob === blob) {
      next[id] = cached;
    } else {
      next[id] = { blob, url: createUrl(blob) };
      changed = true;
    }
  }
  for (const [id, cached] of Object.entries(prev)) {
    if (!next[id] && pending.get(id) === cached.blob) {
      next[id] = cached;
      continue;
    }
    if (next[id] !== cached) {
      revokeUrl(cached.url);
      changed = true;
    }
  }
  if (changed) {
    useRasterImageStore.setState({ images: next });
  }
}

followDocument((doc) => syncUrls(doc.snapshot().images));
