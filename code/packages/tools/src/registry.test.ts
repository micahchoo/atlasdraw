// SPDX-License-Identifier: MIT
// Tests for the tool registration API (ISSUES.md Direction 4 — headroom
// audit, verdict: pursue). Before this, `ToolRegistry` (types.ts) was
// documented as "built up in apps/atlas-app from @atlasdraw/tools exports"
// but nothing anywhere ever actually constructed one — only PinTool was
// ever imported by name.

import { describe, expect, it } from "vitest";

import {
  ArrowTool,
  CircleTool,
  FreehandTool,
  PinTool,
  PolygonTool,
  PolylineTool,
  RectangleTool,
  TextLabelTool,
  getTool,
  listTools,
  registerTool,
} from "./index.js";

describe("tools registry — self-registration of the 8 built-in tools", () => {
  it("listTools() includes all 8 built-in tools", () => {
    const ids = listTools().map((t) => t.id);
    for (const tool of [
      PinTool,
      PolygonTool,
      PolylineTool,
      FreehandTool,
      TextLabelTool,
      ArrowTool,
      RectangleTool,
      CircleTool,
    ]) {
      expect(ids).toContain(tool.id);
    }
  });

  it("getTool(id) returns the same object as the named export for each built-in tool", () => {
    expect(getTool(PinTool.id)).toBe(PinTool);
    expect(getTool(PolygonTool.id)).toBe(PolygonTool);
    expect(getTool(CircleTool.id)).toBe(CircleTool);
  });

  it("getTool returns undefined for an unregistered id", () => {
    expect(getTool("does-not-exist")).toBeUndefined();
  });
});

describe("tools registry — registerTool()", () => {
  it("registers a new tool reachable via getTool and listTools", () => {
    const customTool = {
      id: "test-only-tool",
      label: "Test Only",
      icon: "test-icon",
      cursor: "crosshair",
      defaultScaleMode: "geographic" as const,
      onPointerDown: () => {},
    };
    registerTool(customTool);

    expect(getTool("test-only-tool")).toBe(customTool);
    expect(listTools().map((t) => t.id)).toContain("test-only-tool");
  });

  it("throws when registering a duplicate id", () => {
    expect(() =>
      registerTool({
        id: PinTool.id,
        label: "Duplicate Pin",
        icon: "x",
        cursor: "x",
        defaultScaleMode: "geographic" as const,
        onPointerDown: () => {},
      }),
    ).toThrow(/already registered/);
  });
});
