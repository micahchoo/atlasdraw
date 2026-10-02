# CLAUDE.md

## Project structure

Atlasdraw is a Yarn 4 workspace: a map studio built on a fork of Excalidraw (the drawing engine) and MapLibre (the map), plus two servers.

- **`apps/atlas-app/`** — the product: the editor, the read-only viewer (`/m`) and the embed (`/embed`). `src/routes.ts` decides what a URL opens. `src/config/app-config.ts` reads every `VITE_*` variable through one schema.
- **`apps/storage/`** — the HTTP API (Fastify; SQLite and files, or Postgres and S3). Maps carry a write key; share tokens are read-only (ADR-0017).
- **`apps/realtime/`** — the relay: one Y.Doc per room over the y-websocket protocol, saved to SQLite (ADR-0014, ADR-0018).
- **`packages/excalidraw/`, `packages/element/`, `packages/math/`, `packages/common/`, `packages/utils/`** — the Excalidraw fork. Atlasdraw owns it outright (`decisions/0010-own-the-fork.md`). All five are `@atlasdraw/*` and `private: true`. Grep the fork before you trust a plan that names an Excalidraw API (`.claude/rules/excalidraw-api.md`).
- **`packages/geo/`, `packages/basemap/`, `packages/tools/`, `packages/data/`, `packages/protocol/`, `packages/cli/`** — the Atlasdraw packages, also `@atlasdraw/*`. `cli` is frozen (ADR-0016).

ADRs are in two series whose numbers collide: `decisions/` (0001–0010) and `../docs/architecture/adr/` (0006 and later). Cite an ADR by its file path.

## Workflow

1. **Product work**: `apps/atlas-app/`, `apps/realtime/`, `apps/storage/`.
2. **Fork work**: the five fork packages. The fork point is upstream master `2dfcc6f` (2026-05-02), newer than the 0.18.0 tag, so a 0.18.x advisory does not map onto this code line for line. Port only security fixes, by hand (`../VENDOR.md`).
3. **Before you commit**: `yarn test:typecheck`, then the tests of the workspace you touched.

## Commands

Run every command from this folder.

```bash
yarn start                                   # editor dev server, port 5174
yarn build                                   # editor production build (apps/atlas-app/dist)
yarn test:typecheck                          # builds the fork's types, then tsc in every workspace
yarn test --watch=false                      # Vitest, all workspaces
npx vitest run apps/storage                  # Vitest, one folder
yarn test:code                               # ESLint 9 (eslint.config.mjs): boundaries, hooks, a few correctness rules
yarn test:other                              # Prettier check (TypeScript, JS, css, scss, json, md, html, yml)
yarn test:all                                # all of the above, plus test:falsifiable
yarn fix                                     # Prettier and ESLint fixes
yarn workspace @atlasdraw/atlas-app e2e      # Playwright, chromium
```

## Architecture notes

### Packages

- `packageManager: yarn@4.15.0`. In CI, `corepack enable` runs before `setup-node`'s yarn cache step.
- One scope: everything internal is `@atlasdraw/*` (ADR 0010). The only `@excalidraw/*` names left are real npm dependencies (`eslint-config`, `prettier-config`, `laser-pointer`, `random-username`). Never rename them.
- The fork packages build with esbuild (`scripts/buildPackage.js`); the editor builds with Vite. The editor reads the fork's built types, so `yarn test:typecheck` runs `build:types` first.
- TypeScript is strict everywhere. Atlas-owned code also has `noUnusedLocals` and `noUnusedParameters` (`packages/tsconfig.base.json`); the five fork packages turn them off (183 findings in upstream code). Unused code is a type error, not a lint rule.

### Known seams

- The editor ships English only: `packages/excalidraw/locales/en.json` is the one locale. A `langCode` prop for another language falls back to English. Adding a language is a product decision, not a file drop.
