// SPDX-License-Identifier: AGPL-3.0-only
//
// The shortcuts panel says what the keys do. Its rows come from the command
// list and the drawing editor's own keys (commands.ts), and the tool digits
// are checked against the fork's tool table.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SHAPES } from "@atlasdraw/excalidraw/components/shapes";

import { COMMANDS, EDITOR_KEYS, shortcutRows } from "../../commands/commands";
import { keyLabels } from "../../commands/keys";
import { KeyboardShortcuts } from "../KeyboardShortcuts";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

afterEach(cleanup);

describe("KeyboardShortcuts", () => {
  it("names the tool each digit selects, as the tool table binds it", () => {
    const digits = SHAPES.filter((shape) => shape.numericKey !== null);
    expect(digits.length).toBeGreaterThan(0);
    for (const shape of digits) {
      const row = EDITOR_KEYS.find(
        (s) => s.group === "Drawing" && s.keys[0] === shape.numericKey,
      );
      expect(row, `a row for ${shape.numericKey}`).toBeDefined();
      expect(squash(row!.label)).toContain(squash(shape.value));
    }
  });

  it("says that a drag selects, and Space or the hand tool pans", () => {
    const labels = EDITOR_KEYS.filter((s) => s.group === "Map").map(
      (s) => `${s.keys.join("+")}: ${s.label}`,
    );
    expect(labels).toContain("Space+Drag: Pan the map");
    expect(labels).toContain("H: Hand tool: a drag pans the map");
  });

  it("shows a row for every command key, with the command's label", () => {
    render(<KeyboardShortcuts rows={shortcutRows()} onClose={() => {}} />);
    const panel = screen.getByTestId("keyboard-shortcuts-panel");
    const bound = COMMANDS.filter((c) => c.keys?.length);
    expect(bound.length).toBeGreaterThan(5);
    for (const c of bound) {
      const row = within(panel).getByTestId(`shortcut-row-${c.label}`);
      expect(row.textContent).toContain(keyLabels(c.keys![0]).at(-1));
    }
  });
});
