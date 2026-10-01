// SPDX-License-Identifier: AGPL-3.0-only
//
// Object URLs for the open document's raster images.
//
// The document (state/document.ts) owns each raster's PNG. MapLibre's `image`
// source takes a URL, not pixels, so every raster needs an object URL, and
// an object URL keeps its Blob alive until it is revoked. A session that
// imports the same sheet twenty times would otherwise hold twenty PNGs.
//
// This module is that cache and its lifetime. A URL is minted the first time
// it is asked for, kept while the open document holds the same image under
// the same id, and revoked when the image is replaced, its layer is removed,
// or another document opens.

import { followDocument } from "./document";

interface Cached {
  readonly blob: Blob;
  readonly url: string;
}

const cache = new Map<string, Cached>();

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

/**
 * The object URL for a raster's image. An importer asks before it adds the
 * layer, to put the image on the map first; the URL is kept once the
 * document holds the same image under the same id.
 */
export function rasterUrl(id: string, image: Blob): string {
  const cached = cache.get(id);
  if (cached?.blob === image) {
    return cached.url;
  }
  if (cached) {
    revokeUrl(cached.url);
  }
  const url = createUrl(image);
  cache.set(id, { blob: image, url });
  return url;
}

let images: Readonly<Record<string, Blob>> = {};

/** Raster id → object URL, for every raster of the open document. */
export function rasterUrls(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(images).map(([id, image]) => [id, rasterUrl(id, image)]),
  );
}

// Revoke what the open document no longer holds.
followDocument((doc) => {
  images = doc.snapshot().images;
  for (const [id, cached] of Array.from(cache)) {
    if (images[id] !== cached.blob) {
      revokeUrl(cached.url);
      cache.delete(id);
    }
  }
});
