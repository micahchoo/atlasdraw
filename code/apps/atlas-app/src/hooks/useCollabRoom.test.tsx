// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 collab integration — Step 5 tests.
//
// Verifies the hash → connect bridge:
//   1. Valid `#room:` fragment + active CollabState → connect() called.
//   2. Malformed `#room:` fragment → error state set, connect() NOT called.
//   3. collabState.active === false → no-op (no connect, no error).
//   4. Non-`#room:` hash → no-op resting state.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import * as protocol from "@atlasdraw/protocol";

import { useCollabRoom } from "./useCollabRoom";

type FakeCollab = {
  active: boolean;
  connect: ReturnType<typeof vi.fn>;
};

function fakeCollab(active: boolean): FakeCollab {
  return { active, connect: vi.fn() };
}

function setHash(hash: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hash },
    writable: true,
    configurable: true,
  });
}

describe("useCollabRoom", () => {
  beforeEach(() => {
    setHash("");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("calls connect() when hash is a valid #room: fragment and collab is active", async () => {
    const stubKey = { type: "secret" } as unknown as CryptoKey;
    const parseSpy = vi.spyOn(protocol, "parseRoomFragment").mockResolvedValue({
      roomId: "test-room-id",
      key: stubKey,
    });
    setHash("#room:test-room-id,AAAA");
    const collab = fakeCollab(true);

    const { result } = renderHook(() =>
      useCollabRoom(collab as unknown as import("../state/collab").CollabState),
    );

    await waitFor(() => {
      expect(parseSpy).toHaveBeenCalledWith("#room:test-room-id,AAAA");
    });
    await waitFor(() => {
      expect(collab.connect).toHaveBeenCalledWith("test-room-id", stubKey);
    });
    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });
    expect(result.current.error).toBeNull();
  });

  it("sets error state when the #room: fragment is malformed", async () => {
    vi.spyOn(protocol, "parseRoomFragment").mockResolvedValue(null);
    setHash("#room:malformed");
    const collab = fakeCollab(true);

    const { result } = renderHook(() =>
      useCollabRoom(collab as unknown as import("../state/collab").CollabState),
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Invalid room link");
    });
    expect(collab.connect).not.toHaveBeenCalled();
    expect(result.current.isConnecting).toBe(false);
  });

  it("is a no-op when collab.active === false (single-player mode)", async () => {
    const parseSpy = vi.spyOn(protocol, "parseRoomFragment");
    setHash("#room:rid,AAAA");
    const collab = fakeCollab(false);

    const { result } = renderHook(() =>
      useCollabRoom(collab as unknown as import("../state/collab").CollabState),
    );

    // Give microtasks a chance to flush (none should fire).
    await Promise.resolve();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(collab.connect).not.toHaveBeenCalled();
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("is a no-op when hash is not a room fragment", async () => {
    const parseSpy = vi.spyOn(protocol, "parseRoomFragment");
    setHash("#v1:something-else");
    const collab = fakeCollab(true);

    const { result } = renderHook(() =>
      useCollabRoom(collab as unknown as import("../state/collab").CollabState),
    );

    await Promise.resolve();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(collab.connect).not.toHaveBeenCalled();
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
