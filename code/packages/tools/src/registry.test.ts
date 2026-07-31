// SPDX-License-Identifier: MIT
// Tests for the tool registration API (ISSUES.md Direction 4 — headroom
// audit, verdict: pursue). Before this, `ToolRegistry` (types.ts) was
// documented as "built up in apps/atlas-app from @atlasdraw/tools exports"
// but nothing anywhere ever actually constructed one — only PinTool was
// ever imported by name.
//
// The seven Phase 2 Wave 1b tools this file also covered were deleted
// 2026-07-31 (FU-2) — they never acquired a caller. PinTool is the whole
// built-in set now; registerTool() is what the registry is for.

import { describe, expect, it } from "vitest";

import { PinTool, getTool, listTools, registerTool } from "./index.js";

describe("tools registry — self-registration at module load", () => {
  it("listTools() includes the built-in PinTool", () => {
    expect(listTools().map((t) => t.id)).toContain(PinTool.id);
  });

  it("getTool(id) returns the same object as the named export", () => {
    expect(getTool(PinTool.id)).toBe(PinTool);
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
