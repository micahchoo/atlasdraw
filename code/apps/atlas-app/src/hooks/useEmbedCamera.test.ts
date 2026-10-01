// SPDX-License-Identifier: AGPL-3.0-only
// The embed's camera: lock, cooperative gestures, and the fit on load.
//
// The fake map below keeps the state the hook changes: which gesture
// handlers are on, whether cooperative gestures are on, and every fit. Its
// events fire synchronously, as MapLibre's do.

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LngLatBox } from "@atlasdraw/geo";

import { useEmbedCamera, type EmbedMap } from "./useEmbedCamera";

import type { EmbedOptions } from "../lib/embed";

function handler(on = true) {
  const h = {
    on,
    enable: () => {
      h.on = true;
    },
    disable: () => {
      h.on = false;
    },
    isEnabled: () => h.on,
  };
  return h;
}

function fakeMap() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const fits: {
    box: [[number, number], [number, number]];
    duration: number;
  }[] = [];
  const map = {
    dragPan: handler(),
    scrollZoom: handler(),
    boxZoom: handler(),
    dragRotate: handler(),
    keyboard: handler(),
    doubleClickZoom: handler(),
    touchZoomRotate: handler(),
    touchPitch: handler(),
    cooperativeGestures: handler(false),
    fitBounds: (
      box: [[number, number], [number, number]],
      opts: { duration: number },
    ) => {
      fits.push({ box, duration: opts.duration });
    },
    on: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(fn);
    },
    off: (type: string, fn: (e: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type: string, e: unknown = {}) => {
      for (const fn of listeners.get(type) ?? []) {
        fn(e);
      }
    },
    fits,
  };
  return map;
}

const BOX: LngLatBox = { west: 9, south: 48, east: 12, north: 51 };
const opts = (o: Partial<EmbedOptions> = {}): EmbedOptions => ({
  lock: false,
  legend: false,
  view: "fit",
  ...o,
});

describe("useEmbedCamera", () => {
  it("an unlocked embed zooms only with Ctrl or ⌘ and pans with two fingers", () => {
    const map = fakeMap();
    const { unmount } = renderHook(() =>
      useEmbedCamera(map as unknown as EmbedMap, opts(), null),
    );
    expect(map.cooperativeGestures.on).toBe(true);
    // The map still moves: the gestures are on, behind the modifier.
    expect(map.scrollZoom.on).toBe(true);
    expect(map.dragPan.on).toBe(true);
    unmount();
    expect(map.cooperativeGestures.on).toBe(false);
  });

  it("a locked embed turns every gesture off, and back on when unlocked", () => {
    const map = fakeMap();
    const { rerender } = renderHook(
      ({ o }) => useEmbedCamera(map as unknown as EmbedMap, o, null),
      { initialProps: { o: opts({ lock: true }) } },
    );
    for (const h of [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ]) {
      expect(h.on).toBe(false);
    }
    // Nothing to cooperate with: the page scrolls through a locked map.
    expect(map.cooperativeGestures.on).toBe(false);

    rerender({ o: opts() });
    expect(map.scrollZoom.on).toBe(true);
    expect(map.cooperativeGestures.on).toBe(true);
    // The embed has no compass: rotation stays off.
    expect(map.dragRotate.on).toBe(false);
  });

  it("fits the content at once on load, with no animation", () => {
    const map = fakeMap();
    renderHook(() => useEmbedCamera(map as unknown as EmbedMap, opts(), BOX));
    expect(map.fits).toEqual([
      {
        box: [
          [9, 48],
          [12, 51],
        ],
        duration: 0,
      },
    ]);
  });

  it("fits again when the frame changes size, until the reader moves the map", () => {
    const map = fakeMap();
    renderHook(() => useEmbedCamera(map as unknown as EmbedMap, opts(), BOX));
    map.fire("resize");
    expect(map.fits).toHaveLength(2);
    // A move with an input event is the reader's; a fit has none.
    map.fire("movestart", {});
    map.fire("resize");
    expect(map.fits).toHaveLength(3);
    map.fire("movestart", { originalEvent: new Event("wheel") });
    map.fire("resize");
    expect(map.fits).toHaveLength(3);
  });

  it("keeps the saved view with view=saved, and when the map has no content", () => {
    const saved = fakeMap();
    renderHook(() =>
      useEmbedCamera(
        saved as unknown as EmbedMap,
        opts({ view: "saved" }),
        BOX,
      ),
    );
    const empty = fakeMap();
    renderHook(() =>
      useEmbedCamera(empty as unknown as EmbedMap, opts(), null),
    );
    saved.fire("resize");
    empty.fire("resize");
    expect(saved.fits).toEqual([]);
    expect(empty.fits).toEqual([]);
  });
});
