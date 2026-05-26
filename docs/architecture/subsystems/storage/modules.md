# storage — Modules

**Status: Verified against source at `code/apps/storage/` (2026-05-15).**

The existing docs for this subsystem were written speculatively before Phase 4
shipped and predict a `services/`, `db/`, `auth/` layered architecture that
was never built. The actual codebase uses a flat two-layer structure: routes
call adapters directly. All business logic lives in the adapter implementations.

---

## Source Tree (24 files, 3966 lines)

```
apps/storage/src/
  index.ts                          # 121L  Entry: Fastify boot, adapter selection, registration
  types.ts                          # 124L  StorageClient contract + domain types
  config.ts                         # 103L  Zod env-var schema, discriminated by STORAGE_MODE
  logger.ts                         #  11L  Pino structured-log export

  adapters/
    postgres-minio.ts               # 423L  Full-stack adapter (pg Pool + S3)
    sqlite-fs.ts                    # 339L  Minimal adapter (better-sqlite3 + fs)

  routes/
    maps.ts                         #  89L  POST/GET/PUT /maps
    share.ts                        # 142L  POST /maps/:id/share, GET /share/:token[/blob]
    workspaces.ts                   #  63L  GET/POST /api/workspaces (managed-mode only)
    billing.ts                      # 323L  POST /api/billing/checkout, webhook (managed-mode only)
    health.ts                       #  20L  GET /health
    __tests__/
      maps.test.ts                  # 133L
      share.test.ts                 # 408L
      workspaces.test.ts            #  92L
      billing.test.ts               # 412L
      health.test.ts                #  28L
      maps-workspace.test.ts        # 149L

  middleware/
    workspace.ts                    #  89L  X-Workspace-ID preHandler (Phase 6 A9)
    quota.ts                        # 122L  Map-count limit preHandler (Phase 6 A13b)
    __tests__/
      workspace.test.ts             #  89L
      quota.test.ts                 # 168L

  Test-only files at root:
    config.test.ts                  # 135L
    adapters/postgres-minio.test.ts # 250L
    adapters/sqlite-fs.test.ts      # 133L
```

---

## Module Dependency Graph

None of the modules import from other `@atlasdraw/*` packages. The graph is a
clean DAG with zero circular paths:

```
logger.ts  (leaf — no project imports)
types.ts   (leaf — no project imports)
config.ts ──→ types.ts

adapters/postgres-minio.ts ──→ types.ts
adapters/sqlite-fs.ts      ──→ types.ts

routes/maps.ts         ──→ types.ts
routes/share.ts        ──→ types.ts
routes/workspaces.ts   ──→ types.ts
routes/billing.ts      ──→ types.ts
routes/health.ts       ──→ types.ts

middleware/workspace.ts  (leaf — fastify declaration merging, no project imports)
middleware/quota.ts      ──→ types.ts

index.ts ──→ config.ts, logger.ts
          ├── adapters/postgres-minio.ts
          ├── adapters/sqlite-fs.ts
          ├── middleware/workspace.ts
          ├── middleware/quota.ts
          ├── routes/maps.ts
          ├── routes/share.ts
          ├── routes/workspaces.ts
          ├── routes/billing.ts
          └── routes/health.ts
```

---

## Adapter Comparison

Both adapters implement the full `StorageClient` interface (13 methods):

| Method | postgres-minio (423L) | sqlite-fs (339L) |
|---|---|---|
| `createMap` | `pg.Pool.query` + S3 `PutObjectCommand` | `better-sqlite3` insert + `fs.writeFileSync` |
| `getMap` | `pg.Pool.query` param. query | `better-sqlite3` prepared `.get()` |
| `updateMap` | read-then-write S3 key in-place + pg update | read-then-write fs file in-place + prepared update |
| `createShareToken` | pg insert (nanoid 21, 7-day TTL) | prepared insert (nanoid 21, 7-day TTL) |
| `resolveToken` | pg select by token | prepared `.get()` by token |
| `getBlob` | S3 `GetObjectCommand` | `fs.readFileSync` |
| `createWorkspace` | pg insert | prepared insert |
| `getWorkspace` | pg select | prepared `.get()` |
| `listWorkspaces` | pg select all | prepared `.all()` |
| `updateWorkspacePlan` | pg update w/ COALESCE | prepared update w/ COALESCE |
| `countWorkspaceMaps` | pg COUNT(*) | prepared `.get()` |
| `findWorkspaceByStripeCustomerId` | pg select by customer_id | prepared `.get()` |

**Notable differences:**
- postgres-minio uses raw SQL strings; sqlite-fs uses prepared statements
- postgres-minio lazy-initializes schema via `ensureSchema()`/`ensureBucket()` on first write; sqlite-fs creates schema eagerly in constructor
- sqlite-fs uses sync I/O (`writeFileSync`, `readFileSync`); postgres-minio uses async (`pool.query`, `s3.send`)
- sqlite-fs catches `duplicate column name` errors for idempotent `ALTER TABLE ADD COLUMN`; postgres-minio uses `ADD COLUMN IF NOT EXISTS`

Both expose identical test fixtures: `__postgresMinioInternals` and internal SQL.

---

## Deadwood Assessment

### Routes referenced in speculative docs but not implemented
| Predicted module | Status |
|---|---|
| `routes/metrics.ts` | Not implemented |
| `routes/snapshots.ts` | Not implemented (Phase 7 deferred) |
| `routes/submit.ts` | Not implemented (Phase 7 mobile-field deferred) |
| `services/map-service.ts` | Not implemented — logic lives in adapters |
| `services/share-service.ts` | Not implemented — logic lives in adapters |
| `services/blob-service.ts` | Not implemented — logic lives in adapters |
| `services/snapshot-service.ts` | Not implemented |
| `db/client.ts` | Not implemented — each adapter owns its DB client |
| `db/schema/*.sql` | Not implemented — DDL is inline in adapters |
| `auth/bearer.ts` | Not implemented |
| `auth/oidc.ts` | Not implemented |

The entire `services/`, `db/`, `auth/` layer separation predicted in Phase 4
plan was collapsed into the adapter pattern during implementation.

### Sentry integration — vestigial

```
index.ts:  import * as Sentry from "@sentry/node";
index.ts:  Sentry.init({ dsn: config.SENTRY_DSN, beforeSend: ... });
```

Sentry is initialized at server boot when `SENTRY_DSN` is set, but:
- No route handler or middleware wraps errors with `Sentry.captureException()`
- No Fastify `setErrorHandler` routes to Sentry
- No performance tracing (`Sentry.startSpan`) is used
- The SDK is loaded but produces zero telemetry under normal operation
- Error propagation relies solely on Fastify's default error handler (which
  logs via pino but never reaches Sentry)

**Conclusion:** The Sentry integration is functional scaffolding —
`Sentry.init()` runs, DSN env is respected, auth-header scrubbing works —
but no instrumentation hooks connect it to actual errors. Any unhandled
exception that reaches the process boundary would still be caught by the
runtime's `uncaughtException` handler, but the Sentry SDK would not
receive it without explicit wiring.

### Workspace and billing routes in self-host mode

`workspaces.ts` and `billing.ts` return 404 for every route when
`MANAGED_MODE=false` (the self-host default). The code is compiled and
loaded regardless — the 404 branch is the only active path. This is
intentional (shared codebase, single binary) but the entire module is
dead code for the majority of deployments.

---

## Type Duplication Burden

Storage types are defined once in `apps/storage/src/types.ts` and manually
mirrored in `apps/atlas-app/`. There is no shared types package.

| Type | Defined in storage | Mirrored in atlas-app |
|---|---|---|
| `MapRecord` | `types.ts:24` | `createHttpStorageClient.ts:28` |
| `ShareToken` | `types.ts:41` | `createHttpStorageClient.ts:40` |
| `StorageClient` | `types.ts:87` (13 methods) | `createHttpStorageClient.ts:54` (5 methods) |
| `WorkspacePlan` | `types.ts:68` | `createHttpStorageClient.ts:82` (ad-hoc `WorkspaceSummary`) |

The atlas-app mirror is acknowledged as intentional in source comments:
> "Why mirror types here instead of importing `@atlasdraw/storage`: the
> storage workspace publishes types via `dist/types.d.ts` but has no
> `main`/`types` field, so module resolution from atlas-app would fail."

The root cause: `@atlasdraw/storage` depends on `better-sqlite3` and `pg`,
which are Node-native packages not installable in the browser-based
atlas-app workspace. The storage server does not publish a browser-safe
types-only sub-package.

**No overlap with `@atlasdraw/data` or `@atlasdraw/protocol`:**
- `@atlasdraw/data` defines `.atlasdraw` file format types (`ManifestSchema`,
  `AtlasdrawDocument`, `SceneElement`) — zero overlap with storage types.
- `@atlasdraw/protocol` defines realtime event types (`CollabEvent`,
  `RealtimeConfig`, `CommentAnchor`) — zero overlap.

---

## Module Size Distribution

| Size bucket | Files |
|---|---|
| **<= 30 lines** | `logger.ts` (11), `health.ts` (20) |
| **31-100 lines** | `workspaces.ts` (63), `maps.ts` (89), `workspace.ts` (89) |
| **101-200 lines** | `config.ts` (103), `index.ts` (121), `types.ts` (124), `quota.ts` (122), `share.ts` (142) |
| **201-400 lines** | `billing.ts` (323), `sqlite-fs.ts` (339) |
| **> 400 lines** | `postgres-minio.ts` (423) |

No module violates single-responsibility — each file owns exactly one concern.

`billing.ts` carries the highest complexity: Stripe Checkout session creation,
webhook signature verification, raw body parsing, in-memory idempotency store,
and event dispatch. At 323 lines it is the second-largest source module but
does three things any of the route modules does only one.

---

## Cross-Module Duplication

### `ID_RE` regex (deliberate)

Both `routes/maps.ts:15` and `routes/share.ts:26` define:
```
const ID_RE = /^[A-Za-z0-9_-]{21}$/;
```

The copy in `share.ts` carries an inline comment documenting the duplication
as intentional ("do not refactor maps.ts in this task"). The adapters also
define their own copy of the same regex. Total: 4 copies across 4 files.

### Row-to-domain mapping functions (structural)

Both adapters define private `rowToMap`, `rowToShare`, `rowToWorkspace`
conversion functions. These are structurally identical but cannot be shared
because the row types differ (pg returns `Date` objects; sqlite returns
ISO strings; bigint returns as `string | number` in pg, `number` in sqlite).

---

## Confidence

| Dimension | Confidence | Rationale |
|---|---|---|
| Module inventory | **High** | All 24 source files enumerated from disk |
| Adapter comparison | **High** | Both implementations read line-by-line |
| Deadwood | **High** | Every speculative module checked against filesystem |
| Type duplication | **High** | Cross-referenced atlas-app, data, protocol packages |
| Circular dependencies | **High** | Full import graph verified |
| Sentry status | **Medium** | Vestigial classification based on no `captureException` calls; cannot prove absence of dynamic instrumentation at runtime |
| Test coverage | **High** | 50% test-to-source ratio; every module except logger has a test file |

The speculative prediction documented in the original version of this file was
wrong for the entire `services/`/`db/`/`auth/` layer split. The actual
architecture is simpler and flatter.
