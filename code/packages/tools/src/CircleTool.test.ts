// packages/tools/src/CircleTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T09 — CircleTool unit tests.
//
// Verifies the CircleTool drag-preview lifecycle:
//   1. onPointerDown → two addElement calls (circle ellipse + companion text);
//      the text's data.circleId equals the circle's id.
//   2. onPointerMove → updateElement on both ids; circle's seed.data.radiusKm
//      is a positive number; text's data.text contains "km".
//   3. onPointerUp finalizes and clears internal state (next gesture starts
//      cleanly).
//
// Mocks model: ctx.excalidraw.addElement returns sequential ids; unproject
// returns scripted (lng,lat) per call so we can drive a deterministic gesture.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CircleTool } from "./CircleTool.js";

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
  addElement: ReturnType<typeof vi.fn>;
  updateElement: ReturnType<typeof vi.fn>;
}

/**
 * Build a ToolContext whose unproject returns a different (lng,lat) on each
 * call (scripted points), and whose addElement hands out incrementing ids.
 */
function makeCtx(points: Array<{ lng: number; lat: number }>): MockCtx {
  let i = 0;
  const unproject = vi.fn(() => {
    const p = points[Math.min(i, points.length - 1)];
    i++;
    return p;
  });

  let nextId = 1;
  const addElement = vi.fn((_seed: AtlasdrawElementSeed) => `el-${nextId++}`);
  const updateElement = vi.fn();

  const ctx: ToolContext = {
    map: {
      project: vi.fn(() => ({ x: 0, y: 0 })),
      unproject,
      getZoom: vi.fn(() => 12),
      getBounds: vi.fn(() => ({
        getNorth: () => 0,
        getSouth: () => 0,
        getEast: () => 0,
        getWest: () => 0,
      })),
    },
    excalidraw: {
      addElement,
      updateElement,
      getActiveTool: vi.fn(() => "circle"),
    },
    ui: {
      showPopup: vi.fn(),
      setStatusBarMessage: vi.fn(),
    },
  };

  return { ctx, unproject, addElement, updateElement };
}

describe("CircleTool", () => {
  // Each test starts a fresh gesture; module-level _state persists between
  // tests, but every test calls onPointerDown first which resets it.
  beforeEach(() => {
    // No global setup needed; onPointerDown owns initialization.
  });

  it("declares the contract surface (id, label, defaultScaleMode)", () => {
    expect(CircleTool.id).toBe("circle");
    expect(CircleTool.label).toBe("Circle");
    expect(CircleTool.icon).toBe("circle");
    expect(CircleTool.cursor).toBe("crosshair");
    expect(CircleTool.defaultScaleMode).toBe("geographic");
  });

  it("on pointer-down emits a circle ellipse seed at the center", () => {
    const { ctx, addElement } = makeCtx([{ lng: -73.98, lat: 40.75 }]);

    CircleTool.onPointerDown(makePointerEvent(), ctx);

    // First addElement is the circle.
    const circleSeed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(circleSeed.type).toBe("ellipse");
    expect(circleSeed.scaleMode).toBe("geographic");
    expect(circleSeed.geo.kind).toBe("point");
    if (circleSeed.geo.kind === "point") {
      expect(circleSeed.geo.lng).toBeCloseTo(-73.98);
      expect(circleSeed.geo.lat).toBeCloseTo(40.75);
    }
  });

  it("creates companion text element with km readout", () => {
    const { ctx, addElement } = makeCtx([{ lng: -73.98, lat: 40.75 }]);

    CircleTool.onPointerDown(makePointerEvent(), ctx);

    // Two addElement calls expected: [0] circle, [1] text companion.
    expect(addElement).toHaveBeenCalledTimes(2);
    const textSeed = addElement.mock.calls[1][0] as AtlasdrawElementSeed;
    expect(textSeed.type).toBe("text");
    expect(textSeed.scaleMode).toBe("screen");
    expect(typeof textSeed.data?.text).toBe("string");
    expect(textSeed.data?.text as string).toContain("km");
  });

  it("links text to circle via circleId in companion seed.data", () => {
    const { ctx, addElement } = makeCtx([{ lng: -73.98, lat: 40.75 }]);

    CircleTool.onPointerDown(makePointerEvent(), ctx);

    // addElement returned "el-1" for the circle; the text seed must reference it.
    const textSeed = addElement.mock.calls[1][0] as AtlasdrawElementSeed;
    expect(textSeed.data?.circleId).toBe("el-1");
  });

  it("attaches radiusKm to circle customData via seed.data on move", () => {
    // Center: NYC; edge: ~1.4 km east. Haversine should yield a positive km.
    const { ctx, updateElement } = makeCtx([
      { lng: -73.98, lat: 40.75 }, // pointer-down (center)
      { lng: -73.964, lat: 40.75 }, // pointer-move (edge)
    ]);

    if (!CircleTool.onPointerMove) {
      throw new Error("CircleTool.onPointerMove must be defined");
    }

    CircleTool.onPointerDown(makePointerEvent(), ctx);
    CircleTool.onPointerMove(makePointerEvent({ clientX: 100 }), ctx);

    // Two updateElement calls per move: [0] circle, [1] text.
    expect(updateElement).toHaveBeenCalled();
    // Find the circle update — it's the one with data.radiusKm.
    const circleUpdate = updateElement.mock.calls.find(
      (call) =>
        (call[1] as Partial<AtlasdrawElementSeed>).data?.radiusKm !== undefined,
    );
    expect(circleUpdate).toBeDefined();
    const patch = circleUpdate![1] as Partial<AtlasdrawElementSeed>;
    expect(typeof patch.data!.radiusKm).toBe("number");
    expect(patch.data!.radiusKm as number).toBeGreaterThan(0);
  });

  it("updates the text patch with a km readout containing 'km' on move", () => {
    const { ctx, updateElement } = makeCtx([
      { lng: -73.98, lat: 40.75 },
      { lng: -73.964, lat: 40.75 },
    ]);

    if (!CircleTool.onPointerMove) {
      throw new Error("CircleTool.onPointerMove must be defined");
    }

    CircleTool.onPointerDown(makePointerEvent(), ctx);
    CircleTool.onPointerMove(makePointerEvent({ clientX: 100 }), ctx);

    const textUpdate = updateElement.mock.calls.find(
      (call) =>
        typeof (call[1] as Partial<AtlasdrawElementSeed>).data?.text ===
        "string",
    );
    expect(textUpdate).toBeDefined();
    const patch = textUpdate![1] as Partial<AtlasdrawElementSeed>;
    expect(patch.data!.text as string).toContain("km");
    // Text should also carry the circleId link in updates (co-deletion source).
    expect(patch.data!.circleId).toBe("el-1");
  });

  it("on pointer-up finalizes and resets state (next gesture starts clean)", () => {
    if (!CircleTool.onPointerMove || !CircleTool.onPointerUp) {
      throw new Error(
        "CircleTool.onPointerMove and onPointerUp must be defined",
      );
    }

    // Gesture A
    const a = makeCtx([
      { lng: -73.98, lat: 40.75 },
      { lng: -73.96, lat: 40.75 },
      { lng: -73.95, lat: 40.75 },
    ]);
    CircleTool.onPointerDown(makePointerEvent(), a.ctx);
    CircleTool.onPointerMove(makePointerEvent(), a.ctx);
    CircleTool.onPointerUp(makePointerEvent(), a.ctx);

    // Gesture B — call onPointerMove WITHOUT a fresh down. State should be
    // null after up, so move is a no-op (no updateElement in B).
    const b = makeCtx([{ lng: 0, lat: 0 }]);
    CircleTool.onPointerMove(makePointerEvent(), b.ctx);
    expect(b.updateElement).not.toHaveBeenCalled();
  });
});
