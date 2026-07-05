// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useCoordinateSync (ISSUES.md Issue 6 — coverage climb, priority 1).
//
// This is the wiring hook for Flow A Step 2: MapLibre camera events →
// [throttle 16ms] → CoordinateSync.syncMapToScene(). CoordinateSync's own
// projection math (_projectElement) is covered elsewhere via its consumers
// (useGeoAnchor.test.ts exercises the shared geo/projection primitives); this
// file tests the WIRING the hook itself owns: null-safety, listener
// attach/detach symmetry, throttle behavior, and cleanup ordering.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { CoordinateSync } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useCoordinateSync } from "./useCoordinateSync";

import type maplibregl from "maplibre-gl";

vi.mock("@atlasdraw/basemap", () => {
  const instances: Array<{
    attach: Mock;
    detach: Mock;
    syncMapToScene: Mock;
  }> = [];
  const CoordinateSync = vi.fn(function (this: unknown) {
    const instance = {
      attach: vi.fn(),
      detach: vi.fn(),
      syncMapToScene: vi.fn(),
    };
    instances.push(instance);
    Object.assign(this as object, instance);
  });
  (CoordinateSync as unknown as { __instances: typeof instances }).__instances =
    instances;
  return { CoordinateSync };
});

function makeMockMap(): maplibregl.Map & { on: Mock; off: Mock } {
  return {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 10),
  } as unknown as maplibregl.Map & { on: Mock; off: Mock };
}

function makeMockExcalidrawAPI(): ExcalidrawImperativeAPI {
  return {
    getSceneElements: vi.fn(() => []),
    updateScene: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
}

function lastInstance() {
  const instances = (
    CoordinateSync as unknown as {
      __instances: Array<{
        attach: Mock;
        detach: Mock;
        syncMapToScene: Mock;
      }>;
    }
  ).__instances;
  const instance = instances[instances.length - 1];
  if (!instance) {
    throw new Error("no CoordinateSync instance constructed");
  }
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  (
    CoordinateSync as unknown as { __instances: unknown[] }
  ).__instances.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCoordinateSync", () => {
  it("does nothing when map is null", () => {
    const api = makeMockExcalidrawAPI();
    const { result } = renderHook(() => useCoordinateSync(null, api));
    expect(CoordinateSync).not.toHaveBeenCalled();
    expect(result.current.syncNow).toBeNull();
  });

  it("does nothing when excalidrawAPI is null", () => {
    const map = makeMockMap();
    const { result } = renderHook(() => useCoordinateSync(map, null));
    expect(CoordinateSync).not.toHaveBeenCalled();
    expect(result.current.syncNow).toBeNull();
    expect(map.on).not.toHaveBeenCalled();
  });

  it("constructs CoordinateSync and attaches once both map and api are present", () => {
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    renderHook(() => useCoordinateSync(map, api));
    expect(CoordinateSync).toHaveBeenCalledTimes(1);
    expect(CoordinateSync).toHaveBeenCalledWith({ map, excalidrawAPI: api });
    expect(lastInstance().attach).toHaveBeenCalledTimes(1);
  });

  it("registers all four camera events with the same handler reference", () => {
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    renderHook(() => useCoordinateSync(map, api));
    const calls = (map.on as Mock).mock.calls as Array<[string, unknown]>;
    const events = calls.map(([event]) => event);
    expect(events.sort()).toEqual(["move", "pitch", "rotate", "zoom"]);
    const handlers = new Set(calls.map(([, handler]) => handler));
    expect(handlers.size).toBe(1);
  });

  it("throttles syncMapToScene: leading call fires immediately, rapid repeats collapse", () => {
    vi.useFakeTimers();
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    renderHook(() => useCoordinateSync(map, api));
    const handler = (map.on as Mock).mock.calls[0][1] as () => void;

    handler(); // leading edge — fires immediately
    expect(lastInstance().syncMapToScene).toHaveBeenCalledTimes(1);

    handler(); // inside the 16ms window — queued as trailing, not immediate
    handler();
    expect(lastInstance().syncMapToScene).toHaveBeenCalledTimes(1);
  });

  it("throttles syncMapToScene: trailing call fires once the window elapses", async () => {
    vi.useFakeTimers();
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    renderHook(() => useCoordinateSync(map, api));
    const handler = (map.on as Mock).mock.calls[0][1] as () => void;

    handler();
    handler();
    expect(lastInstance().syncMapToScene).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(16);
    expect(lastInstance().syncMapToScene).toHaveBeenCalledTimes(2);
  });

  it("cancels the pending trailing call and detaches on unmount, before removing listeners", () => {
    vi.useFakeTimers();
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    const { unmount } = renderHook(() => useCoordinateSync(map, api));
    const handler = (map.on as Mock).mock.calls[0][1] as () => void;
    const instance = lastInstance();

    handler();
    handler(); // second call queued as a trailing invocation

    unmount();

    // Trailing call must never fire post-unmount.
    vi.advanceTimersByTime(100);
    expect(instance.syncMapToScene).toHaveBeenCalledTimes(1);

    expect(map.off).toHaveBeenCalledTimes(4);
    const offEvents = (map.off as Mock).mock.calls.map(([event]) => event);
    expect(offEvents.sort()).toEqual(["move", "pitch", "rotate", "zoom"]);
    expect(instance.detach).toHaveBeenCalledTimes(1);
  });

  it("re-creates CoordinateSync only when the (map, api) tuple changes", () => {
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    const { rerender } = renderHook(({ m, a }) => useCoordinateSync(m, a), {
      initialProps: { m: map, a: api },
    });
    expect(CoordinateSync).toHaveBeenCalledTimes(1);

    // Same references — no re-construction.
    rerender({ m: map, a: api });
    expect(CoordinateSync).toHaveBeenCalledTimes(1);

    // New map reference — re-constructs and detaches the old instance.
    const newMap = makeMockMap();
    const oldInstance = lastInstance();
    rerender({ m: newMap, a: api });
    expect(CoordinateSync).toHaveBeenCalledTimes(2);
    expect(oldInstance.detach).toHaveBeenCalledTimes(1);
  });

  it("syncNow calls the memoized instance's syncMapToScene directly (untouched by throttle)", () => {
    const map = makeMockMap();
    const api = makeMockExcalidrawAPI();
    const { result } = renderHook(() => useCoordinateSync(map, api));
    result.current.syncNow?.();
    expect(lastInstance().syncMapToScene).toHaveBeenCalledTimes(1);
  });
});
