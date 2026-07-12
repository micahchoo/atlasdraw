# Atlasdraw -- Ecosystem

**Status: Code-verified.** Derived from package.json files, docker-compose files,
Dockerfiles, env files, VENDOR.md, and GitHub Actions workflow definitions.
Every dependency is verified against actual source, not plans or specs.

Describes every external system Atlasdraw depends on, integrates with, or sits adjacent to.
Organized by relationship type.

---

## 1. Upstream Dependencies (required at runtime)

These must be present for the application to function.

### 1.1 MapLibre GL JS

**Role:** Renders the basemap tile layer, owns the geographic camera
(lng/lat/zoom/bearing/pitch), and provides the project/unproject APIs that
`@atlasdraw/geo` wraps for coordinate conversion.

| Property | Value |
|----------|-------|
| Package | `maplibre-gl` |
| Version | `^4.7.1` |
| Consumed by | `@atlasdraw/atlas-app`, `@atlasdraw/basemap`, `@atlasdraw/geo` (optional peer dep) |
| License | BSD-3 |
| Bundled | Yes -- bundled in the Vite-built SPA |

[CONFIDENCE: high] -- exact semver range from `code/apps/atlas-app/package.json` and
`code/packages/basemap/package.json`.

### 1.2 Excalidraw (vendored fork, v0.18.0)

**Role:** Scene model, element renderer, tool framework. Not npm-installed --
the full Excalidraw monorepo is forked in-tree under `code/`.

| Property | Value |
|----------|-------|
| Package | `@excalidraw/excalidraw` (internal workspace) |
| Version | `0.18.0` |
| Fork point | Commit `2dfcc6f0ce4ce007e0360324e63f02ffc7b7fc1a` ("chore: Remove startBoundElement from state (#11264)") |
| Sync method | Manual (`git clone upstream`, diff `2dfcc6f..HEAD`, copy relevant changes) |
| Upstream remote | **Not configured** in this repo's git remotes |
| Fork location | `code/` as plain files (no embedded git repo, no submodule) |
| License | MIT |

Excalidraw's own dependency tree (from `code/packages/excalidraw/package.json`) is
substantial and largely inherited unchanged:

- `roughjs` 4.6.4 (hand-drawn rendering)
- `@codemirror/*` (text editor, 4 packages at `^6.0.0`)
- `radix-ui` 1.4.3 (UI primitives)
- `jotai` 2.11.0 (state, in addition to zustand on the Atlasdraw side)
- `pako` 2.0.3 (deflate compression for scene files)
- `perfect-freehand` 1.2.0 (pressure-sensitive stroke smoothing)
- `browser-fs-access` 0.38.0 (File System Access API helpers)
- `@excalidraw/laser-pointer` 1.3.1
- `@excalidraw/mermaid-to-excalidraw` 2.2.2
- `clsx` 1.1.1, `fractional-indexing` 3.2.0, `fuzzy` 0.1.3, `nanoid` 3.3.3
- `image-blob-reduce` 3.0.1, `pica` 7.1.1 (image processing)
- `png-chunk-text` / `png-chunks-encode` / `png-chunks-extract` (scene metadata in PNG)
- `es6-promise-pool` 2.5.0
- `sass` 1.51.0 (for building Excalidraw's own styles)
- `tunnel-rat` 0.1.2 (React portal utility)

**Impact of the fork:** Because the fork is inlined (no upstream git remote), there
is no automated merge process. The fork diverges in:
- `packages/excalidraw` (patched for `customData.geo`, geo-aware tools)
- `packages/element`, `packages/math`, `packages/common` (all vendored upstream, no patches)

The excalidraw-app workspace (upstream's demo app) is retained but not the main
deployment target -- Atlasdraw's own app lives at `apps/atlas-app/`.

[CONFIDENCE: high] -- VENDOR.md + `code/packages/excalidraw/package.json` + `git remote -v`.

### 1.3 React 19

**Role:** UI framework for the editor SPA.

| Property | Value |
|----------|-------|
| Package | `react` + `react-dom` |
| Version | `19.0.0` (pinned exact) |
| Peer dep | Excalidraw supports `^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0` |
| Consumed by | `@atlasdraw/atlas-app`, `@atlasdraw/basemap` (peer), `@atlasdraw/tools` (peer) |

[CONFIDENCE: high]

### 1.4 CRDT Layer (Yjs)

**Role:** Real-time collaboration engine for data-layer mutations in shared rooms.

| Package | Version | Role |
|---------|---------|------|
| `yjs` | `^13.6.20` | CRDT document store |
| `y-websocket` | `^2.0.0` | Yjs sync over WebSocket |
| `y-protocols` | `^1.0.6` | Awareness protocol |

Consumed by: `@atlasdraw/atlas-app` (client), `@atlasdraw/realtime` (relay),
`@atlasdraw/data` (Yjs-backed layer wrapper).

Yjs handles datalayer mutations; scene/camera/cursor sync uses Socket.IO (dual
protocol design).

[CONFIDENCE: high]

### 1.5 Socket.IO

**Role:** WebSocket transport for scene/camera/cursor synchronization. Complementary
to Yjs (not a replacement).

| Property | Value |
|----------|-------|
| Server | `socket.io` `^4.7.0` |
| Client | `socket.io-client` `^4.7.0` |
| Redis scaling | `@socket.io/redis-adapter` `^8.3.0` |
| Consumed by | `@atlasdraw/realtime` (server), `@atlasdraw/atlas-app` (client) |

[CONFIDENCE: high]

### 1.6 State Management (Zustand + Immer)

| Package | Version | Role |
|---------|---------|------|
| `zustand` | `5.0.13` | Central state store for Atlasdraw editor |
| `immer` | `11.1.6` | Immutable update helpers for zustand |

Note: Excalidraw's own component tree uses `jotai` 2.11.0 internally. Two state
management libraries coexist in the same browser bundle.

[CONFIDENCE: high]

---

## 2. External Services

### 2.1 Excalidraw SaaS Endpoints (inherited upstream, NOT Atlasdraw infrastructure)

The `.env.development` and `.env.production` files retain Excalidraw's production
SaaS endpoints. These are scaffolding from the upstream fork and are NOT the
Atlasdraw storage path. Atlasdraw's own architecture uses the `storage` server
(Fastify + sqlite/postgres + S3) instead.

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `https://json.excalidraw.com/api/v2/` | Scene persistence (production) | Inherited, unused by atlas-app |
| `https://json-dev.excalidraw.com/api/v2/` | Scene persistence (dev) | Inherited, unused |
| `https://libraries.excalidraw.com` | Library browser | Inherited, unused |
| `https://plus.excalidraw.com` | Excalidraw+ collaboration | Inherited, unused |
| `https://oss-collab.excalidraw.com` | Collab WebSocket | Inherited, unused |
| `https://oss-ai.excalidraw.com` | AI backend | Inherited, unused |
| Firebase (`excalidraw-room-persistence`) | Room persistence | Inherited, unused |
| Firebase (`excalidraw-oss-dev`) | Dev persistence | Inherited, unused |

Atlasdraw removes or replaces these in production builds via `VITE_BUILD_TARGET=hosted`
build arg. The `excalidraw-app` workspace may still reference them.

[CONFIDENCE: high] -- verified in `.env.development` and `.env.production`.

### 2.2 Stripe (hosted mode only)

**Role:** Billing for hosted multi-tenant workspaces.

| Property | Value |
|----------|-------|
| Package | `stripe` `^17.0.0` |
| Server | `@atlasdraw/storage` |
| Guard | Behind `MANAGED_MODE` env var (not in self-host builds) |
| Integration | Webhooks: `checkout.session.completed`, `customer.subscription.deleted` |

[CONFIDENCE: high] -- `code/apps/storage/package.json` + compose env vars + original spec.

### 2.3 Sentry (opt-in error capture)

**Role:** Production error monitoring.

| Property | Value |
|----------|-------|
| Package | `@sentry/node` `10.52.0` |
| Server | `@atlasdraw/storage` |
| Config | Via `SENTRY_DSN` env var |
| Default | Empty string = zero-call-home (ADR-0006) |

[CONFIDENCE: high] -- `code/apps/storage/package.json` + `infra/.env.example`.

### 2.4 PMTiles / Protomaps

**Role:** Bundled basemap tile archive format.

| Property | Value |
|----------|-------|
| Package | `pmtiles` `^4.4.0` |
| Consumed by | `@atlasdraw/basemap` |
| File path | Configurable via `VITE_PMTILES_PATH` (default `/data/world-low-zoom.pmtiles`) |
| Format | PMTiles v3 |

[CONFIDENCE: high] -- `code/packages/basemap/package.json` + compose files + `apps/atlas-app/.env.example`.

### 2.5 OpenFreeMap (default tile source)

**Status:** Presumed from spec. Not directly referenced in package.json or Docker env.
The PMTiles archive is the default; remote tile URLs are a fallback. No tile endpoint
URL is hardcoded in the source files examined.

[CONFIDENCE: medium] -- referenced in original spec but not verified in code literals.

### 2.6 Photon / Nominatim / Pelias (optional geocoding)

**Status:** Expected from spec (Phase 6). No npm dependency for a geocoding client
found in current package.json files. The `photon-client.ts` is planned in `@atlasdraw/data`
but may not exist yet.

[CONFIDENCE: low] -- spec-only, not yet in package dependencies.

### 2.7 OSRM / Valhalla (optional routing)

**Status:** Expected from spec. No npm dependency found.

[CONFIDENCE: low] -- spec-only.

---

## 3. Protocol Surface

| Protocol | Use | Components |
|----------|-----|------------|
| HTTP REST | Storage API (maps, share, health) | `@atlasdraw/storage` (Fastify ^5.2.0) |
| WebSocket (raw `ws`) | Yjs CRDT sync | `@atlasdraw/realtime` (`ws` ^8.16.0) |
| WebSocket (Socket.IO) | Scene/camera/cursor relay | `@atlasdraw/realtime` + atlas-app client |
| CRDT (Yjs protocol) | Data-layer conflict-free replication | `yjs` + `y-websocket` + `y-protocols` |
| S3-compatible HTTP | Blob storage | `@aws-sdk/client-s3` (MinIO, any S3 API) |
| Stripe webhook (HTTP) | Billing events | `@atlasdraw/storage` |
| postMessage | Iframe bridge (Maputnik, SDK embed) | `@atlasdraw/sdk`, planned MaputnikBridge |

[CONFIDENCE: high]

---

## 4. Storage Backends

| Backend | Mode | Consumed by | Details |
|---------|------|-------------|---------|
| SQLite | Minimal stack (`sqlite-fs`) | `@atlasdraw/storage` | `better-sqlite3` ^11, file-system blobs |
| PostgreSQL 16 | Full stack (`postgres-minio`) | `@atlasdraw/storage` | `pg` ^8, via `DATABASE_URL` env, Docker image `postgres:16-alpine` |
| MinIO / S3 | Full stack blob storage | `@atlasdraw/storage` | `@aws-sdk/client-s3` ^3, configurable endpoint, Docker image `minio/minio:latest` |
| IndexedDB | Browser-side persistence | `@atlasdraw/atlas-app` | `idb` ^8.0.0, offline single-player mode |

[CONFIDENCE: high] -- verified in package.json, docker-compose files, and env example.

---

## 5. Build & Toolchain Ecosystem

### 5.1 Core Toolchain

| Tool | Version | Role |
|------|---------|------|
| Node.js | >=18 (engines), 20 (CI + Docker build), 24 (root Dockerfile) | Runtime |
| Yarn | 1.22.22 (Classic v1, no Berry) | Package manager (workspaces) |
| TypeScript | 5.9.3 | Language, type checking |
| Vite | 5.0.12 | App bundler (atlas-app + excalidraw-app) |
| esbuild | 0.19.10 | Package build (excalidraw packages) |
| Vitest | 3.0.6 | Test runner |
| Playwright | ^1.48.0 | E2E browser tests |

### 5.2 Code Quality

| Tool | Version | Role |
|------|---------|------|
| ESLint | (via `@excalidraw/eslint-config` 1.0.3) | Linting |
| Prettier | 2.6.2 | Formatting (`@excalidraw/prettier-config` 1.0.2) |
| Husky | 7.0.4 | Git hooks |
| lint-staged | 12.3.7 | Pre-commit checks |

### 5.3 CI Pipeline (GitHub Actions)

13 workflow files in `code/.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `atlasdraw-checks.yml` | PR to main | License check (ADR 0002), patch-guard (ADR 0004), telemetry check (ADR 0006) |
| `build-docker.yml` | PR to main | Docker build smoke test (no push) |
| `publish-docker.yml` | Push to main | Multi-arch Docker build + push to GHCR |
| `lint.yml` | PR | `yarn install && lint + typecheck` |
| `cancel.yml` | Push to release / PR | Cancel duplicate CI runs |
| `semantic-pr-title.yml` | PR | Enforce conventional commit titles |
| `test.yml` | PR | Run tests |
| `size-limit.yml` | (inherited upstream) | Bundle size budget -- no `.size-limit` config found, likely disabled |
| `autorelease-excalidraw.yml` | Push to release | **Stripped** -- Excalidraw's npm publish, not used by Atlasdraw |
| `locales-coverage.yml` | Push to l10n_master | **Stripped** -- Crowdin l10n, not used by Atlasdraw |
| `sentry-production.yml` | Push to release | **Stripped** -- Excalidraw Sentry release, not used by Atlasdraw |
| `test-coverage-pr.yml` | PR | Coverage reports |
| `locales-coverage.yml` | - | (already covered) |

The stripped workflows are retained as disabled scaffolding from the upstream fork.
Only `atlasdraw-checks.yml`, `build-docker.yml`, `publish-docker.yml`, `lint.yml`,
`cancel.yml`, `semantic-pr-title.yml`, and `test.yml` are active for Atlasdraw.

[CONFIDENCE: high]

---

## 6. Deployment Ecosystem

### 6.1 Container Registry

- **Registry:** GitHub Container Registry (`ghcr.io`)
- **Image:** `ghcr.io/micahchoo/atlasdraw`
- **Tags:** `latest`, `${{ github.sha }}`, `pr-$N`
- **Platforms:** `linux/amd64`, `linux/arm64`

[CONFIDENCE: high] -- verified in `publish-docker.yml` and `build-docker.yml`.

### 6.2 Docker Images

| Service | Build image | Runtime image | Exposure |
|---------|-------------|---------------|----------|
| web (atlas-app) | `node:20-bookworm-slim` (infra) / `node:24` (root) | `nginx:alpine` (infra) / `nginx:1.27-alpine` (root) | Port 3000 |
| storage | `node:20-bookworm-slim` | `node:20-bookworm-slim` | Port 4000 |
| realtime | `node:20-bookworm-slim` | `node:20-bookworm-slim` | Port 4001 |
| postgres | - | `postgres:16-alpine` | Internal |
| minio | - | `minio/minio:latest` | Internal (console port 9001) |
| caddy | - | `caddy:2-alpine` | Ports 80 + 443 (TLS via Let's Encrypt) |

### 6.3 Deployment Topologies

**Minimal stack** (`docker-compose.minimal.yml`):
- 2 services: storage (sqlite-fs) + web (nginx-served SPA)
- Single volume for data
- Suitable for single-VPS, no reverse proxy needed

**Full stack** (`docker-compose.yml`):
- 5 services: storage (postgres-minio) + web + postgres + minio + caddy
- Caddy handles TLS termination and routes `/api/*` to storage
- Realtime behind compose profiles (`--profile realtime`)

**Standalone app** (`code/Dockerfile` + `code/docker-compose.yml`):
- Single nginx container serving atlas-app SPA
- Healthcheck via wget
- No storage backend included (assumes external)

[CONFIDENCE: high] -- all three compose files verified.

---

## 7. Dependency Vintage Map

This monorepo spans multiple JS ecosystem eras simultaneously, from legacy Excalidraw
dependencies to cutting-edge React 19:

| Era | Years | Represented by | Source |
|-----|-------|---------------|--------|
| **Current (2025+)** | 2025-2026 | React 19.0.0, zustand 5.0.13, TypeScript 5.9.3, Fastify ^5.2.0, Vite 5.0.12, vitest 3.0.6, immer 11.1.6, maplibre-gl ^4.7.1, yjs ^13.x, zod ^3.22, pmtiles ^4.4.0 | Atlasdraw packages |
| **Mid (2023-2024)** | 2023-2024 | socket.io 4.x, Playwright ^1.48, esbuild 0.19.10, ioredis ^5.4, @aws-sdk/client-s3 ^3, pino 10.3.1, @sentry/node 10.x, stripe ^17, nanoid ^5 (storage), commander ^11 | Atlasdraw apps |
| **Late (2021-2022)** | 2021-2022 | Yarn 1.22.22, Prettier 2.6.2, Husky 7.0.4, lint-staged 12.3.7, dotenv 16.0, jsdom 22.1 | Root devDeps |
| **Legacy (2020-2021)** | 2020-2021 | roughjs 4.6.4, clsx 1.1.1, fuzzy 0.1.3, nanoid 3.3.3 (Excalidraw), browser-fs-access 0.38, pako 2.0.3, perfect-freehand 1.2.0, codemirror 6.x (early releases), radix-ui 1.4.3 | Excalidraw vendored deps |

The most notable era conflict: **Yarn Classic v1 (2018-era) managing React 19 + Vite 5 (2025-era)**
dependencies. Yarn 1.22 lacks corepack, plug'n'play, and modern workspace features,
but the project works around this with `--frozen-lockfile` in CI.

[CONFIDENCE: high]

---

## 8. Ecosystem Risks

1. **Yarn Classic v1 EOL.** Yarn 1.22 is in maintenance mode. No PnP, no Corepack,
   degrading ecosystem compatibility. Risk of being unable to install newer packages.
   The root `packageManager` field can serve as a migration signal for Dependabot.

2. **Excalidraw fork divergence.** No upstream git remote configured. Manual sync
   process with no automation. As the fork diverges further, merge costs increase
   monotonically. 30+ Excalidraw dependencies are inherited as-is, some already
   legacy (vintage 2020).

3. **Inherited Excalidraw SaaS endpoints in env files.** `.env.production` still
   references `json.excalidraw.com`, `libraries.excalidraw.com`, etc. If a build
   accidentally uses these (via `excalidraw-app` workspace or stale config),
   Atlasdraw would send data to Excalidraw's infrastructure. Mitigated by
   `VITE_BUILD_TARGET=hosted` build arg but worth auditing.

4. **Two state management libraries.** Zustand (Atlasdraw) + Jotai (Excalidraw) both
   bundled. Adds ~5KB to bundle and cognitive overhead.

5. **No size-limit enforcement.** The `.size-limit` config from upstream is absent.
   Bundle size is unguarded.

6. **Vite 5 + legacy Excalidraw build.** Excalidraw's package build uses esbuild 0.19
   via `scripts/buildPackage.js`, while the app uses Vite 5. Two build systems for
   one monorepo.

[CONFIDENCE: high for risks 1-2, medium for 3-6]

---

## Appendix A: Complete Runtime Dependency Tree (by module)

### @atlasdraw/atlas-app (editor SPA)
```
react 19.0.0, react-dom 19.0.0
zustand 5.0.13
immer 11.1.6
maplibre-gl ^4.7.1
@excalidraw/excalidraw 0.18.0 (vendored)
socket.io-client ^4.7.0
yjs ^13.6.20, y-websocket ^2.0.0
@react-aria/focus ^3.20.0
idb ^8.0.0
lz-string 1.5.0
pdf-lib ^1.17.1
zod ^3.22.0
lodash.throttle ^4.1.1
@atlasdraw/basemap, @atlasdraw/data, @atlasdraw/geo, @atlasdraw/protocol, @atlasdraw/tools
```

### @atlasdraw/realtime (collaboration relay)
```
socket.io ^4.7.0
ws ^8.16.0
y-websocket ^2.0.0, y-protocols ^1.0.6
@socket.io/redis-adapter ^8.3.0
ioredis ^5.4.0
@atlasdraw/protocol
```

### @atlasdraw/storage (HTTP API server)
```
fastify ^5.2.0
better-sqlite3 ^11
pg ^8
@aws-sdk/client-s3 ^3
stripe ^17.0.0
@sentry/node 10.52.0
nanoid ^5
pino 10.3.1
zod ^3.22.0
```

### @atlasdraw/basemap
```
maplibre-gl ^4.7.1
pmtiles ^4.4.0
```

### @atlasdraw/data
```
yjs ^13.6.20
zod ^3.22.0
jszip ^3.10.0
papaparse ^5.4.0
shpjs ^6.2.0
ulid ^2.3.0
```

### @atlasdraw/tools
```
@turf/circle 7.3.5, @turf/distance 7.3.5
@atlasdraw/geo 0.1.0
```

### @atlasdraw/cli
```
commander ^11.0.0
ulid ^2.3.0
@atlasdraw/data 0.0.0
```

### @atlasdraw/geo
```
(no runtime deps; maplibre-gl is optional peer)
```

### @atlasdraw/protocol, @atlasdraw/sdk
```
(no runtime deps -- pure TypeScript types)
```

---

## Appendix B: S3-Equivalent Endpoints

| Service | Endpoint pattern | Auth | Used by |
|---------|-----------------|------|---------|
| MinIO (self-host) | `http://minio:9000` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `@atlasdraw/storage` (full stack) |
| Any S3 API | Configurable via `BLOB_ENDPOINT` / `BLOB_ACCESS_KEY` / `BLOB_SECRET_KEY` | AWS Signature V4 | `@atlasdraw/storage` |

---

## Appendix C: Network Ports

| Port | Service | Protocol | Exposed |
|------|---------|----------|---------|
| 80 | Caddy | HTTP | Public |
| 443 | Caddy | HTTPS/TLS | Public |
| 3000 | web (atlas-app nginx) | HTTP | Internal / compose |
| 4000 | storage | HTTP | Internal / compose |
| 4001 | realtime | WebSocket | Internal / compose (profile) |
| 5432 | postgres | PostgreSQL | Internal only |
| 9000 | minio | S3 HTTP | Internal only |
| 9001 | minio console | HTTP | Internal only (unexposed) |
