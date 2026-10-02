// SPDX-License-Identifier: AGPL-3.0-only
//
// lib/icons.tsx is the app's one icon source. Until 2026-10-02 seven
// components drew their own inline SVG icons, each at its own size and
// stroke, beside Excalidraw's icons in the same toolbar and sidebar.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import * as icons from "../icons";

afterEach(cleanup);

const SRC = path.resolve(__dirname, "../..");

/** Every .tsx under src, tests left out, as a path relative to src. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : sources(full);
    }
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx")
      ? [path.relative(SRC, full)]
      : [];
  });
}

describe("icons", () => {
  it("no component draws its own icon; the SVGs left are drawings", () => {
    // A drawing is geometry on the map or an instrument, not an icon:
    // remote cursors, the measured path, the compass dial that turns with
    // the map.
    const drawsSvg = sources(SRC)
      .filter((f) => readFileSync(path.join(SRC, f), "utf8").includes("<svg"))
      .sort();
    expect(drawsSvg).toEqual([
      "components/CursorOverlay.tsx",
      "components/MapCompass.tsx",
      "components/MeasureLayer.tsx",
      "lib/icons.tsx",
    ]);
  });

  it("every icon is hidden from a screen reader and draws in currentColor", () => {
    const names = Object.keys(icons).filter((n) => /^[A-Z]\w*Icon$/.test(n));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const Icon = (icons as Record<string, React.FC<{ className?: string }>>)[
        name
      ]!;
      const { container } = render(<Icon className="probe" />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden"), name).toBe("true");
      expect(svg?.getAttribute("class"), name).toContain("probe");
      // A clip path's fill is a mask, not a colour on screen.
      const painted = [...container.querySelectorAll("*")]
        .filter((el) => !el.closest("defs"))
        .flatMap((el) => [el.getAttribute("fill"), el.getAttribute("stroke")])
        .filter((v): v is string => v !== null);
      expect(
        painted.filter((v) => v !== "currentColor" && v !== "none"),
        name,
      ).toEqual([]);
    }
  });
});
