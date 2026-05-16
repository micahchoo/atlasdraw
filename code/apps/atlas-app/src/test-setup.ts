// SPDX-License-Identifier: AGPL-3.0-only
// Shared vitest setup for atlas-app component tests.
//
// MapEditor mounts the persistence layer which calls openDB on first render.
// jsdom has no indexedDB; fake-indexeddb/auto polyfills the global factory
// before any test module loads.

import "fake-indexeddb/auto";

// Phase 6 A14a — `@atlasdraw/basemap` re-exports MapCanvas at module load,
// which pulls in maplibre-gl. maplibre's top-level body calls
// `window.URL.createObjectURL(new Blob([...]))` to register a worker URL
// even when no map is constructed. jsdom 22 ships no createObjectURL/
// revokeObjectURL — provide a minimal stub here so any test that imports
// a component that imports BasemapPickerDialog (or anything else in the
// basemap barrel) doesn't blow up at module evaluation time. Real Blob
// payloads aren't read by jsdom-only tests.
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
