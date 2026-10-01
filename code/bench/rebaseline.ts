/* eslint-disable no-console */
// SPDX-License-Identifier: MIT
// Deliberately replace the committed baseline with the latest phase-1 run.
// Commit the result with a message that says why the baseline moved.

import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const results = resolve(dirname(fileURLToPath(import.meta.url)), "results");
await copyFile(
  resolve(results, "current", "phase-1.json"),
  resolve(results, "phase-1-baseline.json"),
);
console.log("Baseline replaced from results/current/phase-1.json");
