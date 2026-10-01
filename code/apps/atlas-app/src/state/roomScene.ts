// SPDX-License-Identifier: AGPL-3.0-only
//
// The drawing in a room: Excalidraw's elements, one entry per element id in
// the room doc's `elements` map, and the files they use in `files`.
//
// Scene coordinates are world coordinates (ADR-0015), the same for every
// viewer, so an element record travels as it is.
//
// Conflicts resolve per element as Excalidraw's reconcile does: the higher
// `version` wins, and at equal versions the lower `versionNonce`. A client
// writes an element only when its copy wins over the room's; it applies a
// room element only when that one wins over its own. Two clients that wrote
// one element at once both end up with the winner.
//
// Excalidraw changes elements in place, so a record goes into the doc as a
// copy and comes out as a copy.

import { CaptureUpdateAction } from "@atlasdraw/element";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";

import type * as Y from "yjs";

/** Excalidraw's files by id. */
export type BinaryFiles = Record<string, BinaryFileData>;

/** What a room needs from an editor. MapEditor gives it Excalidraw's. */
export interface RoomEditor {
  /** Every element, deleted ones included. */
  elements(): readonly ExcalidrawElement[];
  files(): BinaryFiles;
  /** Replace the drawing. Undo does not record it. */
  apply(elements: readonly ExcalidrawElement[]): void;
  addFiles(files: BinaryFileData[]): void;
  /** Called after each change of the editor's drawing or files. */
  onChange(listener: () => void): () => void;
}

/** The editor for an Excalidraw instance. */
export function editorOf(api: ExcalidrawImperativeAPI): RoomEditor {
  return {
    elements: () => api.getSceneElementsIncludingDeleted(),
    files: () => api.getFiles(),
    apply: (elements) =>
      api.updateScene({
        elements: elements as Parameters<typeof api.updateScene>[0]["elements"],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    addFiles: (files) => api.addFiles(files),
    onChange: (listener) => api.onChange(() => listener()),
  };
}

/** The room doc's root maps for the drawing. */
export const ELEMENTS_KEY = "elements";
export const FILES_KEY = "files";

type Versioned = Pick<ExcalidrawElement, "version" | "versionNonce">;

/** True when `a` should replace `b` (Excalidraw's reconcile rule). */
export function wins(a: Versioned, b: Versioned): boolean {
  return (
    a.version > b.version ||
    (a.version === b.version && a.versionNonce < b.versionNonce)
  );
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A file as the room doc keeps it: what Excalidraw's BinaryFileData holds. */
type RoomFile = Pick<BinaryFileData, "mimeType" | "dataURL" | "created">;

/**
 * Write every element and file of `editor` that the room does not hold, or
 * holds an older copy of, into `doc` as one transaction with `origin`.
 */
export function writeScene(
  doc: Y.Doc,
  editor: Pick<RoomEditor, "elements" | "files">,
  origin: unknown,
): void {
  const elements = doc.getMap<ExcalidrawElement>(ELEMENTS_KEY);
  const files = doc.getMap<RoomFile>(FILES_KEY);
  const used = new Set<string>();
  const changed: ExcalidrawElement[] = [];
  for (const el of editor.elements()) {
    const held = elements.get(el.id);
    if (!held || wins(el, held)) {
      changed.push(el);
    }
    const fileId = (el as { fileId?: string | null }).fileId;
    if (fileId && !el.isDeleted) {
      used.add(fileId);
    }
  }
  const editorFiles = editor.files();
  const newFiles = Array.from(used).filter(
    (id) => !files.has(id) && editorFiles[id],
  );
  if (changed.length === 0 && newFiles.length === 0) {
    return;
  }
  doc.transact(() => {
    for (const el of changed) {
      elements.set(el.id, copy(el));
    }
    for (const id of newFiles) {
      const f = editorFiles[id]!;
      files.set(id, {
        mimeType: f.mimeType,
        dataURL: f.dataURL,
        created: f.created,
      });
    }
  }, origin);
}

/** Excalidraw's file record for a room file. */
function binaryFile(id: string, f: RoomFile): BinaryFileData {
  return {
    id: id as BinaryFileData["id"],
    mimeType: f.mimeType,
    dataURL: f.dataURL,
    created: f.created,
  };
}

/** Elements by fractional index, ties by id; unindexed ones keep their place. */
function inOrder(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  return elements
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const x = a.el.index;
      const y = b.el.index;
      if (x && y && x !== y) {
        return x < y ? -1 : 1;
      }
      if (x && y) {
        return a.el.id < b.el.id ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map(({ el }) => el);
}

/**
 * Bind `editor` to the drawing in `doc`. The editor first shows exactly
 * the room's drawing. After that, a change in the editor is written with
 * `origin`, and a change from any other origin (a collaborator, or a sync
 * after a reconnect) is applied to the editor. Returns the unbind function.
 */
export function bindScene(
  doc: Y.Doc,
  editor: RoomEditor,
  origin: unknown,
): () => void {
  const elements = doc.getMap<ExcalidrawElement>(ELEMENTS_KEY);
  const files = doc.getMap<RoomFile>(FILES_KEY);

  const allFiles = Array.from(files.entries()).map(([id, f]) =>
    binaryFile(id, f),
  );
  if (allFiles.length > 0) {
    editor.addFiles(allFiles);
  }
  editor.apply(inOrder(Array.from(elements.values()).map(copy)));

  const onElements = (event: Y.YMapEvent<ExcalidrawElement>): void => {
    if (event.transaction.origin === origin) {
      return;
    }
    const byId = new Map(editor.elements().map((el) => [el.id, el]));
    let touched = false;
    for (const id of event.keysChanged) {
      const remote = elements.get(id);
      const local = byId.get(id);
      if (!remote) {
        if (local) {
          byId.delete(id);
          touched = true;
        }
      } else if (!local || wins(remote, local)) {
        byId.set(id, copy(remote));
        touched = true;
      }
    }
    if (touched) {
      editor.apply(inOrder(Array.from(byId.values())));
    }
    // A local copy that beat the remote one goes back to the room.
    writeScene(doc, editor, origin);
  };
  const onFiles = (event: Y.YMapEvent<RoomFile>): void => {
    if (event.transaction.origin === origin) {
      return;
    }
    const added: BinaryFileData[] = [];
    for (const id of event.keysChanged) {
      const f = files.get(id);
      if (f) {
        added.push(binaryFile(id, f));
      }
    }
    if (added.length > 0) {
      editor.addFiles(added);
    }
  };

  elements.observe(onElements);
  files.observe(onFiles);
  const unsubscribe = editor.onChange(() => writeScene(doc, editor, origin));
  return () => {
    unsubscribe();
    elements.unobserve(onElements);
    files.unobserve(onFiles);
  };
}
