// packages/tools/src/TextLabelTool.test.ts
// SPDX-License-Identifier: MPL-2.0
// Phase 2 Wave 1b T06 — TextLabelTool unit tests.
//
// Mirrors PinTool.test.ts shape (same MockCtx + makePointerEvent helpers).
// Two acceptance assertions per the task brief:
//
//   1. "creates text element with screen scaleMode at click location" —
//      seed.type==="text", seed.geo.kind==="point", seed.scaleMode==="geographic",
//      seed.data.text==="Label" (placeholder; T25 — Excalidraw native double-click edits).
//
//   2. "does not call setActiveTool or any non-ctx-exposed API" — only
//      `ctx.excalidraw.addElement` is called. `setActiveTool` is not on the
//      ctx surface at all (and is the regression `mx-682f8a` guards against);
//      verify by asserting the only excalidraw method touched was addElement.

import { describe, it, expect, vi } from "vitest";
import { TextLabelTool } from "./TextLabelTool.js";
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
  updateElement: ReturnType<typeof vi.fn>;
  getActiveTool: ReturnType<typeof vi.fn>;
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
  const updateElement = vi.fn();
  const getActiveTool = vi.fn(() => "selection");

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
      getActiveTool,
    },
    ui: {
      showPopup: vi.fn(),
      setStatusBarMessage: vi.fn(),
    },
  };

  return {
    ctx,
    unproject,
    getZoom,
    addElement,
    updateElement,
    getActiveTool,
  };
}

describe("TextLabelTool", () => {
  it("declares stable id/label/icon/cursor/defaultScaleMode metadata", () => {
    expect(TextLabelTool.id).toBe("text-label");
    expect(TextLabelTool.label).toBe("Text Label");
    expect(TextLabelTool.icon).toBe("text");
    expect(TextLabelTool.cursor).toBe("text");
    expect(TextLabelTool.defaultScaleMode).toBe("geographic");
  });

  it("creates text element with screen scaleMode at click location", () => {
    const { ctx, unproject, addElement } = makeCtx({
      lng: -73.98,
      lat: 40.75,
      zoom: 12,
    });
    const e = makePointerEvent({ clientX: 100, clientY: 200 });

    TextLabelTool.onPointerDown(e, ctx);

    // Click point was unprojected exactly once.
    expect(unproject).toHaveBeenCalledTimes(1);
    expect(unproject).toHaveBeenCalledWith([100, 200]);

    // Exactly one seed emitted.
    expect(addElement).toHaveBeenCalledTimes(1);
    const seed = addElement.mock.calls[0][0] as AtlasdrawElementSeed;

    // Element shape — type/geo/scaleMode/data per brief.
    expect(seed.type).toBe("text");
    expect(seed.geo).toEqual({
      kind: "point",
      lng: -73.98,
      lat: 40.75,
      zRef: 12,
    });
    expect(seed.geo.kind).toBe("point");
    expect(seed.scaleMode).toBe("geographic");
    expect(seed.data?.text).toBe("Label");
  });

  it("does not call setActiveTool or any non-ctx-exposed API", () => {
    // Tools must not activate other tools (Q11 boundary + tool-system
    // independence per mulch convention `mx-682f8a`). The ctx.excalidraw
    // surface intentionally has NO `setActiveTool` method — we verify by
    // asserting only `addElement` was touched on the excalidraw surface.
    const { ctx, addElement, updateElement, getActiveTool } = makeCtx();

    TextLabelTool.onPointerDown(makePointerEvent(), ctx);

    expect(addElement).toHaveBeenCalledTimes(1);
    expect(updateElement).not.toHaveBeenCalled();
    expect(getActiveTool).not.toHaveBeenCalled();

    // The ctx.excalidraw object exposes exactly these three methods today.
    // If a future change adds `setActiveTool` to the ctx surface, this guard
    // alone would not catch it — but the addElement-only assertion above plus
    // the type system (no `(ctx.excalidraw as any).setActiveTool` cast in
    // TextLabelTool.ts) keep the boundary intact.
    expect(Object.keys(ctx.excalidraw).sort()).toEqual(
      ["addElement", "getActiveTool", "updateElement"].sort(),
    );

    // No UI callbacks fired either — text-label is fire-and-forget.
    expect(ctx.ui.showPopup).not.toHaveBeenCalled();
    expect(ctx.ui.setStatusBarMessage).not.toHaveBeenCalled();
  });
});
