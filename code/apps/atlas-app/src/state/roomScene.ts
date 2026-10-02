// SPDX-License-Identifier: AGPL-3.0-only
//
// The drawing in a room: Excalidraw's elements, one entry per element id in
// the room doc's `elements` map, and the files they use in `files`.
//
// Scene coordinates are world coordinates
// (docs/architecture/adr/0015-world-coordinates-gate.md), the same for every
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
//
// Any client can write any value into the room doc. Every element and file
// read from it goes through roomValidation.ts first: a record that fails is
// not shown, and a local copy of the same id wins over it.

import { CaptureUpdateAction } from "@atlasdraw/element";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { elementFileIds } from "./pinDetails";
import {
  checkElement,
  checkFile,
  rejectFrom,
  writerOfKey,
  type RoomFile,
} from "./roomValidation";

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

/** An element as the room doc holds it: a copy, since Excalidraw mutates. */
export function elementRecord(el: ExcalidrawElement): ExcalidrawElement {
  return copy(el);
}

/** A file as the room doc holds it. */
export function fileRecord(f: BinaryFileData): RoomFile {
  return { mimeType: f.mimeType, dataURL: f.dataURL, created: f.created };
}

/**
 * Write every element and file of `editor` that the room does not hold, or
 * holds an older copy of, into `doc` as one transaction with `origin`.
 */
export function writeScene(
  doc: Y.Doc,
  editor: Pick<RoomEditor, "elements" | "files">,
  origin: unknown,
): void {
  const elements = doc.getMap<unknown>(ELEMENTS_KEY);
  const files = doc.getMap<unknown>(FILES_KEY);
  const used = new Set<string>();
  const changed: ExcalidrawElement[] = [];
  for (const el of editor.elements()) {
    // A record that fails the check is no copy at all: the local one wins.
    const held = checkElement(el.id, elements.get(el.id));
    if (!held || wins(el, held)) {
      changed.push(el);
    }
    // An image's file and a pin's photo go to the room with the element.
    for (const fileId of elementFileIds(el)) {
      used.add(fileId);
    }
  }
  const editorFiles = editor.files();
  const newFiles = Array.from(used).filter(
    (id) => !checkFile(id, files.get(id)) && editorFiles[id],
  );
  if (changed.length === 0 && newFiles.length === 0) {
    return;
  }
  doc.transact(() => {
    for (const el of changed) {
      elements.set(el.id, elementRecord(el));
    }
    for (const id of newFiles) {
      files.set(id, fileRecord(editorFiles[id]!));
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
  const elements = doc.getMap<unknown>(ELEMENTS_KEY);
  const files = doc.getMap<unknown>(FILES_KEY);

  /** The valid element under `id`, or null after saying so once per peer. */
  const elementAt = (id: string): ExcalidrawElement | null => {
    const el = checkElement(id, elements.get(id));
    if (!el) {
      rejectFrom(doc, writerOfKey(elements, id), "element");
    }
    return el;
  };
  const fileAt = (id: string): RoomFile | null => {
    const f = checkFile(id, files.get(id));
    if (!f) {
      rejectFrom(doc, writerOfKey(files, id), "file");
    }
    return f;
  };

  const allFiles = Array.from(files.keys()).flatMap((id) => {
    const f = fileAt(id);
    return f ? [binaryFile(id, f)] : [];
  });
  if (allFiles.length > 0) {
    editor.addFiles(allFiles);
  }
  editor.apply(
    inOrder(
      Array.from(elements.keys()).flatMap((id) => {
        const el = elementAt(id);
        return el ? [copy(el)] : [];
      }),
    ),
  );

  // An observer runs inside the Yjs transaction of the relay's message; an
  // error here must not reach the provider or the editor.
  const guarded =
    <E>(handle: (event: E) => void) =>
    (event: E): void => {
      try {
        handle(event);
      } catch (err) {
        console.error("[atlasdraw] room: a remote change was not applied", err);
      }
    };

  const onElements = guarded((event: Y.YMapEvent<unknown>): void => {
    if (event.transaction.origin === origin) {
      return;
    }
    const byId = new Map(editor.elements().map((el) => [el.id, el]));
    let touched = false;
    for (const id of event.keysChanged) {
      const local = byId.get(id);
      if (!elements.has(id)) {
        if (local) {
          byId.delete(id);
          touched = true;
        }
        continue;
      }
      const remote = elementAt(id);
      if (remote && (!local || wins(remote, local))) {
        byId.set(id, copy(remote));
        touched = true;
      }
    }
    if (touched) {
      editor.apply(inOrder(Array.from(byId.values())));
    }
    // A local copy that beat the remote one goes back to the room.
    writeScene(doc, editor, origin);
  });
  const onFiles = guarded((event: Y.YMapEvent<unknown>): void => {
    if (event.transaction.origin === origin) {
      return;
    }
    const added: BinaryFileData[] = [];
    for (const id of event.keysChanged) {
      const f = files.has(id) ? fileAt(id) : null;
      if (f) {
        added.push(binaryFile(id, f));
      }
    }
    if (added.length > 0) {
      editor.addFiles(added);
    }
  });

  elements.observe(onElements);
  files.observe(onFiles);
  const unsubscribe = editor.onChange(() => writeScene(doc, editor, origin));
  return () => {
    unsubscribe();
    elements.unobserve(onElements);
    files.unobserve(onFiles);
  };
}
