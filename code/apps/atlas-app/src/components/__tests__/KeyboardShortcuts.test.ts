// SPDX-License-Identifier: AGPL-3.0-only
//
// The shortcuts panel says what the keys do. The tool digits come from the
// fork's tool table, so the panel is checked against it.

import { describe, expect, it } from "vitest";

import { SHAPES } from "@atlasdraw/excalidraw/components/shapes";

import { SHORTCUTS } from "../KeyboardShortcuts";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

describe("KeyboardShortcuts", () => {
  it("names the tool each digit selects, as the tool table binds it", () => {
    const digits = SHAPES.filter((shape) => shape.numericKey !== null);
    expect(digits.length).toBeGreaterThan(0);
    for (const shape of digits) {
      const row = SHORTCUTS.find(
        (s) => s.category === "Drawing" && s.keys[0] === shape.numericKey,
      );
      expect(row, `a row for ${shape.numericKey}`).toBeDefined();
      expect(squash(row!.label)).toContain(squash(shape.value));
    }
  });

  it("says that a drag selects, and Space or the hand tool pans", () => {
    const map = SHORTCUTS.filter((s) => s.category === "Map");
    const labels = map.map((s) => `${s.keys.join("+")}: ${s.label}`);
    expect(labels).toContain("Space+Drag: Pan the map");
    expect(labels).toContain("H: Hand tool: a drag pans the map");
    expect(labels.join("\n")).not.toMatch(/^Pan: Drag to pan map$/m);
  });
});
