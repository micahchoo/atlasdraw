// SPDX-License-Identifier: MIT
// packages/cli/src/index.ts
// Phase 3 Wave 2 T10 — programmatic entry point.
//
// `package.json#main` and `#types` point at this file so consumers can import
// CLI internals (e.g. for testing or embedding). The executable entry with
// the shebang lives in `./atlasdraw.ts` and is wired through `package.json#bin`.

export { runLint, lintCommand } from "./commands/lint.js";
export type { LintStreams } from "./commands/lint.js";
