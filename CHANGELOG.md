# Changelog

All notable changes to Atlasdraw are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Atlasdraw
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

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
