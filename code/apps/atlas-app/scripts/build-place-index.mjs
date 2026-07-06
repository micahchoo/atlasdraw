// SPDX-License-Identifier: AGPL-3.0-only
//
// Build a compact, offline place index from the bundled world basemap pmtiles.
//
//   node apps/atlas-app/scripts/build-place-index.mjs
//   (or: yarn workspace @atlasdraw/atlas-app build:place-index)
//
// Decodes the `places` vector-tile layer out of public/data/world-low-zoom.pmtiles
// (zoom 0–6, ~2900 tiles), dedups to unique places, ranks by population, and
// writes public/data/places-index.json (~0.4 MB). This is what powers the
// toolbar geo-search WITHOUT calling out to any geocoder — the heavy MVT decode
// happens here, once, at build time; the browser just fetches + searches the JSON.
//
// Regenerate whenever world-low-zoom.pmtiles changes. The MVT decode deps
// (@mapbox/vector-tile, pbf, pmtiles) are dev-only — none reach the browser bundle.

import { PMTiles } from "pmtiles";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "public", "data");
const PMTILES = join(dataDir, "world-low-zoom.pmtiles");
const OUT = join(dataDir, "places-index.json");

// pmtiles' getZxy already decompresses tile bytes, so we feed them straight to
// the MVT parser (no gunzip — that was a footgun; the returned bytes are raw MVT).
const buf = readFileSync(PMTILES);
const source = {
  getKey: () => "world-low-zoom",
  getBytes: async (offset, length) => ({
    data: buf.buffer.slice(
      buf.byteOffset + offset,
      buf.byteOffset + offset + length,
    ),
  }),
};

const pm = new PMTiles(source);
const header = await pm.getHeader();

/** name(lower)+~1km coords -> best entry (highest population_rank wins). */
const byKey = new Map();

for (let z = header.minZoom; z <= header.maxZoom; z++) {
  const n = 1 << z;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const tile = await pm.getZxy(z, x, y);
      if (!tile) {
        continue;
      }
      let vt;
      try {
        vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
      } catch {
        continue;
      }
      const layer = vt.layers["places"];
      if (!layer) {
        continue;
      }
      for (let i = 0; i < layer.length; i++) {
        const gj = layer.feature(i).toGeoJSON(x, y, z);
        if (gj.geometry.type !== "Point") {
          continue;
        }
        const props = gj.properties || {};
        // English name for a Latin-typing UI, falling back to the native name.
        const name = props["name:en"] || props.name;
        if (!name || typeof name !== "string") {
          continue;
        }
        const [lng, lat] = gj.geometry.coordinates;
        const rank =
          typeof props.population_rank === "number" ? props.population_rank : 0;
        const key = `${name.toLowerCase()}|${lng.toFixed(2)},${lat.toFixed(2)}`;
        const prev = byKey.get(key);
        if (!prev || rank > prev.r) {
          byKey.set(key, {
            n: name,
            x: Number(lng.toFixed(5)),
            y: Number(lat.toFixed(5)),
            k: typeof props.kind === "string" ? props.kind : "locality",
            r: rank,
          });
        }
      }
    }
  }
}

// Pre-sort by rank desc so the runtime can emit results in importance order
// simply by preserving array order.
const places = [...byKey.values()].sort((a, b) => b.r - a.r);

const out = {
  v: 1,
  source: "world-low-zoom.pmtiles",
  count: places.length,
  places,
};
writeFileSync(OUT, JSON.stringify(out));

const kinds = {};
for (const p of places) kinds[p.k] = (kinds[p.k] || 0) + 1;
const sizeMb = (JSON.stringify(out).length / 1024 / 1024).toFixed(2);
console.log(`Wrote ${OUT}`);
console.log(`  ${places.length} places, ${sizeMb} MB`);
console.log(`  kinds: ${JSON.stringify(kinds)}`);
console.log(`  top: ${places.slice(0, 6).map((p) => p.n).join(", ")}`);
