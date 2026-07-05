import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@atlasdraw\/common$/,
        replacement: path.resolve(__dirname, "./packages/common/src/index.ts"),
      },
      {
        find: /^@atlasdraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/common/src/$1"),
      },
      {
        find: /^@atlasdraw\/element$/,
        replacement: path.resolve(__dirname, "./packages/element/src/index.ts"),
      },
      {
        find: /^@atlasdraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/element/src/$1"),
      },
      {
        find: /^@atlasdraw\/excalidraw$/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/index.tsx"),
      },
      {
        find: /^@atlasdraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/$1"),
      },
      {
        find: /^@atlasdraw\/math$/,
        replacement: path.resolve(__dirname, "./packages/math/src/index.ts"),
      },
      {
        find: /^@atlasdraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/math/src/$1"),
      },
      {
        find: /^@atlasdraw\/utils$/,
        replacement: path.resolve(__dirname, "./packages/utils/src/index.ts"),
      },
      {
        find: /^@atlasdraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/utils/src/$1"),
      },
    ],
  },
  //@ts-ignore
  test: {
    // Since hooks are running in stack in v2, which means all hooks run serially whereas
    // we need to run them in parallel
    sequence: {
      hooks: "parallel",
    },
    setupFiles: ["./setupTests.ts"],
    globals: true,
    environment: "jsdom",
    // Playwright suites — driven by `playwright test`, never by vitest.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/atlas-app/e2e/**",
      "tests/e2e/**",
    ],
    coverage: {
      reporter: ["text", "json-summary", "json", "html", "lcovonly"],
      // Since v2, it ignores empty lines by default and we need to disable it as it affects the coverage
      // Additionally the thresholds also needs to be updated slightly as a result of this change
      ignoreEmptyLines: false,
      thresholds: {
        lines: 60,
        branches: 70,
        functions: 63,
        statements: 60,
      },
    },
  },
});
