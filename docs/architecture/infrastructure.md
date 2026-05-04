# Atlasdraw — Infrastructure

**Status: Speculative.** Derived from spec §7/§10, phase plans (plan-4, plan-5, plan-6),
and open questions resolutions (Q1, Q10). No code exists.

---

## Two Deployment Shapes

Atlasdraw is designed for two distinct deployment shapes that ship the same codebase (Q4,
no open-core split):

### Shape A: Self-hosted

An operator runs Atlasdraw on their own infrastructure via Docker Compose. Two variants (Q10):

**Full stack (`docker-compose.yml`)** — 5 services, production-recommended:
- `web` (atlas-app static build, nginx or Caddy-served)
- `storage` (apps/storage Fastify server)
- `postgres` (postgres:16)
- `minio` (object storage for blob payloads)
- `caddy` (TLS termination + WebSocket proxy)

Phase 5 adds `realtime` (Socket.IO + y-websocket) as a 6th service via Docker Compose profiles
(`profiles: ["realtime"]`). The full-stack compose file documents this but Phase 4 ships without
it. (plan-4 Task 11, MISMATCH-4 in cross-phase audit)

**Minimal stack (`docker-compose.minimal.yml`)** — 3 services, "try it" path:
- `web` (atlas-app)
- `storage` (with `STORAGE_MODE=sqlite-filesystem` — no postgres, no minio)
- `caddy`

README first-run instructions point to `minimal.yml`. "Production self-host" docs point to the
full file. (Q10)

### Shape B: Hosted flagship

A multi-tenant cloud deployment (atlasdraw.app or studio.atlasdraw.org) operated by the
maintainer team. Added in Phase 6. Guarded by `MANAGED_MODE=true`.

Features added in hosted mode:
- Workspace abstraction (workspaces → users → maps hierarchy)
- Stripe billing (checkout, webhooks, plan enforcement)
- Per-workspace quotas (map count, blob storage)
- Telemetry (opt-out toggleable for self-hosters; wholly absent from embed SDK per ADR 0006)

The hosted flagship does not introduce feature exclusions — all features are available in
self-host. (Q4)

---

## Services

### `web` — Static SPA (atlas-app)

**Runtime:** Static files served by nginx (self-host) or Caddy (behind load balancer in hosted).
**Port:** 3000 (behind Caddy/reverse-proxy, not exposed directly).
**Build:** Vite production build of `apps/atlas-app`. Code-split aggressively — Maputnik, Turf,
shapefile parser are async-loaded to stay within bundle budget (spec §8).
**Config:** Environment variables injected at build time (`VITE_*`). Key vars:
- `VITE_STORAGE_URL` — points to storage service
- `VITE_WS_URL` — optional; omit to disable collab UI (Q1)
- `VITE_MANAGED_MODE` — enables workspace/billing UI

**Single-player mode:** If `VITE_WS_URL` is unset, the collab UI degrades gracefully. The app
functions without any WebSocket connectivity. (Q1)

---

### `realtime` — WebSocket relay (apps/realtime)

**Runtime:** Node.js. Forked from `excalidraw/excalidraw-room` (plan-5 Task 3).
**Port:** 1080 (or operator-configured; behind Caddy WebSocket upgrade).
**Opt-in:** Enabled via `profiles: ["realtime"]` in docker-compose.yml, and `[realtime] enabled
= true` in `config.toml`. (Q1)
**Protocols (Q9 dual-socket design):**
- Socket.IO endpoint — handles scene sync, camera sync, cursor presence events
- `/yjs/:roomId` WebSocket endpoint — handles Yjs binary CRDT sync via `y-protocols`

**Room lifecycle:** Rooms are in-memory. On last client disconnect, a TTL timer starts
(`ROOM_TTL_MS`, default 300,000 ms = 5 min). On expiry: `ydoc.destroy()`, remove from doc map.
No persistence at relay level — the relay is intentionally dumb. (plan-5 Task 6)

**Redis (multi-instance):** A Redis adapter for Socket.IO is documented as a Phase 5 TODO for
horizontal scaling, but is not shipped in the initial Phase 5 release.
[CONFIDENCE: low — plan-5 mentions it as optional, not specified in detail]

---

### `storage` — REST API (apps/storage)

**Runtime:** Node.js — Fastify v4.
**Port:** 4000 (behind Caddy).
**Storage modes** (operator-selectable via `STORAGE_MODE` env var):
- `postgres-minio` — Postgres for map metadata; MinIO/S3-compatible for blob payloads (recommended).
- `sqlite-filesystem` — SQLite via `better-sqlite3` for metadata; local filesystem for blobs
  (minimal stack only, not suitable for production horizontal scaling).

**Key packages:** `@fastify/postgres`, `pg`, `minio` JS client, `better-sqlite3`, `lz-string`,
`nanoid`, `zod`. (plan-4 Tech Stack Additions)

**Postgres tables (predicted post-Phase-6):**

| Table | Purpose |
|-------|---------|
| `workspaces` | Multi-tenant workspace records (Phase 6, hosted mode) |
| `users` | User accounts (Phase 6) |
| `workspace_members` | Membership join table |
| `maps` | Map metadata (title, owner, updated_at, blob_key) |
| `share_tokens` | Share link tokens with expiry and permission level |
| `comments` | Inline map comments (Phase 6) |

[CONFIDENCE: medium — table names inferred from Phase 6 plan task descriptions; exact schema
is engineering judgment until Phase 4/6 ship]

**Blob storage layout:**
- `{workspaceId}/{mapId}/{version}.atlasdraw` — full `.atlasdraw` ZIP payload
- `{workspaceId}/{mapId}/thumbnails/{hash}.png` — cached render thumbnails
- `{workspaceId}/{mapId}/photos/{hash}.{ext}` — field-collected photos (Phase 7)

[CONFIDENCE: low — exact bucket layout is not specified in plans; predicted from task descriptions]

**Blob storage backend:** MinIO (self-host) or any S3-compatible endpoint (hosted flagship uses
AWS S3 or CloudFlare R2). (plan-4 Task 11)

---

### `postgres` — Metadata store

**Image:** `postgres:16`
**Persistent volume:** `pgdata`
**Credentials:** Loaded from env file (`.env.local` for development, secrets manager in hosted).
**Phase 4:** Schema created at first storage service startup. No migration framework specified
yet. [CONFIDENCE: low — plan-4 does not specify a migration tool; engineering judgment required]

---

### `minio` — Object storage (self-host)

**Image:** `minio/minio`
**Persistent volume:** `miniodata`
**Console:** Port 9001 (not exposed outside Caddy by default in production).
**Hosted flagship:** Uses AWS S3 or CloudFlare R2 instead. MinIO is the self-host equivalent.

---

### `caddy` — TLS termination and reverse proxy

**Image:** `caddy:2-alpine`
**Config:** `infra/caddy/Caddyfile` (plan-4 Task 11)
**Responsibilities:**
- TLS (automatic ACME / Let's Encrypt in hosted, self-signed in dev)
- Reverse proxy to `web:3000`, `storage:4000`, `realtime:1080`
- WebSocket upgrade for `/yjs/*` and Socket.IO paths
- Static file caching headers for PMTiles and app assets

---

## .atlasdraw File Format

The canonical persistence unit is a ZIP container with `.atlasdraw` extension (Phase 3).
[CONFIDENCE: high — Phase 3 is the file format phase]

Predicted contents:
```
manifest.json        # schema version, layer list, thumbnail hash, metadata
scene.json           # Excalidraw scene (elements + appState)
style.json           # MapLibre style object (basemap style)
layers/
  {layerId}.geojson  # one file per data layer
  {layerId}.pmtiles  # optional bundled tiles per layer
assets/
  {hash}.{ext}       # element blobs (images, photos)
```

Round-trip fuzz test required at Phase 3 gate. File System Access API for save/load; IndexedDB
fallback. (PHASES.md Phase 3 gate)

---

## CI/CD

**Platform:** GitHub Actions.

**Workflows (predicted post-Phase-7):**

| Workflow | Trigger | Gate |
|----------|---------|------|
| `typecheck.yml` | Push, PR | `tsc --noEmit` across all packages |
| `unit-test.yml` | Push, PR | `vitest run` across all packages |
| `e2e.yml` | Push to main, PR | Playwright cross-browser matrix (Phase 1 establishes baseline) |
| `bundle-size.yml` | PR | `size-limit` check — SDK hard limit 300 KB (Phase 6) |
| `upstream-sync-check.yml` | Weekly | Verifies upstream-patches.md is current (Phase 0, ADR 0004) |
| `license-check.yml` | Push | Each package.json must declare `"license"` field; CI fails if missing (Phase 0) |
| `postmessage-roundtrip.yml` | PR | Structural test for SDK postMessage contract (Phase 6) |
| `sdk-telemetry-guard.yml` | PR | Grep check — no network calls in `packages/sdk/src/` (Phase 6) |
| `hosted-e2e.yml` | PR to main | Playwright against `docker-compose.cloud.yml` (Phase 6) |

(plan-0, plan-1, plan-4, plan-6 Wave 4 gates)

---

## Observability

**Status:** Partially planned. GAP-6 in cross-phase audit notes no Sentry or OpenTelemetry for
error tracking on the hosted instance.

**Planned (from Phase 6 ADR 0006 and GAP-6 mitigations):**
- `pino` structured JSON logging on all Node.js services (`realtime`, `storage`)
- `/health` HTTP endpoint on `storage` (Docker healthcheck dependency)
- Anonymous heartbeat telemetry for hosted flagship — defined in ADR 0006; opt-out toggleable
  for self-hosters; wholly omitted from embed SDK

**Not yet planned (GAP-6, GAP-9):**
- Distributed tracing (OpenTelemetry / Jaeger)
- Sentry error reporting for the hosted instance
- Actual `telemetry.atlasdraw.org` endpoint standup (ADR 0006 references it but no phase plan
  has a task to deploy it)

[CONFIDENCE: low on observability stack — only pino + /health are specified with reasonable
certainty from plan descriptions]

---

## Performance Budgets

Defined in spec §8, enforced via CI from Phase 1 onward.

| Budget | Value | Enforced from |
|--------|-------|--------------|
| Initial JS parse + render | < 3 s on mid-tier mobile | Phase 1 benchmark gate |
| 60fps with 50k features | Maintain at full zoom | Phase 1 benchmark gate |
| Phase 1 → Phase 2 regression | ≤ +20% on benchmark metrics | Phase 2 gate |
| SDK bundle size | Hard limit: 300 KB | Phase 6 `size-limit` CI |
| Yjs catch-up freeze | < 1 s during 5 MB Yjs sync | Phase 5 E2E gate |

Benchmark results are persisted as `bench/results/phase-N-baseline.json` and compared by CI.
(plan-1, PHASES.md)
