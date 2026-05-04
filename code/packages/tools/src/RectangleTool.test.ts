// packages/tools/src/RectangleTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b Task T08 — RectangleTool unit tests.
//
// Mocks ToolContext + ToolPointerEvent. Verifies the preview-pattern lifecycle
// (addElement on down, updateElement on move/up) and the bbox-normalization
// contract (min/max regardless of drag direction).

import { describe, it, expect, vi } from "vitest";
import { RectangleTool } from "./RectangleTool.js";
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
 * Build a ToolContext whose `map.unproject` reads pixel coords as (lng, lat)
 * directly — that is, unproject([x, y]) returns { lng: x, lat: y }. Lets the
 * tests express drag geometry in pixel coords and reason about the resulting
 * bbox in the same units.
 */
function makeCtx(opts: { zoom?: number } = {}): MockCtx {
  const zoom = opts.zoom ?? 10;

  const unproject = vi.fn((p: [number, number]) => ({ lng: p[0], lat: p[1] }));
  const getZoom = vi.fn(() => zoom);
  let nextId = 1;
  const addElement = vi.fn((_seed: AtlasdrawElementSeed) => `el-${nextId++}`);
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

describe("RectangleTool", () => {
  it("declares stable id/label/icon/cursor/defaultScaleMode metadata", () => {
    expect(RectangleTool.id).toBe("rectangle");
    expect(RectangleTool.label).toBe("Rectangle");
    expect(RectangleTool.icon).toBe("rectangle");
    expect(RectangleTool.cursor).toBe("crosshair");
    expect(RectangleTool.defaultScaleMode).toBe("geographic");
  });

  it("creates rectangle with bbox GeoAnchor corners from drag", () => {
    const { ctx, addElement, updateElement } = makeCtx({ zoom: 8 });

    // Drag from (0,0) to (100,100). With our identity unproject mock,
    // first corner = (0,0) lng/lat, second = (100,100) lng/lat.
    RectangleTool.onPointerDown(
      makePointerEvent({ clientX: 0, clientY: 0 }),
      ctx,
    );
    RectangleTool.onPointerMove?.(
      makePointerEvent({ clientX: 50, clientY: 50 }),
      ctx,
    );
    RectangleTool.onPointerUp?.(
      makePointerEvent({ clientX: 100, clientY: 100 }),
      ctx,
    );

    // Initial seed: degenerate bbox at origin, type=rectangle, geographic.
    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.type).toBe("rectangle");
    expect(seed.scaleMode).toBe("geographic");
    expect(seed.geo.kind).toBe("bbox");
    if (seed.geo.kind === "bbox") {
      expect(seed.geo.west).toBe(0);
      expect(seed.geo.east).toBe(0);
      expect(seed.geo.south).toBe(0);
      expect(seed.geo.north).toBe(0);
      expect(seed.geo.zRef).toBe(8);
    }

    // Final updateElement (after up) carries the full extent.
    const finalCall = updateElement.mock.calls.at(-1);
    expect(finalCall).toBeDefined();
    const [finalId, finalPatch] = finalCall as [
      string,
      Partial<AtlasdrawElementSeed>,
    ];
    expect(finalId).toBe("el-1");
    expect(finalPatch.geo).toBeDefined();
    if (finalPatch.geo && finalPatch.geo.kind === "bbox") {
      expect(finalPatch.geo.kind).toBe("bbox");
      expect(finalPatch.geo.west).toBeLessThan(finalPatch.geo.east);
      expect(finalPatch.geo.south).toBeLessThan(finalPatch.geo.north);
      expect(finalPatch.geo.west).toBe(0);
      expect(finalPatch.geo.east).toBe(100);
      expect(finalPatch.geo.south).toBe(0);
      expect(finalPatch.geo.north).toBe(100);
    }
  });

  it("handles inverted drag (e.g., bottom-right to top-left)", () => {
    const { ctx, updateElement } = makeCtx({ zoom: 11 });

    // Drag from (100,100) down/left to (0,0): first corner is (100,100),
    // second is (0,0). Bbox must still normalize to min/max.
    RectangleTool.onPointerDown(
      makePointerEvent({ clientX: 100, clientY: 100 }),
      ctx,
    );
    RectangleTool.onPointerUp?.(
      makePointerEvent({ clientX: 0, clientY: 0 }),
      ctx,
    );

    const finalCall = updateElement.mock.calls.at(-1);
    expect(finalCall).toBeDefined();
    const [, finalPatch] = finalCall as [
      string,
      Partial<AtlasdrawElementSeed>,
    ];
    expect(finalPatch.geo?.kind).toBe("bbox");
    if (finalPatch.geo && finalPatch.geo.kind === "bbox") {
      // Regardless of drag direction, west < east and south < north.
      expect(finalPatch.geo.west).toBe(0);
      expect(finalPatch.geo.east).toBe(100);
      expect(finalPatch.geo.south).toBe(0);
      expect(finalPatch.geo.north).toBe(100);
      expect(finalPatch.geo.west).toBeLessThan(finalPatch.geo.east);
      expect(finalPatch.geo.south).toBeLessThan(finalPatch.geo.north);
      expect(finalPatch.geo.zRef).toBe(11);
    }
  });

  it("ignores pointermove/pointerup when no gesture is in flight", () => {
    const { ctx, updateElement } = makeCtx();

    // No prior pointerdown — these should be no-ops, not throw.
    RectangleTool.onPointerMove?.(
      makePointerEvent({ clientX: 50, clientY: 50 }),
      ctx,
    );
    RectangleTool.onPointerUp?.(
      makePointerEvent({ clientX: 50, clientY: 50 }),
      ctx,
    );

    expect(updateElement).not.toHaveBeenCalled();
  });
});
