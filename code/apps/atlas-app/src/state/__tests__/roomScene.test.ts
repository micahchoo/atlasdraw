// SPDX-License-Identifier: AGPL-3.0-only
//
// The merge rule for elements in a room: per element, the higher version
// wins, then the lower versionNonce. Two docs here stand for two clients;
// updates go between them only when `deliver` is called, so a test can make
// two edits concurrent. The transport is measured in collab.known-red.test.ts.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { bindScene, wins, type RoomEditor } from "../roomScene";

function el(id: string, version: number, versionNonce: number, x = 0) {
  return {
    id,
    type: "rectangle",
    x,
    y: 0,
    width: 10,
    height: 10,
    version,
    versionNonce,
    isDeleted: false,
  } as unknown as ExcalidrawElement;
}

interface Side {
  doc: Y.Doc;
  scene: ExcalidrawElement[];
  edit(element: ExcalidrawElement): void;
  applied: number;
}

function side(): Side {
  const doc = new Y.Doc();
  const listeners = new Set<() => void>();
  const s: Side = {
    doc,
    scene: [],
    applied: 0,
    edit(element) {
      s.scene = [...s.scene.filter((e) => e.id !== element.id), element];
      listeners.forEach((l) => l());
    },
  };
  const editor: RoomEditor = {
    elements: () => s.scene,
    files: () => ({}),
    apply: (elements) => {
      s.applied += 1;
      s.scene = [...elements];
    },
    addFiles: () => {},
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  bindScene(doc, editor, { side: doc.clientID });
  return s;
}

/** Hand every update each doc has that the other lacks across, both ways. */
function deliver(a: Side, b: Side): void {
  for (let i = 0; i < 3; i++) {
    Y.applyUpdate(
      b.doc,
      Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)),
    );
    Y.applyUpdate(
      a.doc,
      Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)),
    );
  }
}

describe("wins", () => {
  it("the higher version wins; at equal versions the lower nonce", () => {
    expect(wins(el("a", 2, 9), el("a", 1, 1))).toBe(true);
    expect(wins(el("a", 1, 1), el("a", 2, 9))).toBe(false);
    expect(wins(el("a", 2, 3), el("a", 2, 7))).toBe(true);
    expect(wins(el("a", 2, 7), el("a", 2, 3))).toBe(false);
    expect(wins(el("a", 2, 3), el("a", 2, 3))).toBe(false);
  });
});

describe("bindScene", () => {
  it("an edit on one side reaches the other", () => {
    const a = side();
    const b = side();
    a.edit(el("r", 1, 5, 40));
    deliver(a, b);

    expect(b.scene).toEqual([el("r", 1, 5, 40)]);
  });

  it("two concurrent edits of one element end with the winner on both sides", () => {
    const a = side();
    const b = side();
    a.edit(el("r", 1, 5));
    deliver(a, b);

    a.edit(el("r", 3, 8, 100)); // higher version
    b.edit(el("r", 2, 1, 200));
    deliver(a, b);

    expect(a.scene).toEqual([el("r", 3, 8, 100)]);
    expect(b.scene).toEqual([el("r", 3, 8, 100)]);
  });

  it("at equal versions both sides keep the lower nonce", () => {
    const a = side();
    const b = side();
    a.edit(el("r", 2, 9, 100));
    b.edit(el("r", 2, 4, 200));
    deliver(a, b);

    expect(a.scene).toEqual([el("r", 2, 4, 200)]);
    expect(b.scene).toEqual([el("r", 2, 4, 200)]);
  });

  it("applying a remote change writes nothing back", () => {
    const a = side();
    const b = side();
    a.edit(el("r", 1, 5));
    deliver(a, b);
    const before = Y.encodeStateVector(b.doc);

    // Excalidraw calls onChange after updateScene; the binding hears it.
    b.edit(b.scene[0]!);

    expect(Y.encodeStateVector(b.doc)).toEqual(before);
  });

  it("an edit keeps a copy: changing the editor's object in place does not change the room", () => {
    const a = side();
    const element = el("r", 1, 5, 40);
    a.edit(element);
    (element as { x: number }).x = 999;

    const held = a.doc.getMap<ExcalidrawElement>("elements").get("r");
    expect(held?.x).toBe(40);
  });
});
