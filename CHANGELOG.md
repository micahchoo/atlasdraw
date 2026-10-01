# Changelog

All notable changes to Atlasdraw are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Atlasdraw
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **`GET /maps/:id`.** Nothing used the map record. The owner reads the
  bytes with `GET /maps/:id/blob`.
- **Managed (hosted) mode.** Atlasdraw is self-host only, one trusted
  tenant per deployment (ADR-0013). The storage server loses the
  `/api/workspaces` and `/api/billing/*` routes, the `X-Workspace-ID`
  middleware, the map quota, Stripe, and the `MANAGED_MODE`,
  `QUOTA_*`, `STRIPE_*` and `SITE_URL` env vars. The atlas-app loses the
  workspace switcher, the `/billing` page, the Settings "Workspace" tab
  and `VITE_MANAGED_MODE`. No managed-mode user flow worked end to end,
  and the mode enforced no tenant isolation. The 1.0.0 entry below
  describes it as it shipped.
- **`packages/sdk`.** It was a stub that nothing imported (ADR-0016). A
  read-only map embeds through the `/embed` route.

### Added

- **Maps carry a write key** (ADR-0017). `POST /maps` returns
  `write_key` once. `PUT /maps/:id`, `POST /maps/:id/share` and the new
  `DELETE /maps/:id/share/:token` and `GET /maps/:id/blob` need
  `Authorization: Bearer <write_key>`: none is 401, a wrong one is 403.
  A share token never opens a write.
- **Restore from the server.** `GET /maps/:id/blob` returns a map's
  latest bytes to its key holder. The client has
  `restoreFromServer(client, documentId)`; no menu item calls it yet.
- **Stop sharing.** The Share dialog has "Stop sharing this link", which
  revokes the token.
- **`MAX_TOTAL_BYTES`** caps the total stored size (507 past it), and
  **`SWEEP_INTERVAL_MS`** sets how often expired links and unreachable
  maps are deleted.

### Changed

- **Share links last, and follow the map.** A link lives until its owner
  stops it, unless the owner chose a 7- or 30-day expiry. It serves the
  map's latest saved bytes, so a save updates every link and embed. The
  Share dialog says so. The client shares the document's own server map
  instead of making a new map for every share.
- **Blob writes are atomic.** The SQLite/filesystem adapter writes to a
  flushed temp file and renames it, with async I/O.
- **One owner for the storage schema.** Both storage adapters apply the
  migrations in `apps/storage/src/db/migrations.ts` at startup, and record
  them in a `schema_migrations` table. The Postgres adapter now retries a
  schema setup that failed at a cold start, instead of failing every
  request until a restart.

### Migration notes for self-hosters

- Back up the storage volume before you upgrade. At first start the
  server drops the `workspace_id` columns and the `workspaces` table.
  Maps and share links are kept.
- Remove `MANAGED_MODE`, `QUOTA_FREE_MAPS`, `QUOTA_PRO_MAPS`, `STRIPE_*`,
  `SITE_URL` and `VITE_MANAGED_MODE` from your environment. The server
  ignores them.
- **Existing maps become read-only.** Migration
  `003_write_keys_and_lasting_links` adds `maps.write_key_hash` and makes
  `share_tokens.expires_at` nullable. A map stored before it has no write
  key, so nobody can write it. Its share links work until their 7-day
  expiry; then the sweep deletes the map and its blob. Each browser makes
  a new map with a key at its next save, so you do nothing. The id that
  old clients hold may have leaked through share links (SECURITY.md row
  10), so the server does not let anyone claim a key with it.
- A script that calls the storage API must keep the `write_key` from
  `POST /maps` and send it as `Authorization: Bearer <key>`.
  `infra/smoke-minimal.sh` shows the flow.
- Set `MAX_TOTAL_BYTES` on a server that faces the internet.

- **"Pro+" billing tier.** `pro_25` was a separate `WorkspacePlan` with its
  own Stripe price ID but an identical map quota to `pro` — no code ever
  read a difference between the two (ISSUES.md Direction 5, headroom audit,
  verdict: reject). Folded back into `pro`; `STRIPE_PRICE_PRO_25` is no
  longer a recognized env var.

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
