# storage — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.9; Phase 4/6/7 plans; cross-phase-audit GAP-6; open-questions Q10.

---

## 1. State Machines

### 1.1 Map Lifecycle

```
[NONEXISTENT]
  │
  ▼ POST /maps (authenticated)
[CREATED]
  │  ─ blob stored in MinIO/filesystem
  │  ─ MapRecord row inserted in DB
  │
  ├── PUT /maps/:id (authenticated, owner)
  │     ▼
  │   [UPDATED] ──► back to [CREATED] state with new blob + updatedAt
  │
  ├── POST /maps/:id/share (authenticated, owner)
  │     ▼
  │   ShareToken minted → ShareToken table row inserted
  │   Map state unchanged — sharing is additive metadata
  │
  └── (no explicit delete in Phase 4 MVP — MapRecord persists indefinitely)
```

[CONFIDENCE: high — Phase 4 plan]

---

### 1.2 Share Token Lifecycle

```
[NONEXISTENT]
  │
  ▼ POST /maps/:id/share
[ACTIVE]
  │  ─ token = nanoid(21), TTL = 30 days (inferred), mode = 'read'
  │
  ├── GET /share/:token (before expiry)
  │     ▼
  │   [RESOLVED] → return { map: MapRecord, mode: 'read' }
  │   (token remains ACTIVE — reusable until expiry)
  │
  └── Token TTL expires
        ▼
      [EXPIRED]
        │
        └── GET /share/:token → 410 Gone
            (row remains in DB; not deleted — GC is a future concern, see endorheic basin)
```

**Security invariants:**
- `mode` field set server-side only; never from request.
- 410 Gone distinguishes expired from 404 never-issued.
- No revocation in Phase 4 (documented gap ADR `0008-share-link-encoding.md`).

[CONFIDENCE: high — Phase 4 plan Task 4]

---

### 1.3 Snapshot Lifecycle (Phase 7)

```
[NO SNAPSHOTS]
  │
  ▼ POST /api/v1/maps/:id/snapshots
[SNAPSHOT CREATED]
  │  ─ blob stored; DB row inserted (is_named = true if name provided, false if auto)
  │
  ▼ SnapshotGC.prune(mapId) runs post-save
[AFTER GC]
  │  ─ unnamed auto-snapshots outside retention window deleted
  │  ─ named snapshots never touched by GC
  │
  ├── GET /api/v1/maps/:id/snapshots/:snapshotId
  │     ▼ return blob bytes (for restore)
  │
  └── (user explicit delete — not in Phase 7 MVP; named snapshots accumulate)
```

GC invariant: `SnapshotGC.prune` only deletes rows where `is_named = false` AND `created_at < pruneThreshold`. Named snapshots (`is_named = true`) require explicit user action to delete (not implemented until post-Phase 7).

[CONFIDENCE: high — Phase 7 plan Tasks 9/18]

---

## 2. Endorheic Basins

| Basin | Description | Flush mechanism |
|---|---|---|
| **Share token table** | Expired tokens remain as rows in `share_tokens` table; they return 410 but are never deleted. Table grows without bound over time. | No automatic flush in Phase 4 MVP. Future work: periodic cleanup job (post-Phase 7). |
| **Named snapshots** | Named snapshots are never deleted by auto-GC. A map with many named snapshots accumulates indefinitely. | Only explicit user delete (not implemented in Phase 7). Post-Phase 7 concern. |
| **Orphaned blobs** | If a `MapRecord` or `SnapshotRecord` DB row is deleted (future delete endpoint) without cleaning the blob in MinIO/filesystem, blob storage accumulates orphaned objects. | No reconciler in Phase 4–7. Manual cleanup or future GC job. |
| **Anonymous MapRecords** | Maps created without authenticated users (anonymous usage) accumulate with no owner and no expiry. | No TTL in Phase 4 MVP. Future concern. |

[CONFIDENCE: med — share token basin is high-confidence (Phase 4 plan); others extrapolated from known storage behaviors]

---

## 3. Failure Modes

### 3.1 Postgres Unavailable

```
Fastify starts → @fastify/postgres connect attempt fails
  │
  ├── On startup: Fastify fails to register plugin → process exits
  │     Result: container restart (Docker restart:always)
  │
  └── Mid-operation: query throws connection error
        ├── Route handler catches → 503 Service Unavailable response
        ├── pino logs: { level: "error", error: { message: "DB connection lost" } }
        └── GET /health returns { status: "degraded", db: "error" }
```

[CONFIDENCE: med — standard Fastify/pg failure handling; exact behavior extrapolated]

### 3.2 MinIO / S3 Unavailable

```
Blob operation (put/get) throws network error
  │
  ├── POST /maps fails at blob.put() → 503 response; DB row NOT inserted (transaction)
  │
  ├── GET /maps/:id blob URL generation fails → return MapRecord with blobUrl: null
  │     (client must handle missing blob)
  │
  └── GET /health returns { status: "degraded", blob: "error" }
```

In minimal mode (filesystem), filesystem errors substitute for MinIO errors.

[CONFIDENCE: med — extrapolated from service layer pattern]

### 3.3 Filesystem Mode: Disk Full

In minimal mode (`docker-compose.minimal.yml`), blob writes go to local filesystem in a Docker volume.

```
blob-service.ts: fs.writeFile() throws ENOSPC
  │
  ├── POST /maps → 507 Insufficient Storage
  └── pino: { level: "error", error: { message: "ENOSPC" } }
```

No automatic eviction of old blobs. Operator must manually clear storage or increase volume.

[CONFIDENCE: low — edge case behavior; exact status code extrapolated]

### 3.4 Share Token Collision

`nanoid(21)` provides 126 bits of entropy. Collision probability is negligible in practice. No explicit collision-detection in Phase 4 MVP — the DB `UNIQUE` constraint on the token column will raise a DB error on insert, which the service maps to a 500 (should retry with new token; this is a known gap).

[CONFIDENCE: med — Phase 4 plan adversarial sub-checks mention entropy; retry behavior extrapolated]

### 3.5 Yjs Persistence Write Failure (Phase 6+)

```
apps/realtime TTL eviction triggers setPersistence.writeState()
  │
  └── PUT /maps/:id fails (storage unavailable)
        ├── y-websocket server logs warning; evicts Y.Doc anyway
        ├── In-memory state is lost
        └── On next connect: bindState fetches stale blob from last successful write
              Result: partial data loss (ops since last successful writeState are lost)
```

This is the worst-case failure mode for Yjs persistence. Mitigation: ensure storage is highly available; add retry with backoff on `writeState` (post-Phase 6 improvement).

[CONFIDENCE: med — consequence of Phase 6 persistence design; exact retry behavior extrapolated]

---

## 4. Observability (GAP-6)

Per cross-phase-audit GAP-6, the following observability baseline is mandatory before Phase 4 ships:

1. **`GET /health`** — machine-readable health check (DB + blob reachability). Required for Docker Compose health checks and uptime monitoring.
2. **Pino structured JSON logging** — all routes log `requestId`, `method`, `url`, `statusCode`, `responseTime`. Errors include full `error.stack`.
3. **`GET /metrics`** — optional Prometheus endpoint; provides request rate, latency percentiles, active connections.
4. **Caddy access log forwarding** — Caddy logs forwarded to stdout; collected by Docker log driver.

Without the health endpoint, the Phase 4 demo has no programmatic signal for service readiness. Without pino, production debugging requires grep on freeform strings.

[CONFIDENCE: high — cross-phase-audit GAP-6 recommendation verbatim]

---

## 5. Storage Mode Behavior Differences

| Behavior | Full mode (Postgres + MinIO) | Minimal mode (SQLite + filesystem) |
|---|---|---|
| DB concurrency | Multi-connection Postgres pool | Single-writer SQLite (serialized writes) |
| Blob location | MinIO container (Docker volume or S3 bucket) | Local filesystem path in Docker volume |
| Horizontal scaling | Possible (shared Postgres + MinIO) | Not possible (local filesystem) |
| Data portability | Export from MinIO + pg_dump | Copy Docker volume directory |
| Health check `/health` | Pings Postgres + MinIO | Checks SQLite file open + filesystem write |

[CONFIDENCE: high — Q10 resolution, Phase 4 tech stack table]
