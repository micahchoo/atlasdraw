# storage — Components

**Status: Ground truth.** Audited against the real code at `code/apps/storage/src/` (Phase 6 Wave 3 A13c). 3056 source lines across 14 files, 13 test files (~45% test-to-source ratio by file count).

> Sources: code audit 2026-05-15; quality-linter pass over adapters, middleware, routes, config, types.
>
> NOTABLE GAPS FROM PRIOR DOC: the speculative doc (v1) described 7 nonexistent files (`metrics.ts`, `snapshots.ts`, `submit.ts`, `services/`, `db/client.ts`, `auth/bearer.ts`, `auth/oidc.ts`). These do not exist and have not been planned. The real code is leaner: adapters inline their own DB schema and blob logic; routes are thin handlers delegating to the `StorageClient` contract.

---

## Overview

`apps/storage` is the HTTP persistence server (Phase 4, extended Phase 6). Fastify v5. Adapter-based: two backends implement the same `StorageClient` interface, selected by `STORAGE_MODE` env at boot.

### Key architectural properties

- **Zero imports from `@atlasdraw/*`** — standalone server with self-defined types. No coupling to the monorepo's data packages.
- **No DB migration framework** — schema created on first adapter instantiation (inline `CREATE TABLE IF NOT EXISTS`).
- **No connection pooling beyond `pg.Pool`** — the postgres-minio adapter uses `pg.Pool` directly; the sqlite-fs adapter uses `better-sqlite3` synchronously.
- **Parallel type hierarchy** — `code/apps/storage/src/types.ts` defines `MapRecord`, `ShareToken`, `Workspace`, `StorageClient` as storage-side DTOs. These are distinct from `code/packages/data/src/manifest-schema.ts` (document content types). Overlap is minimal: `MapRecord.id` (nanoid) vs `Manifest.id` (ULID) are fundamentally different ID schemes.
- **Managed mode vs self-host** — `MANAGED_MODE` flag (Phase 6 A9) gates workspace-scoped features and billing. Self-host is Phase 4 backward-compatible.

---

## Quality Summary

| Dimension | Assessment |
|-----------|-----------|
| TypeScript strictness | Strong. Zero `any` types in source files. Branded type `WorkspaceId` for middleware. |
| Lint suppressions | 2 total: `no-console` in `index.ts` (uncaught `main().catch`), `no-var-requires` in `billing.ts` (deliberate lazy load). No ESLint config file — relies on monorepo base. |
| Error handling | Adapters throw `Error("not found: ...")` on missing rows. Routes catch via `isNotFoundError()` helper. Duplicated helper in `maps.ts` and `share.ts` (should be shared). |
| `ignoreDeprecations: "6.0"` | Present in tsconfig.json. The project targets `es2022` with `commonjs` modules. This flag suppresses TS 6.0-era deprecation warnings on older option combos — consider removing after TS upgrade. |
| `esModuleInterop: true` | Set. Good for modern import style. |
| Test coverage | ~45% by file count. All adapters tested via `sqlite-fs` (real DB) and `postgres-minio` (mocked S3/pg). Missing: integration tests that start the full Fastify server with both adapters and exercise the HTTP surface end-to-end. |

---

## Component Inventory

### `index.ts` (121 lines) — Entry point

**Pattern**: start-stop daemon. `main()` loads config, initializes Sentry (opt-in, no-op without `SENTRY_DSN`), creates the Fastify instance, selects adapter by `STORAGE_MODE`, registers middleware + routes, then `listen()`.

**Quality notes**:
- Sentry `beforeSend` scrubs `Authorization` headers and IP addresses (privacy-conscious).
- Fastify v5 requires `loggerInstance` for pre-built pino — uses the string key, would produce `FST_ERR_LOG_INVALID_LOGGER_CONFIG`.
- `bodyLimit: 50 MiB` set globally (also needed because Fastify v5 default is 100 KiB).
- `application/octet-stream` content type parser registered globally.
- Exports re-exported: `middleware/workspace`, `types`, `config` (used by tests).

### `config.ts` (103 lines) — Environment config

**Pattern**: Zod discriminated union. `STORAGE_MODE` is the discriminator key, selecting between `PostgresMinioSchema` and `SqliteFsSchema`. All Stripe vars are optional (missing → routes 503 at request time, not boot-time).

**Env vars surfaced** (all via Zod coercion/transforms):
- `STORAGE_MODE`, `PORT` (default 4000), `PUBLIC_URL`, `LOG_LEVEL`, `SENTRY_DSN`, `MANAGED_MODE`
- `DATABASE_URL`, `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY`, `BLOB_SECRET_KEY` (postgres-minio only)
- `DATA_DIR` (default `/data`, sqlite-fs only)
- `QUOTA_FREE_MAPS` (default 3), `QUOTA_PRO_MAPS` (default 100)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_25`, `SITE_URL` (Phase 6 A13c)

**Quality notes**:
- `formatZodError()` produces human-readable messages with the env var name and current `STORAGE_MODE`.
- `MANAGED_MODE` accepts boolean, string "true"/"false", or "1"/"0".
- Test coverage thorough: 7 test cases covering both modes, PUBLIC_URL defaults, MANAGED_MODE parsing, and error formatting.

### `types.ts` (124 lines) — Storage contract types

**Pattern**: Pure type file (no runtime code). Defines `StorageClient` interface — the contract both adapters implement and all routes consume.

**Exported types**: `StorageMode`, `MapRecord`, `ShareToken`, `WorkspaceScope`, `WorkspacePlan`, `Workspace`, `StorageClient`.

**Quality notes**:
- `WorkspaceId` brand lives in `middleware/workspace.ts`, not here (design choice: keeps the branded type colocated with its minting function `asWorkspaceId`).
- Every field has JSDoc describing which phase introduced it.
- `MapRecord.workspace_id` is `optional` (`string | null | undefined`) — hosted creates carry it, self-host records are `null`.
- `ShareToken.mode` is the literal `"read"` (write tokens deferred to Phase 6, never shipped).
- `StorageClient` methods are fully async (even sqlite-fs wraps sync calls in the return).

### `logger.ts` (11 lines) — Pino logger

**Pattern**: Trivially simple. Single `pino({ level, base: { service: "@atlasdraw/storage" } })` instance exported as `logger`.

**Quality notes**:
- Tiny file with high leverage — every route and adapter imports it.
- No environment-specific configuration (pretty-printing, transport).
- Barely worth its own file; could inline into `index.ts`.

### `middleware/workspace.ts` (89 lines) — Workspace middleware

**Pattern**: Fastify `preHandler` hook. Reads `X-Workspace-ID` header, attaches branded `WorkspaceId` to `request.workspace`.

**Two modes**:
- **Managed**: header is REQUIRED. Missing → 401 `WORKSPACE_REQUIRED`.
- **Self-host**: no-op. Header presence is best-effort attached for local testing.

**Quality notes**:
- `declare module "fastify"` augments `FastifyRequest` — clean pattern, no `any` casts.
- Branded type `WorkspaceId` is a compile-time gate only (`value as WorkspaceId`).
- `/health` and `/health?*` URL bypass (liveness probes don't need a workspace).
- Header is read as `Array.isArray(raw) ? raw[0] : raw` — handles multiple header values defensively.
- Perfect test coverage via `__tests__/workspace.test.ts` (three modes: managed+missing, managed+present, self-host).

### `middleware/quota.ts` (122 lines) — Quota middleware

**Pattern**: Fastify `preHandler`. Runs AFTER workspace middleware in managed mode. For `POST /maps`, counts workspace maps against plan cap; 402s on breach with `quota_breach` ADR-0011 event.

**Quality notes**:
- Self-host returns on line 1 (`if (!opts.managed) return;`) — registered-but-noop, so flipping env doesn't need code changes.
- Only `POST /maps` is gated (v1). Extensible via `gatedRoutes` pattern.
- ADR-0011 event payload: `{workspaceId, quotaType, attemptedValue, limit, timestamp}`.
- Route detection uses `request.url.split("?")[0]` to strip query params.
- Defensive check: if workspace middleware order broke and `workspace` is undefined in managed mode, returns 401.
- Test coverage via `__tests__/quota.test.ts`: free quota exceeded, non-/maps bypass, sub-limit passes, self-host bypass.

### `adapters/sqlite-fs.ts` (339 lines) — SQLite + filesystem adapter

**Pattern**: Factory function `createSqliteFsAdapter()`. Uses `better-sqlite3` synchronously (the `StorageClient` return type is `Promise<T>` but sqlite-fs wraps sync calls). Blobs stored on local filesystem at `{dataDir}/blobs/{id}`.

**Schema created on init**:
- `maps(id, created_at, updated_at, blob_ref, byte_size, workspace_id)` with indexes.
- `share_tokens(token, map_id, mode, expires_at, created_at, workspace_id)` with TTL index.
- `workspaces(id, name, plan, stripe_customer_id, created_at)` with `stripe_customer_id` index — **unused outside managed mode** (acknowledged in comment).

**Quality notes**:
- `id` validation regex `^[A-Za-z0-9_-]{21}$` duplicated here and in `routes/maps.ts` and `routes/share.ts`.
- `ALTER TABLE ... ADD COLUMN` pattern with `try/catch` catching duplicate-column errors for schema evolution.
- Workspace methods are async wrappers around sync prepared statements.
- `stripe_customer_id` uses `COALESCE` in SQL to make it sticky once set.
- No streaming for large blobs — `Buffer` in memory. 50 MiB body limit at Fastify level bounds this.
- Test coverage via `sqlite-fs.test.ts` (133 lines): createMap round-trip, malformed ID rejection, updateMap not-found, getBlob on missing row, createShareToken + resolveToken round-trip, expired token.

**Notable**: The workspaces table is created by both adapters identically. The `stripe_customer_id` column is created with `ALTER TABLE ... ADD COLUMN` rather than in the initial CREATE TABLE (schema evolution pattern).

### `adapters/postgres-minio.ts` (423 lines) — Postgres + S3 adapter

**Pattern**: Factory function `createPostgresMinioAdapter()`. Uses `pg.Pool` for metadata, `@aws-sdk/client-s3` for blob storage. Schema created via raw SQL queries on pool connection.

**Quality notes**:
- S3 client uses `@aws-sdk/client-s3` with `endpoint`, `region: "auto"`, `forcePathStyle: true` (MinIO-compatible).
- Bucket name: `atlasdraw-maps`.
- `ensureBucket()` called on startup — catches `BucketAlreadyOwnedByYou` / `BucketAlreadyExists` errors silently.
- `putObjectCommand` uses `ContentType: "application/octet-stream"`.
- `getBlob` catches `NoSuchKey` and returns `null` — prevents 500 on orphaned blob refs.
- Prepared statement names prefixed with `pg_` to avoid collision with sqlite-fs when both are loaded (though only one loads).
- Full workspace method suite identical to sqlite-fs: `createWorkspace`, `getWorkspace`, `listWorkspaces`, `updateWorkspacePlan`, `countWorkspaceMaps`, `findWorkspaceByStripeCustomerId`.
- Test coverage via `postgres-minio.test.ts` (250 lines): pg + S3 clients fully mocked using `vi.mock`, covering createMap, getMap, updateMap, getBlob NoSuchKey, createShareToken, resolveToken, workspace CRUD, malformed IDs, adapter name export.

**Notable**: Test uses `vi.mock` at module scope, then dynamically imports the adapter. `vi.hoisted` would be the Vitest 3+ preferred pattern. Works but fragile.

### `routes/maps.ts` (89 lines) — Map CRUD routes

**Three endpoints**:
- `POST /maps`: `body` must be `Buffer` (octet-stream). Returns 201 with `MapRecord`. Workspace-scoped in managed mode.
- `GET /maps/:id`: validates ID format via regex. Returns 200/404.
- `PUT /maps/:id`: validates ID format. Returns 200/404 on not-found.

**Quality notes**:
- `isNotFoundError()` helper detects adapter's `Error("not found: ...")` convention. **Duplicated** in `share.ts` — should be in a shared module.
- No workspace scope on GET/PUT (only POST) — Phase 4 backward compat.
- ID regex `ID_RE = /^[A-Za-z0-9_-]{21}$/` duplicated across `maps.ts`, `share.ts`, both adapters.
- Test coverage via `maps.test.ts` (133 lines): all 3 endpoints, body limit test, malformed IDs.

### `routes/share.ts` (142 lines) — Share token routes

**Three endpoints**:
- `POST /maps/:id/share`: mints `nanoid(21)` token with 30-day TTL, stores via `client.createShareToken`, returns `{ token, url }`.
- `GET /share/:token`: resolves token via `client.resolveToken`. Expired → 410 Gone. Returns `{ map: MapRecord, mode: "read" }`.
- `GET /share/:token/blob`: resolves token, then calls `client.getBlob(mapId)`. Expired → 410. Supports blob download via share token.

**Quality notes**:
- `mode` field is always server-set from `ShareToken.mode` (security invariant confirmed).
- Defensive: share route uses `ID_RE` test before adapter calls.
- Token expiry: inline `Date.now() > new Date(expires_at).getTime()`.
- `isNotFoundError` duplicated from `maps.ts`.
- Test coverage via `share.test.ts` (408 lines): comprehensive — minting, resolution, expiry, blob retrieval, 404 on unknown map, 410 on expired.

### `routes/health.ts` (20 lines) — Health check

**Endpoint**: `GET /health` returns `{ status: "ok", uptime, storageMode }`.

**Quality notes**:
- Lightweight liveness probe. Does NOT check DB or blob reachability (speculative doc claimed it would).
- Bypasses workspace middleware (hardcoded URL check in workspace middleware).
- Test coverage via `health.test.ts` (28 lines): basic status check.

### `routes/workspaces.ts` (63 lines) — Workspace management (Phase 6 A13b)

**Two endpoints** (both 404 in self-host):
- `GET /api/workspaces`: lists all workspaces (no user auth — returns every row in v1).
- `POST /api/workspaces`: creates a free-tier workspace. Requires `body.name`. Returns 400 `name_required` on missing name.

**Quality notes**:
- ADR-0011 `workspace_created` event emitted on creation.
- `nanoid(21)` for workspace IDs.
- Managed-mode gate is per-handler (`if (!opts.managed) return 404`).
- No pagination on `GET /api/workspaces` (OK for v1 but won't scale).

### `routes/billing.ts` (324 lines) — Stripe billing (Phase 6 A13c)

**Three endpoints**:
- `POST /api/billing/checkout`: creates Stripe Checkout Session for a workspace. Reads `workspaceId` from body, determines price ID by plan, creates session with success/cancel URLs.
- `POST /api/billing/webhook`: receives Stripe webhook events. Verifies signature, deduplicates via idempotency store, dispatches `checkout.session.completed` (updates workspace plan + stripe_customer_id).
- Webhook dispatches to `dispatchEvent()` which handles `checkout.session.completed` by calling `updateWorkspacePlan`.

**Quality notes**:
- Lazy `require("stripe")` — keeps the Stripe SDK out of self-host builds. `StripeLike` interface avoids top-level `import type Stripe`.
- Stripe webhook body parsing: custom content-type parser for `/api/billing/webhook` that keeps raw bytes for `stripe.webhooks.constructEvent()`. Uses a flag approach (first request to `/api/billing/webhook` marks the URL, subsequent requests fast-path).
- Idempotency: **in-memory** `Set` with 30-day TTL (`IdempotencyStore`). Comment explicitly calls out "Redis is the proper home for production multi-instance deploys — TODO". This is a known production gap for multi-replica deployments.
- `priceIdForTier()` maps `WorkspacePlan` to Stripe price IDs from config.
- All Stripe env vars optional — 503 with `stripe_not_configured` at request time if missing.
- `stripeFactory` option enables test injection without mocking the Stripe module.
- Test coverage via `__tests__/billing.test.ts`: checkout session creation (with stub factory), webhook signature validation failure.

---

## Stratigraphy Assessment

Fastify v5 — modern era. No deprecated middleware patterns (no express-style, no `@fastify/middie`).

| Era | Pattern | Present? |
|-----|---------|----------|
| Modern (v5) | Zod env config, discriminated union | Yes |
| Modern | `declare module "fastify"` augmentation | Yes |
| Modern | Inline `addContentTypeParser` | Yes |
| Modern | `require.main === module` guard | Yes |
| Legacy | `ignoreDeprecations: "6.0"` | Yes (minor, tsconfig) |
| Legacy | `commonjs` modules | Yes (deliberate — direct Node.js execution) |
| Legacy | `any` types | **Zero** across all source |

**Conclusion**: The codebase is consistently modern with two minor tsconfig-era artifacts (`ignoreDeprecations`, `commonjs` module format). No evidence of older pattern carry-over.

---

## Parallel Type Hierarchy Analysis

| Domain | File | Types | Purpose |
|--------|------|-------|---------|
| Storage | `code/apps/storage/src/types.ts` | `MapRecord`, `ShareToken`, `Workspace`, `StorageClient` | Persistence metadata: where is the blob, who owns it, how big is it |
| Document | `code/packages/data/src/manifest-schema.ts` | `Manifest`, `AtlasdrawDocument`, `SceneElement`, `LayerEntry` | Document content: title, basemap config, camera position, layers |

**Are they genuinely parallel?** Yes, and this is correct. Storage types describe **envelope** metadata (blob refs, byte sizes, workspaces, tokens). Document types describe **payload** content (what's inside the atlasdraw document). They overlap only at `id` — and even then use different ID schemes (nanoid in storage, ULID in manifests). This is not code duplication; it's separation of concerns.

The key invariant: **the storage server never parses the document content.** It stores opaque blobs (`Buffer`) and manages metadata around them. This is a deliberate architectural boundary.

---

## Dead Code & Incomplete Features

1. **Workspace table in self-host**: Both adapters create the `workspaces` table unconditionally, but it's only used in managed mode. Comment at `sqlite-fs.ts:78`: "table is just unused outside managed mode."
2. **In-memory idempotency store**: `IdempotencyStore` in `billing.ts` uses a `Set` with TTL. Explicit TODO about Redis. This will double-process Stripe events under concurrent webhook delivery to multiple replicas.
3. **`ignoreDeprecations: "6.0"`**: Still present in tsconfig. Should be verified against current TypeScript version and removed if possible.
4. **No metrics endpoint**: The speculative doc claimed `metrics.ts` (Prometheus). Does not exist. Was listed as optional (GAP-6). Not implemented.
5. **No snapshot routes**: `snapshots.ts` and `submit.ts` from the speculative doc do not exist. They were Phase 7 forward-planning entries only.
6. **No auth directory**: No bearer token or OIDC implementation exists. All routes are unauthenticated at the HTTP level — workspace and quota middleware are the only guards.

---

## Quality Signals Summary

**Strengths**:
- Clean adapter pattern (routes are adapter-agnostic)
- Zero `any` types — strong TypeScript discipline
- Minimal lint suppressions (2 total)
- Zod discriminated union for config (compile-time + runtime safety)
- Branded types for workspace IDs
- ADR-0011 event emissions in workspace, quota, and billing flows
- 13 test files, both adapters tested (real sqlite + mocked postgres-minio)
- Opt-in Sentry with privacy scrubbing
- Graceful degradation for self-host (Stripe env optional → 503 at request time)
- `StripeLike` interface avoids pulling Stripe types in all compilation units

**Weaknesses**:
- `isNotFoundError` helper duplicated in `maps.ts` and `share.ts`
- ID regex `ID_RE` duplicated across routes and adapters
- In-memory webhook idempotency (not production-safe for multi-replica)
- No end-to-end HTTP integration tests (all tests exercise adapters or routes in isolation via `app.inject`)
- Workspace table created unconditionally in self-host (acknowledged dead code)
- No blob streaming — all blobs held as `Buffer` in memory
- No pagination on `GET /api/workspaces`
- `ignoreDeprecations: "6.0"` in tsconfig

---

## Dependency Diagram

```
index.ts
  ├── config.ts              (Zod env parsing)
  ├── logger.ts              (pino instance)
  ├── middleware/workspace.ts (X-Workspace-ID preHandler)
  ├── middleware/quota.ts    (plan-cap preHandler)
  ├── adapters/sqlite-fs.ts  (StorageClient impl, better-sqlite3 + fs)
  ├── adapters/postgres-minio.ts (StorageClient impl, pg + @aws-sdk/client-s3)
  ├── routes/maps.ts         (StorageClient consumer)
  ├── routes/share.ts        (StorageClient consumer)
  ├── routes/health.ts       (no deps beyond types)
  ├── routes/workspaces.ts   (StorageClient consumer)
  └── routes/billing.ts      (StorageClient consumer, lazy stripe)
```

Routes never import adapters directly — only `index.ts` wires them together. This is a textbook strategy pattern implementation.
