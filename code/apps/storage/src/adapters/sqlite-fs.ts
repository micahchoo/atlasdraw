// @atlasdraw/storage — sqlite-fs adapter.
//
// Minimal stack: SQLite for metadata, the filesystem for blobs. Every write
// streams to a NEW file (`blobs/<id>.<random>.atlasdraw`) through a flushed
// temp file and a rename; one transaction then checks the row still exists,
// points it at the new file, keeps the old file as a version or not
// (versions.ts) and counts the size change; only then are the files no row
// names deleted. A crash at any point leaves the old map whole. Reads stream
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
import { RevisionConflictError, storageFull } from "../lib/errors";
import { NO_VERSIONS, keepsReplaced, pastKeep } from "../versions";

import type {
  BlobBody,
  BlobRead,
  MapVersion,
  ShareToken,
  StorageClient,
  SweepResult,
  VersionPolicy,
} from "../types";

interface MapRow {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
  write_key_hash: string | null;
  revision: number;
}

interface ShareRow {
  token: string;
  map_id: string;
  mode: string;
  expires_at: string | null;
  created_at: string;
  revision: number | null;
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
    revision: row.revision,
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
    `UPDATE maps SET blob_ref = ?, byte_size = ?, updated_at = ?, revision = ?
     WHERE id = ?`,
  );
  const deleteMapRow = db.prepare(`DELETE FROM maps WHERE id = ?`);
  const deleteMapShares = db.prepare(
    `DELETE FROM share_tokens WHERE map_id = ?`,
  );
  const insertShare = db.prepare(
    `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at, revision)
     VALUES (?, ?, ?, ?, ?, ?)`,
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
  const selectRefs = db.prepare(
    `SELECT blob_ref FROM maps UNION ALL SELECT blob_ref FROM map_versions`,
  );
  const selectVersions = db.prepare(
    `SELECT revision, saved_at, byte_size, blob_ref FROM map_versions
     WHERE map_id = ? ORDER BY revision DESC`,
  );
  const selectVersion = db.prepare(
    `SELECT blob_ref FROM map_versions WHERE map_id = ? AND revision = ?`,
  );
  const selectPinned = db.prepare(
    `SELECT DISTINCT revision FROM share_tokens
     WHERE map_id = ? AND revision IS NOT NULL`,
  );
  const insertVersion = db.prepare(
    `INSERT INTO map_versions (map_id, revision, blob_ref, byte_size, saved_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteVersion = db.prepare(
    `DELETE FROM map_versions WHERE map_id = ? AND revision = ?`,
  );
  const deleteMapVersions = db.prepare(
    `DELETE FROM map_versions WHERE map_id = ?`,
  );
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
    /** `freed`: blobs no row names any more, to delete after the commit. */
    | { kind: "swapped"; old: MapRow; freed: string[] }
    | { kind: "missing" }
    | { kind: "full" }
    | { kind: "conflict"; revision: number };

  interface SwapRequest {
    ref: string;
    size: number;
    at: Date;
    reservation: string;
    /** What the reservation holds. */
    growth: number;
    cap: number;
    ifRevision: number | undefined;
    policy: VersionPolicy;
    checkpoint: boolean;
  }

  /**
   * Points the map at its new blob, if the map still exists, is still at
   * `ifRevision` when one is named, and the size change still fits. The
   * replaced bytes become a version or are freed (versions.ts).
   */
  const commitSwap = db.transaction((id: string, w: SwapRequest): Swap => {
    deleteReservation.run(w.reservation);
    const row = selectMap.get(id) as MapRow | undefined;
    if (!row) {
      return { kind: "missing" };
    }
    if (w.ifRevision !== undefined && row.revision !== w.ifRevision) {
      return { kind: "conflict", revision: row.revision };
    }
    const versions = selectVersions.all(id) as MapVersion[];
    const pinned = new Set(
      (selectPinned.all(id) as Array<{ revision: number }>).map(
        (r) => r.revision,
      ),
    );
    const replaced: MapVersion = {
      revision: row.revision,
      saved_at: row.updated_at,
      byte_size: row.byte_size,
      blob_ref: row.blob_ref,
    };
    const keep = keepsReplaced(
      w.policy,
      row.updated_at,
      versions[0],
      w.at,
      w.checkpoint || pinned.has(row.revision),
    );
    const dropped = pastKeep(
      keep ? [replaced, ...versions] : versions,
      pinned,
      w.policy.keep,
    );
    const delta =
      w.size -
      (keep ? 0 : row.byte_size) -
      dropped.reduce((n, v) => n + v.byte_size, 0);
    if (
      w.cap > 0 &&
      delta > w.growth &&
      counted() + inFlight() + delta > w.cap
    ) {
      return { kind: "full" };
    }
    pointMap.run(w.ref, w.size, w.at.toISOString(), row.revision + 1, id);
    if (keep) {
      insertVersion.run(
        id,
        replaced.revision,
        replaced.blob_ref,
        replaced.byte_size,
        replaced.saved_at,
      );
    }
    for (const v of dropped) {
      deleteVersion.run(id, v.revision);
    }
    addUsage.run(delta);
    return {
      kind: "swapped",
      old: row,
      freed: [
        ...(keep ? [] : [row.blob_ref]),
        ...dropped.map((v) => v.blob_ref),
      ],
    };
  });

  /** Deletes the map's rows; the blobs to delete, or null for no map. */
  const deleteMapRows = db.transaction((id: string) => {
    const row = selectMap.get(id) as MapRow | undefined;
    if (!row) {
      return null;
    }
    const versions = selectVersions.all(id) as MapVersion[];
    deleteMapShares.run(id);
    deleteMapVersions.run(id);
    deleteMapRow.run(id);
    addUsage.run(
      -row.byte_size - versions.reduce((n, v) => n + v.byte_size, 0),
    );
    return [row.blob_ref, ...versions.map((v) => v.blob_ref)];
  });

  /** Inserts the token if its map, and its revision when it names one, exist. */
  const insertShareChecked = db.transaction((t: ShareToken): boolean => {
    const row = selectMap.get(t.map_id) as MapRow | undefined;
    if (!row) {
      return false;
    }
    if (
      t.revision !== null &&
      t.revision !== row.revision &&
      !selectVersion.get(t.map_id, t.revision)
    ) {
      return false;
    }
    insertShare.run(
      t.token,
      t.map_id,
      t.mode,
      t.expires_at,
      t.created_at,
      t.revision,
    );
    return true;
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
  const refCount = db.prepare(
    `SELECT 1 FROM maps WHERE blob_ref = ?
     UNION ALL SELECT 1 FROM map_versions WHERE blob_ref = ?`,
  );
  const isReferenced = (name: string) =>
    refCount.get(`blobs/${name}`, `blobs/${name}`) !== undefined;

  /** Streams one blob file; null when the file is gone. */
  async function readBlob(
    ref: string,
    revision: number,
  ): Promise<BlobRead | null> {
    let handle: fsp.FileHandle;
    try {
      handle = await fsp.open(blobPath(ref), "r");
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
      return { stream: handle.createReadStream(), size, revision };
    } catch (err) {
      await handle.close();
      throw err;
    }
  }

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
        revision: 1,
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
      // Refused before a byte is read; checked again in the swap.
      if (
        opts.ifRevision !== undefined &&
        existing.revision !== opts.ifRevision
      ) {
        throw new RevisionConflictError(existing.revision);
      }
      const cap = opts.maxTotalBytes ?? 0;
      const policy = opts.versions ?? NO_VERSIONS;
      const checkpoint = opts.checkpoint ?? false;
      // A write that may keep the old bytes may grow by all of its own.
      const growth =
        policy.keep > 0 || checkpoint
          ? body.size
          : Math.max(0, body.size - existing.byte_size);
      const written = await writeReserved(id, body, growth, cap);
      if (!written) {
        throw storageFull();
      }
      const at = opts.at ?? new Date();
      const swap = commitSwap.immediate(id, {
        ref: written.ref,
        size: body.size,
        at,
        reservation: written.reservation,
        growth,
        cap,
        ifRevision: opts.ifRevision,
        policy,
        checkpoint,
      });
      if (swap.kind !== "swapped") {
        await fsp.rm(blobPath(written.ref), { force: true });
        throw swap.kind === "full"
          ? storageFull()
          : swap.kind === "conflict"
          ? new RevisionConflictError(swap.revision)
          : new Error(`not found: ${id}`);
      }
      // A reader that opened an old file keeps reading it.
      for (const ref of swap.freed) {
        await fsp.rm(blobPath(ref), { force: true });
      }
      return {
        ...swap.old,
        blob_ref: written.ref,
        byte_size: body.size,
        updated_at: at.toISOString(),
        revision: swap.old.revision + 1,
      };
    },

    async createShareToken(mapId, expiresAt, revision = null) {
      if (!ID_RE.test(mapId)) {
        throw new Error(`not found: ${mapId}`);
      }
      const record: ShareToken = {
        token: nanoid(21),
        map_id: mapId,
        mode: "read",
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        created_at: new Date().toISOString(),
        revision,
      };
      if (!insertShareChecked.immediate(record)) {
        throw new Error(`not found: ${mapId}`);
      }
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
      return row ? readBlob(row.blob_ref, row.revision) : null;
    },

    async listVersions(id) {
      if (!ID_RE.test(id) || !selectMap.get(id)) {
        return null;
      }
      return (selectVersions.all(id) as MapVersion[]).map((v) => ({ ...v }));
    },

    async getVersionBlob(id, revision) {
      if (!ID_RE.test(id)) {
        return null;
      }
      const row = selectMap.get(id) as MapRow | undefined;
      if (!row) {
        return null;
      }
      if (row.revision === revision) {
        return readBlob(row.blob_ref, revision);
      }
      const version = selectVersion.get(id, revision) as
        | { blob_ref: string }
        | undefined;
      return version ? readBlob(version.blob_ref, revision) : null;
    },

    async deleteMap(id) {
      if (!ID_RE.test(id)) {
        return false;
      }
      const refs = deleteMapRows.immediate(id);
      if (refs === null) {
        return false;
      }
      for (const ref of refs) {
        await fsp.rm(blobPath(ref), { force: true });
      }
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
