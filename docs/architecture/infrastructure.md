# Atlasdraw -- Infrastructure

**Status: Verified against running code (May 2026).** Every claim traces to a
source file. See the section footers for file paths.

---

## Runtime Topology

Atlasdraw ships as a set of distinct Node.js and nginx processes. In full-stack
deployment, a single Caddy reverse proxy front-ends all services.

```
                         (TLS termination)
  ┌──────────┐ 80/443 ┌─────────┐
  │  Client  │ ──────► │  Caddy  │
  └──────────┘         └─────────┘
                          │
           ┌──────────────┼────────────────────┐
           ▼              ▼                     ▼
       ┌────────┐   ┌──────────┐   ┌────────────────┐
       │  web   │   │ storage  │   │  realtime(*)   │
       │ :3000  │   │  :4000   │   │     :4001      │
       │ (nginx)│   │ (Fastify)│   │ (Socket.IO+Yjs)│
       └────────┘   └──────────┘   └────────────────┘
                        │                  │
                        ▼                  │
                    ┌─────────┐            │
                    │ postgres│            │
                    │  :5432  │            │
                    └─────────┘            │
                        │                  │
                        ▼                  │
                    ┌─────────┐            │
                    │  minio  │            │
                    │  :9000  │            │
                    └─────────┘            │
                                           │
                                    (opt-in Redis)
```

### Process table

| Process | Runtime | Image base | Entry point | Start command |
|---------|---------|------------|-------------|---------------|
| web (atlas-app) | nginx 1.27-alpine | `nginx:alpine` | `/usr/share/nginx/html` (static) | nginx default |
| storage | Node.js 20 | `node:20-bookworm-slim` | `dist/index.js` | `node dist/index.js` |
| realtime | Node.js 20 | `node:20-bookworm-slim` | `dist/index.js` | `node dist/index.js` |
| postgres | postgres 16-alpine | `postgres:16-alpine` | standard | standard |
| minio | minio/minio | `minio/minio:latest` | `server /data` | custom CMD |
| caddy | Go | `caddy:2-alpine` | `/etc/caddy/Caddyfile` | standard |

(*realtime is opt-in via Docker Compose profiles)

[Sources: `code/Dockerfile` (monolith), `code/apps/atlas-app/Dockerfile`,
`code/apps/storage/Dockerfile`, `code/apps/realtime/Dockerfile`,
`infra/docker-compose.yml`]
[CONFIDENCE: high]

### Inter-service contracts

- **web -> storage**: HTTP via Caddy reverse proxy. Caddy routes `/api/*` to
  `storage:4000` and strips the `/api` prefix. WebSocket not used between web
  and storage. [CONFIDENCE: high]

- **web -> realtime**: Browser-native WebSocket (Socket.IO client) and
  y-websocket over separate TCP connections. Dual-socket design prevents
  head-of-line blocking between Yjs catch-up and cursor events.
  [CONFIDENCE: high]

- **storage -> postgres**: `pg` Pool (TCP). Connection string from
  `DATABASE_URL` env var. Accessed via postgres-minio adapter only.
  [CONFIDENCE: high]

- **storage -> minio/S3**: `@aws-sdk/client-s3` (HTTP). Endpoint, access key,
  secret from env vars. Bucket name: `atlasdraw-maps`. Auto-created on first
  write. [CONFIDENCE: high]

- **realtime -> Redis** (optional): `@socket.io/redis-adapter` + `ioredis`.
  Only initialized when `REDIS_URL` env is set. [CONFIDENCE: high]

[Sources: `infra/caddy/Caddyfile`, `code/apps/storage/src/adapters/postgres-minio.ts`,
`code/apps/realtime/src/index.ts`, `code/apps/realtime/src/redis-adapter.ts`]

---

## Containerization

### Docker images

The monorepo produces four distinct Docker images:

**1. Monolith image** (`code/Dockerfile`)
- Build stage: `node:24` (multi-arch build via `BUILDPLATFORM`/`TARGETARCH`)
- Runtime: `nginx:1.27-alpine`
- Builds only `@atlasdraw/atlas-app`
- Multi-stage, copies dist to nginx html dir
- Single-layer nginx config with SPA fallback and `/data/` caching
- HEALTHCHECK via `wget -q -O /dev/null http://localhost`
- Published to `ghcr.io/micahchoo/atlasdraw` (latest + sha tags)

**2. Storage image** (`code/apps/storage/Dockerfile`)
- Build + runtime both on `node:20-bookworm-slim`
- Build deps include `python3 make g++` for `better-sqlite3` native module
- Copies all workspace `packages/` for resolution, then builds `@atlasdraw/storage`
- Exposes 4000

**3. Realtime image** (`code/apps/realtime/Dockerfile`)
- Same base as storage (`node:20-bookworm-slim`)
- No native build deps needed
- Exposes 4001

**4. Atlas-app image** (`code/apps/atlas-app/Dockerfile`)
- Build: `node:20-bookworm-slim`, Runtime: `nginx:alpine`
- Receives Vite build args: `VITE_BUILD_TARGET`, `VITE_STORAGE_BASE_URL`,
  `VITE_PMTILES_PATH`, `VITE_REALTIME_ENABLED`, `VITE_REALTIME_WS_URL`
- Embedded nginx config: listen 3000, SPA fallback, /data/ caching headers
- Exposes 3000

[Sources: source files listed above]
[CONFIDENCE: high]

### Docker Compose stacks

**Full stack** (`infra/docker-compose.yml`, 3930 bytes):
- 5 services standard: `storage`, `web`, `postgres`, `minio`, `caddy`
- 1 opt-in service: `realtime` behind `profiles: ["realtime"]`
- Volumes: `pgdata`, `miniodata`, `caddy_data`, `caddy_config`
- Caddy binds 80:80, 443:443; all other services internal to compose network
- Storage memory limit: 1g (minio only)
- All services: `restart: unless-stopped`
- Config from `.env` file at repo root

**Minimal stack** (`infra/docker-compose.minimal.yml`, 1308 bytes):
- 2 services: `storage` (sqlite-fs mode) + `web`
- 1 named volume: `atlas-storage-data`
- Direct port mappings: 4000 (storage), 3000 (web)
- No Caddy, no postgres, no minio

[Sources: `infra/docker-compose.yml`, `infra/docker-compose.minimal.yml`]
[CONFIDENCE: high]

---

## CI/CD Pipeline

Four GitHub Actions workflows, all targeting `main` branch:

### 1. Bench CI gate (`ci.yml`)
- Trigger: `pull_request` on `main`
- Action: Setup Node 20, corepack, `yarn install --immutable`, run
  `@atlasdraw/bench bench` then `@atlasdraw/bench ci-gate`
- Verifies performance regression gate on every PR

### 2. Build Docker smoke test (`build-docker.yml`)
- Trigger: `pull_request` on `main`
- Action: Docker Buildx, build image (no push) with GHA cache
- Tags as `ghcr.io/micahchoo/atlasdraw:pr-${{ github.event.pull_request.number }}`

### 3. Publish Docker (`publish-docker.yml`)
- Trigger: `workflow_dispatch` (manual)
- Action: QEMU + Buildx, login to ghcr.io, build and push
- Platforms: `linux/amd64,linux/arm64`
- Tags: `:latest`, `:${{ github.sha }}`
- Cache: `type=gha, mode=max`

### 4. GitHub Pages deploy (`pages.yml`)
- Trigger: `push` to `main` or `workflow_dispatch`
- Action: Checkout with LFS, setup Node 20, corepack, install, build
  `@atlasdraw/atlas-app` with `VITE_BUILD_TARGET=pages` + custom pmtiles path,
  upload `apps/atlas-app/dist` as Pages artifact, deploy via `actions/deploy-pages`
- Permissions: `pages: write`, `id-token: write`

### Local CI (husky)
- `.husky/pre-commit`: commented out (`# yarn lint-staged`)
- `.husky/post-checkout`, `post-commit`, `post-merge`, `pre-push`: exist but
  minimal (standard githook wrappers)
- No active pre-commit hooks -- lint-staged is opted out

[Sources: `.github/workflows/*.yml`, `.husky/*`]
[CONFIDENCE: high]

---

## Environment Configuration

### Build-time injection (VITE_*)

The web frontend receives configuration at build time via Vite's `VITE_*`
env-var convention. Build-time envs are baked into the JS bundle.

| Variable | Default | Set by |
|----------|---------|--------|
| `VITE_BUILD_TARGET` | `hosted` | Dockerfile ARG |
| `VITE_STORAGE_BASE_URL` | `/api` (full), `http://localhost:4000` (minimal) | Dockerfile ARG |
| `VITE_PMTILES_PATH` | `/data/world-low-zoom.pmtiles` (full), same (minimal) | Dockerfile ARG |
| `VITE_REALTIME_ENABLED` | `false` | Dockerfile ARG / compose env |
| `VITE_REALTIME_WS_URL` | (empty) | Dockerfile ARG / compose env |

### Inherited Excalidraw envs (legacy)

The `.env.development` and `.env.production` files carry Excalidraw-origin
configs. These are ignored by atlas-app builds (no `VITE_APP_*` vars are read
by the atlas-app -- they are Excalidraw upstream heritage):

- `VITE_APP_BACKEND_V2_*` -- Excalidraw scene storage endpoints
- `VITE_APP_LIBRARY_*` -- Excalidraw component library endpoints
- `VITE_APP_WS_SERVER_URL` -- legacy Excalidraw collaboration server
- `VITE_APP_FIREBASE_CONFIG` -- legacy Firebase (excalidraw.com infra)
- `VITE_APP_PLUS_*` -- Excalidraw Plus SaaS endpoints
- `VITE_APP_AI_BACKEND` -- Excalidraw AI service
- `VITE_APP_ENABLE_TRACKING` -- telemetry opt-in

These live in the repo but are dead weight for atlas-app -- they exist because
the codebase forked from Excalidraw and the env files were never pruned.
[CONFIDENCE: high -- atlas-app Dockerfile does not pass these vars]

### Self-host operator envs (`infra/.env.example`)

| Variable | Purpose | Required for |
|----------|---------|-------------|
| `PUBLIC_DOMAIN` | Hostname Caddy serves | Full stack |
| `ACME_EMAIL` | Let's Encrypt cert notifications | Full stack (production) |
| `LOG_LEVEL` | pino log level (default `info`) | All stacks |
| `SENTRY_DSN` | Opt-in error capture | Full stack (ADR-0009) |
| `POSTGRES_*` | Postgres credentials | Full stack |
| `MINIO_ROOT_USER/PASSWORD` | MinIO credentials | Full stack |

The old-Excalidraw env vars (`VITE_APP_*`) are NOT present in the operator
env file, confirming they are dead configuration.

[Sources: `code/.env.development`, `code/.env.production`, `infra/.env.example`,
`code/apps/atlas-app/Dockerfile`]
[CONFIDENCE: high]

---

## Storage Infrastructure

### Two backend adapters

Both adapters implement the same `StorageClient` interface (from
`apps/storage/src/types.ts`):

```typescript
interface StorageClient {
  createMap(workspaceId, mapId, blob): Promise<MapRecord>;
  getMap(mapId): Promise<MapRecord | null>;
  listMaps(workspaceId): Promise<MapRecord[]>;
  deleteMap(mapId): Promise<void>;
  // ... share tokens, workspaces
}
```

**postgres-minio** (`apps/storage/src/adapters/postgres-minio.ts`):
- Metadata: `pg.Pool` connecting to `DATABASE_URL`
- Blobs: `@aws-sdk/client-s3` (S3Client, PutObjectCommand, GetObjectCommand,
  CreateBucketCommand)
- Bucket: `atlasdraw-maps` (constant `BUCKET`)
- Tables: maps, share_tokens, workspaces (schema created on first start)
- S3-compatible: works with MinIO, AWS S3, CloudFlare R2

**sqlite-fs** (`apps/storage/src/adapters/sqlite-fs.ts`):
- Metadata: `better-sqlite3` (synchronous SQLite)
- Blobs: `node:fs` (filesystem at `DATA_DIR`)
- No external dependencies -- single-process storage

### Workspace model

Both adapers support the full workspace hierarchy:
- `Workspace` (id, name, slug, plan, scope, timestamps)
- `WorkspacePlan` (enum: free, plus, business, enterprise)
- `WorkspaceScope` (enum: personal, team)
- `MapRecord` (id, timestamps, blob_ref, byte_size, workspace_id)
- `ShareToken` (token, map_id, mode, expiry)

[Sources: `code/apps/storage/src/adapters/postgres-minio.ts`,
`code/apps/storage/src/adapters/sqlite-fs.ts`]
[CONFIDENCE: high]

### Storage server middleware/routes

The Fastify server registers middleware and route modules:

- Health: `routes/health.ts` -- `/health` endpoint
- Maps CRUD: `routes/maps.ts` -- `/maps/*`
- Share tokens: `routes/share.ts` -- `/share/*`
- Workspaces: `routes/workspaces.ts` -- `/workspaces/*`
- Billing: `routes/billing.ts` -- Stripe integration (hosted mode)
- Middleware: `middleware/quota.ts`, `middleware/workspace.ts`

[Sources: `code/apps/storage/src/index.ts`]
[CONFIDENCE: high]

---

## Build Infrastructure

### Workspace layout

Yarn 1.22 workspaces (classic, not Berry). 3 apps, 11 packages:

```
code/
  excalidraw-app/          # Excalidraw upstream app (vendored entry point)
  apps/
    atlas-app/             # Atlasdraw web SPA (Vite + React)
    realtime/              # WebSocket relay (Socket.IO + y-websocket)
    storage/               # REST API (Fastify v5)
  packages/
    basemap/               # MapLibre basemap management
    cli/                   # CLI tooling
    common/                # Excalidraw shared utilities
    data/                  # Data layer abstractions
    element/               # Excalidraw element model
    excalidraw/            # Excalidraw core library
    geo/                   # Geospatial utilities
    math/                  # Excalidraw math utilities
    protocol/              # Shared protocol types for realtime
    sdk/                   # Embed SDK (postMessage)
    tools/                 # Atlasdraw tool implementations
    utils/                 # General utilities
  bench/                   # Performance benchmarks
```

[Sources: `code/package.json` workspaces field]
[CONFIDENCE: high]

### TypeScript project references

`code/tsconfig.json` is a composite-project solution root with references to 5
atlas-owned packages: `basemap`, `data`, `geo`, `tools`, `cli`. These are the
packages that can be built as composite projects.

NOT included (explicitly documented):
- `atlas-app`: non-composite leaf consumer (noEmit + Vite)
- `realtime`: Phase 5 stub
- Vendored Excalidraw packages (`common`, `element`, `excalidraw`, `math`,
  `utils`): have internal cycles preventing composite builds

Running `tsc -b` from `code/` builds only the atlas-owned type graph.
To typecheck atlas-app: `cd apps/atlas-app && tsc --noEmit`.

`packages/tsconfig.base.json` provides shared compiler options:
- `target: ESNext`, `module: ESNext`, `moduleResolution: Node`
- `strict: true`, `skipLibCheck: true`
- Path aliases for all `@excalidraw/*` packages

[Sources: `code/tsconfig.json`, `code/packages/tsconfig.base.json`]
[CONFIDENCE: high]

### Vite build

- Vite 5.0.12 with `@vitejs/plugin-react` 3.1.0
- JSX runtime: `react-jsx` (automatic transform)
- Additional plugins: `vite-plugin-checker`, `vite-plugin-ejs`,
  `vite-plugin-pwa`, `vite-plugin-svgr`
- vitest config provides path aliases mapping `@excalidraw/*` to source dirs

[Sources: `code/package.json`, `code/vitest.config.mts`]
[CONFIDENCE: high]

---

## Test Infrastructure

### Framework

- **vitest 3.0.6** with `@vitest/coverage-v8` and `@vitest/ui`
- Test environment: `jsdom` (browser API simulation)
- Test syntax: Jest-compatible (`describe`, `it`, `test`, `expect`)
- Only 5 vitest imports in test files -- tests rely on vitest's Jest-compatible
  globals (`globals: true` in config)
- Hooks run in parallel (`sequence: { hooks: "parallel" }`)

### Coverage thresholds (vitest.config.mts)

| Metric | Minimum |
|--------|---------|
| Lines | 60% |
| Branches | 70% |
| Functions | 63% |
| Statements | 60% |

### Test commands

| Command | What it runs |
|---------|-------------|
| `yarn test` | `vitest` (interactive watch) |
| `yarn test:app` | `vitest` |
| `yarn test:all` | typecheck + eslint + prettier + vitest |
| `yarn test:code` | `eslint --max-warnings=0` |
| `yarn test:other` | `prettier --list-different` |
| `yarn test:typecheck` | `tsc` |
| `yarn test:update` | `vitest --update --watch=false` |

### Test counts

- 246 test files
- 6969 `describe`/`it`/`test` blocks
- 16973 `expect` assertions

### E2E

No Playwright or E2E workflows detected in CI. The speculative doc lists
`e2e.yml` and `hosted-e2e.yml` but neither exists in `.github/workflows/`.
Playwright CLI skill exists in `.claude/skills/playwright-cli/` but no E2E
workflow is wired.

[Sources: `code/vitest.config.mts`, `code/package.json`, codebase analytics]
[CONFIDENCE: high]

---

## Era Markers (Index Fossils)

Analysis of syntax patterns revealing the codebase's evolutionary history:

### Variable declarations
| Pattern | Count | Interpretation |
|---------|-------|----------------|
| `var` | 16,805 | Heavy Excalidraw upstream heritage (pre-ES6 style) |
| `let` | 7,065 | Modern code additions |
| `const` | 78,224 | Dominant modern style |

The `var` count is extremely high for a modern TS codebase, confirming the
Excalidraw fork origin. Ratio: `var` is 21% of declarations (vs near-zero in
greenfield TS projects).

### Module system
| Pattern | Count | Interpretation |
|---------|-------|----------------|
| `require()` | 1,267 | Legacy Excalidraw code, build tool configs |
| `import` statements | 36,021 | Dominant modern style |

The require calls are concentrated in vendored/copied Excalidraw code and
config files.

### React patterns
| Pattern | Count | Interpretation |
|---------|-------|----------------|
| `extends Component` / `extends React.Component` | 0 | No class components in TSX |
| `useState|useEffect|useRef|useCallback|useMemo|etc.` | 682 | Hooks-only codebase |

The codebase has zero React class components -- all React code uses hooks.
This aligns with the Excalidraw v0.18 baseline which was already hooks-only.

### HTTP framework
| Framework | Import count | Interpretation |
|-----------|-------------|----------------|
| Fastify | 25 | Atlas-owned storage server |
| Express | 4 | Remnant from vendored/upstream code |

Fastify v5 is the active HTTP framework; Express is a 4-import remnant.

### Type safety
| Pattern | Count | Risk |
|---------|-------|------|
| `@ts-ignore` | 298 | Moderate -- 298 suppression sites |
| `any` type escapes | 20,997 | High -- 21K `any` escapes indicates weak type coverage |

The `any` count is extraordinarily high. This is a significant type-safety
concern inherited from the Excalidraw fork. Atlas-owned code likely has
better discipline, but the vendored Excalidraw packages contribute most of
these escapes.

### Test framework
| Marker | Count |
|--------|-------|
| vitest imports | 5 |
| describe/it/test blocks | 6,969 |
| expect assertions | 16,973 |

The codebase migrated from Jest (evidenced by `@types/jest` in devDeps) to
vitest. The 5 vitest imports suggest tests use vitest globals rather than
explicit imports. `@types/jest: 27.4.0` and `chai: 4.3.6` are still in
devDependencies as legacy remnants.

[Sources: grep results across all TS/TSX files, `code/package.json`]
[CONFIDENCE: high for counts; medium for interpretation of Excalidraw split]

---

## Infrastructure Risks

### Single points of failure

1. **No database migration framework.** The storage server creates its schema
   on first start. No Alembic, Kysely, Prisma Migrate, or similar tool. Schema
   changes require manual SQL or code-level DDL. [CONFIDENCE: high]

2. **No database connection pooling beyond pg.Pool.** Postgres scaling beyond
   a single instance is not addressed. No PgBouncer, no read replicas.
   [CONFIDENCE: high]

3. **Realtime server is single-instance by default.** Redis adapter exists
   (`@socket.io/redis-adapter`) but only activates when `REDIS_URL` is set.
   Default config runs in-memory rooms. Multiple realtime instances without
   Redis will have disjoint rooms. [CONFIDENCE: high]

4. **Realtime rooms are ephemeral.** TTL eviction (5 min default) with no
   persistence. Last-client-disconnect triggers `ydoc.destroy()`. No
   `setPersistence` is wired (marked as TODO). [CONFIDENCE: high]

5. **MinIO memory limit** (1 GB cgroup) is the only resource constraint.
   Other services have no limits. [CONFIDENCE: high]

### Missing observability

6. **Distributed tracing: absent.** No OpenTelemetry, no Jaeger. The
   `SENTRY_DSN` variable exists and Sentry is initialized in the storage
   server, but this is error capture, not APM. [CONFIDENCE: high]

7. **Health checks: partial.** Storage serves `/health`. The monolith image
   has a Docker HEALTHCHECK (wget). But there is no `health` endpoint on
   realtime (though `health.ts` exists in its src dir). No aggregated health
   status across services. [CONFIDENCE: high]

8. **Structured logging: pino on storage and realtime.** Both use pino.
   Caddy logs in JSON format. Nginx logs go to stdout (Docker default). No
   centralized log aggregation. [CONFIDENCE: high]

### Security

9. **CORS: realtime allows `*`.** The Socket.IO server has `cors: { origin: "*" }`.
   This may be intentional (relay is opaque) but is notable.
   [CONFIDENCE: high]

10. **No TLS at compose network level.** Caddy terminates TLS at the edge.
    Postgres and MinIO communicate in plaintext on the compose network.
    [CONFIDENCE: high]

---

## Confidence Assessment

| Section | Confidence | Basis |
|---------|-----------|-------|
| Runtime topology | High | Verified against Dockerfiles and source |
| Containerization | High | All Dockerfiles and compose files read in full |
| CI/CD pipeline | High | All 4 workflow YAMLs read in full |
| Environment config | High | All env files and Dockerfile ARGs inspected |
| Storage infrastructure | High | Adapter source code and types read in full |
| Build infrastructure | High | Config files (tsconfig, vitest, package.json) read |
| Test infrastructure | High | Config + greps + file counts |
| Era markers | High | Quantitative grep results from full codebase |
| Risks | Medium-High | Inferred from missing elements in verified code |
| Observability | Medium-High | Inferred from absence (negative evidence) |
