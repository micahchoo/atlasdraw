// Applies the migrations in ./migrations.ts to a database. Each adapter calls
// its runner at startup. A database records every migration it has applied
// in `schema_migrations`, so a second run applies nothing.

import { MIGRATIONS } from "./migrations";

import type Database from "better-sqlite3";
import type { Pool } from "pg";
import type { Migration } from "./migrations";

const CREATE_RECORD_TABLE_SQLITE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`;

const CREATE_RECORD_TABLE_POSTGRES = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL
  )`;

// Any constant works; it only has to be the same for every storage server
// that shares a database.
const POSTGRES_LOCK_KEY = 7_240_113;

/**
 * Apply every pending migration to a SQLite database, each in its own
 * transaction. Throws on the first failure; the migrations before it stay
 * applied.
 */
export function migrateSqlite(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): void {
  db.exec(CREATE_RECORD_TABLE_SQLITE);
  const applied = new Set(
    (
      db.prepare("SELECT name FROM schema_migrations").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }
    db.transaction(() => {
      migration.sqlite(db);
      record.run(migration.name, new Date().toISOString());
    })();
  }
}

/**
 * Apply every pending migration to a Postgres database in one transaction.
 * An advisory lock makes a second server that starts at the same time wait,
 * then find nothing to do.
 */
export async function migratePostgres(
  pool: Pool,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [POSTGRES_LOCK_KEY]);
    await client.query(CREATE_RECORD_TABLE_POSTGRES);
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.name));
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }
      await client.query(migration.postgres);
      await client.query(
        "INSERT INTO schema_migrations (name, applied_at) VALUES ($1, now())",
        [migration.name],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    // Report the error that stopped the migration, not a failed ROLLBACK. A
    // connection that broke rolls back on the server by itself.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
