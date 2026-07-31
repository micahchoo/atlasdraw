// SPDX-License-Identifier: AGPL-3.0-only
// FU-1 RA-3 — decoded raster images, keyed by layer id.
//
// The sibling of useDataLayerFCStore, and for the same reason: the
// LayerRegistry holds metadata, and the bytes a layer renders from cannot live
// inside MapLibre once handed over. A `raster` entry carries corners, opacity
// and an `imageKey`; the PNG those name lives here.
//
// One thing this store has that the FC store does not: an object URL per image,
// and therefore a lifetime. MapLibre's `image` source takes a URL, not pixels,
// so every raster needs one — and an object URL holds its Blob alive until
// `revokeObjectURL`. Dropping the map reference is not enough; without the
// revoke, re-importing the same sheet twenty times over a long session leaks
// twenty full-size PNGs. So `delete` and `clear` revoke, and every caller that
// removes a raster goes through them.
//
// Write path, mirroring the FC store: the LayerRegistry's `remove(id)` deletes
// here unconditionally, so a call site removing an annotation or a data layer
// stays kind-agnostic and this is simply a no-op.

import { create } from "zustand";

export type RasterImage = {
  /** The decoded PNG. What gets written into the document's `files/` bag. */
  blob: Blob;
  /** Object URL over `blob`, handed to MapLibre's `image` source. */
  url: string;
};

export type RasterImageState = {
  images: Record<string, RasterImage>;

  /**
   * Insert or replace the image for a raster layer id, minting its object URL.
   * Replacing an existing entry revokes the old URL first — the same id twice
   * is a re-import, and the previous URL has no remaining reader.
   */
  set: (id: string, blob: Blob) => void;

  /** Remove and revoke. No-op if absent, so annotation/data ids pass through. */
  delete: (id: string) => void;

  get: (id: string) => RasterImage | undefined;

  /** Snapshot as a plain record — a fresh shallow clone, like the FC store. */
  getAll: () => Record<string, RasterImage>;

  /** Drop and revoke everything. Document load and tests. */
  clear: () => void;
};

/**
 * `URL.createObjectURL` is absent in a plain Node/vitest environment. Rather
 * than force every consumer's test to stub the global, fall back to a marker
 * string: nothing in Node can render an image anyway, so a URL that cannot be
 * fetched is honest about what it is, and the store's own bookkeeping stays
 * testable without jsdom.
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

export const useRasterImageStore = create<RasterImageState>()((set, get) => ({
  images: {},

  set: (id, blob) =>
    set((s) => {
      const existing = s.images[id];
      if (existing) {
        revokeUrl(existing.url);
      }
      return { images: { ...s.images, [id]: { blob, url: createUrl(blob) } } };
    }),

  delete: (id) =>
    set((s) => {
      const existing = s.images[id];
      if (!existing) {
        return s;
      }
      revokeUrl(existing.url);
      const next = { ...s.images };
      delete next[id];
      return { images: next };
    }),

  get: (id) => get().images[id],

  getAll: () => ({ ...get().images }),

  clear: () =>
    set((s) => {
      for (const image of Object.values(s.images)) {
        revokeUrl(image.url);
      }
      return { images: {} };
    }),
}));
