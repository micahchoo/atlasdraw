// SPDX-License-Identifier: AGPL-3.0-only
// RT-3/RT-9 — tests for useCameraRotation.
//
// Driven against `FakeMercatorMap` (geoOpFuzz.harness), which models bearing
// with a real rotation matrix over real Web Mercator, rather than a stubbed
// `cameraRotation`. Two reasons. The hook's whole job is to report the
// *measured* rotation, so stubbing the measurement would leave nothing under
// test but a `useState`. And the sign relationship it inherits — a map at
// bearing θ shows east at screen angle −θ — is the one every other RT task
// agrees with; asserting it here is what keeps the compass needle and the
// annotations turning the same way.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

import { FakeMercatorMap } from "./geoOpFuzz.harness";
import { useCameraRotation } from "./useCameraRotation";

import type maplibregl from "maplibre-gl";

/**
 * A FakeMercatorMap that emits `rotate` the way MapLibre does, so the hook's
 * subscription is exercised rather than assumed.
 */
function makeMap(bearing = 0) {
  const fake = new FakeMercatorMap(4, { lng: 12, lat: 45 });
  fake.setBearing(bearing);
  const listeners = new Map<string, Set<() => void>>();

  const map = Object.assign(fake, {
    on(event: string, cb: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
    },
    off(event: string, cb: () => void) {
      listeners.get(event)?.delete(cb);
    },
  }) as unknown as maplibregl.Map;

  return {
    map,
    /** Turn the camera and emit, as a gesture would. */
    rotateTo(deg: number) {
      fake.setBearing(deg);
      for (const cb of listeners.get("rotate") ?? []) {
        cb();
      }
    },
    /** Emit without turning — MapLibre fires per frame through a drag. */
    emit() {
      for (const cb of listeners.get("rotate") ?? []) {
        cb();
      }
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

afterEach(() => {
  cleanup();
});

describe("useCameraRotation", () => {
  it("reports north-up when there is no map yet", () => {
    const { result } = renderHook(() => useCameraRotation(null));

    expect(result.current).toEqual({ degrees: 0, isRotated: false });
  });

  it("seeds from a map that is ALREADY turned, without waiting for an event", () => {
    // The gate must not render one frame as north-up and let a click through.
    const { map } = makeMap(30);

    const { result } = renderHook(() => useCameraRotation(map));

    expect(result.current.isRotated).toBe(true);
    expect(result.current.degrees).toBeCloseTo(-30, 6);
  });

  it("follows the camera when it turns", () => {
    const h = makeMap(0);
    const { result } = renderHook(() => useCameraRotation(h.map));
    expect(result.current.isRotated).toBe(false);

    act(() => h.rotateTo(90));

    expect(result.current.degrees).toBeCloseTo(-90, 6);
    expect(result.current.isRotated).toBe(true);
  });

  it("agrees with setCameraRotation's convention: east-angle is -bearing", () => {
    // The identity the compass depends on. If this flips, dragging the dial
    // turns the map the other way.
    for (const bearing of [-170, -33, 15, 45, 137, 179]) {
      const h = makeMap(bearing);
      const { result, unmount } = renderHook(() => useCameraRotation(h.map));
      expect(result.current.degrees).toBeCloseTo(-bearing, 6);
      unmount();
    }
  });

  it("snaps a hair off north to exactly north", () => {
    // resetNorth animates; its last frames are a hair off. A gate that
    // flickers back on a frame early is worse than one that rounds.
    const { map } = makeMap(0.001);

    const { result } = renderHook(() => useCameraRotation(map));

    expect(result.current).toEqual({ degrees: 0, isRotated: false });
  });

  it("treats a rotation a user can actually see as rotated", () => {
    const { map } = makeMap(0.5);

    const { result } = renderHook(() => useCameraRotation(map));

    expect(result.current.isRotated).toBe(true);
  });

  it("returns the same object when an event carries no change", () => {
    // `rotate` fires per frame through a drag. A fresh object every frame
    // re-renders the compass and the gate for nothing.
    const h = makeMap(45);
    const { result } = renderHook(() => useCameraRotation(h.map));
    const first = result.current;

    act(() => h.emit());

    expect(result.current).toBe(first);
  });

  it("unsubscribes on unmount", () => {
    const h = makeMap(0);
    const { unmount } = renderHook(() => useCameraRotation(h.map));
    expect(h.listenerCount("rotate")).toBe(1);

    unmount();

    expect(h.listenerCount("rotate")).toBe(0);
  });

  it("drops back to north-up, and off the old map, when the map goes away", () => {
    // Otherwise the last rotation stays stuck in state and holds the drawing
    // gate shut against a map that no longer exists.
    const h = makeMap(60);
    const { result, rerender } = renderHook(
      ({ map }: { map: maplibregl.Map | null }) => useCameraRotation(map),
      { initialProps: { map: h.map as maplibregl.Map | null } },
    );
    expect(result.current.isRotated).toBe(true);

    rerender({ map: null });

    expect(result.current).toEqual({ degrees: 0, isRotated: false });
    expect(h.listenerCount("rotate")).toBe(0);
  });

  it("subscribes to `rotate` only", () => {
    // Pitch is impossible (maxPitch: 0), and pan and zoom cannot change the
    // screen angle of east under Mercator. Subscribing to `move` would only
    // add re-renders.
    const h = makeMap(0);
    const on = vi.spyOn(h.map, "on");

    renderHook(() => useCameraRotation(h.map));

    expect(on.mock.calls.map((c) => c[0])).toEqual(["rotate"]);
  });
});
