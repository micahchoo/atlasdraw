// @atlasdraw/storage — sqlite-fs adapter.
//
// Minimal stack: SQLite for metadata, the filesystem for blobs. A blob is
// written to a temp file, flushed to disk and renamed over the old one, so a
// crash leaves the old bytes or the new bytes, never a mix.

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import Database from "better-sqlite3";
import { nanoid } from "nanoid";

import { ID_RE } from "../constants";
import { migrateSqlite } from "../db/migrate";

import type {
  MapRecord,
  ShareToken,
  StorageClient,
  SweepResult,
} from "../types";

interface MapRow {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
  write_key_hash: string | null;
}

interface ShareRow {
  token: string;
  map_id: string;
  mode: string;
  expires_at: string | null;
  created_at: string;
}

const TEMP_SUFFIX = ".tmp";

/** Writes `bytes` to `target` through a flushed temp file and a rename. */
async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  const temp = `${target}.${randomBytes(6).toString("hex")}${TEMP_SUFFIX}`;
  try {
    const handle = await fsp.open(temp, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temp, target);
  } catch (err) {
    await fsp.rm(temp, { force: true });
    throw err;
  }
}

function rowToMap(row: MapRow): MapRecord {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    blob_ref: row.blob_ref,
    byte_size: row.byte_size,
    write_key_hash: row.write_key_hash,
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

export function createSqliteFsAdapter(opts: {
  dataDir: string;
}): StorageClient {
  const { dataDir } = opts;
  const blobsDir = path.join(dataDir, "blobs");
  fs.mkdirSync(blobsDir, { recursive: true });
  // A temp file left by a crash mid-write belongs to no map.
  for (const name of fs.readdirSync(blobsDir)) {
    if (name.endsWith(TEMP_SUFFIX)) {
      fs.rmSync(path.join(blobsDir, name), { force: true });
    }
  }

  const db = new Database(path.join(dataDir, "atlas.db"));
  db.pragma("journal_mode = WAL");
  migrateSqlite(db);

  const insertMap = db.prepare(
    `INSERT INTO maps (id, created_at, updated_at, blob_ref, byte_size, write_key_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
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
  const deleteShare = db.prepare(
    `DELETE FROM share_tokens WHERE token = ? AND map_id = ?`,
  );
  const sumBytes = db.prepare(
    `SELECT COALESCE(SUM(byte_size), 0) AS total FROM maps`,
  );
  const deleteExpired = db.prepare(
    `DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?`,
  );
  const selectUnreachable = db.prepare(
    `SELECT id, blob_ref FROM maps
     WHERE write_key_hash IS NULL
       AND NOT EXISTS (SELECT 1 FROM share_tokens WHERE map_id = maps.id)`,
  );
  const deleteMapRow = db.prepare(`DELETE FROM maps WHERE id = ?`);

  const sweepRows = db.transaction((nowIso: string) => {
    const tokens = deleteExpired.run(nowIso).changes;
    const maps = selectUnreachable.all() as Array<{
      id: string;
      blob_ref: string;
    }>;
    for (const map of maps) {
      deleteMapRow.run(map.id);
    }
    return { tokens, maps };
  });

  return {
    async createMap(blob, writeKeyHash) {
      const id = nanoid(21);
      const now = new Date().toISOString();
      const blobRef = `blobs/${id}.atlasdraw`;
      const fullPath = path.join(dataDir, blobRef);
      await writeAtomic(fullPath, blob);
      try {
        insertMap.run(id, now, now, blobRef, blob.byteLength, writeKeyHash);
      } catch (err) {
        await fsp.rm(fullPath, { force: true });
        throw err;
      }
      return {
        id,
        created_at: now,
        updated_at: now,
        blob_ref: blobRef,
        byte_size: blob.byteLength,
        write_key_hash: writeKeyHash,
      };
    },

    async getMap(id) {
      if (!ID_RE.test(id)) {
        return null;
      }
      const row = selectMap.get(id) as MapRow | undefined;
      return row ? rowToMap(row) : null;
    },

    async updateMap(id, blob) {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      const existing = selectMap.get(id) as MapRow | undefined;
      if (!existing) {
        throw new Error(`not found: ${id}`);
      }
      const now = new Date().toISOString();
      await writeAtomic(path.join(dataDir, existing.blob_ref), blob);
      updateMapRow.run(now, blob.byteLength, id);
      return {
        ...rowToMap(existing),
        updated_at: now,
        byte_size: blob.byteLength,
      };
    },

    async createShareToken(mapId, expiresAt) {
      if (!ID_RE.test(mapId) || !selectMap.get(mapId)) {
        throw new Error(`not found: ${mapId}`);
      }
      const record: ShareToken = {
        token: nanoid(21),
        map_id: mapId,
        mode: "read",
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        created_at: new Date().toISOString(),
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

    async resolveToken(token) {
      if (!ID_RE.test(token)) {
        return null;
      }
      const row = selectShare.get(token) as ShareRow | undefined;
      return row ? rowToShare(row) : null;
    },

    async deleteShareToken(mapId, token) {
      if (!ID_RE.test(mapId) || !ID_RE.test(token)) {
        return false;
      }
      return deleteShare.run(token, mapId).changes > 0;
    },

    async getBlob(id) {
      if (!ID_RE.test(id)) {
        return null;
      }
      const row = selectMap.get(id) as MapRow | undefined;
      if (!row) {
        return null;
      }
      try {
        return await fsp.readFile(path.join(dataDir, row.blob_ref));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    },

    async totalBytes() {
      return (sumBytes.get() as { total: number }).total;
    },

    async sweep(now): Promise<SweepResult> {
      const { tokens, maps } = sweepRows(now.toISOString());
      for (const map of maps) {
        await fsp.rm(path.join(dataDir, map.blob_ref), { force: true });
      }
      return { tokens, maps: maps.length };
    },

    async ping() {
      // The blobs dir is on the same filesystem as the database, so a
      // disk-level failure shows on both.
      db.prepare("SELECT 1").get();
      await fsp.access(blobsDir, fs.constants.R_OK | fs.constants.W_OK);
    },

    async close() {
      db.close();
    },
  };
}
