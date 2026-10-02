import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { defineConfig } from "@playwright/test";

// E2E_PORT lets a run sit beside other checkouts' dev servers. When it is set,
// the run always starts its own server on exactly that port (--strictPort), so
// it can never attach to, or fall through to, another tree's server.
const PORT = Number(process.env.E2E_PORT ?? 5174);
const BASE_URL = `http://localhost:${PORT}`;

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

// Collaboration specs (e2e/collab.spec.ts) need a relay and an editor built
// to use it: a second dev server on its own port, a hosted build with rooms
// on. The relay keeps its rooms in a fresh temporary folder. The ports and
// URL reach the specs through the environment, which the workers inherit.
// Workers load this file again; the first load's values stand.
const RELAY_PORT = Number((process.env.E2E_RELAY_PORT ??= String(freePort())));
const COLLAB_PORT = Number(
  (process.env.E2E_COLLAB_PORT ??= String(freePort())),
);
process.env.E2E_COLLAB_URL = `http://localhost:${COLLAB_PORT}`;
const ROOMS_DB = (process.env.E2E_ROOMS_DB ??= join(
  mkdtempSync(join(tmpdir(), "atlasdraw-rooms-")),
  "rooms.sqlite",
));

/**
 * Playwright config for atlas-app E2E tests.
 *
 * Three browser projects per Wave 4 Task 17 cross-browser hardening:
 *   chromium — primary; reference behaviour for sub-pixel pan/zoom math.
 *   firefox  — wheel deltaMode differs (LINE-mode default vs Chromium PIXEL);
 *              useMapWheelRouter normalises this, but the gate proves it.
 *   webkit   — Safari proxy; pointer-events propagation through nested layers
 *              has historic quirks (touch-action may need to be set explicitly).
 *
 * Tests stay sequential (workers:1, fullyParallel:false) so a single dev server
 * is shared across browser projects.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  // One retry on CI: one slow boot must not fail CI and so block the Pages
  // deploy. The failed try keeps its trace and video.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
    },
  ],
  webServer: [
    {
      // No `--cwd`: playwright runs this from the config file's own
      // directory, so yarn walks up to whichever workspace root actually
      // contains this config. Naming one checkout absolutely made an e2e run
      // from a git worktree start the OTHER tree's dev server.
      command: `yarn workspace @atlasdraw/atlas-app dev --port ${PORT} --strictPort`,
      url: BASE_URL,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "yarn workspace @atlasdraw/realtime dev",
      url: `http://localhost:${RELAY_PORT}/health`,
      env: { PORT: String(RELAY_PORT), ROOMS_DB },
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `yarn workspace @atlasdraw/atlas-app dev --port ${COLLAB_PORT} --strictPort`,
      url: process.env.E2E_COLLAB_URL,
      env: {
        VITE_BUILD_TARGET: "hosted",
        VITE_REALTIME_ENABLED: "true",
        VITE_REALTIME_WS_URL: `ws://localhost:${RELAY_PORT}`,
      },
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
