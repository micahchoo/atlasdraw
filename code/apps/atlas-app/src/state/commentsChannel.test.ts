// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for CommentsChannel — extracted from
// state/collab.ts's CollabState class (DEADWOOD.md god-module split,
// collab.ts Cut 1). No test covered this concern directly before
// extraction — CollabState's own collab.test.ts only exercises the
// snapshot-pull machinery.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentsChannel } from "./commentsChannel";

const LOCAL_STORAGE_KEY = "atlasdraw:comments:local";

vi.mock("../config/app-config", () => ({
  getAppConfig: () => ({
    realtime: { enabled: true, wsUrl: "" },
  }),
}));

// Stub the global WebSocket so the real y-websocket WebsocketProvider
// constructed by connect() (no providerFactory injected, matching
// CollabState's own production call) doesn't attempt a real connection —
// same stub collab.test.ts installs for CollabState.connect().
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeEach(() => {
  localStorage.clear();
  (globalThis as { WebSocket: unknown }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket =
    originalWebSocket as unknown as typeof WebSocket;
});

describe("CommentsChannel — lazy local-only layer", () => {
  it("creates a local-only layer on first access, with no WebSocket provider", () => {
    const channel = new CommentsChannel();
    const layer = channel.layer;
    expect(layer).toBeTruthy();
    expect(layer.doc).toBeTruthy();
  });

  it("returns the same layer instance on repeated access", () => {
    const channel = new CommentsChannel();
    expect(channel.layer).toBe(channel.layer);
  });

  it("restores comments persisted to localStorage from a prior session", () => {
    const saved = [
      {
        id: "c1",
        authorId: "user-1",
        authorName: "Ari",
        text: "hello",
        createdAt: 0,
        resolved: false,
        anchor: { kind: "point", lng: 0, lat: 0 },
        schemaVersion: 1,
      },
    ];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(saved));

    const channel = new CommentsChannel();
    // The load path itself (JSON.parse + Y.Doc population) is what this test
    // locks — a parse throw would fail the `new CommentsChannel().layer`
    // call, and a successful restore surfaces the comment via the public
    // `comments` getter.
    expect(channel.layer.comments).toHaveLength(1);
    expect(channel.layer.comments[0].id).toBe("c1");
  });

  it("starts fresh (does not throw) when localStorage holds corrupt JSON", () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, "{not valid json");
    const channel = new CommentsChannel();
    expect(() => channel.layer).not.toThrow();
  });

  it("persists to localStorage when the layer's comments change", () => {
    const channel = new CommentsChannel();
    const layer = channel.layer;
    layer.addComment({
      text: "hi",
      anchor: { kind: "point", lng: 1, lat: 1 } as never,
      authorId: "user-1",
      authorName: "Ari",
    });

    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    expect(raw).not.toBeNull();
  });
});

describe("CommentsChannel — connect/disconnect", () => {
  it("replaces the local-only layer with a real one bound to the given room on connect()", () => {
    const channel = new CommentsChannel();
    const localLayer = channel.layer;

    channel.connect("http://localhost", "room-1", null);

    expect(channel.layer).not.toBe(localLayer);
  });

  it("destroys the prior layer when connect() replaces it", () => {
    const channel = new CommentsChannel();
    const localLayer = channel.layer;
    const destroySpy = vi.spyOn(localLayer, "destroy");

    channel.connect("http://localhost", "room-1", null);

    expect(destroySpy).toHaveBeenCalled();
  });

  it("disconnect() destroys the layer and clears it (a later access creates a fresh one)", () => {
    const channel = new CommentsChannel();
    channel.connect("http://localhost", "room-1", null);
    const connectedLayer = channel.layer;
    const destroySpy = vi.spyOn(connectedLayer, "destroy");

    channel.disconnect();

    expect(destroySpy).toHaveBeenCalled();
    expect(channel.layer).not.toBe(connectedLayer);
  });

  it("disconnect() is idempotent when connect() was never called", () => {
    const channel = new CommentsChannel();
    expect(() => channel.disconnect()).not.toThrow();
  });
});
