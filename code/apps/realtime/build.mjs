// SPDX-License-Identifier: AGPL-3.0-only
//
// Build the relay into dist/index.js, one ES module for Node 20.
//
// @atlasdraw/protocol is bundled in: it is TypeScript source in this
// workspace, and the runtime image (Dockerfile) holds only dist/ and the
// production node_modules, where a workspace link points at nothing. Every
// other dependency stays external and comes from node_modules.

import { readFileSync } from "fs";

import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url)));
const external = Object.keys(pkg.dependencies).filter(
  (name) => !name.startsWith("@atlasdraw/"),
);

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external,
  sourcemap: true,
  logLevel: "warning",
});
