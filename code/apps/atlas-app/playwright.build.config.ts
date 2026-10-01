import { defineConfig } from "@playwright/test";

/**
 * Specs that need the production build, not the dev server: the content
 * security policy is written into index.html by the build only
 * (src/lib/contentSecurityPolicy.ts). This config builds the app as a
 * hosted build with rooms, serves dist/ with `vite preview`, and runs
 * e2e-build/ in chromium.
 *
 *   E2E_BUILD_PORT=5316 npx playwright test --config=playwright.build.config.ts
 *
 * E2E_BUILD_URL runs the same specs against a server you started, such as
 * the nginx image serving dist/; then nothing is built here.
 */
const PORT = Number(process.env.E2E_BUILD_PORT ?? 5316);
const URL = process.env.E2E_BUILD_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e-build",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: process.env.E2E_BUILD_URL
    ? undefined
    : {
        command: `yarn workspace @atlasdraw/atlas-app build && yarn workspace @atlasdraw/atlas-app preview --port ${PORT} --strictPort`,
        env: {
          VITE_BUILD_TARGET: "hosted",
          VITE_STORAGE_BASE_URL: "/api",
          VITE_REALTIME_ENABLED: "true",
        },
        url: URL,
        timeout: 300_000,
        reuseExistingServer: false,
        stdout: "ignore",
        stderr: "pipe",
      },
});
