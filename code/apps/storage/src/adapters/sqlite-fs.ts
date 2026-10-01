// @atlasdraw/storage — Phase 4 T3: sqlite-fs adapter.
//
// Minimal stack — SQLite for metadata, filesystem for blobs. Used by the
// "single-binary" self-host path.

import * as fs from "node:fs";

import * as path from "node:path";

import Database from "better-sqlite3";
import { nanoid } from "nanoid";

import { ID_RE, SHARE_TTL_MS } from "../constants";
import { migrateSqlite } from "../db/migrate";

import type { MapRecord, ShareToken, StorageClient } from "../types";

interface MapRow {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
}

interface ShareRow {
  token: string;
  map_id: string;
  mode: string;
  expires_at: string;
  created_at: string;
}

export function createSqliteFsAdapter(opts: {
  dataDir: string;
}): StorageClient {
  const { dataDir } = opts;
  const blobsDir = path.join(dataDir, "blobs");
  fs.mkdirSync(blobsDir, { recursive: true });

  const db = new Database(path.join(dataDir, "atlas.db"));
  db.pragma("journal_mode = WAL");
  migrateSqlite(db);

  const insertMap = db.prepare(
    `INSERT INTO maps (id, created_at, updated_at, blob_ref, byte_size)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const selectMap = db.prepare(`SELECT * FROM maps WHERE id = ?`);
  const updateMapRow = db.prepare(
    `UPDATE maps SET updated_at = ?, byte_size = ? WHERE id = ?`,
  );
  const insertShare = db.prepare(
    `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const selectShare = db.prepare(`SELECT * FROM share_tokens WHERE token = ?`);

  function rowToMap(row: MapRow): MapRecord {
    return {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      blob_ref: row.blob_ref,
      byte_size: row.byte_size,
    };
  }

  function rowToShare(row: ShareRow): ShareToken {
    return {
      token: row.token,
      map_id: row.map_id,
      mode: "read",
      expires_at: row.expires_at,
      created_at: row.created_at,
    };
  }

  return {
    async createMap(blob: Buffer): Promise<MapRecord> {
      const id = nanoid(21);
      const now = new Date().toISOString();
      const blobRef = `blobs/${id}.atlasdraw`;
      const fullPath = path.join(dataDir, blobRef);
      fs.writeFileSync(fullPath, blob);
      insertMap.run(id, now, now, blobRef, blob.byteLength);
      return {
        id,
        created_at: now,
        updated_at: now,
        blob_ref: blobRef,
        byte_size: blob.byteLength,
      };
    },

    async getMap(id: string): Promise<MapRecord | null> {
      if (!ID_RE.test(id)) {
        return null;
      }
      const row = selectMap.get(id) as MapRow | undefined;
      return row ? rowToMap(row) : null;
    },

    async updateMap(id: string, blob: Buffer): Promise<MapRecord> {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      const existing = selectMap.get(id) as MapRow | undefined;
      if (!existing) {
        throw new Error(`not found: ${id}`);
      }
      const now = new Date().toISOString();
      const fullPath = path.join(dataDir, existing.blob_ref);
      fs.writeFileSync(fullPath, blob);
      updateMapRow.run(now, blob.byteLength, id);
      return {
        id,
        created_at: existing.created_at,
        updated_at: now,
        blob_ref: existing.blob_ref,
        byte_size: blob.byteLength,
      };
    },

    async createShareToken(mapId: string): Promise<ShareToken> {
      if (!ID_RE.test(mapId)) {
        throw new Error(`not found: ${mapId}`);
      }
      const existing = selectMap.get(mapId) as MapRow | undefined;
      if (!existing) {
        throw new Error(`not found: ${mapId}`);
      }
      const token = nanoid(21);
      const now = new Date();
      const expires = new Date(now.getTime() + SHARE_TTL_MS);
      const record: ShareToken = {
        token,
        map_id: mapId,
        mode: "read",
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
      };
      insertShare.run(
        record.token,
        record.map_id,
        record.mode,
        record.expires_at,
        record.created_at,
      );
      return record;
    },

    async resolveToken(token: string): Promise<ShareToken | null> {
      if (!ID_RE.test(token)) {
        return null;
      }
      const row = selectShare.get(token) as ShareRow | undefined;
      return row ? rowToShare(row) : null;
    },

    async getBlob(id: string): Promise<Buffer | null> {
      // Defense-in-depth: reject malformed ids before any filesystem call.
      // Phase 4 T8 amendment — consumed by GET /share/:token/blob.
      if (!ID_RE.test(id)) {
        return null;
      }
      const fullPath = path.join(dataDir, "blobs", `${id}.atlasdraw`);
      try {
        return fs.readFileSync(fullPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    },

    async ping(): Promise<void> {
      // Also confirms the blobs dir is still there — same filesystem the
      // sqlite file lives on, so a disk-level failure would hit both.
      db.prepare("SELECT 1").get();
      fs.accessSync(blobsDir, fs.constants.R_OK | fs.constants.W_OK);
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
