<!-- ADR-0014-MARKER: collab-trust-model -->

# ADR-0014: Collaboration Trusts the Relay — Option C Made Permanent

- **Status:** Accepted. Implemented in roadmap waves W6 and W6b (2026-10-01); see "Implementation".
- **Date:** 2026-10-01
- **Supersedes:** ADR-0010's tables of what the relay can see, and its claim
  that comments are end-to-end encrypted. Also decides `code/decisions/0007-yjs-e2ee-threat-model.md`.
- **Amends:** ADR-0010 (Yjs E2EE threat model). This is the "Option C made
  permanent" decision block that ADR-0010's Phase 6 obligations asked for. It
  closes escalation E-01.
- **Relates to:** ADR-0008 (share-link encoding: the room key in the URL fragment)

## Context

ADR-0010 chose a server-trusted Yjs relay (Option C) for data layers in Phase 5,
kept scene and comments end-to-end encrypted over Socket.IO, and deferred the
choice between making C permanent and building an opaque log-replay relay
(Option B).

The collaboration audit of 2026-10-01 found that ADR-0010 no longer describes
the code:

- Comments travel over y-websocket in plaintext, not encrypted over Socket.IO.
- The only encrypted path carries the one-time join snapshot. Live scene
  updates, cursors and camera updates have no sender.
- The data-layer connection opens a bare WebSocket and never runs the Yjs sync
  protocol, so nothing syncs.
- The relay checks nothing: a socket can send into a room it never joined,
  under any sender id, and anyone who knows a room id can read and write its
  comments.

Live collaboration will be rebuilt on one Y.Doc per room (roadmap wave W6).
Before that, the trust model must be decided, because it decides whether the
server may read room content.

## Decision

The relay is trusted. Option C is permanent.

1. **One transport.** Each room has one Y.Doc over y-websocket, holding
   elements (keyed by id, geo anchor as truth), file references, layers,
   metadata and comments. Presence uses Yjs awareness.
2. **The relay can read everything in a room doc.** Operators can see room
   content, as they can see a stored map today. Self-host docs state this in a
   "What the relay can see" section.
3. **The link key is the capability, not the room id.** The client derives a
   room access token from the fragment key (one-way derivation with a fixed
   label) and presents it on connect. The relay accepts a connection only with
   the token that matches the room. A room id alone, seen in a log or a URL
   path, grants nothing.
4. **The server may persist rooms.** Room docs, including comments, persist to
   storage, so a review that runs over days keeps its comments. (As built, the
   relay keeps them in its own SQLite file, not the storage server: ADR-0018.)
5. **Delete what Option B kept alive.** When W6 lands, delete the Socket.IO
   relay, `apps/atlas-app/src/collab/scene-crypto.ts` and the unused stub
   `packages/data/src/yjs-crypto.ts`.

## Consequences

- Comments, late-joiner catch-up, undo and persistence all come from Yjs; there
  is no custom sync protocol to maintain.
- Privacy against the operator depends on who runs the relay. A user who needs
  it runs their own deployment, which is the self-host posture (ADR-0013).
- ADR-0010's tables "What the Phase 5 relay can see" and its claim that comments
  are end-to-end encrypted are superseded by this ADR. Before W6, comments
  were plaintext to the relay and readable by anyone who knew the room id; W6
  closed that (see "Implementation").

## Alternatives considered

**Option B, an opaque log-replay relay with end-to-end encryption.** Rejected:
the server could not persist or compact rooms, so comments could not outlive
the session without client-side storage, and it needs a custom replacement for
the Yjs sync protocol. Reopen only on real demand from deployments that cannot
trust their own operator.

## Implementation (W6, 2026-10-01)

Every point of the decision is in the code:

- **One transport.** `apps/realtime/src/rooms.ts` serves one Y.Doc per room
  over the y-websocket protocol at `/yjs/<roomId>`. The client is
  `apps/atlas-app/src/state/room.ts` (`joinRoom`). The Socket.IO relay, its
  rate limiter and Redis adapter, `collab/scene-crypto.ts` and
  `packages/data/src/yjs-crypto.ts` are deleted.
- **The link key is the capability.** The client derives the room token
  with HKDF-SHA256 (salt: the room id; info: `atlasdraw-room-auth`) from the
  32-byte secret in the fragment (`packages/protocol/src/room-link.ts`) and
  sends it as the first WebSocket message, never in the URL, so proxy access
  logs hold only the room id. The first connection to a room stores
  SHA-256(token) as its verifier; any other token is closed with code 4403.
- **Rooms persist** in the relay's SQLite file (ADR-0018), comments with
  them.

- **Undo stays Excalidraw's.** A collaborator's change reaches the editor
  with `CaptureUpdateAction.NEVER`, so Excalidraw's history holds only this
  user's own changes, as per-element deltas. An undo is then a new local
  edit with a higher version, and it reaches the room like any other edit.
  A `Y.UndoManager` would duplicate that history and would need Excalidraw's
  undo actions rerouted inside the fork.
- **Conflicts** resolve per element as Excalidraw's reconcile does: the
  higher `version` wins, then the lower `versionNonce`
  (`apps/atlas-app/src/state/roomScene.ts`).
- **A room doc is untrusted input** (W6b). The token admits a client; it
  does not make what the client writes valid. Every record read from the
  room doc goes through `apps/atlas-app/src/state/roomValidation.ts` before
  the editor, the Document or the map sees it. A record that fails is
  skipped, logged once per peer, and left in the room for clients that can
  read it. The relay limits abuse of its memory and disk (SECURITY.md
  row 14).

### What the relay can see

Everything in the room doc, in plaintext, and so can anyone who reads the
relay's SQLite file:

| Data                                                              | Visible to the relay                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Every drawn element, with its scene (world) coordinates           | Yes                                                        |
| Pasted images (data URLs) and raster images (PNG bytes)           | Yes                                                        |
| Data layers (GeoJSON), tile layer URLs, layer names and styles    | Yes                                                        |
| Title, world frame, basemap, the camera the room was made at      | Yes                                                        |
| Comments: text, author name, anchor (lng/lat or element id)       | Yes                                                        |
| Presence: each person's name, colour, cursor (lng/lat) and camera | Yes, while they are connected; not stored                  |
| The room id, connection times, message sizes                      | Yes                                                        |
| The link secret                                                   | No: the fragment never leaves the browser                  |
| The room token                                                    | Yes, in memory during a connection; stored only as SHA-256 |

The room id alone grants nothing: it appears in URLs and logs, and the relay
refuses a connection that does not present the room's token.
