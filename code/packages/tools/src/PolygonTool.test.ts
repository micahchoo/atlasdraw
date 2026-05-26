// packages/tools/src/PolygonTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T03 — PolygonTool unit tests.
//
// Mocks `ToolContext` + `ToolPointerEvent`. Drives PolygonTool through:
//   - vertex accumulation (no commit until double-click)
//   - double-click commit produces ONE addElement call with a closed
//     polyline (first==last) and scaleMode:"geographic"
//   - delayed second click (>300ms) does NOT commit
// Resets the tool-local singleton draft between tests.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { PolygonTool, __resetPolygonDraftForTests } from "./PolygonTool.js";

import type {
  AtlasdrawElementSeed,
  ToolContext,
  ToolPointerEvent,
} from "./types.js";

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
 * Builds a ToolContext whose `unproject` returns a sequence of preset
 * lng/lat pairs in call order. Tests assert on the exact ring contents,
 * so we want full control over what each click projects to.
 */
function makeCtx(
  opts: { lngLats?: Array<[number, number]>; zoom?: number } = {},
): MockCtx {
  const lngLats = opts.lngLats ?? [
    [-73.98, 40.75],
    [-73.97, 40.76],
    [-73.96, 40.74],
  ];
  const zoom = opts.zoom ?? 12;

  let callIdx = 0;
  const unproject = vi.fn(() => {
    const i = Math.min(callIdx, lngLats.length - 1);
    callIdx += 1;
    const [lng, lat] = lngLats[i];
    return { lng, lat };
  });

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
      getActiveTool: vi.fn(() => "polygon"),
    },
    ui: {
      showPopup: vi.fn(),
      setStatusBarMessage: vi.fn(),
    },
  };

  return { ctx, unproject, getZoom, addElement };
}

beforeEach(() => {
  __resetPolygonDraftForTests();
  vi.useRealTimers();
});

describe("PolygonTool", () => {
  it("accumulates vertices on pointerDown and closes ring on double-click", () => {
    const lngLats: Array<[number, number]> = [
      [-73.98, 40.75], // v0
      [-73.97, 40.76], // v1
      [-73.96, 40.74], // v2
      // Fourth unproject call corresponds to the double-click second
      // click. PolygonTool consumes the close-gesture click WITHOUT
      // calling unproject (it short-circuits in the double-click branch),
      // so this slot is intentionally never read.
    ];
    const { ctx, addElement, unproject } = makeCtx({ lngLats, zoom: 12 });

    const dateSpy = vi.spyOn(Date, "now");

    // Three single clicks, well-separated in time so none triggers the
    // double-click window.
    dateSpy.mockReturnValue(1_000);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 100, clientY: 100 }),
      ctx,
    );

    dateSpy.mockReturnValue(2_000);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 200, clientY: 100 }),
      ctx,
    );

    dateSpy.mockReturnValue(3_000);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 200, clientY: 200 }),
      ctx,
    );

    // No commit yet.
    expect(addElement).not.toHaveBeenCalled();

    // Fourth click within DOUBLE_CLICK_MS (300ms) of the third — closes.
    dateSpy.mockReturnValue(3_100);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 200, clientY: 200 }),
      ctx,
    );

    expect(addElement).toHaveBeenCalledTimes(1);

    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.type).toBe("freedraw");
    expect(seed.scaleMode).toBe("geographic");
    expect(seed.geo.kind).toBe("polyline");

    if (seed.geo.kind !== "polyline") {
      throw new Error("unreachable");
    }
    const coords = seed.geo.coordinates;

    // Three accumulated vertices + closing copy of v0 = 4 entries.
    expect(coords).toHaveLength(4);
    expect(coords[0]).toEqual([-73.98, 40.75]);
    expect(coords[1]).toEqual([-73.97, 40.76]);
    expect(coords[2]).toEqual([-73.96, 40.74]);
    // Closed ring invariant: first == last.
    expect(coords[coords.length - 1]).toEqual(coords[0]);

    expect(seed.geo.zRef).toBe(12);

    // unproject was called exactly 3 times (once per accumulating click;
    // the closing double-click click is consumed by the close branch
    // before unproject is reached).
    expect(unproject).toHaveBeenCalledTimes(3);

    dateSpy.mockRestore();
  });

  it("does not commit on single click + delay > 300ms", () => {
    const { ctx, addElement } = makeCtx();
    const dateSpy = vi.spyOn(Date, "now");

    dateSpy.mockReturnValue(1_000);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 50, clientY: 50 }),
      ctx,
    );

    // Second click well outside the 300ms window — must NOT close.
    dateSpy.mockReturnValue(1_500);
    PolygonTool.onPointerDown(
      makePointerEvent({ clientX: 60, clientY: 60 }),
      ctx,
    );

    expect(addElement).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });

  it("declares stable id/label/icon/cursor/defaultScaleMode metadata", () => {
    expect(PolygonTool.id).toBe("polygon");
    expect(PolygonTool.label).toBe("Polygon");
    expect(PolygonTool.icon).toBe("polygon");
    expect(PolygonTool.cursor).toBe("crosshair");
    expect(PolygonTool.defaultScaleMode).toBe("geographic");
  });
});
