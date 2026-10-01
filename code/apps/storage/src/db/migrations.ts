// The storage schema, as an ordered list of migrations. This list is the one
// definition of the schema: both adapters run it at startup through
// ./migrate.ts, and nothing else creates or alters a table.
//
// Rules for a new migration:
//   - Append it. Never edit, rename or reorder one that has shipped; a
//     database records each name once and never runs that name again.
//   - Give both dialects. SQLite stores timestamps as ISO text; Postgres
//     stores them as TIMESTAMPTZ.
//   - The runner applies each migration in a transaction, so a migration
//     that fails leaves no trace. Do not commit inside one.

import type Database from "better-sqlite3";

export interface Migration {
  /** Unique and sortable. The runner applies migrations in list order. */
  name: string;
  sqlite: (db: Database.Database) => void;
  postgres: string;
}

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return columns.some((c) => c.name === column);
}

export const MIGRATIONS: readonly Migration[] = [
  {
    // IF NOT EXISTS, because a database made before the runner existed
    // already has these tables and no record of this migration.
    name: "001_maps_and_share_tokens",
    sqlite: (db) =>
      db.exec(`
        CREATE TABLE IF NOT EXISTS maps (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          blob_ref TEXT NOT NULL,
          byte_size INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS share_tokens (
          token TEXT PRIMARY KEY,
          map_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (map_id) REFERENCES maps(id)
        );
      `),
    postgres: `
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
        blob_ref TEXT NOT NULL,
        byte_size BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_tokens (
        token TEXT PRIMARY KEY,
        map_id TEXT NOT NULL REFERENCES maps(id),
        mode TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `,
  },
  {
    // Managed mode is removed (ADR-0013). A database that ran it has
    // workspace_id columns, their index and a workspaces table. SQLite
    // refuses to drop an indexed column, so the index goes first.
    name: "002_drop_workspaces",
    sqlite: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS maps_workspace_id_idx;
        DROP INDEX IF EXISTS workspaces_stripe_customer_id_idx;
        DROP TABLE IF EXISTS workspaces;
      `);
      for (const table of ["maps", "share_tokens"]) {
        if (hasColumn(db, table, "workspace_id")) {
          db.exec(`ALTER TABLE ${table} DROP COLUMN workspace_id`);
        }
      }
    },
    postgres: `
      DROP INDEX IF EXISTS maps_workspace_id_idx;
      DROP INDEX IF EXISTS workspaces_stripe_customer_id_idx;
      DROP TABLE IF EXISTS workspaces;
      ALTER TABLE maps DROP COLUMN IF EXISTS workspace_id;
      ALTER TABLE share_tokens DROP COLUMN IF EXISTS workspace_id;
    `,
  },
  {
    // A map carries the SHA-256 of its write key (ADR-0017). A map stored
    // before this has no key: nobody can write it, and it lives only while a
    // share token reads it. A share token may have no expiry, so
    // expires_at becomes nullable. SQLite cannot drop NOT NULL in place, so
    // share_tokens is copied into a new table.
    name: "003_write_keys_and_lasting_links",
    sqlite: (db) => {
      if (!hasColumn(db, "maps", "write_key_hash")) {
        db.exec("ALTER TABLE maps ADD COLUMN write_key_hash TEXT");
      }
      db.exec(`
        CREATE TABLE share_tokens_new (
          token TEXT PRIMARY KEY,
          map_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (map_id) REFERENCES maps(id)
        );
        INSERT INTO share_tokens_new (token, map_id, mode, expires_at, created_at)
          SELECT token, map_id, mode, expires_at, created_at FROM share_tokens;
        DROP TABLE share_tokens;
        ALTER TABLE share_tokens_new RENAME TO share_tokens;
        CREATE INDEX share_tokens_map_id_idx ON share_tokens(map_id);
      `);
    },
    postgres: `
      ALTER TABLE maps ADD COLUMN IF NOT EXISTS write_key_hash TEXT;
      ALTER TABLE share_tokens ALTER COLUMN expires_at DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS share_tokens_map_id_idx ON share_tokens(map_id);
    `,
  },
  {
    // The size cap without a race and without a full scan. storage_usage
    // holds SUM(maps.byte_size) in one row; every statement that changes a
    // map's size changes it in the same transaction. storage_reservations
    // holds the bytes of writes in flight, so concurrent writes see each
    // other before their bytes land. A reservation that a crash left is
    // removed by the sweep.
    name: "004_storage_usage",
    sqlite: (db) =>
      db.exec(`
        CREATE TABLE storage_usage (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          total_bytes INTEGER NOT NULL
        );
        INSERT INTO storage_usage (id, total_bytes)
          SELECT 1, COALESCE(SUM(byte_size), 0) FROM maps;
        CREATE TABLE storage_reservations (
          id TEXT PRIMARY KEY,
          bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `),
    postgres: `
      CREATE TABLE storage_usage (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_bytes BIGINT NOT NULL
      );
      INSERT INTO storage_usage (id, total_bytes)
        SELECT 1, COALESCE(SUM(byte_size), 0) FROM maps;
      CREATE TABLE storage_reservations (
        id TEXT PRIMARY KEY,
        bytes BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `,
  },
];

/** The migration that gave maps write keys; the legacy grace counts from it. */
export const WRITE_KEYS_MIGRATION = "003_write_keys_and_lasting_links";
