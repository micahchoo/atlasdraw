// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's history, wired for the life of the editor: it follows the
// open document (its steps, and a reset when another document opens), and
// the drawing's own history once Excalidraw has mounted.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { followDocumentHistory } from "../state/documentUndo";

import type { EditorSession } from "../session/EditorSession";

export function useEditorHistory(
  session: Pick<EditorSession, "store" | "history">,
  api: ExcalidrawImperativeAPI | null,
): void {
  const { store, history } = session;
  useEffect(() => followDocumentHistory(store, history), [store, history]);
  useEffect(() => {
    if (!api) {
      return;
    }
    history.attachDrawing(api.history);
    return () => history.attachDrawing(null);
  }, [api, history]);
}
