// SPDX-License-Identifier: AGPL-3.0-only
//
// Where rooms are kept between sessions: one SQLite table, one row per room.
// A row holds the room's access verifier and the whole Y.Doc state as one
// Yjs update. Writing the whole state each time is also the compaction.
// ADR-0018 records why SQLite and not the storage server or LevelDB.

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
  close(): void;
}

/**
 * A store in the SQLite file at `path`. ":memory:" gives a store that
 * lasts as long as the process, for tests.
 */
export function sqliteRoomStore(path: string): RoomStore {
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
  const select = db.prepare<[string], { verifier: string; state: Buffer }>(
    "SELECT verifier, state FROM rooms WHERE name = ?",
  );
  const upsert = db.prepare<[string, string, Buffer, number]>(
    `INSERT INTO rooms (name, verifier, state, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state,
       updated_at = excluded.updated_at`,
  );
  return {
    load(room) {
      const row = select.get(room);
      return row
        ? { verifier: row.verifier, state: new Uint8Array(row.state) }
        : null;
    },
    save(room, stored) {
      upsert.run(room, stored.verifier, Buffer.from(stored.state), Date.now());
    },
    close() {
      db.close();
    },
  };
}
