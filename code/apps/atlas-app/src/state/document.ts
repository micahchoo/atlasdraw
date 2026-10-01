// SPDX-License-Identifier: AGPL-3.0-only
//
// The document: the one owner of what a saved map is, apart from the drawing.
//
// The Excalidraw scene owns the drawing. This module owns the rest: the
// document's identity (id and creation time, fixed when the document is
// created and never minted again), when its content last changed, and the
// camera it was saved with.
//
// `updatedAt` is a statement about content, not about saving. A save passes a
// content key (anything that changes when the content changes); the stamp
// moves only when the key differs from the last one it saw. So two saves with
// no edit between them write the same updatedAt, and the same bytes.

import { create } from "zustand";
import { ulid } from "ulid";

import type { Camera } from "@atlasdraw/data";

/** Where a document opens when nothing better is known. */
export const DEFAULT_CAMERA: Camera = {
  center: [0, 0],
  zoom: 2,
  bearing: 0,
  pitch: 0,
};

export interface DocumentState {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The camera the document was saved with. The live map owns the camera
   * while the editor runs; this value is used only when no map can be read
   * (an embed before load, a test without a map).
   */
  readonly camera: Camera;
}

export interface Document {
  /** Fixed at creation. */
  readonly id: string;
  snapshot(): DocumentState;
  /**
   * Record the current content key as the saved baseline without moving
   * updatedAt. A load calls this once the loaded content is in place.
   */
  settle(contentKey: string): void;
  /**
   * The updatedAt to write for a save of content with this key. It moves to
   * `now` only when the key differs from the last settled or stamped key,
   * and never to a time before createdAt.
   */
  stamp(contentKey: string, now: string): string;
  subscribe(listener: () => void): () => void;
}

export function createDocument(initial: Partial<DocumentState> = {}): Document {
  const createdAt = initial.createdAt ?? new Date().toISOString();
  let state: DocumentState = {
    id: initial.id ?? ulid(),
    createdAt,
    updatedAt: initial.updatedAt ?? createdAt,
    camera: initial.camera ?? DEFAULT_CAMERA,
  };
  let lastKey: string | null = null;
  const listeners = new Set<() => void>();

  const set = (next: DocumentState): void => {
    state = next;
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  return {
    id: state.id,
    snapshot: () => state,
    settle: (contentKey) => {
      lastKey = contentKey;
    },
    stamp: (contentKey, now) => {
      if (contentKey !== lastKey) {
        lastKey = contentKey;
        const updatedAt =
          Date.parse(now) < Date.parse(state.createdAt) ? state.createdAt : now;
        if (updatedAt !== state.updatedAt) {
          set({ ...state, updatedAt });
        }
      }
      return state.updatedAt;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The open document
// ---------------------------------------------------------------------------

/**
 * The document the editor has open. Opening a file replaces it with a new
 * Document; nothing edits the identity of the one that is open.
 */
export const useDocumentStore = create<{ doc: Document }>(() => ({
  doc: createDocument(),
}));

export function currentDocument(): Document {
  return useDocumentStore.getState().doc;
}

export function openDocument(doc: Document): void {
  useDocumentStore.setState({ doc });
}
