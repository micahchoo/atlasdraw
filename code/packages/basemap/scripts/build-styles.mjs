// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 1 (T5): one-shot style vendor generator.
//
// Produces three MapLibre style JSONs under ../src/styles/:
//   - protomaps-light.json      (self-hosted pmtiles, via protomaps-themes-base)
//   - protomaps-dark.json       (self-hosted pmtiles, via protomaps-themes-base)
//   - openfreemap-bright.json   (remote tiles, fetched verbatim from openfreemap.org)
//
// The protomaps styles embed `__PMTILES_PATH__` in the source URL; style-builder.ts
// substitutes the caller-provided pmtiles path at runtime. The openfreemap style
// keeps remote tile URLs intact and is gated by `requiresRemote: true` in
// BasemapRegistry (no substitution).
//
// Idempotent: running twice produces byte-identical output.

import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import https from "node:https";

const require = createRequire(import.meta.url);
const protomaps = require("protomaps-themes-base");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(__dirname, "..", "src", "styles");

const PMTILES_TOKEN = "__PMTILES_PATH__";
const PROTOMAPS_SOURCE_NAME = "protomaps";
const GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const OPENFREEMAP_BRIGHT_URL = "https://tiles.openfreemap.org/styles/bright";

/** Build a Protomaps style for the given flavor ('light' | 'dark'). */
function buildProtomapsStyle(flavor) {
  const layers = protomaps.layers(
    PROTOMAPS_SOURCE_NAME,
    protomaps.namedTheme(flavor),
    { lang: "en" },
  );
  return {
    version: 8,
    name: `atlasdraw-${flavor}`,
    sources: {
      [PROTOMAPS_SOURCE_NAME]: {
        type: "vector",
        url: `pmtiles://${PMTILES_TOKEN}`,
      },
    },
    glyphs: GLYPHS_URL,
    layers,
  };
}

/** Fetch the OpenFreeMap bright style JSON verbatim. */
function fetchOpenFreeMapBright() {
  return new Promise((resolve, reject) => {
    https
      .get(OPENFREEMAP_BRIGHT_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(
              `OpenFreeMap fetch failed: HTTP ${res.statusCode} ${res.statusMessage}`,
            ),
          );
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`OpenFreeMap JSON parse failed: ${err.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function writeStyle(filename, obj) {
  const path = join(STYLES_DIR, filename);
  // 2-space indent, trailing newline (consistent with prettier defaults).
  const content = JSON.stringify(obj, null, 2) + "\n";
  await writeFile(path, content, "utf8");
  return { path, bytes: content.length };
}

async function main() {
  await mkdir(STYLES_DIR, { recursive: true });

  const light = buildProtomapsStyle("light");
  const dark = buildProtomapsStyle("dark");
  const bright = await fetchOpenFreeMapBright();

  const results = await Promise.all([
    writeStyle("protomaps-light.json", light),
    writeStyle("protomaps-dark.json", dark),
    writeStyle("openfreemap-bright.json", bright),
  ]);

  for (const { path, bytes } of results) {
    console.log(`wrote ${path} (${bytes} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
