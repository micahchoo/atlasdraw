/* eslint-disable no-console */
// SPDX-License-Identifier: AGPL-3.0-only
// The boot-size gate. Run after `vite build --manifest`:
//
//   node --experimental-strip-types scripts/check-boot-size.ts [dist]
//
// For each route it sums the gzip size (level 9, as the precompress plugin
// writes it) of the files the route loads before it paints, and exits 1 when
// a route is over its budget. src/lib/bootPayload.ts decides which files
// count.
//
// BUDGETS is the measured size plus a margin, not the product target. The
// targets are docs/PRD §9: the editor under 800 KB gzip, the embed about
// 120 KB. Lower a budget when a split lands; never raise one to make a red
// build green without saying why in the commit.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { checkBudgets, routePayload } from "../src/lib/bootPayload.ts";

import type { Manifest } from "../src/lib/bootPayload.ts";

// Route name -> the chunk name of its root (App.tsx's lazy imports).
const ROUTES: Record<string, string> = {
  editor: "MapEditor",
  viewer: "EmbedView",
};

const KB = 1024;
// Measured 2026-10-01 with maplibre-gl 6.11 (the upgrade costs ~49 KB:
// v6 ships a main and a shared module where v4 shipped one file):
// editor 1009 KB, viewer 920 KB.
const BUDGETS: Record<string, number> = {
  editor: 1040 * KB,
  viewer: 950 * KB,
};

const dist = resolve(process.argv[2] ?? "dist");
const manifest = JSON.parse(
  readFileSync(join(dist, ".vite", "manifest.json"), "utf8"),
) as Manifest;

const gzipped = (file: string): number =>
  gzipSync(readFileSync(join(dist, file)), { level: 9 }).byteLength;

const sizes: Record<string, number> = {};
for (const [route, key] of Object.entries(ROUTES)) {
  const files = routePayload(manifest, key);
  sizes[route] = files.reduce((sum, f) => sum + gzipped(f), 0);
  console.log(`${route}:`);
  for (const f of files) {
    console.log(`  ${(gzipped(f) / KB).toFixed(1).padStart(8)} KB  ${f}`);
  }
}

const rows = checkBudgets(sizes, BUDGETS);
console.log("");
for (const r of rows) {
  const budget =
    r.budget === undefined ? "none" : `${(r.budget / KB).toFixed(0)} KB`;
  console.log(
    `${r.pass ? "PASS" : "FAIL"}  ${r.route.padEnd(8)} ${(r.bytes / KB).toFixed(
      1,
    )} KB gzip  (budget ${budget})`,
  );
}
if (rows.some((r) => !r.pass)) {
  console.error("\nA route is over its boot-size budget.");
  process.exit(1);
}
