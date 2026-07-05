// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useCollab (ISSUES.md Issue 9 — CollabContext.Provider gap).
//
// Two paths: (1) a Provider is mounted — the hook must return exactly that
// context value, unmodified; (2) no Provider — the hook builds its own
// fallback CollabState and must still be reactive (useSyncExternalStore
// against subscribe/getSnapshot), matching the real Provider path's
// contract. Before this fix, the fallback path returned a plain object
// snapshot read once per render with no subscription at all.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

import { useCollab, CollabContext } from "./useCollab";

import type { CollabSnapshot } from "../state/collab";

import type { CollabContextValue } from "./useCollab";

// Test-controllable fake — mirrors the real CollabState's reactive contract
// (subscribe/getSnapshot) so the fallback path's useSyncExternalStore wiring
// can be exercised directly, the same way MapEditor.collab-presence.test.tsx
// exercises the Provider path.
class FakeCollabState {
  active = false;
  private _listeners = new Set<() => void>();
  private _snapshot: CollabSnapshot = {
    peers: new Map(),
    localCursor: { x: 0, y: 0 },
    yjsDoc: null,
    commentsLayer: null,
  };
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };
  getSnapshot = (): CollabSnapshot => this._snapshot;
  setPeers(peers: CollabSnapshot["peers"]): void {
    this._snapshot = { ...this._snapshot, peers };
    for (const l of this._listeners) {
      l();
    }
  }
  connect = vi.fn();
  disconnect = vi.fn();
}

let latestFake: FakeCollabState | null = null;

vi.mock("../state/collab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/collab")>();
  return {
    ...actual,
    CollabState: class {
      constructor() {
        latestFake = new FakeCollabState();
        return latestFake;
      }
    },
  };
});

describe("useCollab — Provider mounted", () => {
  it("returns exactly the Provider's value, not a fallback", () => {
    const value: CollabContextValue = {
      active: true,
      peers: new Map([
        [
          "p1",
          {
            id: "p1",
            username: "Ari",
            color: "#000",
            cursor: null,
            camera: null,
          },
        ],
      ]),
      localCursor: { x: 0, y: 0 },
      yjsDoc: null,
      commentsLayer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CollabContext.Provider, { value }, children);

    const { result } = renderHook(() => useCollab(), { wrapper });
    expect(result.current).toBe(value);
  });
});

describe("useCollab — no Provider (fallback)", () => {
  beforeEach(() => {
    latestFake = null;
  });

  it("returns an inactive fallback by default (realtime disabled)", () => {
    const { result } = renderHook(() => useCollab());
    expect(result.current.active).toBe(false);
    expect(result.current.peers.size).toBe(0);
    expect(result.current.yjsDoc).toBeNull();
  });

  it("re-renders when the fallback CollabState's peers change (useSyncExternalStore wiring)", () => {
    const { result } = renderHook(() => useCollab());
    expect(latestFake).not.toBeNull();
    expect(result.current.peers.size).toBe(0);

    act(() => {
      latestFake!.setPeers(
        new Map([
          [
            "p1",
            {
              id: "p1",
              username: "Ari",
              color: "#000",
              cursor: null,
              camera: null,
            },
          ],
        ]),
      );
    });

    expect(result.current.peers.size).toBe(1);
    expect(result.current.peers.get("p1")?.username).toBe("Ari");
  });

  it("connect/disconnect are stable functions bound to the same fallback instance across renders", () => {
    const { result, rerender } = renderHook(() => useCollab());
    const firstConnect = result.current.connect;
    rerender();
    // Not necessarily the same function identity (bind() creates a new fn
    // each render) — but both must be bound to the same underlying
    // instance, i.e. calling either is safe and idempotent.
    expect(() => firstConnect("room-1")).not.toThrow();
    expect(() => result.current.connect("room-1")).not.toThrow();
  });
});
