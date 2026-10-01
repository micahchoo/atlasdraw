// @atlasdraw/storage — sqlite-fs adapter.
//
// Minimal stack: SQLite for metadata, the filesystem for blobs. Every write
// streams to a NEW file (`blobs/<id>.<random>.atlasdraw`) through a flushed
// temp file and a rename; one transaction then checks the row still exists,
// points it at the new file and counts the size change; only then is the old
// file deleted. A crash at any point leaves the old map whole. Reads stream
// from an open file; no blob is ever held whole in memory.
//
// The size cap (types.ts#StorageClient): bytes are reserved in
// storage_reservations before the first one is written, and the reservation
// turns into counted bytes (storage_usage) in the same transaction as the
// row change.

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";

import Database from "better-sqlite3";
import { nanoid } from "nanoid";

import { ID_RE } from "../constants";
import { migrateSqlite } from "../db/migrate";
import { WRITE_KEYS_MIGRATION } from "../db/migrations";
import { measured } from "../lib/body";
import { storageFull } from "../lib/errors";

import type {
  BlobBody,
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

function newBlobRef(id: string): string {
  return `blobs/${id}.${randomBytes(6).toString("hex")}.atlasdraw`;
}

/** Streams `body` to `target` through a flushed temp file and a rename. */
async function writeAtomic(target: string, body: BlobBody): Promise<void> {
  const temp = `${target}${TEMP_SUFFIX}`;
  try {
    await pipeline(
      body.stream,
      measured(body.size),
      fs.createWriteStream(temp, { flush: true }),
    );
    await fsp.rename(temp, target);
  } catch (err) {
    await fsp.rm(temp, { force: true });
    throw err;
  }
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
  const blobPath = (ref: string) => path.join(dataDir, ref);
  fs.mkdirSync(blobsDir, { recursive: true });
  // A temp file left by a crash mid-write belongs to no map.
  for (const name of fs.readdirSync(blobsDir)) {
    if (name.endsWith(TEMP_SUFFIX)) {
      fs.rmSync(path.join(blobsDir, name), { force: true });
    }
  }

  const db = new Database(path.join(dataDir, "atlas.db"));
  db.pragma("journal_mode = WAL");
  // Two servers on one file would otherwise wait forever on each other.
  db.pragma("busy_timeout = 5000");
  migrateSqlite(db);

  const selectMap = db.prepare(`SELECT * FROM maps WHERE id = ?`);
  const insertMap = db.prepare(
    `INSERT INTO maps (id, created_at, updated_at, blob_ref, byte_size, write_key_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const pointMap = db.prepare(
    `UPDATE maps SET blob_ref = ?, byte_size = ?, updated_at = ? WHERE id = ?`,
  );
  const deleteMapRow = db.prepare(`DELETE FROM maps WHERE id = ?`);
  const deleteMapShares = db.prepare(
    `DELETE FROM share_tokens WHERE map_id = ?`,
  );
  const insertShare = db.prepare(
    `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const selectShare = db.prepare(`SELECT * FROM share_tokens WHERE token = ?`);
  const deleteShare = db.prepare(
    `DELETE FROM share_tokens WHERE token = ? AND map_id = ?`,
  );
  const deleteExpired = db.prepare(
    `DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?`,
  );
  const selectUnreachable = db.prepare(
    `SELECT id, blob_ref, byte_size FROM maps
     WHERE write_key_hash IS NULL
       AND NOT EXISTS (SELECT 1 FROM share_tokens WHERE map_id = maps.id)`,
  );
  const selectRefs = db.prepare(`SELECT blob_ref FROM maps`);
  const upgradedAt = db.prepare(
    `SELECT applied_at FROM schema_migrations WHERE name = ?`,
  );

  const usage = db.prepare(
    `SELECT total_bytes FROM storage_usage WHERE id = 1`,
  );
  const addUsage = db.prepare(
    `UPDATE storage_usage SET total_bytes = total_bytes + ? WHERE id = 1`,
  );
  const reserved = db.prepare(
    `SELECT COALESCE(SUM(bytes), 0) AS bytes FROM storage_reservations`,
  );
  const insertReservation = db.prepare(
    `INSERT INTO storage_reservations (id, bytes, created_at) VALUES (?, ?, ?)`,
  );
  const deleteReservation = db.prepare(
    `DELETE FROM storage_reservations WHERE id = ?`,
  );
  const deleteStaleReservations = db.prepare(
    `DELETE FROM storage_reservations WHERE created_at < ?`,
  );

  const counted = () => (usage.get() as { total_bytes: number }).total_bytes;
  const inFlight = () => (reserved.get() as { bytes: number }).bytes;

  /** A reservation id, or null when `bytes` would pass `cap`. */
  const reserve = db.transaction((bytes: number, cap: number) => {
    if (cap > 0 && counted() + inFlight() + bytes > cap) {
      return null;
    }
    const id = randomBytes(9).toString("base64url");
    insertReservation.run(id, bytes, new Date().toISOString());
    return id;
  });

  const commitCreate = db.transaction((row: MapRow, reservation: string) => {
    insertMap.run(
      row.id,
      row.created_at,
      row.updated_at,
      row.blob_ref,
      row.byte_size,
      row.write_key_hash,
    );
    addUsage.run(row.byte_size);
    deleteReservation.run(reservation);
  });

  type Swap =
    | { kind: "swapped"; old: MapRow }
    | { kind: "missing" }
    | { kind: "full" };

  /**
   * Points the map at its new blob, if the map still exists and the size
   * change still fits. `growth` is what the reservation holds.
   */
  const commitSwap = db.transaction(
    (
      id: string,
      ref: string,
      size: number,
      at: string,
      reservation: string,
      growth: number,
      cap: number,
    ): Swap => {
      deleteReservation.run(reservation);
      const row = selectMap.get(id) as MapRow | undefined;
      if (!row) {
        return { kind: "missing" };
      }
      const delta = size - row.byte_size;
      if (cap > 0 && delta > growth && counted() + inFlight() + delta > cap) {
        return { kind: "full" };
      }
      pointMap.run(ref, size, at, id);
      addUsage.run(delta);
      return { kind: "swapped", old: row };
    },
  );

  const deleteMapRows = db.transaction((id: string) => {
    const row = selectMap.get(id) as MapRow | undefined;
    if (!row) {
      return null;
    }
    deleteMapShares.run(id);
    deleteMapRow.run(id);
    addUsage.run(-row.byte_size);
    return row.blob_ref;
  });

  const sweepRows = db.transaction(
    (nowIso: string, keyless: boolean, staleIso: string) => {
      const tokens = deleteExpired.run(nowIso).changes;
      const maps = keyless
        ? (selectUnreachable.all() as Array<{
            id: string;
            blob_ref: string;
            byte_size: number;
          }>)
        : [];
      for (const map of maps) {
        deleteMapRow.run(map.id);
        addUsage.run(-map.byte_size);
      }
      deleteStaleReservations.run(staleIso);
      return { tokens, refs: maps.map((m) => m.blob_ref) };
    },
  );

  /** Streams the bytes to a new blob under a reservation; null when full. */
  async function writeReserved(
    id: string,
    body: BlobBody,
    bytes: number,
    cap: number,
  ): Promise<{ ref: string; reservation: string } | null> {
    const reservation = reserve.immediate(bytes, cap);
    if (reservation === null) {
      return null;
    }
    const ref = newBlobRef(id);
    try {
      await writeAtomic(blobPath(ref), body);
    } catch (err) {
      deleteReservation.run(reservation);
      throw err;
    }
    return { ref, reservation };
  }

  async function removeOrphans(olderThan: number): Promise<number> {
    const live = new Set(
      (selectRefs.all() as Array<{ blob_ref: string }>).map((r) =>
        path.basename(r.blob_ref),
      ),
    );
    let removed = 0;
    for (const name of await fsp.readdir(blobsDir)) {
      if (live.has(name) || name.endsWith(TEMP_SUFFIX)) {
        continue;
      }
      const file = path.join(blobsDir, name);
      const stat = await fsp.stat(file).catch(() => null);
      // Checked again: a write may have pointed a row at it since.
      if (stat && stat.mtimeMs < olderThan && !isReferenced(name)) {
        await fsp.rm(file, { force: true });
        removed += 1;
      }
    }
    return removed;
  }
  const refCount = db.prepare(`SELECT 1 FROM maps WHERE blob_ref = ?`);
  const isReferenced = (name: string) =>
    refCount.get(`blobs/${name}`) !== undefined;

  return {
    async createMap(body, writeKeyHash, opts = {}) {
      const id = nanoid(21);
      const written = await writeReserved(
        id,
        body,
        body.size,
        opts.maxTotalBytes ?? 0,
      );
      if (!written) {
        throw storageFull();
      }
      const now = new Date().toISOString();
      const row: MapRow = {
        id,
        created_at: now,
        updated_at: now,
        blob_ref: written.ref,
        byte_size: body.size,
        write_key_hash: writeKeyHash,
      };
      try {
        commitCreate.immediate(row, written.reservation);
      } catch (err) {
        deleteReservation.run(written.reservation);
        await fsp.rm(blobPath(written.ref), { force: true });
        throw err;
      }
      return { ...row };
    },

    async getMap(id) {
      if (!ID_RE.test(id)) {
        return null;
      }
      const row = selectMap.get(id) as MapRow | undefined;
      return row ? { ...row } : null;
    },

    async updateMap(id, body, opts = {}) {
      if (!ID_RE.test(id)) {
        throw new Error(`not found: ${id}`);
      }
      const existing = selectMap.get(id) as MapRow | undefined;
      if (!existing) {
        throw new Error(`not found: ${id}`);
      }
      const cap = opts.maxTotalBytes ?? 0;
      const growth = Math.max(0, body.size - existing.byte_size);
      const written = await writeReserved(id, body, growth, cap);
      if (!written) {
        throw storageFull();
      }
      const now = new Date().toISOString();
      const swap = commitSwap.immediate(
        id,
        written.ref,
        body.size,
        now,
        written.reservation,
        growth,
        cap,
      );
      if (swap.kind !== "swapped") {
        await fsp.rm(blobPath(written.ref), { force: true });
        throw swap.kind === "full"
          ? storageFull()
          : new Error(`not found: ${id}`);
      }
      // A reader that opened the old file keeps reading it.
      await fsp.rm(blobPath(swap.old.blob_ref), { force: true });
      return {
        ...swap.old,
        blob_ref: written.ref,
        byte_size: body.size,
        updated_at: now,
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
      let handle: fsp.FileHandle;
      try {
        handle = await fsp.open(blobPath(row.blob_ref), "r");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
      // The open handle keeps the bytes readable even if a later write
      // replaces the file. The stream closes the handle when it ends or is
      // destroyed.
      try {
        const { size } = await handle.stat();
        return { stream: handle.createReadStream(), size };
      } catch (err) {
        await handle.close();
        throw err;
      }
    },

    async deleteMap(id) {
      if (!ID_RE.test(id)) {
        return false;
      }
      const blobRef = deleteMapRows.immediate(id);
      if (blobRef === null) {
        return false;
      }
      await fsp.rm(blobPath(blobRef), { force: true });
      return true;
    },

    async totalBytes() {
      return counted();
    },

    async sweep(now, opts): Promise<SweepResult> {
      const upgrade = upgradedAt.get(WRITE_KEYS_MIGRATION) as
        | { applied_at: string }
        | undefined;
      const keyless =
        opts.legacyGraceMs === 0 ||
        !upgrade ||
        now.getTime() >=
          new Date(upgrade.applied_at).getTime() + opts.legacyGraceMs;
      const stale = now.getTime() - opts.orphanGraceMs;
      const { tokens, refs } = sweepRows.immediate(
        now.toISOString(),
        keyless,
        new Date(stale).toISOString(),
      );
      for (const ref of refs) {
        await fsp.rm(blobPath(ref), { force: true });
      }
      const orphans = await removeOrphans(stale);
      return { tokens, maps: refs.length, orphans };
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
