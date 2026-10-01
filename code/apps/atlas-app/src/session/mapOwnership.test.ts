// SPDX-License-Identifier: AGPL-3.0-only
//
// What the editor does when the DocumentStore says no: a newer copy is in
// the slot (Conflict), or another tab holds the map (HeldElsewhere). The
// store is faked at its interface; the session, the document and the
// drawing are real.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../state/document";
import { toFile } from "../state/documentIO";
import { sceneOf } from "../state/scene";
import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";

import { testSession } from "./__tests__/sessionFixture";
import { answerConflict, holdOpenMaps } from "./mapOwnership";

import type { Conflict, HeldElsewhere, Lease } from "../state/documentStore";
import type { EditorSession } from "./EditorSession";
import type { PersistenceStore } from "../state/persistence";

const conflict: Conflict = {
  kind: "conflict",
  stored: { revision: 4, updatedAt: "2026-06-01T00:00:00.000Z" },
};

function lease(id: string) {
  let lose: () => void = () => {};
  const lost = new Promise<void>((r) => {
    lose = r;
  });
  const l: Lease = { kind: "lease", id, release: vi.fn(), lost };
  return { lease: l, lose };
}

function fakeStore(
  claim: (
    id: string,
    o?: { steal?: boolean },
  ) => Promise<Lease | HeldElsewhere>,
) {
  return {
    save: vi.fn(async () => ({ kind: "saved" as const, revision: 5 })),
    claim: vi.fn(claim),
  } as unknown as PersistenceStore & {
    save: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
  };
}

function session(answer: boolean): EditorSession {
  const s = testSession();
  const fx = makeFakeExcalidraw();
  s.view.getState().setApi(fx.api);
  openDocument(createDocument({ title: "Plan" }, sceneOf(fx.api)));
  s.view.setState({ ask: vi.fn(async () => answer) });
  return s;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("answerConflict", () => {
  it("replace: the open map is saved over the newer copy's revision", async () => {
    const s = session(true);
    const store = fakeStore(async (id) => lease(id).lease);
    const file = toFile(currentDocument());

    await answerConflict(s, store, conflict, file);

    expect(store.save).toHaveBeenCalledWith(file, { over: 4 });
    expect(currentDocument().id).toBe(file.manifest.id);
  });

  it("open as a copy (also Escape): the open map gets a new id and is saved as a new map", async () => {
    const s = session(false);
    const store = fakeStore(async (id) => lease(id).lease);
    const file = toFile(currentDocument());

    await answerConflict(s, store, conflict, file);

    const copy = currentDocument();
    expect(copy.id).not.toBe(file.manifest.id);
    expect(copy.snapshot().title).toBe("Plan");
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][0].manifest.id).toBe(copy.id);
  });
});

describe("holdOpenMaps", () => {
  beforeEach(() => {
    openDocument(createDocument({ title: "First" }));
  });

  it("claims the open map, and lets it go when another map opens", async () => {
    const s = session(true);
    const held = new Map<string, ReturnType<typeof lease>>();
    const store = fakeStore(async (id) => {
      const l = lease(id);
      held.set(id, l);
      return l.lease;
    });
    const stop = holdOpenMaps(s, store);
    await flush();
    const first = currentDocument().id;
    expect(store.claim).toHaveBeenCalledWith(first, undefined);

    openDocument(createDocument({ title: "Second" }));
    await flush();

    expect(held.get(first)!.lease.release).toHaveBeenCalled();
    expect(store.claim).toHaveBeenLastCalledWith(
      currentDocument().id,
      undefined,
    );
    expect(s.persistence.getState().readOnly).toBe(false);
    stop();
  });

  it("held in another tab, the user takes over: the lock is stolen", async () => {
    const s = session(true);
    const store = fakeStore(async (id, o) =>
      o?.steal ? lease(id).lease : { kind: "held-elsewhere", id },
    );
    const stop = holdOpenMaps(s, store);
    await flush();
    await flush();

    expect(store.claim).toHaveBeenLastCalledWith(currentDocument().id, {
      steal: true,
    });
    expect(s.persistence.getState().readOnly).toBe(false);
    stop();
  });

  it("held in another tab, the user declines: this tab is read-only", async () => {
    const s = session(false);
    const store = fakeStore(async (id) => ({ kind: "held-elsewhere", id }));
    const stop = holdOpenMaps(s, store);
    await flush();
    await flush();

    expect(s.persistence.getState().readOnly).toBe(true);
    stop();
  });

  it("taken over by another tab: this tab becomes read-only and says so", async () => {
    const s = session(true);
    const notify = vi.spyOn(s.notify, "error");
    let l!: ReturnType<typeof lease>;
    const store = fakeStore(async (id) => {
      l = lease(id);
      return l.lease;
    });
    const stop = holdOpenMaps(s, store);
    await flush();

    l.lose();
    await flush();

    expect(s.persistence.getState().readOnly).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });
});
