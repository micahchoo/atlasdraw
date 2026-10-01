// SPDX-License-Identifier: MIT
// Tests for the tool registration API.
//
// That a built-in self-registers and is reachable by id is a property of the
// registry, not of how many tools ship, so the cases below assert it against
// the one built-in (PinTool) and against a tool registered from outside. The
// registry's real users are the latter.

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
        onPointerDown: () => {},
      }),
    ).toThrow(/already registered/);
  });
});
