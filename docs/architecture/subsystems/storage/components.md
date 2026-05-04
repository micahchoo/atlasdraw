# storage — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.9; Phase 4/5/6/7 plans; cross-phase-audit GAP-6; open-questions Q10.

---

## Overview

`apps/storage` is the HTTP persistence server. Introduced in Phase 4. Fastify v5.8.x (v4 EOL June 2025). Owns two storage concerns:

- **Metadata**: map records, share tokens, user accounts, snapshot index. Postgres (recommended) or SQLite (minimal mode via `docker-compose.minimal.yml`).
- **Blob payloads**: `.atlasdraw` file content. MinIO/S3-compatible (full stack) or local filesystem (minimal mode).

Auth: bearer tokens (30-day TTL, `nanoid(21)` entropy). Optional OIDC for hosted/self-hosters with accounts (Phase 6).

GAP-6 fix: `GET /health` endpoint and pino structured JSON logging are baseline observability requirements added before Phase 4 ships (recommended at "Phase 4 or Phase 5" per cross-phase-audit.md). These are documented here as if present from Phase 4.

[CONFIDENCE: high — tech-spec §4.9, Phase 4 plan, cross-phase-audit GAP-6]

---

## File Structure

```
apps/storage/
  src/
    index.ts                  # Entry: Fastify server, plugin registration, route mounting
    routes/
      maps.ts                 # POST /maps, GET /maps/:id, PUT /maps/:id
      share.ts                # POST /maps/:id/share, GET /share/:token
      health.ts               # GET /health (GAP-6)
      metrics.ts              # GET /metrics (optional, Prometheus format)
      snapshots.ts            # GET/POST /api/v1/maps/:id/snapshots (Phase 7)
      submit.ts               # POST /api/v1/submit/:layerToken (Phase 7 mobile field)
    services/
      map-service.ts          # Map record CRUD business logic
      share-service.ts        # Token minting, resolution, expiry
      blob-service.ts         # Blob storage abstraction (MinIO or filesystem)
      snapshot-service.ts     # Snapshot persistence (Phase 7)
    db/
      client.ts               # Postgres (pg + @fastify/postgres) or SQLite (better-sqlite3)
      schema/
        maps.sql
        share_tokens.sql
        snapshots.sql         # Phase 7
    auth/
      bearer.ts               # Bearer token validation middleware
      oidc.ts                 # Optional OIDC (Phase 6 hosted)
    logger.ts                 # pino structured JSON logger (GAP-6)
  Dockerfile
  package.json
```

[CONFIDENCE: high — Phase 4 plan file structure, Phase 7 plan Feature 4]

---

## Component Details

**`index.ts`**
- Fastify v5 app factory. Registers plugins: `@fastify/postgres`, `@fastify/multipart` (blob uploads), CORS.
- Mounts all route files.
- Reads config: `DATABASE_URL`, `MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`, `STORAGE_MODE` (`postgres+minio` vs `sqlite+filesystem`), `PORT` (default 3001 inferred), `JWT_SECRET` or similar for token signing.
- Phase: 4.
- Complexity: low (wiring).
- [CONFIDENCE: high]

**`routes/maps.ts`**
- `POST /maps`: accept blob; store in blob service; create `MapRecord` in DB; return `{ id }`.
- `GET /maps/:id`: auth-gated; return `MapRecord` + blob URL.
- `PUT /maps/:id`: auth-gated; update blob; update `updated_at`.
- Phase: 4.
- Complexity: medium.
- [CONFIDENCE: high — Phase 4 plan Tasks 3/4]

**`routes/share.ts`**
- `POST /maps/:id/share`: mint share token (`nanoid(21)`); store with TTL in `share_tokens` table; return `{ token, url }`.
- `GET /share/:token` (canonical) / `GET /m/:uuid` (short URL alias): resolve token; if expired return 410 Gone; if valid return `{ map: MapRecord, mode: 'read' }`.
- `mode` field always set server-side from `ShareToken.mode`; never from request input (security invariant).
- Phase: 4.
- Complexity: medium.
- [CONFIDENCE: high — Phase 4 plan Task 4]

**`routes/health.ts`** (GAP-6)
- `GET /health`: returns `{ status: "ok", uptime: number, db: "ok"|"error", blob: "ok"|"error" }`.
- Checks DB connectivity (simple ping query) and blob storage reachability.
- Phase: 4 (per GAP-6 recommendation — must exist before Phase 4 demo).
- Complexity: low.
- [CONFIDENCE: high — cross-phase-audit GAP-6]

**`routes/metrics.ts`**
- `GET /metrics`: optional Prometheus-format metrics. Request counts, response times, active connections.
- Phase: 4+ (optional).
- Complexity: low.
- [CONFIDENCE: low — GAP-6 mentions metrics as optional; implementation shape extrapolated]

**`routes/snapshots.ts`** (Phase 7)
- `POST /api/v1/maps/:id/snapshots`: accept snapshot blob + name; store in blob + snapshots table; run GC policy via `SnapshotGC`.
- `GET /api/v1/maps/:id/snapshots`: list snapshots for map; return `SnapshotDescriptor[]`.
- `GET /api/v1/maps/:id/snapshots/:snapshotId`: return snapshot blob for restore.
- Phase: 7.
- Complexity: medium.
- [CONFIDENCE: high — Phase 7 plan Feature 4 / Tasks 9/18]

**`routes/submit.ts`** (Phase 7 mobile field)
- `POST /api/v1/submit/:layerToken`: mobile field collection endpoint. Accepts GeoJSON Feature; validates against layer schema; appends to target layer's Yjs doc via internal call or direct DB write.
- Auth: `layerToken` is a scoped submit-only token (not the same as share tokens).
- Phase: 7.
- Complexity: medium.
- [CONFIDENCE: med — Phase 7 plan Feature 2 summary; endpoint path from spec]

**`services/blob-service.ts`**
- Abstraction over MinIO (full stack) and filesystem (minimal stack).
- Methods: `put(key, buffer): Promise<void>`, `get(key): Promise<Buffer>`, `delete(key): Promise<void>`.
- Mode selection via `STORAGE_MODE` env var.
- Phase: 4.
- Complexity: low (thin adapter).
- [CONFIDENCE: med — Q10 resolution, Phase 4 tech stack table]

**`logger.ts`** (GAP-6)
- Pino structured JSON logger. All routes use this logger — no `console.log`.
- Log fields: `requestId`, `method`, `url`, `statusCode`, `responseTime`, `error` (on errors).
- Phase: 4 (GAP-6 baseline).
- [CONFIDENCE: high — cross-phase-audit GAP-6]

**`db/schema/snapshots.sql`** (Phase 7)
- Table: `snapshots(id, map_id, name NULLABLE, blob_ref, created_at, is_named BOOL)`.
- `is_named = false` → eligible for auto-GC. `is_named = true` → never deleted by auto-GC.
- Phase: 7.
- [CONFIDENCE: high — Phase 7 plan Feature 4]
