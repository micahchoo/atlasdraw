# Storage Server DB Migration Framework

**Date:** 2026-05-25 **Status:** Planning — not scheduled **Phase:** Infrastructure (blocks Phase 7 versioning) **Estimated effort:** ~4 hours

---

## §1 Goal

Replace schema-on-start (`CREATE TABLE IF NOT EXISTS`) with a version-tracked migration framework so schema evolution (Phase 7 versioning, PostGIS, QGIS bridge) doesn't rely on `try/catch` ALTER TABLE hacks.

---

## §2 Current State

Both adapters (`sqlite-fs.ts`, `postgres-minio.ts`) use raw SQL in constructor:

- `CREATE TABLE IF NOT EXISTS maps (...)`
- `CREATE TABLE IF NOT EXISTS share_tokens (...)`
- `CREATE TABLE IF NOT EXISTS workspaces (...)`
- One inline `ALTER TABLE ADD COLUMN workspace_id` gated by `try/catch` for "duplicate column name"

Zero migration tooling. Zero version tracking. Zero rollback support.

---

## §3 Architecture Context

| File | Role |
| --- | --- |
| `apps/storage/src/adapters/sqlite-fs.ts` | SQLite adapter — `better-sqlite3`, schema at lines 60-105 |
| `apps/storage/src/adapters/postgres-minio.ts` | Postgres adapter — `pg`, schema at lines 122-150 |
| `apps/storage/src/types.ts` | `StorageClient` interface — migration runner not in contract |

Both adapters implement `StorageClient`. A migration runner must fire before the server listens but after the adapter connects.

---

## §4 Approach

**Candidate: Kysely** (already cited in evolution.md §9). Lightweight, TypeScript-native, supports SQLite + Postgres via dialects.

**Alternative: plain SQL files** with a hand-rolled runner (~50 lines). Simpler but less type-safe.

**Recommendation:** Kysely. The project already has `better-sqlite3` and `pg` as direct dependencies; Kysely adds ~15KB gzipped and provides type-safe migration ordering.

---

## §5 Tasks

### T1 — Add Kysely + dialect dependencies

```bash
yarn workspace @atlasdraw/storage add kysely
```

SQLite dialect is built-in. Postgres dialect: `pg` is already a dependency.

### T2 — Create migration directory and runner

**New file:** `apps/storage/src/db/migrate.ts`

- `migrate(db: Kysely<DB>, dialect: "sqlite" | "postgres"): Promise<void>`
- Reads migration files from `apps/storage/src/db/migrations/`
- Tracks applied migrations in a `_migrations` table (created on first run)
- Runs unapplied migrations in order, inside a transaction

### T3 — Convert existing schema to migration files

**New files:**

- `apps/storage/src/db/migrations/001_create_maps.ts`
- `apps/storage/src/db/migrations/002_create_share_tokens.ts`
- `apps/storage/src/db/migrations/003_create_workspaces.ts`
- `apps/storage/src/db/migrations/004_add_workspace_id.ts`

Each migration exports `up(db)` and `down(db)` functions.

### T4 — Wire migration runner into server startup

**Modify:** `apps/storage/src/server.ts` (or equivalent entry point)

- Call `migrate()` after DB connection, before route registration
- On first run against existing DBs: detect existing tables, mark migrations 1-4 as applied

### T5 — Handle existing databases (no `_migrations` table)

**Logic:** If `_migrations` table doesn't exist AND `maps` table exists → bootstrap mode. Create `_migrations`, insert records for migrations 1-4, then continue. This prevents the "migration framework breaks existing installs" failure mode.

### T6 — Remove inline schema from adapters

**Modify:** `sqlite-fs.ts`, `postgres-minio.ts`

- Delete `CREATE TABLE IF NOT EXISTS` blocks from constructors
- Delete `ALTER TABLE ... ADD COLUMN workspace_id` + try/catch
- Adapters assume schema already exists (migration runner guarantees it)

### T7 — Tests

**New file:** `apps/storage/src/db/__tests__/migrate.test.ts`

- Test: fresh DB gets all 4 migrations applied
- Test: existing DB (tables present, no `_migrations`) bootstraps correctly
- Test: no-op when all migrations already applied
- Test: migration failure rolls back transaction

---

## §6 Execution Waves

**Wave 1:** T1 (Kysely dependency) **Wave 2:** T2 + T3 (runner + migration files) — parallel **Wave 3:** T4 + T5 (server wiring + existing DB handling) — after Wave 2 **Wave 4:** T6 (remove inline schema) — after Wave 3 **Wave 5:** T7 (tests) — after Wave 4

---

## §7 Risk Mitigation

- **Existing installs:** Bootstrap mode (T5) ensures existing `maps.db` files aren't broken.
- **Adapter contract:** Migration runner runs before `StorageClient` adapter is constructed; adapters never touch schema.
- **Rollback safety:** Migration runner wraps each migration in a transaction. Failure → rollback, server doesn't start.

---

## §8 Open Questions

1. **OQ-1:** Should the migration runner live behind the `StorageClient` interface, or be a separate concern called before adapter construction? → Separate concern. The `StorageClient` interface is about document CRUD, not schema management. Migration happens once at startup.

2. **OQ-2:** Does the Postgres adapter use a connection pool that complicates transactional migrations? → Yes — `pg.Pool` needs special handling. Kysely's `Migrator` supports this via its Postgres dialect.
