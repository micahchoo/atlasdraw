// SPDX-License-Identifier: AGPL-3.0-only
// Shared vitest setup for atlas-app component tests.
//
// MapEditor mounts the persistence layer which calls openDB on first render.
// jsdom has no indexedDB; fake-indexeddb/auto polyfills the global factory
// before any test module loads.

import "fake-indexeddb/auto";

import { beforeEach } from "vitest";

import { createDocument, openDocument } from "./state/document";

// The open document is a module singleton. Each test starts with a new,
// empty one, so no test sees the layers or title another test left.
beforeEach(() => {
  openDocument(createDocument());
});

// `@atlasdraw/basemap` re-exports MapCanvas at module load, which pulls in
// maplibre-gl. maplibre's top-level body calls
// `window.URL.createObjectURL(new Blob([...]))` to register a worker URL even
// when no map is constructed. jsdom 22 ships no createObjectURL /
// revokeObjectURL — provide a minimal stub here so any test that imports a
// component that imports anything in the basemap barrel doesn't blow up at
// module evaluation time. Real Blob payloads aren't read by jsdom-only tests.
{
  const urlAny = URL as unknown as {
    createObjectURL?: (b: Blob) => string;
    revokeObjectURL?: (u: string) => void;
  };
  if (typeof urlAny.createObjectURL !== "function") {
    urlAny.createObjectURL = () => "blob:test-stub";
  }
  if (typeof urlAny.revokeObjectURL !== "function") {
    urlAny.revokeObjectURL = () => {};
  }
}
