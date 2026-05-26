// @atlasdraw/storage — DB migration runner.
//
// Lightweight, no-framework migration system. Reads numbered SQL files from a
// directory, tracks applied migrations in a `_migrations` table, and runs
// unapplied migrations inside transactions. Works with both better-sqlite3
// and pg (node-postgres).
//
// File naming: `NNN_description.sql` where NNN is a zero-padded sequence
// number. Migrations are applied in numeric order. Once applied, a migration
// is never re-run (its sequence number is recorded in `_migrations`).
//
// Bootstrap: if the `_migrations` table doesn't exist but other tables do,
// existing migrations are marked as applied so the framework can be
// introduced on an existing database without re-running old DDL.

import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";
import type { Pool, PoolClient } from "pg";

const MIGRATIONS_TABLE = "_migrations";

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

export function migrateSqliteSync(db: Database, migrationsDir: string): void {
  const existingTables = listTablesSqlite(db);
  const hasMigrationsTable = existingTables.has(MIGRATIONS_TABLE);

  if (!hasMigrationsTable) {
    db.exec(
      `CREATE TABLE ${MIGRATIONS_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
    );
    if (existingTables.size > 0) {
      // Bootstrap: mark all existing migrations as applied so we don't
      // re-run DDL on an existing database.
      const files = readMigrationFiles(migrationsDir);
      const insert = db.prepare(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`,
      );
      const now = new Date().toISOString();
      const applyAll = db.transaction(() => {
        for (const f of files) {
          insert.run(f, now);
        }
      });
      applyAll();
      return;
    }
  }

  const applied = new Set(
    db
      .prepare(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`)
      .all()
      .map((r: unknown) => (r as { name: string }).name),
  );

  const files = readMigrationFiles(migrationsDir);
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    return;
  }

  const insert = db.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`,
  );

  const runAll = db.transaction(() => {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      db.exec(sql);
      insert.run(file, new Date().toISOString());
    }
  });

  runAll();
}

function listTablesSqlite(db: Database): Set<string> {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export async function migratePostgres(
  pool: Pool,
  migrationsDir: string,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    const existingTables = await listTablesPostgres(client);
    const hasMigrationsTable = existingTables.has(MIGRATIONS_TABLE);

    if (!hasMigrationsTable) {
      await client.query(
        `CREATE TABLE ${MIGRATIONS_TABLE} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)`,
      );
      if (existingTables.size > 0) {
        const files = readMigrationFiles(migrationsDir);
        const now = new Date().toISOString();
        await client.query("BEGIN");
        try {
          for (const f of files) {
            await client.query(
              `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ($1, $2)`,
              [f, now],
            );
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
        return;
      }
    }

    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
    );
    const applied = new Set(rows.map((r) => r.name));

    const files = readMigrationFiles(migrationsDir);
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      return;
    }

    await client.query("BEGIN");
    try {
      for (const file of pending) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ($1, $2)`,
          [file, new Date().toISOString()],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}

async function listTablesPostgres(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
  );
  return new Set(rows.map((r) => r.tablename));
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function readMigrationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}
