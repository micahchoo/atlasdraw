// ESLint, slim: the boundary rules, React's hook rules and a few correctness
// rules. Formatting is Prettier's job (`yarn test:other`); unused code is
// TypeScript's (`noUnusedLocals`, `noUnusedParameters`). Every rule here is
// an error or a warning that `--max-warnings=0` turns into a failure.

import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** Only the app-specific jotai modules may import jotai. */
const JOTAI = {
  name: "jotai",
  message:
    'Do not import from "jotai" directly. Use our app-specific modules ("editor-jotai" or "app-jotai").',
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/build/",
      "**/dist/",
      "**/dev-dist/",
      "**/coverage/",
      "packages/excalidraw/types/",
      "bench/results/",
      "apps/*/test-results/",
      "apps/*/playwright-report/",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/jsx-no-target-blank": ["error", { allowReferrer: true }],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
        },
      ],
      "no-restricted-imports": ["error", { paths: [JOTAI] }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
  // Command-line scripts print their result.
  {
    files: ["scripts/**", "**/scripts/**", "bench/**"],
    rules: { "no-console": "off" },
  },
  // The fork's packages import each other by relative path, never through a
  // barrel index: a barrel import makes a cycle the bundle cannot order.
  {
    files: ["packages/excalidraw/**/*.{ts,tsx}"],
    ignores: [
      "packages/excalidraw/**/*.test.{ts,tsx}",
      "packages/excalidraw/**/*.test.*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            JOTAI,
            ...[
              ".",
              "..",
              "../..",
              "../../..",
              "../../../..",
              "../../../../..",
              "../index",
              "../../index",
              "../../../index",
              "../../../../index",
            ].map((name) => ({
              name,
              message:
                "Do not import from the barrel 'index.tsx' files. Use direct relative imports to the specific module instead.",
              allowTypeImports: true,
            })),
          ],
          patterns: [
            {
              group: ["@atlasdraw/excalidraw"],
              message:
                "Do not import from the barrel 'index.tsx' files. Use direct relative imports to the specific module instead.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // common and element stand below the editor: they take only its types.
  {
    files: [
      "packages/common/src/**/*.{ts,tsx}",
      "packages/element/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [JOTAI],
          patterns: [
            {
              group: [
                "../../excalidraw",
                "../../../packages/excalidraw",
                "@atlasdraw/excalidraw",
              ],
              message:
                "Do not import from '@atlasdraw/excalidraw' package anything but types, as this package must be independent.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
