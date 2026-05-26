// packages/tools/src/PinTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 1 Wave 3b Task 14 — PinTool unit tests.
//
// Mocks the `ToolContext` and `ToolPointerEvent` literals; verifies that
// onPointerDown calls `map.unproject` with the click point and emits an
// `AtlasdrawElementSeed` whose geo / scaleMode / data fields match the spec.

import { describe, it, expect, vi } from "vitest";

import { PinTool } from "./PinTool.js";

import type {
  AtlasdrawElementSeed,
  ToolContext,
  ToolPointerEvent,
} from "./types.js";

function makePointerEvent(
  overrides: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return {
    clientX: 320,
    clientY: 240,
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

function makeCtx(
  opts: { lng?: number; lat?: number; zoom?: number } = {},
): MockCtx {
  const lng = opts.lng ?? -73.98;
  const lat = opts.lat ?? 40.75;
  const zoom = opts.zoom ?? 12;

  const unproject = vi.fn(() => ({ lng, lat }));
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

describe("PinTool", () => {
  it("calls map.unproject exactly once with [clientX, clientY]", () => {
    const { ctx, unproject } = makeCtx();
    const e = makePointerEvent({ clientX: 100, clientY: 200 });

    PinTool.onPointerDown(e, ctx);

    expect(unproject).toHaveBeenCalledTimes(1);
    expect(unproject).toHaveBeenCalledWith([100, 200]);
  });

  it("emits a seed with type='custom' and customType='pin'", () => {
    const { ctx, addElement } = makeCtx();

    PinTool.onPointerDown(makePointerEvent(), ctx);

    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.type).toBe("custom");
    expect(seed.customType).toBe("pin");
  });

  it("emits a seed.geo of {kind:'point', lng, lat, zRef} from unproject + getZoom", () => {
    const { ctx, addElement } = makeCtx({ lng: -73.98, lat: 40.75, zoom: 12 });

    PinTool.onPointerDown(makePointerEvent(), ctx);

    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.geo).toEqual({
      kind: "point",
      lng: -73.98,
      lat: 40.75,
      zRef: 12,
    });
  });

  it("emits a seed with scaleMode='screen' (Spec §3.4 — pins stay screen-sized)", () => {
    const { ctx, addElement } = makeCtx();

    PinTool.onPointerDown(makePointerEvent(), ctx);

    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.scaleMode).toBe("screen");
  });

  it("emits a seed.data.label = 'Pin'", () => {
    const { ctx, addElement } = makeCtx();

    PinTool.onPointerDown(makePointerEvent(), ctx);

    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    expect(seed.data?.label).toBe("Pin");
  });

  it("uses fresh zRef on each invocation (re-reads getZoom)", () => {
    const { ctx, getZoom, addElement } = makeCtx({ zoom: 12 });

    PinTool.onPointerDown(makePointerEvent({ clientX: 0, clientY: 0 }), ctx);
    getZoom.mockReturnValue(15);
    PinTool.onPointerDown(makePointerEvent({ clientX: 50, clientY: 50 }), ctx);

    const first = addElement.mock.calls[0][0] as AtlasdrawElementSeed;
    const second = addElement.mock.calls[1][0] as AtlasdrawElementSeed;
    expect(first.geo.kind === "point" && first.geo.zRef).toBe(12);
    expect(second.geo.kind === "point" && second.geo.zRef).toBe(15);
  });

  it("declares stable id/label/icon/cursor metadata", () => {
    expect(PinTool.id).toBe("pin");
    expect(PinTool.label).toBe("Pin");
    expect(PinTool.icon).toBe("pin");
    expect(PinTool.cursor).toBe("crosshair");
  });
});
