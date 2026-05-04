# storage — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.9; Phase 4/6/7 plans; open-questions Q10; cross-phase-audit GAP-6.

---

## Internal Module Dependency Graph

```
index.ts  (Fastify entry)
  ├── routes/maps.ts
  │     ├── services/map-service.ts
  │     │     ├── db/client.ts
  │     │     └── services/blob-service.ts
  │     └── auth/bearer.ts
  ├── routes/share.ts
  │     ├── services/share-service.ts
  │     │     └── db/client.ts
  │     └── (no auth — public read endpoint)
  ├── routes/health.ts
  │     ├── db/client.ts  (ping check)
  │     └── services/blob-service.ts  (reachability check)
  ├── routes/metrics.ts  (optional)
  ├── routes/snapshots.ts  (Phase 7)
  │     ├── services/snapshot-service.ts
  │     │     ├── db/client.ts
  │     │     └── services/blob-service.ts
  │     └── auth/bearer.ts
  ├── routes/submit.ts  (Phase 7)
  │     └── auth/layer-token.ts  (inferred)
  ├── logger.ts  ◄─── imported by all modules (GAP-6)
  └── db/client.ts  (singleton; shared across services)
```

---

## Layer Separation

| Layer | Modules | Responsibility |
|---|---|---|
| **Route handlers** | `routes/*.ts` | HTTP request/response parsing; Zod validation; auth middleware; delegate to service |
| **Service layer** | `services/*.ts` | Business logic; transaction orchestration; no HTTP concerns |
| **Persistence layer** | `db/client.ts`, `services/blob-service.ts` | DB queries; blob put/get/delete; adapter pattern for minimal vs full mode |
| **Auth** | `auth/bearer.ts`, `auth/oidc.ts`, `auth/layer-token.ts` | Token validation middleware; no business logic |
| **Cross-cutting** | `logger.ts` | Pino structured logging; imported by all layers |

**Route handlers must not query the DB directly** — all DB access goes through the service layer. This ensures transaction boundaries are owned by services, not HTTP handlers.

[CONFIDENCE: med — standard Fastify layering; structure extrapolated from Phase 4 plan files]

---

## Storage Mode Abstraction

`services/blob-service.ts` is the single boundary between storage mode variants:

| Mode | DB driver | Blob backend | Activated by |
|---|---|---|---|
| Full (recommended) | `@fastify/postgres` + `pg` | MinIO via `minio` npm client | `docker-compose.yml` |
| Minimal | `better-sqlite3` | Local filesystem | `docker-compose.minimal.yml` |

`db/client.ts` similarly abstracts over Postgres and SQLite. The route handlers and services are agnostic to the storage mode — they call `db/client.ts` methods without knowing the backend.

Mode is selected at startup via `STORAGE_MODE` env var (or inferred from available env vars).

[CONFIDENCE: high — Q10 resolution, Phase 4 tech stack table]

---

## External Dependencies

| Package | Purpose | Phase |
|---|---|---|
| `fastify` (v5.8.x) | HTTP server framework | 4 |
| `@fastify/postgres` | Postgres plugin | 4 |
| `pg` | Postgres client | 4 |
| `better-sqlite3` | SQLite (minimal mode) | 4 |
| `minio` | MinIO/S3 blob client | 4 |
| `nanoid` | Share token generation | 4 |
| `zod` | Request/response validation | 4 |
| `pino` | Structured logging (GAP-6) | 4 |
| `@fastify/multipart` | Blob upload handling | 4 |

---

## Snapshot GC Integration (Phase 7)

The `SnapshotGC` class from `packages/versioning/src/SnapshotGC.ts` is called from `routes/snapshots.ts` after each `POST /api/v1/maps/:id/snapshots`. GC runs synchronously post-save (or as a background job — implementation detail). GC policy:

- Keep last 50 named snapshots per map.
- Keep one auto-snapshot per `autoSnapshotIntervalHours` hours.
- Prune unnamed auto-snapshots older than 30 days.
- Named snapshots (`is_named = true`) are never deleted by auto-GC.

[CONFIDENCE: high — Phase 7 plan Task 18]

---

## Process Isolation

`apps/storage` is a standalone Fastify process. Does not share memory with `apps/realtime` or `apps/atlas-app`. All communication via HTTP. The Yjs persistence path (`bindState`/`writeState`) is via HTTP `GET`/`PUT /maps/:id` — standard map endpoints reused.

[CONFIDENCE: high]
