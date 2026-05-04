// packages/tools/src/PolylineTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T04 — PolylineTool unit tests.
//
// Mocks `ToolContext` and `ToolPointerEvent`; verifies that successive
// pointerdowns accumulate vertices, that finalize-on-double-click emits a
// single open-path seed (first !== last), and that Escape finalizes the same
// way without ring closure. PolygonTool's closure contract must NOT leak in.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolylineTool } from "./PolylineTool.js";
import type {
  AtlasdrawElementSeed,
  ToolContext,
  ToolPointerEvent,
} from "./types.js";

/**
 * Minimal KeyboardEvent stand-in. The tool only reads `.key`; the test
 * environment is `node` (no DOM globals), so we cast a plain object rather
 * than depend on a JSDOM env switch.
 */
function makeKey(key: string): KeyboardEvent {
  return { key } as unknown as KeyboardEvent;
}

function makePointerEvent(
  overrides: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

interface MockCtx {
  ctx: ToolContext;
  unproject: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  addElement: ReturnType<typeof vi.fn>;
}

/**
 * Build a ctx whose unproject returns a deterministic (lng, lat) per click —
 * `lng = clientX / 10`, `lat = clientY / 10`. Lets the test assert exact
 * coordinate ordering without coupling to a real projection.
 */
function makeCtx(opts: { zoom?: number } = {}): MockCtx {
  const zoom = opts.zoom ?? 12;

  const unproject = vi.fn((point: [number, number]) => ({
    lng: point[0] / 10,
    lat: point[1] / 10,
  }));
  const getZoom = vi.fn(() => zoom);
  const addElement = vi.fn((_seed: AtlasdrawElementSeed) => "el-1");

  const ctx: ToolContext = {
    map: {
      project: vi.fn(() => ({ x: 0, y: 0 })),
      unproject,
      getZoom,
      getBounds: vi.fn(() => ({
        getNorth: () => 0,
        getSouth: () => 0,
        getEast: () => 0,
        getWest: () => 0,
      })),
    },
    excalidraw: {
      addElement,
      updateElement: vi.fn(),
      getActiveTool: vi.fn(() => "selection"),
    },
    ui: {
      showPopup: vi.fn(),
      setStatusBarMessage: vi.fn(),
    },
  };

  return { ctx, unproject, getZoom, addElement };
}

describe("PolylineTool", () => {
  beforeEach(() => {
    // Drain any module-local state from a prior test (Escape commits/aborts).
    // PolylineTool's reset is internal; the public seam to drain is Escape
    // with insufficient vertices, which is a no-op when state is already empty.
    PolylineTool.onKeyDown?.(makeKey("Escape"), makeCtx().ctx);
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it("declares the static tool contract fields", () => {
    expect(PolylineTool.id).toBe("polyline");
    expect(PolylineTool.label).toBe("Polyline");
    expect(PolylineTool.icon).toBe("polyline");
    expect(PolylineTool.cursor).toBe("crosshair");
    expect(PolylineTool.defaultScaleMode).toBe("geographic");
  });

  it("accumulates vertices and finalizes on double-click without closing ring", () => {
    const { ctx, addElement } = makeCtx({ zoom: 12 });

    // Three vertex clicks at different coords — each is a distinct pointerdown
    // with a non-double-click gap in between.
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 100, clientY: 200 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 100, clientY: 200 }), ctx);

    vi.setSystemTime(1000); // > 300ms gap, so this isn't a double-click
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 300, clientY: 400 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 300, clientY: 400 }), ctx);

    vi.setSystemTime(2000);
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 500, clientY: 600 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 500, clientY: 600 }), ctx);

    expect(addElement).not.toHaveBeenCalled();

    // Double-click: second pointerdown+up within 300ms of the previous up.
    vi.setSystemTime(2050); // 50ms gap < 300ms = double-click
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 500, clientY: 600 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 500, clientY: 600 }), ctx);

    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;

    expect(seed.type).toBe("line");
    expect(seed.scaleMode).toBe("geographic");
    expect(seed.geo.kind).toBe("polyline");

    // Critical open-path invariant: first and last vertices must differ —
    // PolygonTool would close the ring; PolylineTool must not.
    const coords = (seed.geo as { coordinates: Array<[number, number]> }).coordinates;
    expect(coords.length).toBeGreaterThanOrEqual(2);
    expect(coords[0]).not.toEqual(coords[coords.length - 1]);
    // First vertex is the very first click.
    expect(coords[0]).toEqual([10, 20]);
  });

  it("finalizes on Escape key without closing ring", () => {
    const { ctx, addElement } = makeCtx();

    PolylineTool.onPointerDown(makePointerEvent({ clientX: 100, clientY: 100 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 100, clientY: 100 }), ctx);
    vi.setSystemTime(1000);
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 200, clientY: 200 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 200, clientY: 200 }), ctx);
    vi.setSystemTime(2000);
    PolylineTool.onPointerDown(makePointerEvent({ clientX: 300, clientY: 300 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 300, clientY: 300 }), ctx);

    PolylineTool.onKeyDown?.(makeKey("Escape"), ctx);

    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;

    expect(seed.type).toBe("line");
    expect(seed.geo.kind).toBe("polyline");

    const coords = (seed.geo as { coordinates: Array<[number, number]> }).coordinates;
    expect(coords).toEqual([
      [10, 10],
      [20, 20],
      [30, 30],
    ]);
    // Open-path invariant: not closed.
    expect(coords[0]).not.toEqual(coords[coords.length - 1]);
  });

  it("Escape with fewer than 2 vertices abandons without emitting", () => {
    const { ctx, addElement } = makeCtx();

    PolylineTool.onPointerDown(makePointerEvent({ clientX: 100, clientY: 100 }), ctx);
    PolylineTool.onPointerUp?.(makePointerEvent({ clientX: 100, clientY: 100 }), ctx);

    PolylineTool.onKeyDown?.(makeKey("Escape"), ctx);

    expect(addElement).not.toHaveBeenCalled();
  });
});
