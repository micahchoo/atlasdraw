import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { defineConfig } from "@playwright/test";

/**
 * The e2e suite for what ships: a production build, served the way it is
 * deployed, in chromium. e2e-build/ drives the app through its UI only; a
 * production build has no development hook (window.__atlasdraw__).
 *
 *   E2E_TARGET=hosted  (default) a hosted build with rooms and storage,
 *                      served by `vite preview` at /
 *   E2E_TARGET=pages   the GitHub Pages build (pages.yml), served by
 *                      e2e-build/serve-pages.mjs at /atlasdraw/, with the
 *                      404.html fallback Pages uses for deep links
 *
 *   E2E_BUILD_PORT=5316 npx playwright test --config=playwright.build.config.ts
 *   E2E_TARGET=pages npx playwright test --config=playwright.build.config.ts
 *
 * The hosted target also starts the storage server (SQLite and files, in a
 * fresh temporary folder); `vite preview` serves it at /api, as nginx does.
 *
 * E2E_BUILD_URL runs the same specs against a server you started, such as
 * the nginx image serving dist/; then nothing is built here.
 */
const TARGET = process.env.E2E_TARGET === "pages" ? "pages" : "hosted";
const PORT = Number(process.env.E2E_BUILD_PORT ?? 5316);
const URL =
  process.env.E2E_BUILD_URL ??
  `http://localhost:${PORT}${TARGET === "pages" ? "/atlasdraw/" : "/"}`;

/** A port no process listens on now, from the OS. */
function freePort(): number {
  return Number(
    execFileSync(process.execPath, [
      "-e",
      "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})",
    ])
      .toString()
      .trim(),
  );
}

// Workers load this file again; the first load's values stand.
const STORAGE_PORT = Number(
  (process.env.E2E_STORAGE_PORT ??= String(freePort())),
);
const STORAGE_DIR = (process.env.E2E_STORAGE_DIR ??= mkdtempSync(
  join(tmpdir(), "atlasdraw-storage-"),
));

const BUILDS = {
  hosted: {
    env: {
      VITE_BUILD_TARGET: "hosted",
      VITE_STORAGE_BASE_URL: "/api",
      VITE_REALTIME_ENABLED: "true",
      // Keeps window.__atlasdraw__ (hooks/useDevHandles.ts) for the specs
      // that read the session. Pages builds without it, as pages.yml does.
      VITE_E2E_HOOKS: "1",
      // vite.config.ts: preview serves the storage server at /api.
      PREVIEW_API_PROXY: `http://localhost:${STORAGE_PORT}`,
    },
    serve: `yarn workspace @atlasdraw/atlas-app preview --port ${PORT} --strictPort`,
  },
  // The same variables as .github/workflows/pages.yml.
  pages: {
    env: {
      VITE_BUILD_TARGET: "pages",
      VITE_PMTILES_PATH: "/atlasdraw/data/world-low-zoom.pmtiles",
    },
    serve: `node e2e-build/serve-pages.mjs dist ${PORT}`,
  },
} as const;

// The specs read the target to know what the build promises (embeds are on
// in the hosted build, off on Pages). Workers inherit it.
process.env.E2E_TARGET = TARGET;

export default defineConfig({
  testDir: ".",
  // The hosted build has the e2e hook, so it also runs the dev-suite specs
  // that need it and are about built behaviour.
  testMatch: [
    "e2e-build/**/*.spec.ts",
    ...(TARGET === "hosted" ? ["e2e/one-history.spec.ts"] : []),
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // One retry on CI, so one slow boot does not fail the build (and block
  // the Pages deploy); the trace of the failed try is kept.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: `chromium-${TARGET}`, use: { browserName: "chromium" } }],
  webServer: process.env.E2E_BUILD_URL
    ? undefined
    : [
        ...(TARGET === "hosted"
          ? [
              {
                command:
                  "yarn workspace @atlasdraw/storage build && yarn workspace @atlasdraw/storage start",
                env: {
                  STORAGE_MODE: "sqlite-fs",
                  DATA_DIR: STORAGE_DIR,
                  PORT: String(STORAGE_PORT),
                },
                url: `http://localhost:${STORAGE_PORT}/health`,
                timeout: 120_000,
                reuseExistingServer: false,
                stdout: "ignore" as const,
                stderr: "pipe" as const,
              },
            ]
          : []),
        {
          command: `yarn workspace @atlasdraw/atlas-app build && ${BUILDS[TARGET].serve}`,
          env: BUILDS[TARGET].env,
          url: URL,
          timeout: 300_000,
          reuseExistingServer: false,
          stdout: "ignore",
          stderr: "pipe",
        },
      ],
});
