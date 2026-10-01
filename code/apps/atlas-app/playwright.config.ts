import { defineConfig } from "@playwright/test";

// E2E_PORT lets a run sit beside other checkouts' dev servers. When it is set,
// the run always starts its own server on exactly that port (--strictPort), so
// it can never attach to, or fall through to, another tree's server.
const PORT = Number(process.env.E2E_PORT ?? 5174);
const BASE_URL = `http://localhost:${PORT}`;

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
  webServer: {
    // No `--cwd`: playwright runs this from the config file's own directory, so
    // yarn walks up to whichever workspace root actually contains this config.
    // It used to name one developer's main checkout absolutely, which meant an
    // e2e run from a git worktree started the OTHER tree's dev server and
    // silently tested code that was not the code under test.
    command: `yarn workspace @atlasdraw/atlas-app dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
    stdout: "ignore",
    stderr: "pipe",
  },
});
