// @atlasdraw/storage — migration runner tests.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateSqliteSync } from "../migrate";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlasdraw-migrate-"));
}

function tmpDb(): Database {
  return new Database(":memory:");
}

function writeMigrations(dir: string, files: Record<string, string>): void {
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql);
  }
}

describe("migrateSqliteSync", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates _migrations table on first run and applies all files", () => {
    writeMigrations(dir, {
      "001_t1.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
      "002_t2.sql": "CREATE TABLE t2 (id INTEGER PRIMARY KEY);",
    });
    const db = tmpDb();

    migrateSqliteSync(db, dir);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((r) => r.name);
    expect(names).toContain("_migrations");
    expect(names).toContain("t1");
    expect(names).toContain("t2");

    const applied = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(applied.map((r) => r.name)).toEqual(["001_t1.sql", "002_t2.sql"]);
  });

  it("no-ops when all migrations are already applied", () => {
    const db = tmpDb();
    migrateSqliteSync(db, dir); // bootstrap — no files, just creates _migrations

    writeMigrations(dir, {
      "001_t1.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
    });
    // First run applies it.
    migrateSqliteSync(db, dir);
    const count1 = (
      db.prepare("SELECT count(*) as c FROM _migrations").get() as { c: number }
    ).c;
    // Second run should be no-op.
    migrateSqliteSync(db, dir);
    const count2 = (
      db.prepare("SELECT count(*) as c FROM _migrations").get() as { c: number }
    ).c;
    expect(count2).toBe(count1);
  });

  it("bootstraps existing databases without _migrations table", () => {
    const db = tmpDb();
    // Simulate an existing DB with tables but no _migrations.
    db.exec("CREATE TABLE maps (id TEXT PRIMARY KEY);");
    db.exec("CREATE TABLE share_tokens (token TEXT PRIMARY KEY);");

    writeMigrations(dir, {
      "001_create_maps.sql":
        "CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY);",
      "002_create_share_tokens.sql":
        "CREATE TABLE IF NOT EXISTS share_tokens (token TEXT PRIMARY KEY);",
      "003_create_workspaces.sql":
        "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY);",
    });

    migrateSqliteSync(db, dir);

    // All 3 should be marked applied without re-creating tables.
    const applied = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(applied.map((r) => r.name)).toEqual([
      "001_create_maps.sql",
      "002_create_share_tokens.sql",
      "003_create_workspaces.sql",
    ]);
    // workspaces should NOT have been created (bootstrap skips DDL).
    const ws = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'",
      )
      .get();
    expect(ws).toBeFalsy();
  });

  it("fails inside transaction on bad SQL and rolls back", () => {
    writeMigrations(dir, {
      "001_t1.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
      "002_bad.sql": "THIS IS NOT VALID SQL;",
    });
    const db = tmpDb();

    expect(() => migrateSqliteSync(db, dir)).toThrow();

    // t1 should NOT exist — transaction rolled back.
    const t1 = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='t1'",
      )
      .get();
    expect(t1).toBeFalsy();
    // _migrations should have no entries.
    const count = (
      db.prepare("SELECT count(*) as c FROM _migrations").get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it("only applies pending migrations, preserving already-applied", () => {
    writeMigrations(dir, {
      "001_t1.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
    });
    const db = tmpDb();
    migrateSqliteSync(db, dir);

    writeMigrations(dir, {
      "001_t1.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
      "002_t2.sql": "CREATE TABLE t2 (id INTEGER PRIMARY KEY);",
    });
    migrateSqliteSync(db, dir);

    const applied = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(applied.map((r) => r.name)).toEqual(["001_t1.sql", "002_t2.sql"]);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((r) => r.name)).toContain("t2");
  });
});
