<!-- ADR-0020-MARKER: server-version-history -->

# ADR-0020: The Server Keeps a Map's Versions; Saves Name the Revision They Replace

- **Status:** Accepted. Implemented in roadmap wave R8b (2026-10-01).
- **Date:** 2026-10-01
- **Amends:** ADR-0017 (maps carry a write key), points 3 and 5
- **Relates to:** `SECURITY.md` rows 12 and 26, the product audit
  (`audit2-08-product.md` P6)

## Context

ADR-0017 made a share link follow the map: every save reaches every link and
embed. That was the promise, and it had two costs.

1. **A bad save is final.** The server kept only the latest bytes. A save
   that broke the map went to every live embed, and nothing could roll it
   back.
2. **Two browsers overwrite each other.** The owner's key may be in two
   browsers. Each one saved over the other without knowing, and the map
   showed whichever saved last.

And the owner's control was fragile. The maps and their write keys lived only
in one browser's IndexedDB. The app never asked the browser to keep that
storage, and WebKit deletes it after seven days without a visit. A cleared
browser lost the ability to change, share or stop every published map.

## Decision

1. **A map counts revisions.** It is revision 1 when made; each save adds
   one. Every save answers its revision, also as the ETag `"<n>"`.
2. **A save may name the revision it replaces** in `If-Match: "<n>"`. The
   server checks it before it reads a byte, and again in the transaction that
   swaps the bytes. If the map is at another revision, the answer is `412`
   with the map's revision, and nothing is stored. Of two saves from one
   revision, the first to finish lands. No `If-Match`, or `*`, does not
   check, so an older client keeps working.
3. **The server keeps earlier bytes as versions.** When a save replaces
   bytes, they stay as a version if they are a resting point: they stood for
   `MAP_VERSION_INTERVAL_MINUTES` (10) or longer, or they came that long after
   the newest kept version, or there is no kept version yet. The editor saves
   every few seconds, so "keep every save" would fill the history with
   seconds of work. The oldest past `MAP_VERSIONS_KEPT` (20) go. The rule is
   one module, `apps/storage/src/versions.ts`, which both adapters call
   inside the swap transaction.
4. **Versions count against `MAX_TOTAL_BYTES`.** A save that may keep the
   old bytes reserves its whole size. A save that does not fit is `507`,
   as before.
5. **Only the write key reads versions.** `GET /maps/:id/versions` lists
   them; `GET /maps/:id/versions/:n/blob` reads one. A share token reads no
   version but the one its link shows.
6. **A restore is a new revision, never a rewrite.** The client reads a
   version and saves it with `PUT /maps/:id?checkpoint=1`. A checkpoint keeps
   the bytes it replaces whatever their age, so the owner can go back again.
7. **A link can be frozen on one revision.** `POST /maps/:id/share` takes
   `{"revision": n}`: the link shows that version and no later one. The
   check and the insert are one transaction, so no save can prune the
   version between them. A version a link reads is never pruned and does not
   count toward `MAP_VERSIONS_KEPT`, even when the history is off.
8. **The client asks; it never chooses.** It sends the revision it last saw.
   A `412` stops its uploads and asks the owner: **Save my version** saves
   over the other browser's revision, which the server keeps as a version.
   A refused map (`401`, `403`, `404`) asks too: **Save a new server copy**
   (F19). Before this, a refusal showed only "Couldn't sync".
9. **Ownership is portable.** My maps offers **Back up my maps**: one JSON
   file with every map's `.atlasdraw` bytes and the id and key of each server
   map. **Restore a backup** adds them to a browser and replaces nothing. The
   app asks the browser to keep its storage (`navigator.storage.persist()`)
   once, after the first save.

## Why not keep every save

At one save every few seconds, 20 versions would cover a minute of drawing,
not a day. Thinning by time keeps one version per interval of a long session
and the state before each pause. A checkpoint and a frozen link are the
owner saying "this one", so they are kept whatever the interval says.

## Why a JSON backup, not a zip

The `.atlasdraw` bytes are already compressed, so a zip saves little, and the
app does not depend on a zip library (only `@atlasdraw/data` does). Base64url
adds a third to the size. A backup is rare and local, so that is acceptable.

## Consequences

- A bad save can be undone from **Server versions…**, and a restore can be
  undone the same way.
- Two browsers no longer overwrite each other in silence. The cost is a
  question for the owner when they do.
- Storage grows: up to `MAP_VERSIONS_KEPT` earlier copies of each map, plus
  the versions frozen links read. They count against `MAX_TOTAL_BYTES`.
  `MAP_VERSIONS_KEPT=0` turns the history off.
- A version kept for a frozen link stays after the link is revoked or
  expires, until the map's next save prunes it.
- The backup file holds write keys. Anyone with it can change and delete the
  owner's server maps (`SECURITY.md`, accepted risks).

## As built

- Migration `005_map_versions`: `maps.revision`, `share_tokens.revision`,
  table `map_versions (map_id, revision, blob_ref, byte_size, saved_at)`.
- `apps/storage/src/versions.ts` (the rule), both adapters
  (`adapters/sqlite-fs.ts`, `adapters/postgres-minio.ts`), the contract tests
  in `adapters/adapter-contract.test.ts`, which run against SQLite and against
  real Postgres and an S3 server.
- Routes: `routes/maps.ts` (`If-Match`, `ETag`, `?checkpoint=1`),
  `routes/versions.ts`, `routes/share.ts` (`revision`).
- Client: `services/createHttpStorageClient.ts`,
  `state/remoteMapIdCache.ts` (the revision per document, `412` and refusal
  handling), `state/myMaps.ts` (restore and open a copy),
  `components/ServerVersionsDialog.tsx` (File → **Server versions…**, which
  replaces **Restore from server backup**), the Share dialog's "Read-only
  link shows: Each new save / This version only", `state/backup.ts` and the
  My maps footer, and `hooks/usePersistenceWiring.ts` (the questions and the
  storage request).
