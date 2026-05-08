// SPDX-License-Identifier: AGPL-3.0-only
// Shared vitest setup for atlas-app component tests.
//
// MapEditor mounts the persistence layer which calls openDB on first render.
// jsdom has no indexedDB; fake-indexeddb/auto polyfills the global factory
// before any test module loads.

import "fake-indexeddb/auto";
