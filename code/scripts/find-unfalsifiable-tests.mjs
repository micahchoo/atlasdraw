// SPDX-License-Identifier: AGPL-3.0-only
//
// FU-10 — find tests that cannot fail.
//
// Three separate review rounds in the sheet-panel sequence each found an
// assertion that was structurally incapable of failing, and one of them
// (`commentMode.test.tsx`) went further and caused an entire ticket to be filed
// against behaviour the app did not have. A suite's test count is a claim about
// coverage; this script checks the claim.
//
// Two patterns, both mechanical, both drawn from defects that actually shipped:
//
//   NO-ASSERTION   a test case containing no assertion at all. It can only fail
//                  by throwing, so it passes for every behaviour that does not
//                  crash. The comment usually states the claim the assertion
//                  should have made.
//
//   ALL-GUARDED    every assertion in the case sits inside an `if`. Written to
//                  narrow a union, it doubles as a skip: when the narrowing
//                  goes false — exactly what a regression looks like — zero
//                  assertions run and the case reports green.
//
// What this does NOT catch, and no static check can: an assertion that runs and
// is simply too weak, like a CSS claim asserted against `getComputedStyle` in
// jsdom, where the value is `""` whether the rule exists or not. That is the
// rule in the UI conventions skill, not a script: a claim about layout gets a
// Playwright probe.
//
// Usage:  node scripts/find-unfalsifiable-tests.mjs [--all]
//   default   atlasdraw-owned code only
//   --all     include the vendored fork (packages/excalidraw and friends),
//             which asserts through deep helper chains this cannot follow and
//             so reports a large number of false positives
//
// Exits 1 if anything is found in the scanned scope.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const includeVendored = process.argv.includes("--all");

/** The vendored upstream fork. Ours to build on, not ours to hold to this. */
const VENDORED = [
  "packages/excalidraw/",
  "packages/element/",
  "packages/common/",
  "packages/math/",
  "packages/utils/",
];

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(p);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      const rel = p.split(path.sep).join("/");
      if (!includeVendored && VENDORED.some((v) => rel.startsWith(v))) continue;
      files.push(rel);
    }
  }
}
for (const root of ["apps", "packages"]) {
  if (fs.existsSync(root)) walk(root);
}

/** [kind, file, line, testName] */
const findings = [];

/**
 * Calls that count as an assertion.
 *
 * `findBy*` / `getBy*` throw when they find nothing, so `await
 * screen.findByText("Unreachable")` is a real assertion even though no
 * `expect` appears. Counting them is what keeps this script's own output
 * falsifiable — a checker that cries wolf gets ignored exactly like the suite
 * it is checking.
 */
const ASSERTION_NAMES = /^(expect|assert|invariant)$/;
const THROWING_QUERY = /^(get|find)(All)?By[A-Z]/;

function rootIdentifier(expr) {
  let e = expr;
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) {
    e = ts.isCallExpression(e) ? e.expression : e.expression;
  }
  return ts.isIdentifier(e) ? e.text : null;
}

function tailName(expr) {
  let e = expr;
  while (ts.isCallExpression(e)) e = e.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return ts.isIdentifier(e) ? e.text : null;
}

for (const file of files) {
  const src = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Same-file helpers that assert. `expectClean(ops)` is an assertion; a test
  // whose whole body is one call to it is fine, and flagging it would be noise.
  const assertingHelpers = new Set();
  const collectHelpers = (node) => {
    let name = null;
    let body = null;
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
      body = node.initializer.body;
    }
    if (name && body && /\bexpect\s*\(/.test(body.getText()))
      assertingHelpers.add(name);
    ts.forEachChild(node, collectHelpers);
  };
  collectHelpers(src);

  const isAssertion = (call) => {
    const root = rootIdentifier(call.expression);
    const tail = tailName(call.expression);
    if (root && ASSERTION_NAMES.test(root)) return true;
    if (root && assertingHelpers.has(root)) return true;
    if (tail && THROWING_QUERY.test(tail)) return true;
    return false;
  };

  const isTestCall = (n) => {
    if (!ts.isCallExpression(n)) return false;
    let e = n.expression;
    while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e))
      e = e.expression;
    return ts.isIdentifier(e) && (e.text === "it" || e.text === "test");
  };

  const scan = (node) => {
    if (isTestCall(node)) {
      const fn = node.arguments.find(
        (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
      );
      if (fn?.body) {
        const name =
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
            ? node.arguments[0].text
            : "<computed name>";
        const line =
          src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

        let total = 0;
        let guarded = 0;
        const count = (n, depth) => {
          if (ts.isCallExpression(n) && isAssertion(n)) {
            total++;
            if (depth > 0) guarded++;
          }
          ts.forEachChild(n, (c) =>
            count(
              c,
              depth + (ts.isIfStatement(n) && c === n.thenStatement ? 1 : 0),
            ),
          );
        };
        count(fn.body, 0);

        if (total === 0) {
          findings.push(["NO-ASSERTION", file, line, name]);
        } else if (total === guarded) {
          findings.push(["ALL-GUARDED", file, line, name]);
        }
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(src);
}

for (const [kind, file, line, name] of findings) {
  console.log(`${kind}  ${file}:${line}\n            ${name}`);
}

const scope = includeVendored ? "all packages" : "atlasdraw-owned code";
if (findings.length === 0) {
  console.log(`No unfalsifiable tests in ${scope} (${files.length} files).`);
  process.exit(0);
}
console.log(
  `\n${findings.length} unfalsifiable test case(s) in ${scope} (${files.length} files).`,
);
process.exit(1);
