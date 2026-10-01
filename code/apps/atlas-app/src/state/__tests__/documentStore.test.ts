// SPDX-License-Identifier: AGPL-3.0-only
//
// The DocumentStore: one map's bytes in its `doc:<id>` slot, never an older
// copy over a newer one, and one tab per map. Run against fake-indexeddb
// and an in-memory Web Locks manager that two "tabs" share.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";

import { createDocumentStore, type Locks } from "../documentStore";

let n = 0;
const freshDb = () => {
  const name = `atlasdraw-docstore-${++n}-${Date.now()}`;
  return () =>
    openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("state");
      },
    });
};

const bytes = (text: string) => new Blob([text]);
const meta = (updatedAt: string) => ({
  title: "Plan",
  updatedAt,
  version: 2,
});

/**
 * Web Locks, in memory: exclusive locks, `ifAvailable` and `steal`. A stolen
 * holder's request promise rejects with an AbortError, as in a browser.
 */
class FakeLocks implements Locks {
  private held = new Map<string, { reject: (err: unknown) => void }>();

  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> {
    const current = this.held.get(name);
    if (current && options.ifAvailable) {
      return Promise.resolve(callback(null));
    }
    if (current && options.steal) {
      current.reject(new DOMException("stolen", "AbortError"));
      this.held.delete(name);
    }
    if (this.held.has(name)) {
      throw new Error("FakeLocks: queueing is not modelled");
    }
    return new Promise((resolve, reject) => {
      this.held.set(name, { reject });
      Promise.resolve(callback({ name })).then(
        (v) => {
          if (this.held.get(name)?.reject === reject) {
            this.held.delete(name);
          }
          resolve(v);
        },
        (e) => reject(e),
      );
    });
  }
}

describe("DocumentStore.save", () => {
  it("writes a map that has no slot yet, at revision 1", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    const result = await store.save("m1", bytes("a"), null, meta("2026-01-02"));
    expect(result).toEqual({ kind: "saved", revision: 1 });
    expect(await store.revision("m1")).toBe(1);
  });

  it("saves on top of the revision it read, and counts up", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    await store.save("m1", bytes("a"), null, meta("2026-01-02"));
    const second = await store.save("m1", bytes("b"), 1, meta("2026-01-03"));
    expect(second).toEqual({ kind: "saved", revision: 2 });
  });

  it("refuses a copy based on an older revision and says what is stored", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    await store.save("m1", bytes("a"), null, meta("2026-01-02"));
    await store.save("m1", bytes("b"), 1, meta("2026-01-05"));

    const stale = await store.save("m1", bytes("c"), 1, meta("2026-01-06"));

    expect(stale).toEqual({
      kind: "conflict",
      stored: { revision: 2, updatedAt: "2026-01-05" },
    });
    expect(await store.revision("m1")).toBe(2);
  });

  it("refuses an opened file older than the stored copy (the file was not read from the slot)", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    await store.save("m1", bytes("week of edits"), null, meta("2026-03-01"));

    const old = await store.save("m1", bytes("month-old file"), null, {
      ...meta("2026-02-01"),
    });

    expect(old).toEqual({
      kind: "conflict",
      stored: { revision: 1, updatedAt: "2026-03-01" },
    });
  });

  it("an opened file newer than the stored copy is saved", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    await store.save("m1", bytes("a"), null, meta("2026-03-01"));
    const newer = await store.save("m1", bytes("b"), null, meta("2026-04-01"));
    expect(newer).toEqual({ kind: "saved", revision: 2 });
  });

  it("replacing on purpose is a save based on the stored revision", async () => {
    const store = createDocumentStore(freshDb(), new FakeLocks());
    await store.save("m1", bytes("a"), null, meta("2026-03-01"));
    const conflict = await store.save(
      "m1",
      bytes("b"),
      null,
      meta("2026-02-01"),
    );
    if (conflict.kind !== "conflict") {
      throw new Error("expected a conflict");
    }
    const replaced = await store.save(
      "m1",
      bytes("b"),
      conflict.stored.revision,
      meta("2026-02-01"),
    );
    expect(replaced).toEqual({ kind: "saved", revision: 2 });
  });
});

describe("DocumentStore.claim", () => {
  it("one tab holds a map; a second tab finds it held elsewhere", async () => {
    const locks = new FakeLocks();
    const db = freshDb();
    const tab1 = createDocumentStore(db, locks);
    const tab2 = createDocumentStore(db, locks);

    const lease = await tab1.claim("m1");
    expect(lease.kind).toBe("lease");
    expect((await tab2.claim("m1")).kind).toBe("held-elsewhere");
    // Another map is free.
    expect((await tab2.claim("m2")).kind).toBe("lease");
  });

  it("a released lease frees the map", async () => {
    const locks = new FakeLocks();
    const db = freshDb();
    const tab1 = createDocumentStore(db, locks);
    const tab2 = createDocumentStore(db, locks);

    const lease = await tab1.claim("m1");
    if (lease.kind !== "lease") {
      throw new Error("expected a lease");
    }
    lease.release();
    await Promise.resolve();
    expect((await tab2.claim("m1")).kind).toBe("lease");
  });

  it("take over: the second tab steals the lock and the first hears it is lost", async () => {
    const locks = new FakeLocks();
    const db = freshDb();
    const tab1 = createDocumentStore(db, locks);
    const tab2 = createDocumentStore(db, locks);

    const first = await tab1.claim("m1");
    if (first.kind !== "lease") {
      throw new Error("expected a lease");
    }
    let lost = false;
    void first.lost.then(() => {
      lost = true;
    });

    const second = await tab2.claim("m1", { steal: true });

    expect(second.kind).toBe("lease");
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toBe(true);
  });

  it("without Web Locks every claim is a lease", async () => {
    const store = createDocumentStore(freshDb(), null);
    expect((await store.claim("m1")).kind).toBe("lease");
    expect((await store.claim("m1")).kind).toBe("lease");
  });
});
