// SPDX-License-Identifier: AGPL-3.0-only
//
// The open document's steps in the editor's history (session/history.ts).
//
// Each command the user gives is a step: its redo is the command again, and
// its undo is the inverse command, read off the state before it. A layer
// command's inverse puts the layer's entry and payload back as they were
// (`put-layer`), so the entry keeps its place, its style and its identity.
// Comment edits are steps too (CommentsLayer.trackUndo).
//
// A collaborator's change is no step: a room dispatches it with origin
// "remote", and its comments arrive with the relay as their origin. Opening
// another document resets the history, so opening is not an edit.

import type { EditorHistory } from "../session/history";
import type {
  AppliedCommand,
  Document,
  DocumentCommand,
  DocumentState,
  DocumentStore,
} from "./document";

/** The command that takes `command` back, from the state before it. */
export function inverseOf(
  command: DocumentCommand,
  before: DocumentState,
): DocumentCommand | null {
  switch (command.type) {
    case "rename-document":
      return { type: "rename-document", title: before.title };
    case "set-basemap":
      return { type: "set-basemap", id: before.basemap };
    case "replace-content":
      // A room's whole-content update is never the user's own step.
      return null;
    case "add-data-layer":
    case "add-raster-layer":
    case "add-tile-layer":
      return { type: "remove-layer", id: command.id };
    case "put-layer":
      return layerAsItWas(command.entry.id, before);
    case "rename-layer":
    case "set-visibility":
    case "reorder":
    case "restyle":
    case "set-opacity":
    case "remove-layer":
      return layerAsItWas(command.id, before);
  }
}

/** The command that makes the layer `id` what it was in `before`. */
function layerAsItWas(id: string, before: DocumentState): DocumentCommand {
  const entry = before.overlays.find((e) => e.id === id);
  if (!entry) {
    return { type: "remove-layer", id };
  }
  const fc = before.featureCollections[id];
  const image = before.images[id];
  return {
    type: "put-layer",
    entry,
    ...(fc ? { fc } : {}),
    ...(image ? { image } : {}),
  };
}

/**
 * The key that joins a run of one command into one step: a slider dragged
 * or digits typed into one field of one layer.
 */
export function mergeKeyOf(command: DocumentCommand): string | undefined {
  switch (command.type) {
    case "restyle":
      return `restyle:${command.id}:${Object.keys(command.patch)
        .sort()
        .join(",")}`;
    case "set-opacity":
      return `opacity:${command.id}`;
    default:
      return undefined;
  }
}

/** Record the document's local commands and comment edits. */
function recordSteps(doc: Document, history: EditorHistory): () => void {
  const stopCommands = doc.onCommand(
    ({ command, before, origin }: AppliedCommand) => {
      if (origin !== "local") {
        return;
      }
      const inverse = inverseOf(command, before);
      if (!inverse) {
        return;
      }
      history.record(
        {
          undo: () => void doc.dispatch(inverse),
          redo: () => void doc.dispatch(command),
        },
        { merge: mergeKeyOf(command) },
      );
    },
  );
  const stopComments = doc.comments.trackUndo((step) => history.record(step));
  return () => {
    stopCommands();
    stopComments();
  };
}

/**
 * Keep `history` on the store's open document: record its steps, and reset
 * the history when another document opens. Returns the function that stops.
 */
export function followDocumentHistory(
  store: Pick<DocumentStore, "getState" | "subscribe">,
  history: EditorHistory,
): () => void {
  let doc = store.getState().doc;
  let stopSteps = recordSteps(doc, history);
  const stopStore = store.subscribe((state) => {
    if (state.doc === doc) {
      return;
    }
    stopSteps();
    doc = state.doc;
    history.reset();
    stopSteps = recordSteps(doc, history);
  });
  return () => {
    stopStore();
    stopSteps();
  };
}
