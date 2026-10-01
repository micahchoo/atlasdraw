// The migration runner owns the schema for both adapters. These tests apply
// the real migration list, never a synthetic one, so a migration that fails
// on a fresh or on an old database fails here.
//
// The Postgres half runs only when ATLASDRAW_TEST_PG_URL names a database. It
// works in a private schema that it drops afterwards, so it can share a
// database with other data.

import Database from "better-sqlite3";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "../migrations";
import { migratePostgres, migrateSqlite } from "../migrate";

import type { Migration } from "../migrations";

// The schema that the sqlite-fs adapter created inline before the runner
// owned the schema, including the managed-mode columns and table. A database
// in the field can have this shape and no migration record.
const LEGACY_SQLITE_SCHEMA = `
  CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    blob_ref TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    workspace_id TEXT
  );
  CREATE TABLE share_tokens (
    token TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    workspace_id TEXT,
    FOREIGN KEY (map_id) REFERENCES maps(id)
  );
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL,
    stripe_customer_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX workspaces_stripe_customer_id_idx ON workspaces(stripe_customer_id);
  CREATE INDEX maps_workspace_id_idx ON maps(workspace_id);
`;

const LEGACY_POSTGRES_SCHEMA = `
  CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    blob_ref TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    workspace_id TEXT
  );
  CREATE TABLE share_tokens (
    token TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES maps(id),
    mode TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    workspace_id TEXT
  );
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL,
    stripe_customer_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
  );
  CREATE INDEX workspaces_stripe_customer_id_idx ON workspaces(stripe_customer_id);
  CREATE INDEX maps_workspace_id_idx ON maps(workspace_id);
`;

const TABLES = ["maps", "schema_migrations", "share_tokens"];
const MAP_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "blob_ref",
  "byte_size",
  "write_key_hash",
];
const SHARE_COLUMNS = ["token", "map_id", "mode", "expires_at", "created_at"];
const ALL_NAMES = MIGRATIONS.map((m) => m.name).sort();

function sqliteTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function sqliteColumns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function sqliteApplied(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("migrateSqlite", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("builds the whole schema on a fresh database", () => {
    migrateSqlite(db);

    expect(sqliteTables(db)).toEqual(TABLES);
    expect(sqliteColumns(db, "maps")).toEqual(MAP_COLUMNS);
    expect(sqliteColumns(db, "share_tokens")).toEqual(SHARE_COLUMNS);
    expect(sqliteApplied(db)).toEqual(ALL_NAMES);
  });

  it("changes nothing when it runs again", () => {
    migrateSqlite(db);
    migrateSqlite(db);

    expect(sqliteApplied(db)).toEqual(ALL_NAMES);
    expect(sqliteTables(db)).toEqual(TABLES);
  });

  it("moves an old database forward and keeps its rows", () => {
    db.exec(LEGACY_SQLITE_SCHEMA);
    db.prepare(
      "INSERT INTO maps VALUES ('m1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'blobs/m1.atlasdraw', 3, 'ws-1')",
    ).run();
    db.prepare(
      "INSERT INTO share_tokens VALUES ('t1', 'm1', 'read', '2026-01-08T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'ws-1')",
    ).run();
    db.prepare(
      "INSERT INTO workspaces VALUES ('ws-1', 'x', 'free', NULL, '2026-01-01T00:00:00.000Z')",
    ).run();

    migrateSqlite(db);

    expect(sqliteTables(db)).toEqual(TABLES);
    expect(sqliteColumns(db, "maps")).toEqual(MAP_COLUMNS);
    expect(sqliteColumns(db, "share_tokens")).toEqual(SHARE_COLUMNS);
    expect(db.prepare("SELECT id, byte_size FROM maps").all()).toEqual([
      { id: "m1", byte_size: 3 },
    ]);
    expect(db.prepare("SELECT token, map_id FROM share_tokens").all()).toEqual([
      { token: "t1", map_id: "m1" },
    ]);
  });

  it("gives an old map no write key and keeps its link's expiry", () => {
    db.exec(LEGACY_SQLITE_SCHEMA);
    db.prepare(
      "INSERT INTO maps VALUES ('m1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'blobs/m1.atlasdraw', 3, NULL)",
    ).run();
    db.prepare(
      "INSERT INTO share_tokens VALUES ('t1', 'm1', 'read', '2026-01-08T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)",
    ).run();

    migrateSqlite(db);

    expect(db.prepare("SELECT write_key_hash FROM maps").get()).toEqual({
      write_key_hash: null,
    });
    expect(db.prepare("SELECT expires_at FROM share_tokens").get()).toEqual({
      expires_at: "2026-01-08T00:00:00.000Z",
    });
  });

  it("lets a share token have no expiry", () => {
    migrateSqlite(db);
    db.prepare(
      "INSERT INTO maps VALUES ('m1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'blobs/m1.atlasdraw', 3, NULL)",
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO share_tokens VALUES ('t1', 'm1', 'read', NULL, '2026-01-01T00:00:00.000Z')",
        )
        .run(),
    ).not.toThrow();
  });

  it("rolls back a migration that fails and records nothing for it", () => {
    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        name: "999_broken",
        sqlite: (d) => {
          d.exec("CREATE TABLE half_done (id TEXT)");
          d.exec("THIS IS NOT SQL");
        },
        postgres: "SELECT 1",
      },
    ];

    expect(() => migrateSqlite(db, broken)).toThrow();

    expect(sqliteTables(db)).not.toContain("half_done");
    expect(sqliteApplied(db)).toEqual(ALL_NAMES);
  });
});

const PG_URL = process.env.ATLASDRAW_TEST_PG_URL;

describe.skipIf(!PG_URL)("migratePostgres (real Postgres)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  function poolFor(s: string): Pool {
    return new Pool({
      connectionString: PG_URL,
      options: `-c search_path=${s}`,
    });
  }

  async function tables(): Promise<string[]> {
    const res = await admin.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schema],
    );
    return res.rows.map((r) => r.table_name);
  }

  async function columns(table: string): Promise<string[]> {
    const res = await admin.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
      [schema, table],
    );
    return res.rows.map((r) => r.column_name);
  }

  async function applied(): Promise<string[]> {
    const res = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    return res.rows.map((r) => r.name);
  }

  beforeEach(async () => {
    admin = new Pool({ connectionString: PG_URL });
    schema = `migrate_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = poolFor(schema);
  });

  afterEach(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("builds the whole schema on a fresh database", async () => {
    await migratePostgres(pool);

    expect(await tables()).toEqual(TABLES);
    expect(await columns("maps")).toEqual(MAP_COLUMNS);
    expect(await columns("share_tokens")).toEqual(SHARE_COLUMNS);
    expect(await applied()).toEqual(ALL_NAMES);
  });

  it("changes nothing when it runs again", async () => {
    await migratePostgres(pool);
    await migratePostgres(pool);

    expect(await applied()).toEqual(ALL_NAMES);
    expect(await tables()).toEqual(TABLES);
  });

  it("lets two servers start at once", async () => {
    const other = poolFor(schema);
    try {
      await Promise.all([migratePostgres(pool), migratePostgres(other)]);
    } finally {
      await other.end();
    }

    expect(await applied()).toEqual(ALL_NAMES);
  });

  it("moves an old database forward and keeps its rows", async () => {
    await pool.query(LEGACY_POSTGRES_SCHEMA);
    await pool.query(
      "INSERT INTO maps VALUES ('m1', now(), now(), 'maps/m1.atlasdraw', 3, 'ws-1')",
    );
    await pool.query(
      "INSERT INTO share_tokens VALUES ('t1', 'm1', 'read', now(), now(), 'ws-1')",
    );

    await migratePostgres(pool);

    expect(await tables()).toEqual(TABLES);
    expect(await columns("maps")).toEqual(MAP_COLUMNS);
    expect(await columns("share_tokens")).toEqual(SHARE_COLUMNS);
    const maps = await pool.query("SELECT id, write_key_hash FROM maps");
    expect(maps.rows).toEqual([{ id: "m1", write_key_hash: null }]);
  });

  it("lets a share token have no expiry", async () => {
    await migratePostgres(pool);
    await pool.query(
      "INSERT INTO maps VALUES ('m1', now(), now(), 'maps/m1.atlasdraw', 3, NULL)",
    );

    await expect(
      pool.query(
        "INSERT INTO share_tokens VALUES ('t1', 'm1', 'read', NULL, now())",
      ),
    ).resolves.toBeDefined();
  });
});
