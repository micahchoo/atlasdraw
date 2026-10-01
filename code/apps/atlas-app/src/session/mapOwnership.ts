// SPDX-License-Identifier: AGPL-3.0-only
//
// Who may write the open map. The DocumentStore (state/documentStore.ts)
// decides and never asks; this module asks the user when it says no:
//
//   answerConflict  the slot holds a newer copy than the one being saved
//                   (an older file of the same map was opened, or another
//                   tab saved). Replace the newer copy, or keep both: the
//                   open map becomes a new map.
//   holdOpenMaps    one tab per map. A map another tab holds opens
//                   read-only, or this tab takes it over; a tab whose map
//                   was taken over becomes read-only.

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { currentDocument, followDocument } from "../state/document";
import { liveCamera, loadDocument, toFile } from "../state/documentIO";
import { copyOfSharedMap } from "../state/myMaps";
import { isRoomDocument } from "../state/room";

import type { Conflict, Lease } from "../state/documentStore";
import type { PersistenceStore } from "../state/persistence";
import type { EditorSession } from "./EditorSession";
import type { Question } from "./view";

type OwnershipSession = Pick<EditorSession, "view" | "persistence" | "notify">;
type OwnershipStore = Pick<PersistenceStore, "save" | "claim">;

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "later" : date.toLocaleString();
}

/** Asked when a save meets a newer copy of the same map. */
export function conflictQuestion(conflict: Conflict): Question {
  return {
    title: "A newer copy of this map is in this browser",
    body: `The copy saved in this browser changed on ${when(
      conflict.stored.updatedAt,
    )}, after the copy you have open. Keep both: the open map becomes a new map, and the newer copy stays in My maps. Or replace the newer copy with the open map.`,
    cancelLabel: "Keep both",
    confirmLabel: "Replace the newer copy",
    tone: "destructive",
  };
}

/**
 * Answer a Conflict from a save of `file`. "Keep both", and Escape, open
 * the map as a copy with a new id and save that; nothing is lost.
 */
export async function answerConflict(
  s: OwnershipSession,
  store: OwnershipStore,
  conflict: Conflict,
  file: AtlasdrawDocument,
): Promise<void> {
  const replace = await s.view.getState().ask(conflictQuestion(conflict));
  if (replace) {
    const result = await store.save(file, { over: conflict.stored.revision });
    if (result.kind === "conflict") {
      // Saved again in another tab while the user read the question.
      s.notify.error(
        "The map changed again in another tab. Nothing was replaced.",
      );
    }
    return;
  }
  const { api, map } = s.view.getState();
  if (!api) {
    return;
  }
  const opened = await loadDocument(copyOfSharedMap(file), api, { map });
  if (!opened) {
    return;
  }
  await store.save(toFile(opened, undefined, liveCamera(map)));
  s.notify.success(
    `"${
      opened.snapshot().title
    }" is now a new map. The newer copy is in My maps.`,
  );
}

/** Asked when another tab holds the map this tab opens. */
export const HELD_QUESTION: Question = {
  title: "This map is open in another tab",
  body: "Two tabs that edit one map write over each other's changes. Take over to edit here; the other tab becomes read-only.",
  cancelLabel: "Open read-only",
  confirmLabel: "Take over",
};

/**
 * Hold each map the editor opens, for as long as it is open. Returns a
 * disposer that lets the held map go.
 */
export function holdOpenMaps(
  s: OwnershipSession,
  store: OwnershipStore,
): () => void {
  const persistence = () => s.persistence.getState();
  let stopped = false;
  let heldId: string | null = null;
  let lease: Lease | null = null;

  const isCurrent = (id: string) =>
    !stopped && heldId === id && currentDocument().id === id;

  const take = (next: Lease) => {
    lease = next;
    persistence().setReadOnly(false);
    void next.lost.then(() => {
      if (lease !== next) {
        return;
      }
      lease = null;
      persistence().setReadOnly(true);
      s.notify.error(
        "This map was opened in another tab. This tab is read-only now; reload it to edit here.",
      );
    });
  };

  const hold = async (id: string) => {
    const first = await store.claim(id, undefined);
    if (!isCurrent(id)) {
      if (first.kind === "lease") {
        first.release();
      }
      return;
    }
    if (first.kind === "lease") {
      take(first);
      return;
    }
    const takeOver = await s.view.getState().ask(HELD_QUESTION);
    if (!isCurrent(id)) {
      return;
    }
    if (!takeOver) {
      persistence().setReadOnly(true);
      return;
    }
    const stolen = await store.claim(id, { steal: true });
    if (!isCurrent(id)) {
      if (stolen.kind === "lease") {
        stolen.release();
      }
      return;
    }
    if (stolen.kind === "lease") {
      take(stolen);
    } else {
      persistence().setReadOnly(true);
    }
  };

  const unfollow = followDocument((doc) => {
    // followDocument also fires on every edit of the open map.
    if (doc.id === heldId) {
      return;
    }
    lease?.release();
    lease = null;
    heldId = doc.id;
    persistence().setReadOnly(false);
    // A room's document is the relay's (ADR-0018); no tab owns it.
    if (!isRoomDocument(doc)) {
      void hold(doc.id);
    }
  });

  return () => {
    stopped = true;
    unfollow();
    lease?.release();
    lease = null;
  };
}
