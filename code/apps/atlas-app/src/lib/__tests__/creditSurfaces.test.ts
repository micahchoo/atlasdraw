// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Every surface that shows the map prints its credits, and every one gets
// them from one function: lib/mapView#mapCredits, through `documentCredits`
// or a MapView's `credits`. Before, the editor's collar was the only surface
// that knew the credit by name, so the viewer and the embed printed MapLibre's
// own control, which credited "MapLibre" and not OpenStreetMap (ODbL asks for
// that credit; audit2-00 #8).
//
// The list below IS the set of surfaces. A new one (a print view, a
// thumbnail) is added here with the test that shows its credit on the page,
// in the file or in the image.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

interface Surface {
  name: string;
  /** The file that prints the credits. */
  file: string;
  /** How it reads them. */
  reads: RegExp;
  /** The test that checks the credit the user sees on that surface. */
  test: string;
  /** What that test checks for. */
  checks: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: "editor collar (status bar)",
    file: "components/StatusBar.tsx",
    reads: /documentCredits\(/,
    test: "components/__tests__/StatusBar.credit.test.tsx",
    checks: /status-bar-attribution/,
  },
  {
    name: "read-only viewer (/m) and embed (/embed)",
    file: "components/EmbedView.tsx",
    reads: /documentCredits\(/,
    test: "components/EmbedView.test.tsx",
    checks: /viewer-credit/,
  },
  {
    name: "PNG export (bottom-right of the image)",
    file: "lib/export.ts",
    reads: /creditText\(view\.credits\)/,
    test: "lib/__tests__/export.test.ts",
    checks: /prints the view's credits in the bottom-right corner/,
  },
  {
    name: "PDF export (page text and document info)",
    file: "lib/print-pdf.ts",
    reads: /creditText\(view\.credits\)/,
    test: "components/__tests__/ExportDialog.test.tsx",
    checks: /prints the view's credits/,
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") {
        continue;
      }
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const codeOf = (file: string) =>
  readFileSync(path.join(SRC, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("credit surfaces", () => {
  for (const s of SURFACES) {
    it(`${s.name} prints the credits from the one function`, () => {
      expect(codeOf(s.file)).toMatch(s.reads);
      expect(existsSync(path.join(SRC, s.test)), s.test).toBe(true);
      expect(readFileSync(path.join(SRC, s.test), "utf8")).toMatch(s.checks);
    });
  }

  it("no other code reads a basemap's credit or a tile layer's credit", () => {
    const readers: string[] = [];
    for (const full of sourceFiles(SRC)) {
      const rel = path.relative(SRC, full);
      if (rel === "lib/mapView.ts") {
        continue;
      }
      // A basemap's credit, or a tile layer's, read to be printed.
      if (
        /getBasemap\([^)]*\)\??\.attribution|\.attribution\b.*join\(/.test(
          codeOf(rel),
        )
      ) {
        readers.push(rel);
      }
    }
    expect(readers).toEqual([]);
  });

  it("the viewer and the embed hide MapLibre's own credit control", () => {
    // It reads the style's sources, which carry no credit: it would print
    // "MapLibre" alone, beside or instead of the real credit.
    expect(codeOf("components/EmbedView.tsx")).toMatch(/hideAttribution/);
  });
});
