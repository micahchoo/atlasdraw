// Monorepo test projects. Each atlasdraw package/app runs under ITS OWN
// vitest.config.ts (environment, setup files, aliases) — previously the
// root config steamrolled them with jsdom + engine setupTests, which broke
// every Blob/zip round-trip (jsdom Blob lacks .text()) and maplibre import
// (engine polyfills swap global URL for node's). The engine packages keep
// the root config via `extends`.
export default [
  {
    extends: "./vitest.config.mts",
    test: {
      name: "engine",
      include: [
        "packages/excalidraw/**/*.test.{ts,tsx}",
        "packages/element/**/*.test.{ts,tsx}",
        "packages/common/**/*.test.{ts,tsx}",
        "packages/math/**/*.test.{ts,tsx}",
        "packages/utils/**/*.test.{ts,tsx}",
      ],
    },
  },
  "apps/atlas-app/vitest.config.ts",
  "apps/storage/vitest.config.ts",
  "apps/realtime/vitest.config.ts",
  "packages/data/vitest.config.ts",
  "packages/geo/vitest.config.ts",
  "packages/protocol/vitest.config.ts",
  "packages/tools/vitest.config.ts",
  "packages/basemap/vitest.config.ts",
  "packages/cli/vitest.config.ts",
  "bench/vitest.config.ts",
];
