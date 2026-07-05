// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for YjsChannel — extracted from state/collab.ts's
// CollabState class (DEADWOOD.md god-module split, collab.ts Cut 2). No
// test covered this concern directly before extraction — CollabState's own
// collab.test.ts only exercises the snapshot-pull machinery.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { YjsChannel } from "./yjsChannel";

// Stub the global WebSocket so connect()'s `new WebSocket(...)` doesn't
// attempt a real connection — same stub collab.test.ts installs.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  close(): void {
    this.readyState = 3;
  }
}

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket =
    originalWebSocket as unknown as typeof WebSocket;
});

describe("YjsChannel — connect/disconnect", () => {
  it("has no doc before connect()", () => {
    const channel = new YjsChannel();
    expect(channel.doc).toBeNull();
  });

  it("creates a Y.Doc on connect()", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    expect(channel.doc).not.toBeNull();
  });

  it("destroys the doc and returns null on disconnect()", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    channel.disconnect();
    expect(channel.doc).toBeNull();
  });

  it("disconnect() is idempotent when connect() was never called", () => {
    const channel = new YjsChannel();
    expect(() => channel.disconnect()).not.toThrow();
  });

  it("a fresh connect() after disconnect() produces a new doc", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    const firstDoc = channel.doc;
    channel.disconnect();
    channel.connect("ws://localhost", "room-2");
    expect(channel.doc).not.toBeNull();
    expect(channel.doc).not.toBe(firstDoc);
  });
});

describe("YjsChannel — undo manager", () => {
  it("has no undoManager before attachUndo()", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    expect(channel.undoManager).toBeNull();
  });

  it("creates the undoManager once attachUndo() is called after connect()", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    channel.attachUndo("socket-id-1");
    expect(channel.undoManager).not.toBeNull();
  });

  it("no-ops when attachUndo() is called before connect() (no doc yet)", () => {
    const channel = new YjsChannel();
    channel.attachUndo("socket-id-1");
    expect(channel.undoManager).toBeNull();
  });

  it("clears the undoManager on disconnect()", () => {
    const channel = new YjsChannel();
    channel.connect("ws://localhost", "room-1");
    channel.attachUndo("socket-id-1");
    channel.disconnect();
    expect(channel.undoManager).toBeNull();
  });
});
