// SPDX-License-Identifier: AGPL-3.0-only
//
// useCollabDocumentTitle — syncs the document name across a collab room.
//
// The scene channel carries elements and the Yjs channel carries data-layer
// features; neither carried manifest metadata, so before this hook two people
// in the same room saw two different names in the collar and whichever client
// happened to auto-save last silently overwrote the other.
//
// The title rides the Y.Doc rather than the Socket.IO scene channel: it is
// document state, not presence, so it must survive a peer leaving and be
// there for the next joiner. It lives under a `meta` root map alongside
// YjsLayer's `layers` root (packages/data/src/yjs-layer.ts) — a plain string
// on a Y.Map, so concurrent renames resolve last-writer-wins, which is the
// right semantic for a name (unlike geometry, there is nothing to merge).
//
// Join rule: the room wins. If the shared doc already carries a title we
// adopt it; only when the room has none do we publish ours, which makes the
// first person in the room the one who names it.

import { useEffect } from "react";

import { useDocumentTitleStore } from "../state/documentTitle";

import type * as Y from "yjs";

/** Root Y.Map holding document metadata. Sibling of YjsLayer's "layers". */
export const META_MAP_KEY = "meta";
export const TITLE_KEY = "title";

export function useCollabDocumentTitle(yjsDoc: Y.Doc | null): void {
  useEffect(() => {
    if (!yjsDoc) {
      return;
    }
    const meta = yjsDoc.getMap<string>(META_MAP_KEY);

    const pullFromRoom = () => {
      const remote = meta.get(TITLE_KEY);
      if (typeof remote !== "string" || remote.trim() === "") {
        return;
      }
      const store = useDocumentTitleStore.getState();
      // The equality check is what breaks the echo loop: our own write comes
      // back through `observe`, and without this it would bounce forever.
      if (remote !== store.title) {
        store.setTitle(remote);
      }
    };

    if (typeof meta.get(TITLE_KEY) === "string") {
      pullFromRoom();
    } else {
      meta.set(TITLE_KEY, useDocumentTitleStore.getState().title);
    }

    meta.observe(pullFromRoom);
    const unsubscribe = useDocumentTitleStore.subscribe((state) => {
      if (meta.get(TITLE_KEY) !== state.title) {
        meta.set(TITLE_KEY, state.title);
      }
    });

    return () => {
      meta.unobserve(pullFromRoom);
      unsubscribe();
    };
  }, [yjsDoc]);
}
