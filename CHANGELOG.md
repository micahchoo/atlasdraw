# Changelog

All notable changes to Atlasdraw are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Atlasdraw
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The 2026-10 roadmap. It closes a write hole in share links, makes links and
rooms durable, moves drawings to world coordinates, and adds the map basics
that 1.0 lacked. Read "Upgrade" before you deploy it.

### Upgrade

Back up the storage volume and, if you run it, the relay before you start
the new images. Then:

1. **Remove old environment variables.** The servers ignore them:
   `MANAGED_MODE`, `QUOTA_FREE_MAPS`, `QUOTA_PRO_MAPS`, `STRIPE_*`,
   `SITE_URL`, `VITE_MANAGED_MODE` (managed mode), and `CORS_ORIGIN` and
   `REDIS_URL` (the old Socket.IO relay).
2. **Minimal stack: use port 3000 only.** The storage server is no longer
   published on `4000`. The web container's nginx serves it on the same
   origin at `/api`, so the health check is
   `curl http://localhost:3000/api/health`.
3. **Full stack with the relay: add the `roomsdata` volume.** The relay now
   saves rooms to SQLite at `/data/rooms.sqlite`. The new
   `infra/docker-compose.yml` declares the volume.
4. **Check the storage limits.** `MAX_TOTAL_BYTES` now defaults to 10 GiB,
   and each client address may make 60 new maps an hour
   (`MAX_NEW_MAPS_PER_IP`). `POST /maps` is open to anyone who reaches the
   API. The relay has its own caps with defaults
   (`docs/self-host/production.md`, "Realtime relay").

What happens by itself:

- **Files move to format version 2.** A version 1 `.atlasdraw` file, autosave
  or hash link is migrated when it opens: each drawn element moves from
  screen pixels to world coordinates. The next save writes version 2. An older
  build cannot open a version 2 file.
- **Maps saved on the server before write keys become read-only.** Migration
  `003_write_keys_and_lasting_links` gives them no key, so nobody can write
  them. The owner's browser creates a new map with a key at its next save.
  The server does not let anyone claim a key for an old map, because its id
  may have leaked (SECURITY.md row 10).
- **Those old maps are kept for `LEGACY_MAP_GRACE_DAYS` (default 90) after
  the upgrade.** Then the sweep deletes each one that no live share link
  reads, with its blob. Their share links still work until their 7-day
  expiry. Set a longer grace before the first start if you want to keep the
  copies on the volume longer; `0` deletes them at the first sweep.
- **The storage schema migrates at start.** It drops the `workspace_id`
  columns and the `workspaces` table, adds the size counter
  (`storage_usage`, `storage_reservations`), and records each step in
  `schema_migrations`. Every map and share link stays through the
  migration; only the sweep above removes old maps, after the grace.
- **The size cap is on by default: 10 GiB** (`MAX_TOTAL_BYTES`). A server
  that holds more than that already refuses new maps and growing saves (507)
  until you raise it or set `0` for no cap.
- **The browser's autosave moves to one slot per map.** The old single slot
  opens on the next reload and moves at the next save.
- **Rooms start empty.** The old relay kept nothing after the last person
  left, so there is nothing to carry over.

A script that calls the storage API must now keep the `write_key` from
`POST /maps` and send it as `Authorization: Bearer <key>`.
`infra/smoke-minimal.sh` shows the flow.

### Security

- **A share link no longer gives write access.** `GET /share/:token`
  returned the map id, and the id was enough to overwrite the map. The route
  is deleted (SECURITY.md row 10).
- **Maps carry a write key** (ADR-0017). `POST /maps` returns `write_key`
  once; the server stores its SHA-256. `PUT /maps/:id`, `DELETE /maps/:id`,
  `GET /maps/:id/blob`, `POST /maps/:id/share` and
  `DELETE /maps/:id/share/:token` need `Authorization: Bearer <key>`. No key
  is 401; a wrong key is 403 (row 12).
- **A room link's key is the capability** (ADR-0014). The client derives a
  room token from the link secret and sends it as the first WebSocket
  message. The relay keeps SHA-256 of the first token per room and closes any
  other with 4403. The room id must be a UUID (row 3).
- **The editor checks every record it reads from a room.** Anyone with the
  link can write the room doc, so each record is validated before the editor
  uses it (`state/roomValidation.ts`).
- **Abuse limits.** Storage: `MAX_TOTAL_BYTES` (507 past it), and
  `TRUST_PROXY` (default off), so a client cannot forge its address past the
  per-IP rate limit (rows 11, 13). Relay: total stored bytes, new rooms per IP per hour,
  connections per IP, connections per room, message and room size, and room
  expiry (row 14).

### Added

- **World coordinates** (ADR-0015). A drawing is stored in Web Mercator pixels
  at zoom 22 from the document's origin. A camera move writes no element, so
  undo after a pan, autosave and collaboration no longer see false changes.
  Pinch zoom on touch screens drives the map; Ctrl+0 frames the drawing.
- **Live rooms on one Y.Doc per room** (ADR-0014, ADR-0018). The drawing,
  layers, title, comments and presence sync through the relay over
  y-websocket. The relay saves each room to SQLite and deletes a room nobody
  opened for `ROOM_EXPIRY_DAYS` (90). A person can set a display name in the
  presence list.
- **Share links last and follow the map.** A server link lives until its
  owner chooses "Stop sharing", unless the owner chose a 7- or 30-day expiry.
  It shows the map's latest save, so an edit updates every link and embed.
  The client shares the document's own server map instead of a new copy.
- **One read-only viewer** for `/m` (with a title and an "open a copy" link)
  and `/embed` (no chrome). It shows the basemap, data, raster and tile
  layers and the drawing at the saved camera.
- **My maps**: the maps saved in this browser, to open or remove, and
  **Restore from server backup**.
- **Import KML, KMZ and GPX.** A file with mixed geometry becomes one layer
  per kind. `.json` GeoJSON is accepted.
- **Measure** distance and area on the ellipsoid, and a readout of the
  selected shape's length, area and radius.
- **Feature popups**: a click on a feature shows its attributes, in the
  editor and in an unlocked embed.
- **Tile layers** from an XYZ URL, with a credit in the status bar and in
  exports.
- **Labels from a property and a filter by property** for data layers.
- **Export a data layer** as GeoJSON or CSV from its menu; the GeoJSON export
  can include data layers. CSV text never starts a spreadsheet formula.
- **PNG export at 1x, 2x or 3x.**
- **`DELETE /maps/:id`** removes a map, its links and its bytes (write key).
- **Storage:** `MAX_TOTAL_BYTES`, `SWEEP_INTERVAL_MS`, `TRUST_PROXY`.
  **Relay:** `ROOMS_DB`, `MAX_ROOMS`, `MAX_ROOM_SIZE`, `MAX_MESSAGE_BYTES`,
  `MAX_ROOM_BYTES`, `MAX_TOTAL_ROOM_BYTES`, `MAX_NEW_ROOMS_PER_IP`,
  `MAX_CONNECTIONS_PER_IP`, `ROOM_EXPIRY_DAYS`, `ROOM_SWEEP_INTERVAL_MS`,
  `TRUST_PROXY`.
- **CI gates**: typecheck, ESLint, Prettier, a check that every test can
  fail, Vitest, the storage adapter against a real Postgres, a benchmark
  regression gate and chromium end-to-end tests.

### Changed

- **The editor reads every `VITE_*` variable through one schema**
  (`config/app-config.ts`). A bad value stops the app at boot and names the
  variable. Every link the app makes works under the build's base path.
- **Blob writes are atomic.** The SQLite and file adapter writes a temporary
  file, flushes it and renames it.
- **One owner for the storage schema.** Both adapters apply
  `apps/storage/src/db/migrations.ts` at start. The Postgres adapter retries a
  failed schema setup instead of failing every request until a restart.
- **The PDF and PNG panes say what the file holds.** The PDF is a page with a
  map image, a legend and a scale; it was called a "vector document".
- **One list of commands** feeds the main menu, the Ctrl+K palette, the
  keys and the keyboard shortcuts panel, so the four agree. The palette now
  holds every command (Import data, Settings, Clear the drawing, the zoom
  commands and more). Ctrl+K opens the palette with a shape selected too.
- **The basemap belongs to the map.** It is saved with the map and follows
  a room; your own map keeps its basemap when you leave a room.
- **"Clear the drawing" asks first and keeps the layers.** Undo brings the
  shapes back. It was the drawing editor's own reset.
- **Ctrl+Arrow no longer adds a flowchart node.** The node landed on the
  shape at map scale and its arrow had no head. The key moves the selection
  like an arrow key.
- **`?` in the viewer (`/m`, `/embed`) opens nothing.** The viewer has no
  editing keys to explain.
- **The page frame painted before the app loads** is the editor's collar,
  or the viewer's head bar, so the page does not change shape at mount.

### Removed

- **Managed (hosted) mode** (ADR-0013): workspaces, quotas, Stripe billing,
  `/api/workspaces`, `/api/billing/*`, the `X-Workspace-ID` header, the
  workspace switcher and the `/billing` page. No managed-mode flow worked end
  to end, and the mode enforced no tenant isolation. Atlasdraw is self-host
  only, one trusted tenant per deployment.
- **The Socket.IO relay**, its Redis adapter and the end-to-end encrypted
  scene channel. Rooms are not end-to-end encrypted: the relay can read them
  (ADR-0014, "What the relay can see").
- **`GET /maps/:id` and `GET /share/:token`.** The owner reads the bytes with
  `GET /maps/:id/blob`; a link holder with `GET /share/:token/blob`.
- **`packages/sdk`**, a stub that nothing imported (ADR-0016).
- **Upstream Excalidraw features that mean nothing on a map**: the frame,
  embeddable, laser and magic-frame tools, Mermaid and text-to-diagram, every
  locale except English, and the upstream image export and `.excalidraw`
  save. Old documents with those element types still load (`VENDOR.md`).
- **The `ShareView` component.** `/m` uses the same viewer as `/embed`.
- **"Edit style" (Maputnik) and `VITE_MAPUTNIK_URL`.** The dialog sent
  Maputnik a `/styles/…` URL that no server serves, and Maputnik could not
  send an edit back. The basemap is chosen in the Layers panel.
- **The Settings "Basemap" tab.** The Layers panel is the one basemap
  picker.

## [1.0.0] — 2026-05-15

First standalone-app release. Atlasdraw is a collaborative web map studio
combining an Excalidraw drawing surface with a MapLibre basemap. The 1.0
release ships the FOSS standalone app (self-host or local-only) plus the
optional maintainer-hosted SaaS overlay.

### Phase 6 — this release

- **Anchored comments.** Per-room second `Y.Doc` carrying comment threads
  anchored to either a MapLibre coordinate or an Excalidraw element id.
  CRDT-merged the same way scene state is. UI: `CommentsPanel` +
  inline `CommentAnchor` markers.
- **Maputnik integration.** Modal dialog hosts the public (or self-hosted)
  Maputnik editor against the active basemap style URL; round-trips style
  edits back into `@atlasdraw/basemap`.
- **Categorical + graduated layer styling.** Style compiler extended with
  `expression: { kind: "categorical" | "graduated", property, stops }` —
  deterministic MapLibre expression output. New `StylePanel` +
  `ColorRampPicker` UI.
- **Photon geocoder client.** Fetch-based, LRU-cached, **opt-in by
  configuration** (`VITE_GEOCODER_ENDPOINT` empty by default, no
  call-home). Wired into the existing CSV reader's address column.
- **Print-to-PDF.** `pdf-lib`-based layout panel; exports the current
  map + scene at chosen page size + dpi.
- **Excalidraw asset library.** `.excalidrawlib` reader and curated
  fixture set; `AssetLibraryPanel` UI.
- **Workspace abstraction.** `WorkspaceId` plumbed through every storage
  route. Self-host operators get the foundation; default single-workspace
  behaviour is preserved.
- **Hosted-mode (managed) overlay.** Opt-in via `MANAGED_MODE=true`
  on the storage server + `VITE_MANAGED_MODE=true` on the atlas-app.
  Adds: per-workspace Stripe billing (Pro tier), per-workspace
  map-count quotas (free=3, pro=100 by default; configurable via
  `QUOTA_FREE_MAPS` / `QUOTA_PRO_MAPS`), `WorkspaceSwitcher`
  dropdown, `BillingPage` route. ADR-0011 governs telemetry: hosted
  mode emits server-side `pino` operational events only — no client
  beacon, Stripe holds billing PII. Self-host is unaffected; quota
  middleware short-circuits as a no-op when `MANAGED_MODE=false`.
- **Accessibility pass.** `@react-aria/focus` keyboard nav + focus
  management across modals; `@react-aria/announce` hidden aria-live
  region for screen-reader announcements.

### Phase 5 — recap

- Real-time collaboration via Y.Doc + Socket.IO. Per-room CRDT;
  end-to-end encrypted scene payloads with 32-byte room keys carried
  in the URL fragment.
- Snapshot election (Q-P5-1, joiner-pull): joiners request a snapshot
  from existing peers; the relay elects the first responder within a
  5-second window, falling back to retry on disconnect.
- Share URL convention (Q-P5-2): `#room:<roomId>,<base64url-key>` —
  the `room:` prefix is mandatory and gates write-capable collab.

### Phase 4 — recap

- Self-host MVP. Two storage adapters: `sqlite-fs` (minimal stack) and
  `postgres-minio` (full stack). Docker Compose stack with optional
  `realtime` profile. Share links (read-only / read-write).

### Phase 3 — recap

- `.atlasdraw` file format (versioned zipped JSON + assets).
- Data readers: CSV, GeoJSON, Shapefile via `packages/data`. (KML/GPX
  remain unimplemented planned adapters.)

### Notable decisions

- **Q-P5-1** — Snapshot election strategy (joiner-pull, 5s window,
  retry on disconnect). `docs/decisions/phase-5-research-notes.md`.
- **Q-P5-2** — Room URL convention: `#room:` prefix mandatory; read-only
  share view (`/m`) never grants write capability even when a `#room:`
  fragment is present.
- **Q-P6-1** — Phase 6 scope cut. v1.0 ships the standalone app only.
  No AtlasdrawAPI, no Embed SDK, no Felt importer, no `packages/sdk`
  surface freeze. `docs/decisions/phase-6-research-notes.md`.

### Out of scope for 1.0 (explicit)

- **AtlasdrawAPI / SDK / embed widget.** Cut per Q-P6-1. There is no
  third-party automation surface in v1.0 and no commitment to one in
  the immediate roadmap.
- **Felt importer.** Cut per Q-P6-1. Atlasdraw is inspired by Felt; it
  is not a Felt-compatible product.
- **Phase 7 plugin sandbox.** Flagged for revision; see seeds issue
  `atlasdraw-c547`.

### Migration notes for self-hosters

- New env var: `MANAGED_MODE` (storage server) — defaults to `false`,
  preserves Phase 4 self-host behaviour. Setting it to `true` enables
  the hosted-mode routes (`/api/workspaces`, `/api/billing/*`) and the
  quota middleware. The atlas-app's `VITE_MANAGED_MODE` is the
  client-side counterpart; defaults to `false`.
- New optional env var: `VITE_MAPUTNIK_URL` — defaults to
  `https://maputnik.github.io/editor/`. Point at a self-hosted
  Maputnik instance to avoid third-party traffic.
- New optional env var: `VITE_GEOCODER_ENDPOINT` — **empty by default**.
  Set to e.g. `https://photon.komoot.io` or a self-hosted Photon
  instance to opt into address-column geocoding for CSV imports. With
  no value, no geocoding requests are made (ADR-0006 / ADR-0011: zero
  call-home in the default posture).

### License

- Applications (`apps/atlas-app`, `apps/storage`, `apps/realtime`) —
  AGPL-3.0-only.
- Packages (`packages/*`) — MIT, except `packages/basemap` and
  `packages/tools` (MPL-2.0). See `code/LICENSING.md` for the full
  per-package breakdown.

[1.0.0]: https://github.com/atlasdraw/atlasdraw/releases/tag/v1.0.0
