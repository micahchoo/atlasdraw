// SPDX-License-Identifier: AGPL-3.0-only
//
// The Document interface: identity, revision and the updatedAt stamp.

import { describe, expect, it } from "vitest";

import { createDocument } from "../document";

const LOADED = {
  id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
};

describe("document identity", () => {
  it("mints an id when none is given, and starts updatedAt at createdAt", () => {
    const doc = createDocument({ createdAt: "2026-10-01T09:00:00.000Z" });

    expect(doc.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(doc.snapshot().updatedAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("keeps a loaded id and creation time", () => {
    const doc = createDocument(LOADED);

    expect(doc.id).toBe(LOADED.id);
    expect(doc.snapshot()).toMatchObject(LOADED);
  });

  it("two documents get two ids", () => {
    expect(createDocument().id).not.toBe(createDocument().id);
  });
});

describe("updatedAt", () => {
  it("does not move when the content key is the one the document settled on", () => {
    const doc = createDocument(LOADED);
    doc.settle("k0");

    expect(doc.stamp("k0", "2026-10-01T09:00:00.000Z")).toBe(LOADED.updatedAt);
    expect(doc.stamp("k0", "2026-10-01T09:00:10.000Z")).toBe(LOADED.updatedAt);
  });

  it("moves to the save time when the content key changed, then holds", () => {
    const doc = createDocument(LOADED);
    doc.settle("k0");

    expect(doc.stamp("k1", "2026-10-01T09:00:00.000Z")).toBe(
      "2026-10-01T09:00:00.000Z",
    );
    expect(doc.stamp("k1", "2026-10-01T09:00:10.000Z")).toBe(
      "2026-10-01T09:00:00.000Z",
    );
    expect(doc.snapshot().updatedAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("never goes before createdAt, whatever the clock says", () => {
    const doc = createDocument(LOADED);

    expect(doc.stamp("k1", "2020-01-01T00:00:00.000Z")).toBe(LOADED.createdAt);
  });
});
