// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentsLayer unit tests.
//
// Exercises the CRDT semantics of CommentsLayer in isolation: addComment
// appends, resolve flips, delete removes, and two layers wired together
// through a shared Y.Doc update channel converge — the same wire-level
// semantics a real y-websocket connection enforces.
//
// We do NOT mock y-websocket internals here (per advisor guidance). The
// realtime-side test `comments-yjs.test.ts` owns wire-level integration.

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { CommentsLayer } from "../comments";

function makeLayer(doc: Y.Doc): CommentsLayer {
  // Pass a no-op provider factory — we bypass the WebSocket and exercise
  // CRDT semantics directly via Y.applyUpdate between docs.
  return new CommentsLayer({
    wsUrl: "ws://test.invalid",
    roomId: "test-room",
    workspaceId: null,
    doc,
    providerFactory: () => null,
  });
}

describe("CommentsLayer", () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let layerA: CommentsLayer;
  let layerB: CommentsLayer;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    layerA = makeLayer(docA);
    layerB = makeLayer(docB);
    // Two-way bridge: whenever one doc updates, broadcast to the other.
    docA.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "bridge") Y.applyUpdate(docB, u, "bridge");
    });
    docB.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "bridge") Y.applyUpdate(docA, u, "bridge");
    });
  });

  it("addComment appends to the comments list", () => {
    const id = layerA.addComment({
      text: "hello",
      anchor: { kind: "map", lng: 1, lat: 2 },
      authorId: "alice",
      authorName: "Alice",
    });
    expect(layerA.comments).toHaveLength(1);
    const c = layerA.comments[0]!;
    expect(c.id).toBe(id);
    expect(c.text).toBe("hello");
    expect(c.authorId).toBe("alice");
    expect(c.anchor).toEqual({ kind: "map", lng: 1, lat: 2 });
    expect(c.resolved).toBe(false);
    expect(c.schemaVersion).toBe(1);
  });

  it("resolve flips the resolved flag; no-op on unknown id", () => {
    const id = layerA.addComment({
      text: "x",
      anchor: { kind: "element", elementId: "el-1" },
      authorId: "alice",
      authorName: "Alice",
    });
    expect(layerA.comments[0]?.resolved).toBe(false);
    layerA.resolve(id);
    expect(layerA.comments[0]?.resolved).toBe(true);
    layerA.resolve("nonexistent"); // no throw
    expect(layerA.comments).toHaveLength(1);
  });

  it("delete removes the row; no-op on unknown id", () => {
    const id1 = layerA.addComment({
      text: "first",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "alice",
      authorName: "Alice",
    });
    const id2 = layerA.addComment({
      text: "second",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "alice",
      authorName: "Alice",
    });
    expect(layerA.comments).toHaveLength(2);
    layerA.delete(id1);
    expect(layerA.comments).toHaveLength(1);
    expect(layerA.comments[0]?.id).toBe(id2);
    layerA.delete("nonexistent"); // no throw
    expect(layerA.comments).toHaveLength(1);
  });

  it("subscribe fires on local + remote mutations", () => {
    const seen: number[] = [];
    const unsub = layerA.subscribe((next) => {
      seen.push(next.length);
    });
    layerA.addComment({
      text: "local",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "alice",
      authorName: "Alice",
    });
    // Remote write on doc B propagates to doc A via the bridge.
    layerB.addComment({
      text: "remote",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "bob",
      authorName: "Bob",
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(2);
    unsub();
  });

  it("two layers converge — second sees additions via Yjs sync", () => {
    layerA.addComment({
      text: "from-a",
      anchor: { kind: "map", lng: 10, lat: 20 },
      authorId: "alice",
      authorName: "Alice",
    });
    expect(layerB.comments).toHaveLength(1);
    expect(layerB.comments[0]?.text).toBe("from-a");
    expect(layerB.comments[0]?.anchor).toEqual({
      kind: "map",
      lng: 10,
      lat: 20,
    });

    layerB.resolve(layerB.comments[0]!.id);
    expect(layerA.comments[0]?.resolved).toBe(true);

    layerA.delete(layerA.comments[0]!.id);
    expect(layerB.comments).toHaveLength(0);
  });

  it("element-anchor round-trips through Y.Map serialization", () => {
    layerA.addComment({
      text: "on element",
      anchor: { kind: "element", elementId: "ex-42" },
      authorId: "alice",
      authorName: "Alice",
    });
    expect(layerB.comments[0]?.anchor).toEqual({
      kind: "element",
      elementId: "ex-42",
    });
  });
});
