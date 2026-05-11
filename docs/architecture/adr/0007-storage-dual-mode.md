<!-- ADR-0007-MARKER: storage-dual-mode -->

# ADR-0007: Storage Dual-Mode — sqlite-fs and postgres-minio Behind One Interface

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** 4 (MVP self-host)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** ADR-0008 (share-link encoding), ADR-0009 (error capture)

## Context

Phase 4 introduces map persistence to Atlasdraw. The self-host audience splits into two operator profiles:

1. **Minimal-friction self-hoster.** Single VPS, single Docker container, single volume. Goal: `docker run -v /data:/data atlasdraw` and have it work. No external database, no object store, no Kubernetes.
2. **Production self-hoster.** Already runs Postgres and MinIO/S3. Wants Atlasdraw to use them. Goal: horizontal scalability, backup workflows that match the rest of their stack.

A single storage adapter — embedded SQLite-plus-filesystem, or external Postgres-plus-S3 — would force one of these audiences to compromise. Forcing minimal to deploy Postgres adds three pieces of infrastructure for a single-user tool. Forcing production to use SQLite caps them at a single writer and complicates backup.

The atlas-app frontend MUST NOT need to know which adapter is loaded; the HTTP API surface is identical. The HTTP server selects an adapter once, at startup, from environment variables.

## Decision

The `@atlasdraw/storage` workspace defines a single TypeScript interface, `StorageClient` (5 methods: `createMap`, `getMap`, `updateMap`, `createShareToken`, `resolveToken`), and ships two implementations:

- **`sqlite-fs` adapter** (`adapters/sqlite-fs.ts`). Uses `better-sqlite3@^11` for metadata and writes blobs as files under `$DATA_DIR/blobs/{id}.atlasdraw`. The SQLite DB file lives at `$DATA_DIR/atlas.db`. All I/O is local-volume.
- **`postgres-minio` adapter** (`adapters/postgres-minio.ts`). Uses `pg@^8` for metadata and `@aws-sdk/client-s3@^3` (with `forcePathStyle: true`) for blobs. Targets a MinIO bucket `atlasdraw-maps` or any S3-compatible store.

Adapter selection is a startup-only discriminator: the `STORAGE_MODE` env (validated by Zod in `config.ts`) is one of `"sqlite-fs"` or `"postgres-minio"`. The server fails fast at boot if the required envs for the chosen mode are missing or malformed.

Both adapters implement all 5 methods of `StorageClient`. Share-token methods (`createShareToken`, `resolveToken`) are part of the interface even though T3's own routes don't use them; T4 share routes layer on top without an interface change.

## Consequences

**Positive:**

- One HTTP API surface (`POST/GET/PUT /maps`, `POST /maps/:id/share`, `GET /share/:token`) for both deployment topologies. The atlas-app client never branches on mode.
- Each adapter can be developed and tested independently. Adapter unit tests run against real I/O (sqlite-fs) or against mocked `pg`/`s3` (postgres-minio); integration tests against real Postgres/MinIO happen at the compose-stack level (T16 E2E smoke).
- The minimal stack — sqlite-fs — has zero external service dependencies. `docker run` works.
- The production stack — postgres-minio — uses well-supported, widely-deployed components with established backup tooling.

**Negative / accepted costs:**

- Two adapters to maintain. Schema changes touch both. A schema migration framework is deferred (single-table-pair schema in MVP makes ad-hoc DDL acceptable).
- A self-host operator who starts on `sqlite-fs` and outgrows it has no automatic migration path to `postgres-minio`. **No in-place migration is included in MVP.** Operators must export-and-reimport (and the export tool itself is deferred to Phase 6).
- The `postgres-minio` adapter's unit tests use mocks, not testcontainers — so the integration-level guarantee is "shape and SQL are correct"; real-DB behavior is verified at the compose-stack smoke level. This is a deliberate tradeoff for test speed.

**Follow-ups:**

- Phase 6 will introduce export/import tooling that doubles as a sqlite-fs → postgres-minio migration path.
- If a third storage mode is needed (e.g., a fully-managed cloud target like Cloudflare R2 + D1), it slots into the same `StorageClient` interface; no API or atlas-app changes.

## Alternatives Considered

1. **Single Postgres-only adapter** (rejected) — forces the minimal-friction audience to deploy Postgres, gating the casual self-host story behind ~5 minutes of additional setup. The premise of MVP is "one container, one volume, it works."

2. **Single SQLite-only adapter** (rejected) — caps deployments at single-writer, complicates concurrent-write semantics, and offers no upgrade path for operators already running Postgres infra. Forces a future migration for any operator who scales.

3. **Runtime-polymorphic single adapter** (rejected) — e.g., "use SQLite if `$DATABASE_URL` is unset." Adds a configuration trap: typos in `$DATABASE_URL` silently fall back to SQLite, which is a surprising failure mode for production operators. Startup-time discriminator is louder and verification-friendlier.

4. **A third "memory-only" adapter for dev** (rejected for MVP) — would simplify dev startup, but `sqlite-fs` against `tmp` is already <500ms to boot. Not worth the maintenance burden.

5. **gRPC instead of HTTP between atlas-app and storage** (rejected) — gRPC over the browser requires gRPC-Web + a sidecar proxy. HTTP+JSON is already understood by every browser and CDN. The marginal type-safety benefit doesn't pay for the deployment complexity.

## Verification

- `code/apps/storage/src/types.ts:44-50` declares the `StorageClient` interface; both `adapters/sqlite-fs.ts` and `adapters/postgres-minio.ts` implement all 5 methods.
- `STORAGE_MODE=sqlite-fs DATA_DIR=/tmp/x node code/apps/storage/dist/index.js` starts the server and serves the full API without any Postgres or MinIO running.
- `code/apps/storage/src/config.ts` Zod-validates the per-mode env shape: the server fails at boot with a named error if `DATABASE_URL` is missing in `postgres-minio` mode or `DATA_DIR` is missing in `sqlite-fs` mode.
- Adapter unit-test suites: `sqlite-fs.test.ts` (9 tests, real I/O), `postgres-minio.test.ts` (8 tests, mocked I/O).
