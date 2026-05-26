# storage — Contracts

**Status: Ground-truth.** Verified against `code/apps/storage/src/` at commit 11cb498.

> Source: full source analysis of index.ts, config.ts, types.ts, all 4 route files, 2 middleware files, 2 adapter files, logger.ts, and associated tests.

---

## 1. HTTP API Surface

### Maps

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/maps` | X-Workspace-ID (managed) or none (self-host) | `application/octet-stream` raw bytes. 50 MiB body limit (Fastify `bodyLimit`). | `201` returns `MapRecord` JSON | ID minted server-side via `nanoid(21)`. ID regex: `^[A-Za-z0-9_-]{21}$`. |
| `GET` | `/maps/:id` | Same | — | `200` returns `MapRecord` JSON | Validates ID regex; mismatch = `400` `{"error":"invalid id"}`. Missing = `404`. |
| `PUT` | `/maps/:id` | Same | `application/octet-stream` raw bytes | `200` returns updated `MapRecord` JSON | Overwrites blob on same `blob_ref`. Missing = `404`. |
| (missing) | `DELETE /maps/:id` | — | — | — | **Not implemented.** No delete endpoint exists. Maps are append-only. |

### Share

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/maps/:id/share` | X-Workspace-ID | — | `201` `{ token: string, url: string, expires_at: string }` | Mint read-only token. Verifies map exists first. TTL = 7 days (hardcoded in adapters, not configurable). |
| `GET` | `/share/:token` | None | — | `200` `{ map: MapRecord, mode: "read" }` | Resolves and checks expiry. `410` for expired/orphaned. `404` for never-issued. |
| `GET` | `/share/:token/blob` | None | — | `200` raw `application/octet-stream` | Same gates as token resolve, plus blob-exists check. `Cache-Control: private, max-age=60`. |
| (missing) | `/m/:uuid` | — | — | — | **Short URL alias NOT implemented.** The spec doc predicted it; only the `url` response field in POST maps:id/share constructs `/m/:token` URLs, but no GET handler is registered for `/m/:uuid`. |

### Workspaces (Phase 6 A13b — managed-mode only)

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `GET` | `/api/workspaces` | X-Workspace-ID | — | `200` `{ workspaces: Workspace[] }` | Returns all workspaces. Self-host servers return `404`. |
| `POST` | `/api/workspaces` | X-Workspace-ID | `{ name: string }` | `201` `Workspace` JSON | Creates free-tier workspace. Self-host = `404`. ID server-generated via `nanoid(21)`. |

### Billing (Phase 6 A13c — managed-mode only)

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/api/billing/checkout` | X-Workspace-ID | `{ workspaceId: string, priceTier: WorkspacePlan }` | `200` `{ url: string }` | Stripe Checkout Session. Self-host = `404`. Stripe not configured = `503`. |
| `POST` | `/api/billing/webhook` | Stripe signature | `application/json` (raw body preserved) | `200` `{ status: "ok" }` or `{ status: "already_processed" }` | Signature verification. In-memory idempotency store (30-day TTL, lost on restart). Self-host = `404`. |

### Health & Observability

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `GET` | `/health` | None (bypassed by workspace middleware) | — | `200` `{ status: "ok", uptime: number, storageMode: StorageMode }` | Simple liveness probe. No DB/blob health check despite the spec doc prediction. |

### Runtime behavior (not routes)

- **No DELETE anywhere.** Maps are append-only. No revocation for share tokens.
- **No bearer token auth.** The spec doc predicted Bearer tokens; the code has NONE. All auth is via `X-Workspace-ID` header in managed mode only.
- **No Prometheus `/metrics` endpoint.** The spec doc predicted it; it does not exist.
- **No snapshot endpoints.** Phase 7 snapshots not implemented.
- **No mobile field collection.** Phase 7 `/api/v1/submit/:layerToken` not implemented.
- **No Yjs persistence endpoints.** Phase 6 predicted `GET /api/maps/:id` and `PUT /api/maps/:id` but the real code uses raw `octet-stream`, not Yjs-aware endpoints.

---

## 2. Data Shapes

### MapRecord (storage/types.ts — the actual contract)

```typescript
interface MapRecord {
  id: string;            // nanoid(21)
  created_at: string;    // ISO 8601
  updated_at: string;    // ISO 8601
  blob_ref: string;      // adapter-specific: "blobs/<id>.atlasdraw" (sqlite-fs),
                         //   "maps/<id>.atlasdraw" (postgres-minio), or S3 key
  byte_size: number;     // blob byte length
  workspace_id: string | null;  // Phase 6 A9: null for Phase 4 / self-host records
}
```

**Divergence from spec doc (`MapRecord`):** The spec doc predicted `ownerId`, `blobUrl?`, and `camelCase`. The real type uses `snake_case`, has no `ownerId`, no `blobUrl`, and adds `byte_size`.

### ShareToken (storage/types.ts)

```typescript
interface ShareToken {
  token: string;         // nanoid(21)
  map_id: string;
  mode: "read";          // ALWAYS "read" — no write mode
  expires_at: string;    // ISO 8601
  created_at: string;    // ISO 8601
  workspace_id: string | null;
}
```

TTL = 7 days, hardcoded in each adapter. The spec doc predicted configurable TTL; the code has none.

### Workspace (storage/types.ts)

```typescript
interface Workspace {
  id: string;
  name: string;
  plan: WorkspacePlan;   // "free" | "pro" | "pro_25"
  stripe_customer_id: string | null;
  created_at: string;
}
```

### WorkspaceScope (storage/types.ts)

```typescript
interface WorkspaceScope {
  workspaceId?: string | null;
}
```

### WorkspacePlan

```typescript
type WorkspacePlan = "free" | "pro" | "pro_25";
```

### WorkspaceId (middleware/workspace.ts — branded type)

```typescript
type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
```

---

## 3. Type Hierarchy Comparison: storage vs data packages

| Concept | `@atlasdraw/storage` types | `@atlasdraw/data` / `ManifestSchema` | Key Divergence |
|---------|---------------------------|---------------------------------------|----------------|
| Record IDs | `nanoid(21)` — `^[A-Za-z0-9_-]{21}$` | ULID — `^[0-9A-HJKMNP-TV-Z]{26}$` | **Different format AND length.** Storage uses nanoid; data uses ULID. No shared ID generator. |
| Field naming | `snake_case` (`created_at`, `blob_ref`, `workspace_id`) | `camelCase` (`createdAt`, `layerId`, `featureCount`) | **Naming convention divergence.** Two naming systems in the same project. |
| Map identity | `id` (nanoid(21)), mutable `updated_at` | `manifest.id` (ULID), `createdAt`, `updatedAt` | The map persisted by storage has a nanoid, but the manifest inside the blob has a separate ULID. Two ID systems for the same document. |
| `byte_size` | Present on `MapRecord` | Not present in `Manifest` | Adapter tracks blob size; manifest doesn't know about it. |
| `workspace_id` | Present on `MapRecord`, `ShareToken`, DB row | Not present in `ManifestSchema` | Workspace scoping is a storage-layer concern, invisible to the data format. |
| Owner concept | **None.** No `ownerId`, `owner_id`, or user field on any storage type | No owner on `Manifest` explicitly (permissions has `publicView` only) | Neither layer knows who owns a document. `permissions.publicView` is the only access control. |
| Timestamps | ISO 8601 strings | ISO 8601 strings (datetime with offset via `ISOTimestampSchema`) | Compatible format, but storage timestamps are `new Date().toISOString()` (always UTC). |
| Blob reference | `blob_ref` — adapter-specific internal key | Not in manifest (the blob IS the manifest + scene + layers) | Storage's blob is the full `.atlasdraw` zip; the manifest is one file within it. |

**Critical finding:** There are TWO independent ID systems. The storage server assigns a `nanoid(21)` to each map record (the DB row). The blob itself contains a manifest with a completely different ULID. There is no contract ensuring they match or relate -- the blob's manifest ID is opaque to the storage server.

---

## 4. Auth Contract

### Actual: Workspace middleware only (no bearer tokens)

| Layer | Mechanism | What it checks | Response |
|-------|-----------|----------------|----------|
| Workspace middleware (global preHandler) | `X-Workspace-ID` header | In managed mode: header required, non-empty string. In self-host: best-effort attach if present. | Managed: `401 WORKSPACE_REQUIRED`. Self-host: no-op. |
| Quota middleware (global preHandler, runs after workspace) | Workspace plan from DB | POST /maps only: `workspace.countWorkspaceMaps < plan.limit` | `402 quota_exceeded` with `{limit, current, max}`. `404 workspace_not_found` if workspace missing. |
| Health bypass | URL check | `/health` (and `/health?*`) bypass workshop+quota middleware | Always passes. |

**What is NOT implemented (despite spec doc predictions):**
- No Bearer token auth.
- No JWT, OIDC, or session tokens.
- No token revocation.
- No OIDC (predicted for Phase 6 hosted mode).
- No anonymous token support despite MapRecord comments referencing it.
- No user-level auth -- workspace-level scoping is the only isolation.
- `X-Workspace-ID` is trusted as-is -- there is no DB-backed validation in the middleware layer (the quota middleware validates the workspace exists, but map CRUD routes themselves do not re-validate).

### Share token access (unauthenticated)

`GET /share/:token` and `GET /share/:token/blob` are fully unauthenticated -- no workspace header, no bearer token, no origin check. Correctness relies entirely on token entropy (`nanoid(21)` = 126 bits).

---

## 5. DB Schema Comparison: SQLite vs Postgres

### maps table

| Column | SQLite | Postgres | Compatible? |
|--------|--------|----------|-------------|
| `id` | `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` | Yes |
| `created_at` | `TEXT NOT NULL` | `TIMESTAMP WITH TIME ZONE NOT NULL` | **Divergence** -- SQLite stores ISO strings; Postgres stores native timestamps. `rowToMap` normalizes both to ISO strings. |
| `updated_at` | `TEXT NOT NULL` | `TIMESTAMP WITH TIME ZONE NOT NULL` | Same divergence. |
| `blob_ref` | `TEXT NOT NULL` | `TEXT NOT NULL` | Yes |
| `byte_size` | `INTEGER NOT NULL` | `BIGINT NOT NULL` | Yes (both 64-bit) |
| `workspace_id` | `TEXT` (added via ALTER TABLE ADD COLUMN; catch duplicate) | `TEXT` (added via ALTER TABLE ADD COLUMN IF NOT EXISTS) | Compatible semantics, **different migration pattern**. Postgres: `IF NOT EXISTS`. SQLite: try/catch for "duplicate column name". |

### share_tokens table

| Column | SQLite | Postgres | Compatible? |
|--------|--------|----------|-------------|
| `token` | `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` | Yes |
| `map_id` | `TEXT NOT NULL, FOREIGN KEY REFERENCES maps(id)` | `TEXT NOT NULL REFERENCES maps(id)` | SQLite declares FK separately; Postgres inline. Both enforce referential integrity (SQLite only with `PRAGMA foreign_keys = ON`). |
| `mode` | `TEXT NOT NULL` | `TEXT NOT NULL` | Yes |
| `expires_at` | `TEXT NOT NULL` | `TIMESTAMP WITH TIME ZONE NOT NULL` | Same divergence as timestamps. |
| `created_at` | `TEXT NOT NULL` | `TIMESTAMP WITH TIME ZONE NOT NULL` | Same divergence. |
| `workspace_id` | `TEXT` (same ALTER TABLE catch pattern) | `TEXT` (same ALTER TABLE IF NOT EXISTS) | Same migration divergence. |

### workspaces table

| Column | SQLite | Postgres | Compatible? |
|--------|--------|----------|-------------|
| `id` | `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` | Yes |
| `name` | `TEXT NOT NULL` | `TEXT NOT NULL` | Yes |
| `plan` | `TEXT NOT NULL` | `TEXT NOT NULL` | Yes |
| `stripe_customer_id` | `TEXT` (nullable) | `TEXT` (nullable) | Yes |
| `created_at` | `TEXT NOT NULL` | `TIMESTAMP WITH TIME ZONE NOT NULL` | Same timestamps divergence. |

### Indexes (identical in both)

- `workspaces_stripe_customer_id_idx` on `workspaces(stripe_customer_id)`
- `maps_workspace_id_idx` on `maps(workspace_id)`

### Critical divergence

1. **Timestamp type:** SQLite stores as ISO strings (`TEXT`); Postgres stores as `TIMESTAMPTZ`. The `isoize()` helper in postgres-minio normalizes from Postgres's native `Date` to ISO string. The SQLite adapter reads/writes strings directly. The returned types are identical (`string`), but they round-trip through different paths.

2. **Migration pattern for `workspace_id`:** Postgres uses native `ADD COLUMN IF NOT EXISTS`. SQLite has no `IF NOT EXISTS` for columns, so it uses try/catch on `duplicate column name`.

3. **Foreign key syntax:** SQLite uses separate `FOREIGN KEY (map_id) REFERENCES maps(id)` clause. Postgres uses inline `REFERENCES maps(id)`. SQLite requires `PRAGMA foreign_keys = ON` at connection to enforce.

---

## 6. Quota Middleware Contract

```
POST /maps
  │
  ├─ Quota middleware checks: `if (!opts.managed) return`          [short-circuit]
  ├─ Checks method === "POST" && url === "/maps"                    [only gated route]
  ├─ Reads `request.workspace` (branded WorkspaceId)
  ├─ Calls `client.getWorkspace(workspaceId)`                        [look up plan]
  ├─ Calls `client.countWorkspaceMaps(workspaceId)`                  [count current]
  ├─ Compares against `capForPlan(plan, limits)`                     [check cap]
  └─ If ≥ cap → 402 with `{error:"quota_exceeded", limit, current, max}`
```

Only `POST /maps` is gated in v1. No other mutation (PUT, POST share, POST workspace, POST billing) is quota-checked. Quota middleware is registered as a Fastify preHandler hook on the app level.

---

## 7. Undocumented Contracts

### 7.1 ID format convention

Both map IDs and share tokens use `nanoid(21)` validated by `/^[A-Za-z0-9_-]{21}$/`. This is duplicated as a regex constant in `routes/maps.ts`, `routes/share.ts`, and both adapters. There is no shared ID validation utility.

### 7.2 Share token TTL is hardcoded

`SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000` (7 days) is defined independently in both `adapters/sqlite-fs.ts` and `adapters/postgres-minio.ts`. Not configurable via env or config.

### 7.3 Body format requirement

Maps are created/updated as raw `application/octet-stream` with a 50 MiB limit. The content type parser is registered at app level in `index.ts`:
```typescript
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, ...)
```
Oversize bodies return Fastify's built-in 413. Non-buffer bodies return `415 { error: "Content-Type must be application/octet-stream" }`.

### 7.4 Blob storage key convention divergence

- `sqlite-fs`: `blobs/<id>.atlasdraw` stored at `<DATA_DIR>/blobs/<id>.atlasdraw`
- `postgres-minio`: `maps/<id>.atlasdraw` in the `atlasdraw-maps` bucket

The blob key scheme differs between adapters, but the `blob_ref` field stores the adapter-specific key transparently.

### 7.5 Workspace middleware bypasses /health

The `preHandler` middleware has a hardcoded bypass: `request.url === "/health" || request.url.startsWith("/health?")`. This must be manually updated if any new public endpoint is added.

### 7.6 No rate limiting

No rate limiting exists at any layer. The 50 MiB body limit is the only request-size protection.

### 7.7 Stripe idempotency is in-memory only

The `IdempotencyStore` is a per-process `Map<string, number>` with 30-day GC. Lost on process restart. No Redis or shared storage. Documented as "TODO post-v1."

### 7.8 Workspace scope is metadata-only at the adapter layer

The `WorkspaceScope` interface documents that adapters MUST persist the value when present and MUST NOT reject calls based on it. DB-backed workspace validation happens only in the quota middleware, not in CRUD routes.

### 7.9 No query/filter/list/list endpoints

There is no `GET /maps`, no `GET /workspaces/:id/maps`, no search, no pagination, no filter. The `StorageClient` interface has no `listMaps()` method. Workspace map counting (`countWorkspaceMaps`) uses `SELECT COUNT(*)` with no pagination.

### 7.10 `blob_ref` overwrite behavior on PUT

`PUT /maps/:id` overwrites the blob at the existing `blob_ref`. The key is set once at creation and never changes, so the blob storage location is the object's identity. There is no versioning, no copy-on-write, no history.

### 7.11 Structured logging fields

All routes use `request.log.info/warn/error` (pino via Fastify). ADR-0011 domain events use reserved field names:
- `workspace_scoped` — emitted on POST /maps and POST /maps/:id/share when workspace context present
- `workspace_created` — emitted on POST /api/workspaces
- `stripe_webhook_received` — emitted on POST /api/billing/webhook
- `stripe_webhook_signature_failed` — on signature verification failure
- `stripe_webhook_dispatch_failed` — on webhook handler error
- `quota_breach` — emitted on quota rejection with `{workspaceId, quotaType, attemptedValue, limit, timestamp}`

---

## 8. Configuration Contract

The server boots from `loadConfig()`, which reads env vars through a Zod `discriminatedUnion` keyed on `STORAGE_MODE`.

| Env Var | Required | Default | Used By |
|---------|----------|---------|---------|
| `STORAGE_MODE` | Yes | — | All — selects adapter |
| `PORT` | No | `4000` | Server listen |
| `PUBLIC_URL` | No | `""` | Share URL prefix |
| `LOG_LEVEL` | No | `"info"` | Pino level |
| `SENTRY_DSN` | No | — | Sentry init (no-op if absent) |
| `MANAGED_MODE` | No | `false` | Workspace + quota + billing gate |
| `QUOTA_FREE_MAPS` | No | `3` | Free-tier map cap |
| `QUOTA_PRO_MAPS` | No | `100` | Pro-tier map cap (also used for pro_25) |
| `STRIPE_SECRET_KEY` | No | — | Stripe SDK |
| `STRIPE_WEBHOOK_SECRET` | No | — | Webhook signature verification |
| `STRIPE_PRICE_PRO` | No | — | Stripe price for pro tier |
| `STRIPE_PRICE_PRO_25` | No | — | Stripe price for pro_25 tier |
| `SITE_URL` | No | `"http://localhost:3000"` | Stripe redirect URLs |
| `DATABASE_URL` | Conditional (postgres-minio) | — | pg Pool connection |
| `BLOB_ENDPOINT` | Conditional (postgres-minio) | — | S3 endpoint |
| `BLOB_ACCESS_KEY` | Conditional (postgres-minio) | — | S3 credentials |
| `BLOB_SECRET_KEY` | Conditional (postgres-minio) | — | S3 credentials |
| `DATA_DIR` | No (sqlite-fs) | `"/data"` | SQLite DB + blob filesystem root |

---

## 9. Confidence Assessment

| Area | Confidence | Rationale |
|------|-----------|-----------|
| Route catalog | **High** | All 10 registered routes verified against source. `/m/:uuid` confirmed absent. |
| Request/response shapes | **High** | Every handler read and documented. Types verified against runtime. |
| Auth contract | **High** | Workspace middleware source verified. No bearer token exists anywhere. |
| Quota middleware | **High** | Short-circuit path confirmed: `if (!opts.managed) return` is first line of hook. |
| DB schema compatibility | **High** | Both adapters read. All columns compared. Timestamp type divergence documented. |
| Type hierarchy comparison | **High** | storage types vs data package types compared line-by-line. Two ID systems confirmed. |
| Configuration surface | **High** | Zod schema verified. Conditional requirements documented. |
| Yjs persistence | **High** | Confirmed NOT implemented. No Yjs-aware routes exist. |
| Snapshot / mobile endpoints | **High** | Confirmed NOT implemented (Phase 7). |
| Metrics endpoint | **High** | Confirmed absent despite spec doc prediction. |
| Undocumented contracts | **Medium** | Some implicit assumptions (ID uniqueness, workspace-ID trust model) are architectural invariants not stated anywhere. |

---

## 10. Summary of Spec Doc Corrections

| Spec Doc Claim | Actual | Impact |
|---------------|--------|--------|
| Bearer token auth | No auth; X-Workspace-ID header only | Any client who knows a map ID can access it. |
| `MapRecord.ownerId` | No owner field | No ownership tracking. |
| `MapRecord.blobUrl?` | No blobUrl field | Consumers must go through adapter directly. |
| camelCase fields | snake_case fields (`created_at`, `blob_ref`, `byte_size`) | Wire format differs from spec. |
| `/m/:uuid` short URL | Not implemented | Share URLs with `/m/` prefix 404. |
| Configurable share TTL | Hardcoded 7 days per adapter | Cannot customize. |
| `/metrics` endpoint | Not implemented | No Prometheus integration. |
| Phase 7 snapshot endpoints | Not implemented | Correctly marked as future. |
| 30-day bearer TTL | No bearer token exists | Entire auth section is speculative. |
