// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Build-output check for the Asset Library.
//
// AssetLibraryPanel.test.tsx passes in Node because asset-library.ts falls
// back to `require("node:fs")` there. A browser has no `fs`, so the shipped
// panel depends on Vite rewriting `import.meta.glob(...)` into fixture
// imports. Vite rewrites only a LITERAL `import.meta.glob(...)` call; read
// through a variable, the bundle keeps the bare `import.meta.glob` and no
// fixture. Only a Vite build can see this, so this test runs one (about
// 70 ms) on the real module and reads its output.

import path from "path";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import type { RollupOutput } from "rollup";

const ASSET_LIBRARY = path.resolve(
  __dirname,
  "../../../../../packages/data/src/asset-library.ts",
);

async function bundle(entry: string): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    root: path.dirname(entry),
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: "asset-library" },
      rollupOptions: { external: [/^node:/] },
    },
  })) as RollupOutput | RollupOutput[];
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => ("code" in chunk ? chunk.code : ""))
    .join("\n");
}

describe("asset library in a Vite build", () => {
  it("bundles the built-in library fixtures", async () => {
    const code = await bundle(ASSET_LIBRARY);
    expect({
      hazard: code.includes("atlasdraw:hazard-markers"),
      transit: code.includes("atlasdraw:transit-symbols"),
      wildfire: code.includes("atlasdraw:wildfire-icons"),
    }).toEqual({ hazard: true, transit: true, wildfire: true });
  });
});
