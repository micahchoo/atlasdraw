// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// The offline basemaps draw their labels and icons from files this app
// serves (public/basemap/, made by scripts/vendor-basemap-assets.sh). A font
// stack or a sprite a style names and the folder lacks gives a map with no
// labels and only a console message, so each one is checked here.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ASSETS = path.resolve(__dirname, "../../../public/basemap");
const STYLES = path.resolve(
  __dirname,
  "../../../../../packages/basemap/src/styles",
);

/** The styles that use the bundled assets: they hold the token. */
const offlineStyles = readdirSync(STYLES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({
    file: f,
    style: JSON.parse(readFileSync(path.join(STYLES, f), "utf8")) as {
      glyphs?: string;
      sprite?: string;
      layers: Array<{ layout?: Record<string, unknown> }>;
    },
  }))
  .filter(({ style }) => style.glyphs?.startsWith("__BASEMAP_ASSETS__/"));

/** Every font stack a `text-font` value names, literal or in an expression. */
function fontStacks(value: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => typeof v === "string")) {
      // ["case", …] and ["literal", …] are operators, not stacks.
      if (!["case", "literal", "get", "step", "match"].includes(value[0])) {
        out.add(value.join(","));
      }
    }
    for (const v of value) {
      fontStacks(v, out);
    }
  }
  return out;
}

describe("bundled basemap assets", () => {
  it("the offline styles use them", () => {
    expect(offlineStyles.map((s) => s.file).sort()).toEqual([
      "protomaps-dark.json",
      "protomaps-light.json",
    ]);
  });

  it.each(offlineStyles.map((s) => [s.file, s.style] as const))(
    "%s: every font stack has all 256 glyph ranges",
    (_file, style) => {
      const stacks = new Set<string>();
      for (const layer of style.layers) {
        fontStacks(layer.layout?.["text-font"], stacks);
      }
      expect(stacks.size).toBeGreaterThan(0);
      for (const stack of stacks) {
        const dir = path.join(ASSETS, "fonts", stack);
        expect(existsSync(dir), dir).toBe(true);
        // MapLibre fails a whole tile's labels when one range is missing.
        expect(readdirSync(dir).filter((f) => f.endsWith(".pbf"))).toHaveLength(
          256,
        );
      }
    },
  );

  it.each(offlineStyles.map((s) => [s.file, s.style] as const))(
    "%s: the sprite has its 1x and 2x sheets",
    (_file, style) => {
      const sprite = style.sprite!.replace("__BASEMAP_ASSETS__", ASSETS);
      for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
        expect(existsSync(sprite + suffix), sprite + suffix).toBe(true);
      }
    },
  );

  it("ships the font licence with the fonts", () => {
    expect(existsSync(path.join(ASSETS, "fonts", "OFL.txt"))).toBe(true);
  });
});
