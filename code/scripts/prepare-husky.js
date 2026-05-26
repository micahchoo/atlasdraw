#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/prepare-husky.js
//
// Closes atlasdraw-0c97. The Excalidraw monorepo's `code/` lived as a git
// subrepo with its own .git directory; husky 7's `install` looks for
// `.git` in the script's CWD. Atlasdraw retired the subrepo layout and
// hoisted git to the parent, leaving `code/.git` missing — `yarn install`
// in `code/` then errored with ".git can't be found" at the postinstall
// step (deps still installed; the noisy failure was dev-friction).
//
// Fix: locate the actual git toplevel via `git rev-parse --show-toplevel`,
// chdir there, and invoke husky pointing at the relative `.husky` path.
// husky 7's bin works fine when run from a directory that contains `.git`.
// If git isn't available at all (npm install on a tarball, sandbox),
// silently skip — there's nothing to install hooks into.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

function run(cmd, args, opts) {
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

let gitRoot;
try {
  gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  console.log("[husky] no git context — skipping hook install");
  process.exit(0);
}

const huskyBin = path.join(__dirname, "..", "node_modules", ".bin", "husky");
const huskyDirRel = path.relative(
  gitRoot,
  path.join(__dirname, "..", ".husky"),
);

try {
  run(huskyBin, ["install", huskyDirRel], { cwd: gitRoot });
} catch (err) {
  console.warn(
    `[husky] install failed (${err && err.message}); continuing without hooks`,
  );
  process.exit(0);
}
