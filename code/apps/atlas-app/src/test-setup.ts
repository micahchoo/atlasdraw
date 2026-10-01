// SPDX-License-Identifier: AGPL-3.0-only
// Shared vitest setup for atlas-app component tests.
//
// MapEditor mounts the persistence layer which calls openDB on first render.
// jsdom has no indexedDB; fake-indexeddb/auto polyfills the global factory
// before any test module loads.

import "fake-indexeddb/auto";
import { beforeEach } from "vitest";

// Before any module that reaches the basemap barrel (state/document does,
// through the room checks).
import "./test-url-stub";

import { createDocument, openDocument } from "./state/document";

// The open document is a module singleton. Each test starts with a new,
// empty one, so no test sees the layers or title another test left.
beforeEach(() => {
  openDocument(createDocument());
});
