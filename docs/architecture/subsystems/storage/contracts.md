# storage — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

> Sources: tech-spec §4.9; Phase 4/5/6/7 plans; cross-phase-audit GAP-6; open-questions Q10.

---

## 1. HTTP Endpoint Catalog

### Maps

| Method | Path | Auth | Request | Response | Phase |
|---|---|---|---|---|---|
| `POST` | `/maps` | Bearer token | `multipart/form-data` body: `blob` (`.atlasdraw` binary) | `201 { id: string }` | 4 |
| `GET` | `/maps/:id` | Bearer token | — | `200 { id, ownerId, createdAt, updatedAt, blobUrl: string }` | 4 |
| `PUT` | `/maps/:id` | Bearer token | `multipart/form-data` body: `blob` | `200 { updatedAt }` | 4 |

### Share

| Method | Path | Auth | Request | Response | Phase |
|---|---|---|---|---|---|
| `POST` | `/maps/:id/share` | Bearer token | `{}` or `{ mode: 'read' }` (default read) | `201 { token: string; url: string }` | 4 |
| `GET` | `/share/:token` | None | — | `200 { map: MapRecord; mode: 'read' }` or `404` (never existed) or `410` (expired) | 4 |
| `GET` | `/m/:uuid` | None | — | Same as `/share/:token` — short URL alias | 4 |

**Security invariants:**
- `mode` in `GET /share/:token` response is always set server-side from `ShareToken.mode` — never from request input.
- Expired tokens: `410 Gone` (not `404`) to distinguish expired from never-issued.
- Token entropy: `nanoid(21)` = 126 bits.
- No revocation in Phase 4 MVP (documented gap in ADR `0008-share-link-encoding.md`).

[CONFIDENCE: high — Phase 4 plan Tasks 4/9]

### Health & Observability (GAP-6)

| Method | Path | Auth | Request | Response | Phase |
|---|---|---|---|---|---|
| `GET` | `/health` | None | — | `200 { status: "ok"\|"degraded", uptime: number, db: "ok"\|"error", blob: "ok"\|"error" }` | 4 |
| `GET` | `/metrics` | Optional bearer | — | Prometheus text format (optional endpoint) | 4+ |

**GAP-6 requirement**: `/health` must exist before Phase 4 demo ("Show HN moment at Phase 4 Week 11"). Structured pino JSON logging is mandatory on all routes.

[CONFIDENCE: high — cross-phase-audit GAP-6]

### Snapshots (Phase 7)

| Method | Path | Auth | Request | Response | Phase |
|---|---|---|---|---|---|
| `POST` | `/api/v1/maps/:id/snapshots` | Bearer token | `{ name?: string; blob: binary }` | `201 { snapshotId: string; createdAt: string }` | 7 |
| `GET` | `/api/v1/maps/:id/snapshots` | Bearer token | — | `200 { snapshots: SnapshotDescriptor[] }` | 7 |
| `GET` | `/api/v1/maps/:id/snapshots/:snapshotId` | Bearer token | — | `200 blob bytes` | 7 |

```typescript
interface SnapshotDescriptor {
  snapshotId: string
  name: string | null   // null = auto-generated
  createdAt: string     // ISO 8601
  isNamed: boolean      // false = GC-eligible
  blobRef: string       // internal blob storage key
}
```

[CONFIDENCE: high — Phase 7 plan Tasks 9/18/29]

### Mobile Field Collection (Phase 7)

| Method | Path | Auth | Request | Response | Phase |
|---|---|---|---|---|---|
| `POST` | `/api/v1/submit/:layerToken` | Layer token (scoped) | GeoJSON Feature body | `201 { featureId: string }` | 7 |

[CONFIDENCE: med — Phase 7 plan Feature 2 summary; request/response shape extrapolated]

---

## 2. Data Shapes

### MapRecord

```typescript
interface MapRecord {
  id: string           // UUID
  ownerId: string      // user ID or anonymous token
  createdAt: string    // ISO 8601
  updatedAt: string    // ISO 8601
  blobRef: string      // internal blob storage key (not exposed to clients)
  blobUrl?: string     // pre-signed URL for blob download (client-facing)
}
```

### ShareToken (internal)

```typescript
interface ShareToken {
  token: string        // nanoid(21) — 126-bit entropy
  mapId: string
  mode: 'read'         // 'write' not implemented in Phase 4 MVP
  expiresAt: string    // ISO 8601; server checks on resolution
  createdAt: string
}
```

---

## 3. Auth Contract

| Mechanism | Scope | TTL | Phase |
|---|---|---|---|
| Bearer token | Map CRUD, snapshot endpoints | 30 days (hardcoded) | 4 |
| Share token | Read-only map access via `/share/:token` | Per-token TTL (30 days default, inferred) | 4 |
| Layer token | Mobile field collection submit | Per-layer, indefinite until revoked (inferred) | 7 |
| OIDC | Hosted SaaS user accounts | Session-based | 6 (hosted only) |

[CONFIDENCE: high for bearer/share token — Phase 4 plan; layer token and OIDC med — extrapolated]

---

## 4. Yjs Persistence Contract (Phase 6)

`apps/realtime` calls `setPersistence({ bindState, writeState })` wired to this server:

```typescript
// bindState: called when a room's Y.Doc is first loaded (after TTL eviction + reconnect)
GET /api/maps/:id  →  returns blob  →  realtime loads Y.Doc from blob bytes

// writeState: called on TTL eviction (room going idle)
PUT /api/maps/:id  →  accepts updated blob  →  storage persists
```

This contract is established in Phase 5 (stub `comment` in `yjs-server.ts`) and wired in Phase 6. The storage server does not need to understand Yjs encoding — it treats the Yjs doc as an opaque binary blob.

[CONFIDENCE: high — cross-phase-audit 1.6, Phase 5 produces table]

---

## 5. Structured Logging Contract (GAP-6)

All log lines emitted as pino JSON. Mandatory fields:

```json
{
  "level": "info|warn|error",
  "time": 1234567890,
  "requestId": "abc123",
  "method": "GET",
  "url": "/health",
  "statusCode": 200,
  "responseTime": 12.5
}
```

Error logs additionally include `"error": { "message": "...", "stack": "..." }`.

No `console.log` anywhere in `apps/storage` — all output through pino logger.

[CONFIDENCE: high — cross-phase-audit GAP-6]
