// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useMapWheelRouter (ISSUES.md Issue 6 — coverage climb).
//
// Intercepts wheel events on a container and routes them to map.easeTo with
// the canonical scrollZoom delta math, so scroll-to-zoom keeps working even
// when the Excalidraw layer is capturing pointer events on top of the map.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useMapWheelRouter } from "./useMapWheelRouter";

import type maplibregl from "maplibre-gl";

function makeMockMap(zoom = 10) {
  return {
    getZoom: vi.fn(() => zoom),
    getCanvas: vi.fn(() => ({
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    })),
    unproject: vi.fn(([x, y]: [number, number]) => ({ lng: x, lat: y })),
    easeTo: vi.fn(),
  } as unknown as maplibregl.Map & {
    getZoom: ReturnType<typeof vi.fn>;
    unproject: ReturnType<typeof vi.fn>;
    easeTo: ReturnType<typeof vi.fn>;
  };
}

function fireWheel(
  target: HTMLElement,
  init: Partial<WheelEventInit> = {},
): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
    clientX: 50,
    clientY: 60,
    ...init,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");
  const stopPropagation = vi.spyOn(event, "stopPropagation");
  const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");
  target.dispatchEvent(event);
  Object.assign(event, {
    __preventDefault: preventDefault,
    __stopPropagation: stopPropagation,
    __stopImmediatePropagation: stopImmediatePropagation,
  });
  return event;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useMapWheelRouter", () => {
  it("does nothing when container is null", () => {
    const map = makeMockMap();
    renderHook(() => useMapWheelRouter(null, map));
    // No listener to attach to — nothing to assert on the container, but
    // confirm the hook doesn't throw and map is untouched.
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("does nothing when map is null", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderHook(() => useMapWheelRouter(container, null));
    fireWheel(container);
    // No map to call easeTo on; event should pass through untouched.
  });

  it("routes a plain wheel event to map.easeTo with the canonical zoom delta", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap(10);
    renderHook(() => useMapWheelRouter(container, map));

    const event = fireWheel(container, { deltaY: 100 });
    expect(
      (event as unknown as { __preventDefault: ReturnType<typeof vi.fn> })
        .__preventDefault,
    ).toHaveBeenCalled();
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const call = map.easeTo.mock.calls[0][0];
    // zoomDelta = -100 * 0.0035 = -0.35; new zoom = 10 - 0.35 = 9.65
    expect(call.zoom).toBeCloseTo(9.65);
    expect(call.duration).toBe(0);
    expect(call.around).toEqual({ lng: 40, lat: 40 }); // clientX-left=40, clientY-top=40
  });

  it("scales deltaY by LINE_HEIGHT_PX when deltaMode is DOM_DELTA_LINE", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap(10);
    renderHook(() => useMapWheelRouter(container, map));

    fireWheel(container, { deltaY: 2, deltaMode: 1 });
    // deltaY = 2 * 25 = 50; zoomDelta = -50 * 0.0035 = -0.175
    const call = map.easeTo.mock.calls[0][0];
    expect(call.zoom).toBeCloseTo(9.825);
  });

  it("lets ctrl+wheel pass through untouched (browser pinch-zoom)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap();
    renderHook(() => useMapWheelRouter(container, map));

    const event = fireWheel(container, { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("lets meta+wheel pass through untouched (macOS pinch-zoom)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap();
    renderHook(() => useMapWheelRouter(container, map));

    const event = fireWheel(container, { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("intercepts shift+wheel as map zoom (deliberate atlasdraw semantic)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap();
    renderHook(() => useMapWheelRouter(container, map));

    fireWheel(container, { shiftKey: true });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });

  it("removes the wheel listener on unmount", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = makeMockMap();
    const { unmount } = renderHook(() => useMapWheelRouter(container, map));
    unmount();
    fireWheel(container);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("re-attaches when the (container, map) pair changes", () => {
    const containerA = document.createElement("div");
    const containerB = document.createElement("div");
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ container }) => useMapWheelRouter(container, map),
      { initialProps: { container: containerA as HTMLElement | null } },
    );

    rerender({ container: containerB });
    fireWheel(containerA); // old container no longer listened to
    expect(map.easeTo).not.toHaveBeenCalled();
    fireWheel(containerB);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });
});
