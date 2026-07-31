import base from "./playwright.config";

/**
 * The same e2e suite, but against a server this run started itself.
 *
 * The base config sets `reuseExistingServer: !process.env.CI`, so a local run
 * attaches to whatever is already listening on :5174. That is the fast loop and
 * it is the right default — but it means a run can silently test modules a
 * long-lived dev server transformed hours ago, which is the trap that produced
 * a phantom "missing export" on this branch and cost an afternoon. It also
 * means a run inherits any mutant a previous experiment left in that server.
 *
 * Use this config when the answer has to attach to the source on disk rather
 * than to a server's memory of it: mutation checks, "does this fail before the
 * fix", and any result you are about to report. It boots its own server on a
 * dedicated port with `reuseExistingServer: false`, so it cannot pick up
 * anyone else's, and chromium only, because that is what those checks need.
 *
 *   npx playwright test --config=playwright.clean.config.ts e2e/<spec>
 */
export default {
  ...base,
  use: { ...base.use, baseURL: "http://localhost:5311" },
  projects: [{ name: "chromium", use: { browserName: "chromium" as const } }],
  webServer: {
    command: "yarn workspace @atlasdraw/atlas-app dev --port 5311 --strictPort",
    url: "http://localhost:5311",
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  },
};
