# CLAUDE.md

## Project Structure

Atlasdraw is a **yarn workspaces monorepo**: a collaborative map-drawing product built on a fork of Excalidraw (canvas engine) merged with MapLibre (map rendering), plus product-specific services.

- **`apps/atlas-app/`** - The product: the Atlasdraw editor SPA (MapLibre + Excalidraw stacked), hosted at app.atlasdraw.org. This is where atlasdraw-specific feature work happens.
- **`apps/realtime/`** - Collaboration server (Socket.IO + Yjs sync).
- **`apps/storage/`** - Backend API (Fastify + Postgres/S3 + Stripe billing).
- **`packages/excalidraw/`, `packages/element/`, `packages/math/`, `packages/common/`, `packages/utils/`** - The forked Excalidraw core, owned outright per ADR 0010 and scoped `@atlasdraw/*` like everything else (renamed from `@excalidraw/*` 2026-07-04; all five are `private: true`, never published). Grep the vendored source before trusting any plan that names an Excalidraw API — see `.claude/rules/excalidraw-api.md`.
- **`packages/basemap/`, `packages/geo/`, `packages/tools/`, `packages/data/`, `packages/protocol/`, `packages/sdk/`, `packages/cli/`** - Atlasdraw-native packages, also `@atlasdraw/*`.
- **`excalidraw-app/`** - The original unmodified upstream Excalidraw demo app. Not built, tested, or deployed by any CI workflow or the Docker path — kept only as a reference/diff target against upstream. Do not add atlasdraw product work here.
- **`examples/`** - Upstream Excalidraw npm-package integration examples (NextJS, browser script). Unrelated to the atlasdraw product.

## Development Workflow

1. **Product feature work**: `apps/atlas-app/` (editor UI), `apps/realtime/` (collab), `apps/storage/` (backend).
2. **Forked-engine work**: `packages/excalidraw/`, `packages/element/`, `packages/math/`, `packages/common/` — fully owned per ADR 0010; upstream Excalidraw is a one-time vendor (last absorbed: v0.18.0) and only security fixes get manually backported.
3. **Testing**: `yarn test:typecheck`, `yarn test` (vitest), `yarn workspace @atlasdraw/atlas-app e2e` (Playwright) as relevant to the workspace touched.
4. **Type Safety**: `yarn test:typecheck` before committing.

## Development Commands

```bash
yarn test:typecheck              # TypeScript type checking, all workspaces
yarn test                        # vitest, all workspaces
yarn fix                         # Auto-fix formatting and linting issues
yarn workspace @atlasdraw/atlas-app dev     # run the product locally
yarn workspace @atlasdraw/atlas-app build   # production build (apps/atlas-app/dist)
```

## Architecture Notes

### Package System

- Uses Yarn 4 workspaces for monorepo management (`packageManager: yarn@4.15.0` — corepack must be enabled before `setup-node`'s yarn cache step, see CI workflow comments).
- Single package scope: everything internal is `@atlasdraw/*` (ADR 0010). The only `@excalidraw/*` names left are genuine external npm deps (`eslint-config`, `prettier-config`, `laser-pointer`, `random-username`, `mermaid-to-excalidraw`) — never rename those.
- Build system uses esbuild for packages, Vite for `apps/atlas-app`.
- TypeScript throughout with strict configuration.

### Known seams (tracked, not yet resolved)

- `packages/excalidraw/locales` ships 59 upstream locale files with no active translation coverage tooling (`locales-coverage.yml` is disabled) — treat as dead weight until a real i18n decision is made, don't add new keys expecting them to be translated.
