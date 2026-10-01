// SPDX-License-Identifier: AGPL-3.0-only
//
// Where rooms are kept between sessions: one SQLite table, one row per room.
// A row holds the room's access verifier and the whole Y.Doc state as one
// Yjs update. Writing the whole state each time is also the compaction.
// ADR-0018 records why SQLite and not the storage server or LevelDB.
//
// `updated_at` is the time of the last save. The relay saves a room when its
// last connection closes, so for a room not in memory it is also the last
// time anyone was in it. The expiry sweep reads it.

import Database from "better-sqlite3";

/** One stored room. */
export interface StoredRoom {
  /** SHA-256 (hex) of the access token the room was created with. */
  readonly verifier: string;
  /** Y.encodeStateAsUpdate of the room doc; empty for a room with no edits. */
  readonly state: Uint8Array;
}

export interface RoomStore {
  load(room: string): StoredRoom | null;
  save(room: string, stored: StoredRoom): void;
  /** The bytes of the stored state of `room`; 0 when there is none. */
  bytesOf(room: string): number;
  /** The bytes of every stored room state together. */
  totalBytes(): number;
  /**
   * Delete every room last saved before `cutoff` (ms since the epoch),
   * except those in `keep`. Returns the names of the deleted rooms.
   */
  sweep(cutoff: number, keep: ReadonlySet<string>): string[];
  close(): void;
}

export interface RoomStoreOptions {
  /** The clock for `updated_at`. Tests move it by hand. */
  now?: () => number;
}

/**
 * A store in the SQLite file at `path`. ":memory:" gives a store that
 * lasts as long as the process, for tests.
 */
export function sqliteRoomStore(
  path: string,
  options: RoomStoreOptions = {},
): RoomStore {
  const now = options.now ?? Date.now;
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(
    `CREATE TABLE IF NOT EXISTS rooms (
       name TEXT PRIMARY KEY,
       verifier TEXT NOT NULL,
       state BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms (updated_at)");
  const select = db.prepare<[string], { verifier: string; state: Buffer }>(
    "SELECT verifier, state FROM rooms WHERE name = ?",
  );
  const selectBytes = db.prepare<[string], { bytes: number }>(
    "SELECT length(state) AS bytes FROM rooms WHERE name = ?",
  );
  const upsert = db.prepare<[string, string, Buffer, number]>(
    `INSERT INTO rooms (name, verifier, state, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state,
       updated_at = excluded.updated_at`,
  );
  const stale = db.prepare<[number], { name: string; bytes: number }>(
    "SELECT name, length(state) AS bytes FROM rooms WHERE updated_at < ?",
  );
  const remove = db.prepare<[string]>("DELETE FROM rooms WHERE name = ?");

  const bytesOf = (room: string): number => selectBytes.get(room)?.bytes ?? 0;
  // One relay process per file (ADR-0018), so a running total stays exact.
  let total =
    db
      .prepare<[], { total: number | null }>(
        "SELECT sum(length(state)) AS total FROM rooms",
      )
      .get()?.total ?? 0;

  return {
    load(room) {
      const row = select.get(room);
      return row
        ? { verifier: row.verifier, state: new Uint8Array(row.state) }
        : null;
    },
    save(room, stored) {
      const before = bytesOf(room);
      upsert.run(room, stored.verifier, Buffer.from(stored.state), now());
      total += stored.state.byteLength - before;
    },
    bytesOf,
    totalBytes: () => total,
    sweep(cutoff, keep) {
      const deleted: string[] = [];
      db.transaction(() => {
        for (const row of stale.all(cutoff)) {
          if (keep.has(row.name)) {
            continue;
          }
          remove.run(row.name);
          total -= row.bytes;
          deleted.push(row.name);
        }
      })();
      return deleted;
    },
    close() {
      db.close();
    },
  };
}
