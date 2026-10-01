<!-- ADR-0018-MARKER: rooms-persist-in-relay-sqlite -->

# ADR-0018: The Relay Keeps Rooms in Its Own SQLite File

- **Status:** Accepted. Implemented in roadmap waves W6 and W6b (2026-10-01).
- **Date:** 2026-10-01
- **Relates to:** ADR-0014 (the relay is trusted; rooms persist), ADR-0017
  (maps carry a write key)

## Context

ADR-0014 lets the relay keep rooms, so a review that runs over days keeps its
comments. A room is one Y.Doc (W6). The relay needs a place to put it when the
last person leaves, and it must find it again when someone comes back, also
after a restart.

A room also has an access verifier: SHA-256 of the room token that the first
client presented. The verifier must last exactly as long as the room. If the
room content outlived its verifier, the next client to arrive with any token
would claim the room and read it.

Three places were possible:

1. **The storage server's API.** The relay would POST each room's bytes to
   `apps/storage`.
2. **LevelDB in the relay** (`y-leveldb`, which y-websocket's own server
   uses). It keeps every update as a row and compacts later.
3. **SQLite in the relay** (`better-sqlite3`). One row per room: the
   verifier and the whole doc state as one Yjs update.

## Decision

SQLite in the relay. `apps/realtime/src/room-store.ts` holds one table,
`rooms(name, verifier, state, updated_at)`. The file is `ROOMS_DB`
(`/data/rooms.sqlite` in the image, a `roomsdata` volume in compose).

- A room's row is written when the first client claims it (verifier and an
  empty state), then 2 s after an edit, and when the last client leaves.
  Then the room leaves memory: eviction happens only at zero connections.
- Each write stores the whole state (`Y.encodeStateAsUpdate`). That is also
  the compaction: there is no update log to grow.
- The verifier is written once and never changes.
- A room never grows past `MAX_ROOM_BYTES` (64 MiB, protocol
  `ROOM_SIZE.roomBytes`). The relay checks every update before it applies
  it: one that would take the room past the cap closes its socket with 4413
  "room too large: N > cap", and the room in memory keeps its state. (Until
  2026-10-01 the check ran only at save, 2 s after the edit, so a room
  reached 5x the cap in memory first.) The save keeps its own check as a
  second guard.

## Why not the others

**The storage server** would make the relay a client of an API that has no
service identity: the relay would need its own write key per room (ADR-0017)
or a new trusted channel, and a room could not open while storage is down.
The two services would share a failure for no gain: nothing else reads a
room.

**LevelDB** stores updates as rows and needs compaction; the verifier would
be a second key that a crash between two writes could separate from the
content. `leveldown` is a native module as `better-sqlite3` is, so it saves
no build step. SQLite writes the verifier and the state in one row, in one
statement, and `better-sqlite3` is already built for `apps/storage`.

## Consequences

- One relay process per deployment. Two relays on one file would each hold
  their own copy of a live room and overwrite each other. The Socket.IO
  Redis adapter, which promised several instances, is deleted.
- Backups of the relay are a copy of one file (with SQLite's WAL files).
- The operator can read every room in the file (ADR-0014, "What the relay
  can see").
- A room nobody was in for `ROOM_EXPIRY_DAYS` (default 90) is deleted by a
  sweep on `updated_at`, at start and every `ROOM_SWEEP_INTERVAL_MS`. A
  room is saved when its last connection closes, so `updated_at` is also
  when someone was last in it, unless that save was refused at
  `MAX_TOTAL_ROOM_BYTES`: then it is the last good save, and a room in use
  can expire. A room in memory is never swept. The id of a
  deleted room is free again: its old link makes a new, empty room.
- `MAX_TOTAL_ROOM_BYTES` caps the file's room states together (W6b,
  SECURITY.md row 14).
