// apps/atlas-app/vitest.config.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 1a — minimal vitest config for atlas-app unit tests.
//
// Inherits the @excalidraw/* alias setup from vite.config.ts so source-resolved
// imports (e.g. `@atlasdraw/excalidraw`) work in tests the same way they
// do at dev/build time. Uses `node` environment (no DOM) — current tests are
// pure ToolContext-shape unit tests that mock map/excalidrawAPI.

import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@atlasdraw\/common$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/common/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/common/src/$1"),
      },
      {
        find: /^@atlasdraw\/element$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/element/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/element/src/$1"),
      },
      {
        find: /^@atlasdraw\/excalidraw$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/excalidraw/index.tsx",
        ),
      },
      {
        find: /^@atlasdraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/excalidraw/$1"),
      },
      {
        find: /^@atlasdraw\/math$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/math/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/math/src/$1"),
      },
      {
        find: /^@atlasdraw\/utils$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/utils/src/$1"),
      },
    ],
  },
  test: {
    // jsdom — vendored @atlasdraw/common references `navigator` at module
    // load time, so even node-only logic tests need a DOM-ish global. Matches
    // the root code/vitest.config.mts environment.
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
  },
});
