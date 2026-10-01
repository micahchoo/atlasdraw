// SPDX-License-Identifier: AGPL-3.0-only
//
// A session for a component test: the editor's open-document store and
// drawing, no rooms, and the map the test hands in. Per
// .claude/rules/test-fixtures.md: do not change this to fix one test.

import React from "react";

import { useDocumentStore } from "../../state/document";
import { editorScene } from "../../state/scene";
import { createSession, type EditorSession } from "../EditorSession";
import { SessionProvider } from "../SessionContext";

import type maplibregl from "maplibre-gl";

export function testSession(
  options: { map?: maplibregl.Map | null } = {},
): EditorSession {
  return createSession({
    store: useDocumentStore,
    scene: editorScene,
    transport: null,
    notify: { success: () => {}, error: () => {} },
    map: options.map ?? null,
  });
}

/** `ui` inside a SessionProvider. */
export function withSession(
  ui: React.ReactElement,
  session: EditorSession = testSession(),
): React.ReactElement {
  return <SessionProvider session={session}>{ui}</SessionProvider>;
}
