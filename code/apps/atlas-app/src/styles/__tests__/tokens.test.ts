// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Every colour on the app's own surfaces comes from a --ad-* token, and every
// colour token has a dark value. Until 2026-10-02 neither held: the tokens had
// no dark values at all, and 87 literals in 18 modules painted white inputs and
// light badges whatever the theme. "Dark or light theme" changed nothing the
// owner could see (e2e/dark-theme.spec.ts).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const STYLES = path.resolve(__dirname, "..");
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

/** The CSS without comments and without `var(…)` calls, fallbacks included. */
function withoutVars(css: string): string {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "VAR");
  }
  return s;
}

/** The custom properties a block sets: name → value. */
function properties(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--ad-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** The body of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("design tokens", () => {
  it("no CSS module paints a colour that is not a token", () => {
    // excalidraw-theme.css too: it maps Excalidraw's variables onto these
    // tokens, and a literal there is light in both themes.
    const literals = readdirSync(STYLES)
      .filter((f) => f.endsWith(".module.css") || f === "excalidraw-theme.css")
      .flatMap((f) =>
        withoutVars(readFileSync(path.join(STYLES, f), "utf8"))
          .split("\n")
          .filter((line) => COLOUR.test(line))
          .map((line) => `${f}: ${line.trim()}`),
      );
    expect(literals).toEqual([]);
  });

  it("no CSS module sets a font size, z-index or radius that is not a token", () => {
    // Before 2026-10-02 the modules held 13 font sizes, 11 z-index values and
    // 8 radii as literals; the z-index ladder lived only in comments.
    // 0, 50% and keywords stay: they are not a choice on a scale.
    const SCALED =
      /^\s*(font-size|z-index|border(?:-[a-z]+)*-radius)\s*:\s*([^;]+);/;
    const literals = readdirSync(STYLES)
      .filter((f) => f.endsWith(".module.css"))
      .flatMap((f) =>
        withoutVars(readFileSync(path.join(STYLES, f), "utf8"))
          .split("\n")
          .filter((line) => {
            const value = SCALED.exec(line)?.[2];
            return (
              value !== undefined && /\d/.test(value.replace(/\b0\b|50%/g, ""))
            );
          })
          .map((line) => `${f}: ${line.trim()}`),
      );
    expect(literals).toEqual([]);
  });

  it("every token a CSS module reads is defined", () => {
    // A misspelt token is not an error in CSS: `z-index: var(--ad-z-overlya)`
    // computes to `auto` and the surface drops under the map.
    // --ad-sheet-panel-inset is set at run time on the collar shell.
    const defined = new Set([
      ...properties(
        readFileSync(path.join(STYLES, "tokens.css"), "utf8"),
      ).keys(),
      "--ad-sheet-panel-inset",
    ]);
    const undefinedTokens = readdirSync(STYLES)
      .filter((f) => f.endsWith(".module.css"))
      .flatMap((f) =>
        [
          ...readFileSync(path.join(STYLES, f), "utf8").matchAll(
            /var\((--ad-[a-z0-9-]+)/g,
          ),
        ]
          .map((m) => m[1]!)
          .filter((name) => !defined.has(name))
          .map((name) => `${f}: ${name}`),
      );
    expect(undefinedTokens).toEqual([]);
  });

  it("every colour token has a dark value", () => {
    const css = readFileSync(path.join(STYLES, "tokens.css"), "utf8");
    const light = properties(block(css, ":root"));
    const dark = properties(block(css, ':root[data-ad-theme="dark"]'));
    const colours = [...light]
      .filter(([, value]) => COLOUR.test(value))
      .map(([name]) => name);
    expect(colours.length).toBeGreaterThan(10);
    expect(colours.filter((name) => !dark.has(name))).toEqual([]);
  });
});
