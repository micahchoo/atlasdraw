# Atlasdraw

An open-source, self-hostable, real-time collaborative web map studio.
Atlasdraw stacks an [Excalidraw](https://github.com/excalidraw/excalidraw)
drawing surface on top of a [MapLibre GL JS](https://maplibre.org/) basemap
so that hand-drawn annotations stay geographically anchored under pan,
zoom, and collaborative editing.

> **Status:** `v1.0.0` — released 2026-05-15. See [`CHANGELOG.md`](CHANGELOG.md).

---

## What it is

- A map editor where the basemap and the drawing canvas share one
  coordinate space. MapLibre owns the camera (WGS84 / Mercator);
  Excalidraw's scroll/zoom is a derived mirror of it.
- Every Excalidraw element carries a `customData.geo` anchor
  (`point`, `bbox`, or `polyline`) plus a `scaleMode`. A
  `CoordinateSync` layer reprojects scene geometry on every map
  `move` event.
- Two element classes are distinguished throughout the app:
  **annotations** (Excalidraw-managed, stored in the scene) and
  **data layers** (MapLibre-managed, backed by GeoJSON sources).
- Local-first. The default self-host stack runs offline against a
  bundled low-zoom PMTiles basemap.

Detail: [`PRD.md`](PRD.md), [`atlasdraw-tech-spec.md`](atlasdraw-tech-spec.md),
[`docs/architecture/overview.md`](docs/architecture/overview.md).

---

## Repository layout

```
atlasdraw/
├── code/                    # Yarn-workspace monorepo (forked from excalidraw/excalidraw)
│   ├── apps/
│   │   ├── atlas-app/       # editor SPA — Vite + React 19
│   │   ├── realtime/        # WebSocket relay — Socket.IO + y-websocket
│   │   └── storage/         # Fastify HTTP API — map metadata + blobs
│   ├── packages/
│   │   ├── geo/             # coord transforms, GeoJSON adapters
│   │   ├── basemap/         # MapLibre wrapper, style registry
│   │   ├── data/            # .atlasdraw / GeoJSON / KML / CSV / SHP I/O
│   │   ├── tools/           # geo-aware drawing tools
│   │   ├── protocol/        # collaboration message types
│   │   ├── sdk/             # embed surface (stub — see §Out of scope)
│   │   ├── cli/             # headless lint / convert / render
│   │   ├── excalidraw/      # vendored upstream (light patches)
│   │   ├── element/         # vendored upstream
│   │   ├── math/            # vendored upstream
│   │   ├── common/          # vendored upstream
│   │   └── utils/           # vendored upstream
│   └── LICENSING.md         # canonical per-package license table
├── infra/
│   ├── docker-compose.yml          # full production stack (5 services)
│   ├── docker-compose.minimal.yml  # minimal try-it stack (2 services)
│   └── caddy/                      # Caddy config for TLS + reverse proxy
├── docs/
│   ├── architecture/        # overview + per-subsystem docs
│   ├── decisions/           # ADRs
│   ├── self-host/           # operator docs
│   ├── superpowers/plans/   # per-phase implementation plans
│   ├── method/              # process notes
│   ├── security/            # threat model + hardening notes
│   ├── test-matrix/         # test coverage tracking
│   └── PHASES.md            # phase timeline
├── PRD.md
├── atlasdraw-tech-spec.md
├── VENDOR.md                # upstream fork pin (Excalidraw commit 2dfcc6f0)
├── CHANGELOG.md
└── CLAUDE.md
```

The upstream Excalidraw fork is **inlined** under `code/` as plain
files (no submodule). Resync procedure in [`VENDOR.md`](VENDOR.md).

---

## Tech stack

App (`apps/atlas-app/package.json`):

| Concern | Choice | Version |
|---|---|---|
| UI runtime | React | `19.0.0` |
| Drawing surface | `@excalidraw/excalidraw` (vendored) | `0.18.0` |
| Basemap | `maplibre-gl` | `^4.7.1` |
| Realtime CRDT | `yjs` + `y-websocket` | `^13.6.20` / `^2.0.0` |
| Realtime presence | `socket.io-client` | `^4.7.0` |
| State | `zustand` | `5.0.13` |
| Local persistence | `idb` (IndexedDB) | `^8.0.0` |
| Schemas | `zod` | `^3.22.0` |
| Accessibility | `@react-aria/focus` | `^3.20.0` |
| Print/PDF | `pdf-lib` | `^1.17.1` |
| Build | `vite` | `^5.0.12` |
| Tests | `vitest`, `@playwright/test` | `3.0.6` / `^1.48.0` |

Server (`apps/storage`): Fastify, optional Postgres / SQLite, optional MinIO / S3.

---

## Features (v1.0)

Drawing + map composition

- Stacked MapLibre + Excalidraw with `CoordinateSync` reprojecting
  elements on every camera move.
- Drawing tools retuned for maps: pin, polygon, polyline/route,
  freehand, text, arrow, rectangle, circle.
- `LayerPanel` separating Excalidraw annotations from GeoJSON-backed
  data layers.
- `BasemapPickerDialog` over a basemap registry.

File format + I/O

- `.atlasdraw` — zipped bundle of scene JSON, per-layer GeoJSON,
  style reference, and manifest.
- Importers: GeoJSON, KML/KMZ, GPX, CSV (with lat/lng or address
  column), single-file Shapefile zip, GeoTIFF.
- Exporters: PNG, PDF (single + multi-page print layout), GeoJSON,
  `.atlasdraw`.

Real-time (Phase 5)

- `apps/realtime` WebSocket relay: Socket.IO presence + y-websocket
  CRDT endpoint.
- Cursor presence (`CursorOverlay`, `PresenceList`) and `MAP_CAMERA_UPDATE` events.
- End-to-end encryption preserved on annotation traffic from upstream.

v1.0 release (Phase 6)

- **Anchored comments** — per-room second `Y.Doc` carrying threads
  anchored to a MapLibre coordinate or Excalidraw element id
  (`CommentsPanel`, `CommentAnchor`, `CommentAnchorsOverlay`).
- **Maputnik style editing** in a modal (`MaputnikDialog`),
  round-tripping edits back into `@atlasdraw/basemap`.
- **Categorical + graduated layer styling** with deterministic
  MapLibre expression output (`StylePanel`, `ColorRampPicker`).
- **Photon geocoder client** — opt-in via `VITE_GEOCODER_ENDPOINT`,
  empty by default (no call-home).
- **Print-to-PDF** layout panel built on `pdf-lib` (`PrintDialog`).
- **Excalidraw asset library** — `.excalidrawlib` reader plus a
  curated fixture set (`AssetLibraryPanel`).
- **Workspace abstraction** — `WorkspaceId` plumbed through every
  storage route; defaults to a single workspace on self-host.
- **Hosted-mode overlay** — opt-in via `MANAGED_MODE=true` (server)
  + `VITE_MANAGED_MODE=true` (app). Adds Stripe billing,
  per-workspace quotas, `WorkspaceSwitcher`, `BillingPage`. Quota
  middleware short-circuits to a no-op when `MANAGED_MODE=false`.
- **Accessibility pass** — `@react-aria/focus` keyboard nav,
  `FocusTrap` across modals, `AriaAnnouncer` live region.

Full list and per-phase recaps: [`CHANGELOG.md`](CHANGELOG.md).

### Out of scope for 1.0 (explicit)

Per `Q-P6-1` decision recorded in the changelog:

- **AtlasdrawAPI / SDK / embed widget.** `packages/sdk` exists as a
  package slot but no third-party automation surface is shipped in
  v1.0 and none is committed in the immediate roadmap.
- **Felt importer.**
- **Phase 7 plugin sandbox.** Flagged for revision (seeds issue
  `atlasdraw-c547`).

---

## Quick start — develop locally

The monorepo lives under [`code/`](code/) and uses Yarn workspaces
(`yarn@1.22`). Node ≥ 18.

```bash
cd code
yarn install
yarn --cwd apps/atlas-app dev          # editor on http://localhost:5173
```

Common scripts (from `apps/atlas-app/package.json`):

```bash
yarn --cwd apps/atlas-app build         # production bundle
yarn --cwd apps/atlas-app test          # vitest run
yarn --cwd apps/atlas-app test:typecheck
yarn --cwd apps/atlas-app e2e           # Playwright (chromium)
```

---

## Self-host

Two compose stacks ship in [`infra/`](infra/):

- [`infra/docker-compose.minimal.yml`](infra/docker-compose.minimal.yml) —
  2 services (`web` + `storage` in `sqlite-fs` mode) plus one named
  volume. Ships with a bundled low-zoom PMTiles basemap baked into the
  web image; no outbound network calls in the default config.
- [`infra/docker-compose.yml`](infra/docker-compose.yml) — full
  production stack: `web` + `storage` (postgres-minio mode) +
  `postgres` + `minio` + `caddy` (TLS + reverse proxy). Phase 5's
  `realtime` service is wired in via the `realtime` compose profile.

Minimal first run is documented in
[`docs/self-host/README.md`](docs/self-host/README.md). Production
deployment notes live under `docs/self-host/`.

---

## Licensing

Atlasdraw ships under three open-source licenses; the split is
deliberate and load-bearing. Authoritative table:
[`code/LICENSING.md`](code/LICENSING.md).

| Component | License |
|---|---|
| `apps/atlas-app` | MIT |
| `apps/realtime`, `apps/storage` | AGPL-3.0-only |
| `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data` | MIT |
| `packages/basemap`, `packages/tools` | MPL-2.0 |
| Vendored `packages/{excalidraw,element,math,common,utils}` | MIT (upstream) |

License files: [`code/LICENSE-AGPL`](code/LICENSE-AGPL),
[`code/LICENSE-MIT`](code/LICENSE-MIT),
[`code/LICENSE-MPL`](code/LICENSE-MPL),
[`code/LICENSE-EXCALIDRAW-UPSTREAM`](code/LICENSE-EXCALIDRAW-UPSTREAM).

---

## Further reading

- [`PRD.md`](PRD.md) — product requirements
- [`atlasdraw-tech-spec.md`](atlasdraw-tech-spec.md) — technical specification (coordinate sync, scale modes, phase plan)
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — architecture overview
- [`docs/architecture/subsystems.md`](docs/architecture/subsystems.md) — per-subsystem responsibilities + contracts
- [`docs/decisions/`](docs/decisions/) — ADRs
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — per-phase implementation plans
- [`VENDOR.md`](VENDOR.md) — upstream fork pin and resync procedure
- [`CHANGELOG.md`](CHANGELOG.md) — release history
