#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// packages/cli/src/atlasdraw.ts
// Phase 3 Wave 2 T10 — Commander entry point for the atlasdraw CLI.
//
// Subcommands register themselves by exporting a `Command` instance and being
// added here via `program.addCommand(...)`. Today: `lint`. Round 2 will add
// `convert` (T11) and `render` (T12) — they should follow the same pattern.

import { Command } from "commander";
import { lintCommand } from "./commands/lint.js";
import { convertCommand } from "./commands/convert.js";

const program = new Command();

program
  .name("atlasdraw")
  .description("atlasdraw CLI — headless tooling for .atlasdraw files")
  .version("0.0.0");

program.addCommand(lintCommand);
program.addCommand(convertCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  // Commander's parseAsync rejects only on programmer error or an action
  // handler that throws something non-Commander. Surface verbatim with a
  // non-zero exit so the user (or CI) sees something useful.
  process.stderr.write(
    `${(err as Error).name ?? "Error"}: ${(err as Error).message ?? String(err)}\n`,
  );
  process.exit(1);
});
