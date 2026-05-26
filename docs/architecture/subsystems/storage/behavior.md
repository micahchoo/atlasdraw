# storage — Behavior

**Status: Verified.** Traced against `code/apps/storage/src/` at commit 11cb498.

> Sources: code/apps/storage/src/index.ts, config.ts, types.ts, adapters/*.ts,
> middleware/*.ts, routes/*.ts, logger.ts.

---

## 1. Flow Traces

### 1.1 Server Startup

```
main() entry
  │
  ├── loadConfig() — Zod discriminated union (+ postgres-minio, + sqlite-fs)
  │     Failure: throws with formatZodError() — loud, named, exits via process.exit(1)
  │
  ├── Sentry.init() — only if SENTRY_DSN is set (opt-in per ADR-0009)
  │     beforeSend scrubs Authorization headers + user.ip_address
  │
  ├── Fastify instantiation
  │     loggerInstance: pino (pre-built via logger.ts)
  │     bodyLimit: 50 MiB
  │
  ├── Content type parser: application/octet-stream → Buffer passthrough
  │
  ├── Adapter selection (switch on STORAGE_MODE)
  │   ├── "sqlite-fs" → createSqliteFsAdapter({ dataDir })
  │   │     ├── fs.mkdirSync(blobsDir, { recursive: true })
  │   │     ├── new Database(path, { WAL mode })
  │   │     ├── CREATE TABLE IF NOT EXISTS maps, share_tokens, workspaces
  │   │     ├── CREATE INDEX IF NOT EXISTS (2 indexes)
  │   │     └── ALTER TABLE ADD COLUMN IF NOT EXISTS workspace_id
  │   │         (catches duplicate column error — idempotent)
  │   │
  │   └── "postgres-minio" → createPostgresMinioAdapter({ databaseUrl, blob* })
  │         ├── new Pool({ connectionString }) — lazy connect, no pool.query yet
  │         ├── new S3Client({ endpoint, credentials, forcePathStyle })
  │         ├── ensureSchema() — lazy via initReady Promise (first API call)
  │         └── ensureBucket() — lazy, on first putBlob
  │             (CreateBucketCommand, ignores BucketAlreadyExists)
  │
  ├── Route + middleware registration order (load-bearing):
  │   1. GET /health                    ← before ws middleware (bypasses workspace)
  │   2. Workspace preHandler (global)  ← reads X-Workspace-ID
  │   3. Quota preHandler (global)      ← checks POST /maps map count
  │   4. POST /maps, GET /maps/:id, PUT /maps/:id
  │   5. POST /maps/:id/share, GET /share/:token, GET /share/:token/blob
  │   6. GET /api/workspaces, POST /api/workspaces (404 if !managed)
  │   7. POST /api/billing/checkout, POST /api/billing/webhook (404 if !managed)
  │
  └── app.listen({ host: "0.0.0.0", port })
```

**Key observations:**
- Schema creation is synchronous for sqlite-fs (at construction time), lazy for postgres-minio (deferred to first `ensureSchema()` call with Promise deduplication via `initReady`). No race condition in either mode — sqlite-fs is single-threaded by better-sqlite3 design; postgres-minio's `ensureSchema` is idempotent DDL protected by a module-level `Promise<void> | null` latch.
- Postgres pool connects lazily — no startup-time connectivity check. First query fails if DB is unreachable.
- S3 bucket is created lazily on first `putBlob`. If bucket creation fails with auth errors, the error propagates and crashes the request (500).
- Workspace middleware registered BEFORE quota middleware — quota depends on `request.workspace` being set.
- ALTER TABLE ADD COLUMN in sqlite-fs: catches `"duplicate column name"` — safe across restarts.

[CONFIDENCE: high — all code read]

---

### 1.2 Map CRUD

#### POST /maps

```
Request: raw octet-stream (Buffer), 50 MiB limit enforced by Fastify bodyLimit
  │
  ├── [415] body is not Buffer → "Content-Type must be application/octet-stream"
  │
  ├── workspaceId = request.workspace ?? null
  │
  └── client.createMap(blob, { workspaceId })
        ├── sqlite-fs:
        │     ├── nanoid(21) → id
        │     ├── fs.writeFileSync(blobsDir/id.atlasdraw, blob)
        │     ├── INSERT INTO maps (...) VALUES (...)
        │     └── returns MapRecord
        │
        └── postgres-minio:
              ├── ensureSchema() (lazy, idempotent)
              ├── nanoid(21) → id, blobRef = `maps/${id}.atlasdraw`
              ├── putBlob(blobRef, blob)
              │     ├── ensureBucket() (lazy, idempotent)
              │     └── s3.send(PutObjectCommand)
              ├── INSERT INTO maps (...) VALUES (...)
              └── returns MapRecord

  Return: 201 { id, created_at, updated_at, blob_ref, byte_size, workspace_id }
  Event: if workspaceId truthy → pino info "workspace_scoped" per ADR-0011
```

**Key observations:**
- No transaction wrapping blob + DB insert. If blob write succeeds but DB insert fails (e.g., uniqueness constraint — currently impossible since nanoid is unique), the blob is orphaned. This is a verified endorheic basin.
- ID format: nanoid(21), regex-validated on read/update paths.
- Input validation: only Content-Type check. No size check beyond Fastify bodyLimit (any Buffer up to 50 MiB accepted).
- `workspace_scoped` event fires in both managed and self-host mode when the header is present.

#### GET /maps/:id

```
Request: id from URL param
  │
  ├── [400] !ID_RE.test(id) → "invalid id"
  │
  └── client.getMap(id)
        ├── sqlite-fs: selectMap.get(id), returns row or undefined → null
        └── postgres-minio: pool.query(SELECT ... WHERE id=$1), returns row or null

  Return: 200 { MapRecord } or 404 { error: "not found" }
```

**Key observations:**
- Malformed IDs return 400 (not 404). Valid format but missing returns 404.
- Workspace ID is returned in the record but NOT validated against the requesting workspace — retrieval is workspace-agnostic in v1 (workspace_id is metadata only).

#### PUT /maps/:id

```
Request: id from URL param, body is octet-stream Buffer
  │
  ├── [400] !ID_RE.test(id) → "invalid id"
  ├── [415] body is not Buffer → "Content-Type must be application/octet-stream"
  │
  └── client.updateMap(id, blob)
        ├── sqlite-fs:
        │     ├── selectMap.get(id) — throws "not found:" if missing
        │     ├── fs.writeFileSync(existing.blob_ref, blob) — OVERWRITES existing blob
        │     └── updateMapRow.run(now, byteLength, id)
        │
        └── postgres-minio:
              ├── pool.query(SELECT ... WHERE id=$1) — throws "not found:" if missing
              ├── putBlob(existing.blob_ref, blob) — OVERWRITES existing S3 object
              └── UPDATE maps SET updated_at=$1, byte_size=$2 WHERE id=$3

  Return: 200 { MapRecord } or 404 { error: "not found" }
```

**Key observations:**
- Overwrite-only — old blob content is replaced in-place, no new blob version created.
- No delete endpoint exists. MapRecords and their blobs persist indefinitely.
- No blob cleanup on failure — if UPDATE fails after blob write, the blob is orphaned (newer content unreachable by id).

[CONFIDENCE: high — all code read]

---

### 1.3 Share Token Flow

#### POST /maps/:id/share — Mint token

```
Request: id from URL param
  │
  ├── [400] !ID_RE.test(id) → "invalid id"
  ├── client.getMap(id) — pre-check, early 404 if map missing
  │
  └── client.createShareToken(mapId, { workspaceId })
        ├── ID_RE check, then verify map exists via SELECT
        ├── nanoid(21) → token
        ├── SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000 = 7 days (not 30!)
        ├── INSERT INTO share_tokens (...) VALUES (...)
        └── returns ShareToken

  Return: 201 { token, url, expires_at }
  Event: if workspaceId truthy → pino info "workspace_scoped"
```

#### GET /share/:token — Resolve token

```
Request: token from URL param
  │
  ├── [400] !ID_RE.test(token) → "invalid token"
  ├── client.resolveToken(token) → null → [404] "not found"
  ├── new Date(expires_at) <= Date.now() → [410] "expired"
  ├── client.getMap(map_id) → null → [410] "expired" (orphaned token)
  │
  Return: 200 { map: MapRecord, mode: "read" }
```

#### GET /share/:token/blob — Download blob via share token

```
Request: token from URL param
  │
  ├── (same validation chain as GET /share/:token)
  ├── client.getBlob(map_id) → null → [410] "expired" (orphaned blob)
  │
  Return: 200 application/octet-stream with Cache-Control: private, max-age=60
```

**Key observations:**
- TTL is 7 days, hard-coded in each adapter (SHARE_TTL_MS constant), not configurable.
- `mode` is always `"read"` — set server-side, never echoed from request.
- Orphaned token detection: if the map row was deleted, the token is indistinguishable from expiry (410 "expired").
- Orphaned blob detection: if map row exists but blob is missing from S3/filesystem, returns 410.
- No token revocation. No token delete. Expired tokens remain in the table forever.
- Cache-Control: max-age=60 on blob downloads — browsers cache for 60 seconds.

[CONFIDENCE: high — all code read]

---

### 1.4 Workspace Management

#### GET /api/workspaces — List workspaces

```
  ├── [404] if !opts.managed (self-host hides the feature)
  └── client.listWorkspaces()
        ├── sqlite-fs: SELECT * FROM workspaces ORDER BY created_at ASC
        └── postgres-minio: same query
  Return: 200 { workspaces: Workspace[] }
```

#### POST /api/workspaces — Create free-tier workspace

```
Request: { name: string }
  │
  ├── [404] if !opts.managed
  ├── [400] if name is missing/empty → "name_required"
  │
  └── client.createWorkspace({ id: nanoid(21), name, plan: "free" })
        ├── INSERT INTO workspaces (id, name, plan, stripe_customer_id, created_at)
        └── stripe_customer_id = null always (no Stripe checkout yet)

  Return: 201 { Workspace }
  Event: pino info "workspace_created" { workspaceId, plan, timestamp }
```

**Key observations:**
- Workspace name is trimmed server-side. Single string field — no min/max length validation beyond non-empty.
- ID is server-generated nanoid(21) — no client-supplied IDs.
- No auth/ownership — any caller can list all workspaces. Post-v1 TODO per comment.
- stripe_customer_id starts null; populated only via Stripe checkout webhook.

[CONFIDENCE: high — all code read]

---

### 1.5 Stripe Billing Flow

#### POST /api/billing/checkout — Create Checkout Session

```
Request: { workspaceId, priceTier }
  │
  ├── [404] if !opts.managed
  ├── [503] if STRIPE_SECRET_KEY not configured → "stripe_not_configured"
  ├── [400] if missing workspaceId or priceTier
  ├── [400] if priceTier is not "pro" or "pro_25"
  ├── [503] if price ID not configured for tier → "price_not_configured"
  ├── client.getWorkspace(workspaceId) → null → [404] "workspace_not_found"
  │
  ├── Stripe SDK (lazy require("stripe")) loads at handler time
  │   └── stripe.checkout.sessions.create({ mode: "subscription", ... })
  │
  Return: 200 { url: session.url }
```

#### POST /api/billing/webhook — Stripe event receiver

```
Request: application/json (raw Buffer retained for signature verification)
  │
  ├── [404] if !opts.managed
  ├── [503] if STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not configured
  ├── [400] if stripe-signature header missing
  ├── [400] if rawBody not a Buffer
  │
  ├── Stripe.webhooks.constructEvent(rawBody, sig, secret)
  │     └── fails → [400] "invalid_signature", logged as warn
  │
  ├── IdempotencyStore.has(event.id) → true → [200] { status: "already_processed" }
  │     (in-memory Map, 30-day TTL with lazy GC, single-instance only)
  │
  ├── IdempotencyStore.add(event.id)
  ├── pino info "stripe_webhook_received" { eventType, customerId, timestamp }
  │
  └── dispatchEvent(event, opts)
        ├── "checkout.session.completed":
        │     Extract workspaceId, priceTier, customer from metadata
        │     → client.updateWorkspacePlan(workspaceId, priceTier, customer)
        │     COALESCE in SQL preserves existing stripe_customer_id on null
        │
        ├── "customer.subscription.deleted":
        │     Extract customer → findWorkspaceByStripeCustomerId
        │     → client.updateWorkspacePlan(ws.id, "free")
        │     Downgrades to free on cancellation
        │
        └── unknown type: 200-OK no-op (forward-compat)

        dispatchEvent fails → [500] "dispatch_failed"
        Return: 200 { status: "ok" }
```

**Key observations:**
- Fastify's default JSON parser is REPLACED for the webhook route (`removeContentTypeParser` + re-add). The webhook route captures raw Buffer via `rawBody` for Stripe signature verification. Non-webhook JSON requests are still JSON.parsed.
- Stripe SDK is lazy `require("stripe")` — self-host builds don't need the package installed. Test injection via `stripeFactory` option.
- IdempotencyStore is in-memory only — lost on restart. 30-day TTL with lazy GC (scans on every `has()` and `size()` call). Production multi-instance needs Redis (documented TODO).
- Price IDs are configured via env (STRIPE_PRICE_PRO, STRIPE_PRICE_PRO_25) — no database lookups.
- Stripe env vars are entirely optional at startup. Boot succeeds; affected routes return 503 at request time.

[CONFIDENCE: high — all code read]

---

### 1.6 Health Endpoint

```
GET /health

Return: 200 { status: "ok", uptime: number, storageMode: "postgres-minio"|"sqlite-fs" }
```

**Key observations:**
- No DB ping or blob reachability check. Health is purely process-liveness (200 if the process is serving HTTP). Actual I/O readiness is implicit — failures surface as 5xx on real requests.
- Storage mode is echoed in the response (useful for debugging which adapter is active).
- Bypasses workspace middleware entirely (first route registered, before preHandler).

[CONFIDENCE: high — all code read]

---

## 2. Middleware Chain Analysis

### 2.1 Workspace Middleware (global preHandler, registered first)

| Mode | Behavior |
|---|---|
| `managed=true` | Requires `X-Workspace-ID` header on all routes except /health. Missing → 401 `WORKSPACE_REQUIRED`. Attaches `request.workspace` as branded `WorkspaceId`. |
| `managed=false` | Best-effort: attaches `request.workspace` if header is present, never requires. No-op on missing header. |

- Bypass list: currently only `/health`. Any future public route must be added to the bypass check.
- WorkspaceId is an opaque branded string — no DB-backed validation at this layer (that happens in quota middleware and workspace routes).
- Header value is a single string; array headers take the first element.

### 2.2 Quota Middleware (global preHandler, registered second)

| Mode | Behavior |
|---|---|
| `managed=false` | Returns immediately — one branch check per request, no I/O. |
| `managed=true` | Only gates `POST /maps`. Other methods/paths pass through. |

Gate logic:
- Reads `request.workspace` (set by workspace middleware).
- Looks up workspace via `client.getWorkspace()`.
- Counts existing maps via `client.countWorkspaceMaps()`.
- If `current >= capForPlan(plan)` → 402 `quota_exceeded` + pino info `quota_breach` per ADR-0011.
- Guard: if `request.workspace` is undefined (ordering bug), returns 401 defensively.

**Race condition**: POST /maps can exceed quota under concurrent requests since count-then-insert is not atomic across requests. Two concurrent POSTs for the same workspace at `current == max - 1` both pass the check and both insert. Postgres serializable isolation would prevent this; sqlite-fs serializes writes but the check and insert are separate synchronous calls within the same async function — between the `selectMap` and `insertMap` statements, another concurrent handler thread could insert.

[CONFIDENCE: high — all code read]

---

## 3. Endorheic Basins

| Basin | Code evidence | Severity | Flush mechanism |
|---|---|---|---|
| **Expired share tokens** | `share_tokens` rows persist after TTL expires. No DELETE anywhere in `share.ts` or adapters. | Med | No automatic cleanup. Table grows without bound. Requires manual SQL DELETE or future GC job. |
| **Orphaned blobs on postgres-minio** | `createMap`: blob written to S3 before DB insert. If INSERT fails, blob exists but no DB row references it. `updateMap`: blob overwritten before DB UPDATE — if UPDATE fails, blob has newer content but DB record points at older (or blob is orphaned entirely if blob key changed, which it isn't — same key reused). | Med | No reconciler. Manual cleanup or future GC. |
| **Postgres connection pool** | `new Pool()` created at startup, never `pool.end()` called. No graceful shutdown hook registered. | Low | Process death (SIGTERM/SIGKILL) cleans up. Long-running server holds connections until idle timeout. |
| **In-memory idempotency store** | `IdempotencyStore` in billing.ts is an in-memory `Map<string, number>`. Lost on restart. 30-day TTL with per-operation lazy GC. | Med (single-instance) | Production multi-instance deployment needs Redis (documented TODO). Single-instance accepts the loss-on-restart window. |
| **S3 bucket on different endpoint** | If BLOB_ENDPOINT is changed between restarts, existing blob_refs in the DB point at the old endpoint. | Low | Operational awareness. No migration mechanism. |
| **Map records without workspace** | Maps created in self-host mode (or before workspace scoping) have `workspace_id = null`. If a future migration requires workspace_id, these are unowned. | Low | Null workspace_id is valid per the type (`workspace_id?: string \| null`) — intentional backward compat. |
| **No delete endpoint** | No HTTP route for DELETE /maps/:id. MapRecords and their blobs accumulate forever. | Med | No plan to add in v1. Operator must manually delete DB rows + blobs. |

[CONFIDENCE: high — verified against code]

---

## 4. Error Handling per Route

| Route | Invalid input | Not found | DB failure | S3/IO failure | Other |
|---|---|---|---|---|---|
| `POST /maps` | 415 if not Buffer | N/A | Uncaught → Fastify 500 | Uncaught → Fastify 500 (bucket creation/auth errors) | 50 MiB bodyLimit → 413 (Fastify built-in) |
| `GET /maps/:id` | 400 if invalid id format | 404 | Uncaught → 500 | N/A (no blob read in GET /maps) | |
| `PUT /maps/:id` | 400 invalid id; 415 not Buffer | 404 `isNotFoundError` | Uncaught → 500 | Uncaught → 500 | |
| `POST /maps/:id/share` | 400 invalid id | 404 (pre-check + adapter fallback) | Uncaught → 500 | N/A | |
| `GET /share/:token` | 400 invalid token | 404 | Uncaught → 500 | N/A | 410 for expired/orphaned |
| `GET /share/:token/blob` | 400 invalid token | 404 | Uncaught → 500 | `getBlob` catches NoSuchKey/NotFound/ENOENT → null → 410 | 410 for expired/orphaned; Cache-Control: private, max-age=60 |
| `GET /health` | N/A | N/A | N/A | N/A | Always 200 |
| `GET /api/workspaces` | N/A | N/A | Uncaught → 500 | N/A | 404 if !managed |
| `POST /api/workspaces` | 400 if empty name | N/A | Uncaught → 500 | N/A | 404 if !managed |
| `POST /api/billing/checkout` | 400 missing/ invalid params; 503 Stripe not configured; 503 price not configured | 404 workspace_not_found | Uncaught → 500 | N/A | 404 if !managed |
| `POST /api/billing/webhook` | 400 missing sig/body; 400 invalid_signature; 503 Stripe not configured | N/A | 500 dispatch_failed | N/A | 404 if !managed; 200 already_processed (idempotent) |

**Unified pattern:**
- Invalid IDs/missing fields: 400 with descriptive error string.
- Not found errors checked via `isNotFoundError()` (string.startsWith("not found:") helper).
- No custom Fastify error handler — uncaught errors produce default Fastify 500 with logged stack.
- S3/filesystem not-found errors are caught in `getBlob` only (returns null, route returns 410). Other S3 errors propagate as 500s.
- Zod validation errors only happen at startup (loadConfig) — never per-request.

[CONFIDENCE: high — all code read]

---

## 5. Auth Flow

The storage server has no bearer token / API key / session auth in v1. The only auth primitive is the workspace header:

```
Request arrives
  │
  └── Workspace preHandler (global, except /health)
        │
        ├── managed=true:
        │     Reads X-Workspace-ID header
        │     Missing → 401 WORKSPACE_REQUIRED
        │     Present → request.workspace = branded string (opaque, no DB validation)
        │
        └── managed=false:
              Reads X-Workspace-ID header (best-effort)
              Missing → undefined (routes work without it)
              Present → request.workspace = branded string
```

Workspace middleware validates the HEADER exists (managed mode) but does NOT validate that the workspace ID corresponds to a row in the workspaces table. That validation happens downstream:
- Quota middleware: `client.getWorkspace()` call fails if workspace missing → 404 workspace_not_found.
- Workspace route handlers: `client.getWorkspace()` via `listWorkspaces`/`createWorkspace` (latter returns all).

No bearer token. No OIDC. No session. Share tokens serve as capability-based auth for public read endpoints.

[CONFIDENCE: high — all code read]

---

## 6. MANAGED_MODE=false Short-Circuit Behavior

When `MANAGED_MODE` is false (default for self-host), these components change behavior:

| Component | Behavior when MANAGED_MODE=false |
|---|---|
| **Workspace middleware** | Best-effort: attaches X-Workspace-ID if present, never requires. All routes work without it. |
| **Quota middleware** | First-line return — no I/O, no quota check. POST /maps always succeeds. |
| **Workspace routes** | GET/POST /api/workspaces → 404. Feature hidden. |
| **Billing routes** | POST /api/billing/* → 404. Stripe not required. |
| **Map CRUD** | Unchanged. workspace_id stored as null in records. |
| **Share tokens** | Unchanged. workspace_id stored as null in records. |
| **Health** | Unchanged. Always responds. |

Self-host behavior is identical to Phase 4 — workspace_id stored as null everywhere, no quota, no billing.

[CONFIDENCE: high — all code read]

---

## 7. Configuration Validation

Config is loaded once at startup via Zod discriminated union:

- If `STORAGE_MODE` is missing or invalid → loud error with valid values listed.
- `postgres-minio`: requires `DATABASE_URL`, `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY`, `BLOB_SECRET_KEY`.
- `sqlite-fs`: requires `DATA_DIR` (defaults to `/data`).
- All Stripe env vars optional (fail at request time with 503).
- Defaults: PORT=4000, LOG_LEVEL=info, QUOTA_FREE_MAPS=3, QUOTA_PRO_MAPS=100, PUBLIC_URL="" (relative URLs).

Error messages name the specific missing/invalid variable — no generic "config error".

[CONFIDENCE: high — all code read]

---

## 8. Summary of Key Differences from Prior Speculative Doc

| Topic | Speculative doc said | Actual code says |
|---|---|---|
| Share token TTL | 30 days | **7 days** (SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000) |
| Token ID | nanoid(21) from route | nanoid(21) from **adapter** (consistent) |
| Map blob input | multipart/form-data | **application/octet-stream** (raw Buffer) |
| Health check | Pings DB + blob | **No I/O check** — process-liveness only (`{ status: "ok", uptime, storageMode }`) |
| DB connection | @fastify/postgres plugin | **Raw `pg.Pool`** (no Fastify plugin) |
| Blob client | `minio` npm package | **@aws-sdk/client-s3** (S3 SDK, not minio client) |
| Auth mechanism | Bearer tokens + OIDC | **No bearer tokens** — workspace header only in v1 |
| DELETE endpoint | Not in Phase 4 MVP | **No DELETE endpoint at all** (matches speculative) |
| Metrics endpoint | Optional /metrics | **Not implemented** |
| Snapshot routes | Phase 7 | **Not implemented** (no snapshot code) |
| Snapshot GC | Phase 7 | **Not implemented** |
| Yjs persistence contract | Referenced | **No Yjs code in storage** — handled by realtime app via HTTP |
| Workspace routes | Phase 6 | **Implemented** (managed-mode only, 404 in self-host) |
| Billing webhook | Phase 6 | **Implemented** with raw body parser, in-memory idempotency |
| Schema creation | Not discussed | **Lazy** in postgres-minio (initReady Promise), **synchronous** in sqlite-fs |
| Workspace ALTER TABLE | Not discussed | **idempotent** — catches duplicate column error |

[CONFIDENCE: high — all code read]
