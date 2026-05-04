import { defineConfig } from "@playwright/test";

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
    baseURL: "http://localhost:5174",
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
    command:
      "yarn --cwd /mnt/Ghar/2TA/DevStuff/atlasdraw/code workspace @atlasdraw/atlas-app dev",
    url: "http://localhost:5174",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
