// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// The overlay part of the MapLibre style has one writer: lib/mapOverlays.ts.
// A second module that adds, removes, moves or restyles a layer is how the
// map and the document drifted apart before. This test reads the source and
// fails on a style write anywhere else.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CODE = path.resolve(__dirname, "../../../../..");

/** Where map code lives. */
const ROOTS = [
  "apps/atlas-app/src",
  "packages/basemap/src",
  "packages/data/src",
  "packages/geo/src",
  "packages/tools/src",
];

/** The only files that may write the style. */
const ALLOWED = new Set(["apps/atlas-app/src/lib/mapOverlays.ts"]);

const WRITE =
  /\.(addLayer|addSource|removeLayer|removeSource|moveLayer|setPaintProperty|setLayoutProperty|setFilter)\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") {
        continue;
      }
      out.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !/harness\.ts$/.test(name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** The code lines of a file: comments are not writes. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe("map style writers", () => {
  it("only lib/mapOverlays.ts adds, removes, moves, restyles or filters map layers", () => {
    const writers: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(CODE, root))) {
        const rel = path.relative(CODE, file);
        if (ALLOWED.has(rel)) {
          continue;
        }
        codeLines(readFileSync(file, "utf8")).forEach((line) => {
          if (WRITE.test(line)) {
            writers.push(`${rel}: ${line.trim()}`);
          }
        });
      }
    }
    expect(writers).toEqual([]);
  });

  it("the allowed writer does write the style, so the scan is looking", () => {
    const text = readFileSync(
      path.join(CODE, "apps/atlas-app/src/lib/mapOverlays.ts"),
      "utf8",
    );
    expect(codeLines(text).some((line) => WRITE.test(line))).toBe(true);
  });
});
