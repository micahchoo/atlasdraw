// SPDX-License-Identifier: AGPL-3.0-only
//
// Convert selection to data layer: the command `edit.convert-to-layer`
// (commands/commands.ts), in the palette and in a shape's right-click menu.
//
// The conversion is one step in the editor's history (session/history.ts):
// the document gains a data layer with the shape's geometry, and the shape
// is deleted. Undo takes back both, so the shape is never on the map twice.
// The delete is kept out of the drawing's own history, which would hold it
// as a second step. The map overlays draw the new layer; nothing here
// writes the map.

import {
  annotationToFeatureCollection,
  elementGeometry,
  UnsupportedConvertElementError,
} from "@atlasdraw/tools";
import { defaultLayerStyle } from "@atlasdraw/basemap";

import {
  annotationParts,
  generateLayerLabel,
  setDeletedOutsideDrawingHistory,
} from "../state/annotations";

import type { NonDeletedExcalidrawElement } from "@atlasdraw/element/types";

import type { EditorSession } from "./EditorSession";

/**
 * The one selected shape, when it converts: it has a shape on the map, and
 * it is not text (a label is not a feature). Else null.
 */
export function convertibleSelection(
  s: EditorSession,
): NonDeletedExcalidrawElement | null {
  const api = s.view.getState().api;
  if (!api) {
    return null;
  }
  const selected = api.getAppState().selectedElementIds ?? {};
  const ids = Object.keys(selected).filter((id) => selected[id]);
  if (ids.length !== 1) {
    return null;
  }
  const el = api.getSceneElements().find((x) => x.id === ids[0]);
  const world = s.store.getState().doc.snapshot().world;
  return el && el.type !== "text" && elementGeometry(el, world) !== null
    ? el
    : null;
}

/** Convert the selected shape. A failure is a toast; nothing throws. */
export function convertSelection(s: EditorSession): void {
  const api = s.view.getState().api;
  const el = convertibleSelection(s);
  if (!api || !el) {
    return;
  }
  const doc = s.store.getState().doc;
  try {
    const world = doc.snapshot().world;
    const fc = annotationToFeatureCollection(el, world);
    const parts = annotationParts(api, el.id);
    let refused: string | null = null;
    s.history.group(() => {
      const added = doc.dispatch({
        type: "add-data-layer",
        id: `dl:${crypto.randomUUID()}`,
        fc,
        label: generateLayerLabel(el, world),
        style: defaultLayerStyle(fc),
      });
      if (!added.ok) {
        refused = added.reason;
        return;
      }
      setDeletedOutsideDrawingHistory(api, parts, true);
      s.history.record({
        undo: () => setDeletedOutsideDrawingHistory(api, parts, false),
        redo: () => setDeletedOutsideDrawingHistory(api, parts, true),
      });
    });
    if (refused) {
      s.notify.error(`Couldn't convert to a data layer — ${refused}`);
    }
  } catch (err) {
    if (err instanceof UnsupportedConvertElementError) {
      s.notify.error(err.message);
      return;
    }
    // A menu click or a palette pick runs this; a rethrow would be an
    // uncaught exception with nothing shown to the user.
    console.error("[convertSelection] convert failed:", err);
    s.notify.error(
      `Couldn't convert to a data layer${
        err instanceof Error ? ` — ${err.message}` : ""
      }`,
    );
  }
}
