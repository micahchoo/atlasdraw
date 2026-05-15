// SPDX-License-Identifier: AGPL-3.0-only
// Vitest config for @atlasdraw/realtime adversarial tests.
//
// Uses the `node` environment because the relay is a plain Node HTTP/WS server
// with no DOM dependency. Only the `tests/` directory is included so vitest
// does not pick up source files or unrelated test patterns.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
