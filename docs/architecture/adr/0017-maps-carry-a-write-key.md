<!-- ADR-0017-MARKER: maps-carry-a-write-key -->

# ADR-0017: Maps Carry a Write Key; Share Links Last and Follow the Map

- **Status:** Accepted. Implemented in roadmap wave W8 (2026-10-01).
  Amended by ADR-0020 (points 3 and 5).
- **Date:** 2026-10-01
- **Supersedes:** the TTL in `code/decisions/0008-share-token-ttl.md` (7 days as built)
- **Relates to:** ADR-0013 (self-host only), `SECURITY.md` rows 10–13

## Context

The storage API has no accounts (ADR-0013). Before this decision, the map id
was the only write capability: `PUT /maps/:id` needed nothing else. A
read-only share link once leaked that id (SECURITY.md row 10), so a reader
could overwrite the map. Deleting that route closed the leak. It did not give
the owner a capability of their own.

Share tokens died after 7 days, and an embed is a share link. The PRFAQ
promises embeds that last. Every upload share made a new map, so a link never
showed a later edit, and nothing ever deleted the old maps.

The server backup could not be read back: no route returned a map's bytes to
its owner.

## Decision

1. **A map has a write key.** `POST /maps` makes 32 random bytes (base64url)
   and returns them once, as `write_key`. The server stores only the SHA-256
   and compares in constant time. A random 256-bit key needs no slow hash.
2. **Every owner action shows the key** in `Authorization: Bearer <key>`:
   `PUT /maps/:id`, `GET /maps/:id/blob` (the backup), `POST /maps/:id/share`
   and `DELETE /maps/:id/share/:token`. No header is 401; a wrong key is 403.
   `GET /maps/:id` is deleted: nothing needed the record.
3. **A share token is read-only and reads the latest bytes.** It never works
   as a key. A save updates every link and embed made from the map.
4. **A share token lasts until it is revoked.** The owner can ask for an
   expiry (`{"expires_in_days": n}`, 1 to 3650).
5. **The client keeps one server map per document** with its key
   (`remoteMapIdCache.ts`). The autosave and the share use that one map.
6. **A map stored before write keys gets no key.** Nobody can write it. It
   lives while a share token reads it; the sweep deletes it after the last one
   expires. The client makes a new map with a key at the next save.

## Why not give old maps a key

The only thing an old client holds is the map id, and the id leaked through
share links before row 10 was fixed. A "claim with the id" step would hand the
key to whoever claims first, maybe the person who had the leaked id. No key is
the safe default: the owner's next save makes a new map, and old links keep
working until they expire.

## Consequences

- A link or embed is durable, and an edit reaches it.
- The key is a bearer secret in the browser's IndexedDB. A script on the app's
  origin can read it; a link holder cannot. Losing the browser's storage
  loses write access, not the map: the links still read it.
- `POST /maps` stays open to anyone who reaches the API. `MAX_TOTAL_BYTES`
  caps the total stored size. A map with a key is never collected, because
  its owner may return.
- `infra/smoke-minimal.sh` walks the key flow.

## As built

- `apps/storage/src/routes/write-key.ts` reads the key; `routes/maps.ts` and
  `routes/share.ts` use it. Migration `003_write_keys_and_lasting_links` adds
  `maps.write_key_hash` and makes `share_tokens.expires_at` nullable.
- W7a added `DELETE /maps/:id` (write key): it removes the map, its links and
  its bytes.
- The client keeps the key in IndexedDB (`atlasdraw-autosave`), beside the
  server map id (`apps/atlas-app/src/state/remoteMapIdCache.ts`). The main
  menu offers **Restore from server backup**, which reads `GET /maps/:id/blob`.
- The Share dialog offers "Until you stop it", 7 days or 30 days, and
  **Stop sharing this link**.

## Amended by ADR-0020 (2026-10-01)

`docs/architecture/adr/0020-server-version-history.md` changes two points.

- **Point 3:** a share token reads the latest bytes unless the owner freezes
  it on one revision (`{"revision": n}`). A frozen link does not follow later
  saves.
- **Point 5:** the client keeps the revision it last saw beside the key, and
  each save names it in `If-Match`. A save that another browser overtook is
  refused (`412`) and the owner is asked.

**Restore from server backup** is now **Server versions…**: the owner can go
back to any kept version, not only the latest. "Losing the browser's storage
loses write access" is no longer the only outcome: **Back up my maps** keeps
the keys in a file the owner holds.
