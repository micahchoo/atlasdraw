// packages/tools/src/ArrowTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b T07 — ArrowTool unit tests.
//
// Tests the drag-preview pattern: pointerdown emits an initial seed via
// addElement (capturing the returned id), pointermove patches the head via
// updateElement, pointerup commits the final head and clears state. Asserts
// the second drag works independently to prove state-clear on up.

import { describe, it, expect, vi } from "vitest";

import { ArrowTool } from "./ArrowTool.js";

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
  updateElement: ReturnType<typeof vi.fn>;
}

/**
 * Build a mock ToolContext where `unproject` returns a different lng/lat per
 * call so we can distinguish tail (down) from head (move/up) frames in the
 * captured patches. Caller queues the (lng,lat) pairs to return.
 */
function makeCtx(
  pts: Array<{ lng: number; lat: number }>,
  opts: { zoom?: number; addElementId?: string } = {},
): MockCtx {
  const zoom = opts.zoom ?? 10;
  const id = opts.addElementId ?? "arrow-elem-1";
  let i = 0;

  const unproject = vi.fn(() => {
    const p = pts[i] ?? pts[pts.length - 1];
    i += 1;
    return p;
  });
  const getZoom = vi.fn(() => zoom);
  const addElement = vi.fn((_seed: AtlasdrawElementSeed) => id);
  const updateElement = vi.fn();

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
      updateElement,
      getActiveTool: vi.fn(() => "selection"),
    },
    ui: {
      showPopup: vi.fn(),
      setStatusBarMessage: vi.fn(),
    },
  };

  return { ctx, unproject, getZoom, addElement, updateElement };
}

describe("ArrowTool", () => {
  it("declares stable id/label/icon/cursor/defaultScaleMode metadata", () => {
    expect(ArrowTool.id).toBe("arrow");
    expect(ArrowTool.label).toBe("Arrow");
    expect(ArrowTool.icon).toBe("arrow");
    expect(ArrowTool.cursor).toBe("crosshair");
    expect(ArrowTool.defaultScaleMode).toBe("geographic");
  });

  it("creates arrow with geographic scaleMode and two-coord polyline anchor", () => {
    // Down at tail (-73.98, 40.75); move to (-73.97, 40.76); up at (-73.96, 40.77).
    const tail = { lng: -73.98, lat: 40.75 };
    const mid = { lng: -73.97, lat: 40.76 };
    const head = { lng: -73.96, lat: 40.77 };
    const { ctx, addElement, updateElement } = makeCtx([tail, mid, head], {
      zoom: 12,
      addElementId: "arrow-elem-1",
    });

    ArrowTool.onPointerDown!(
      makePointerEvent({ clientX: 100, clientY: 100 }),
      ctx,
    );
    ArrowTool.onPointerMove!(
      makePointerEvent({ clientX: 150, clientY: 150 }),
      ctx,
    );
    ArrowTool.onPointerUp!(
      makePointerEvent({ clientX: 200, clientY: 200 }),
      ctx,
    );

    // Exactly one addElement (at down).
    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.type).toBe("arrow");
    expect(seed.scaleMode).toBe("geographic");
    // Initial seed: head==tail (zero-length arrow).
    expect(seed.geo).toEqual({
      kind: "polyline",
      coordinates: [
        [tail.lng, tail.lat],
        [tail.lng, tail.lat],
      ],
      zRef: 12,
    });

    // Two updateElement calls (move + up), both patching the polyline.
    expect(updateElement).toHaveBeenCalledTimes(2);

    const [moveId, movePatch] = updateElement.mock.calls[0] as [
      string,
      Partial<AtlasdrawElementSeed>,
    ];
    expect(moveId).toBe("arrow-elem-1");
    expect(movePatch.geo).toEqual({
      kind: "polyline",
      coordinates: [
        [tail.lng, tail.lat],
        [mid.lng, mid.lat],
      ],
      zRef: 12,
    });

    const [upId, upPatch] = updateElement.mock.calls[1] as [
      string,
      Partial<AtlasdrawElementSeed>,
    ];
    expect(upId).toBe("arrow-elem-1");
    expect(upPatch.geo).toEqual({
      kind: "polyline",
      coordinates: [
        [tail.lng, tail.lat],
        [head.lng, head.lat],
      ],
      zRef: 12,
    });
  });

  it("clears preview state after pointerUp", () => {
    // First drag: down → up. Then second drag must use its own tail and id,
    // proving the module-scope state was cleared.
    const firstTail = { lng: 1, lat: 1 };
    const firstHead = { lng: 2, lat: 2 };
    const ctx1 = makeCtx([firstTail, firstHead], {
      zoom: 10,
      addElementId: "arrow-1",
    });
    ArrowTool.onPointerDown!(makePointerEvent(), ctx1.ctx);
    ArrowTool.onPointerUp!(makePointerEvent(), ctx1.ctx);
    expect(ctx1.addElement).toHaveBeenCalledTimes(1);
    expect(ctx1.updateElement).toHaveBeenCalledTimes(1);

    // A stray pointermove with no in-flight gesture is a no-op (state was cleared).
    const strayCtx = makeCtx([{ lng: 99, lat: 99 }]);
    ArrowTool.onPointerMove!(makePointerEvent(), strayCtx.ctx);
    expect(strayCtx.updateElement).not.toHaveBeenCalled();
    // Ditto stray pointerup.
    ArrowTool.onPointerUp!(makePointerEvent(), strayCtx.ctx);
    expect(strayCtx.updateElement).not.toHaveBeenCalled();

    // Second drag with different tail / new id — must work independently.
    const secondTail = { lng: 10, lat: 10 };
    const secondHead = { lng: 20, lat: 20 };
    const ctx2 = makeCtx([secondTail, secondHead], {
      zoom: 14,
      addElementId: "arrow-2",
    });
    ArrowTool.onPointerDown!(makePointerEvent(), ctx2.ctx);
    ArrowTool.onPointerUp!(makePointerEvent(), ctx2.ctx);

    expect(ctx2.addElement).toHaveBeenCalledTimes(1);
    const seed2 = ctx2.addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed2.geo).toEqual({
      kind: "polyline",
      coordinates: [
        [secondTail.lng, secondTail.lat],
        [secondTail.lng, secondTail.lat],
      ],
      zRef: 14,
    });
    // The updateElement call from the second drag must reference arrow-2,
    // not the cleared arrow-1 — proves state was reset.
    expect(ctx2.updateElement).toHaveBeenCalledTimes(1);
    const [secondUpId, secondUpPatch] = ctx2.updateElement.mock.calls[0] as [
      string,
      Partial<AtlasdrawElementSeed>,
    ];
    expect(secondUpId).toBe("arrow-2");
    expect(secondUpPatch.geo).toEqual({
      kind: "polyline",
      coordinates: [
        [secondTail.lng, secondTail.lat],
        [secondHead.lng, secondHead.lat],
      ],
      zRef: 14,
    });
  });
});
