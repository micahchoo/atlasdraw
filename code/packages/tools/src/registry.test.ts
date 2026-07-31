// SPDX-License-Identifier: MIT
// Tests for the tool registration API (ISSUES.md Direction 4 — headroom
// audit, verdict: pursue). Before this, `ToolRegistry` (types.ts) was
// documented as "built up in apps/atlas-app from @atlasdraw/tools exports"
// but nothing anywhere ever actually constructed one — only PinTool was
// ever imported by name.
//
// FU-2 deleted the seven tools this file used to enumerate. What it tested
// about them — that a built-in self-registers and is reachable by id — is a
// property of the registry, not of the count, so the cases below assert it
// against the one built-in that ships and against a tool registered from
// outside. The registry's real users are the latter.

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

  // The seven are gone, not renamed or moved. A stale id resolving would mean
  // something re-registered them somewhere this file cannot see.
  it("does not resolve the seven ids deleted in FU-2", () => {
    for (const id of [
      "polygon",
      "polyline",
      "freehand",
      "text-label",
      "arrow",
      "rectangle",
      "circle",
    ]) {
      expect(getTool(id)).toBeUndefined();
    }
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
