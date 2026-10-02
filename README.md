# Atlasdraw

Atlasdraw is an open-source map studio that you host yourself. You draw on a
real map with the [Excalidraw](https://github.com/excalidraw/excalidraw)
tools, and every shape stays at its place on the ground when you pan, zoom or
share. The map is [MapLibre GL JS](https://maplibre.org/).

> [!NOTE]
> Latest release: `v1.0.0` (2026-05-15). The changes since then are under
> "Unreleased" in [`CHANGELOG.md`](CHANGELOG.md).

## Why Atlasdraw?

Use it when you must sketch, annotate and discuss a place, not only drop
pins.

- **Drawing on a map.** Freehand, shapes, arrows, text and pins. A drawing is
  stored in world coordinates, so it does not drift when the map moves.
- **Your data.** Import GeoJSON, CSV, Shapefile (zip), KML, KMZ, GPX and
  GeoTIFF. Style a layer by a property, label it, filter it, and click a
  feature to see its attributes. Add raster tiles from an XYZ URL.
- **Measure.** Distance, area and radius, on the ellipsoid.
- **Share and embed.** A read-only link or an `<iframe>` embed. A server link
  lasts until you stop it, and it shows your latest save.
- **Edit together.** Live rooms with cursors, names and comments. The relay
  keeps a room between sessions.
- **Open files.** Export PNG (1x, 2x, 3x), PDF, GeoJSON, CSV and the
  `.atlasdraw` bundle (zipped JSON and GeoJSON).
- **Self-host.** No telemetry. The default basemap is a file on your own
  server.

## Quick start

The code is a Yarn 4 workspace in [`code/`](code/). Use Node 20.

```bash
cd code
corepack enable        # gives the yarn version that package.json pins
yarn install
yarn start             # the editor on http://localhost:5174
```

## Self-host

Two Docker Compose stacks are in [`infra/`](infra/):

- [`infra/docker-compose.minimal.yml`](infra/docker-compose.minimal.yml) —
  `web` and `storage` (SQLite and files). One port, `3000`.
- [`infra/docker-compose.yml`](infra/docker-compose.yml) — `web`, `storage`,
  `postgres` and `caddy` (TLS). Map bytes go to an S3-compatible bucket
  that you supply; the stack runs no object store. The relay for
  live rooms starts with the `realtime` profile.

First run: [`docs/self-host/README.md`](docs/self-host/README.md).
Production: [`docs/self-host/production.md`](docs/self-host/production.md).

The default basemaps ("Light" and "Dark") make no request to another
server: the tiles, label fonts and icons are in the image. The "Bright" and
"OSM" basemaps and the tile layers that a user adds load from their own
servers. The self-host guide tells you how to turn these off.

## Architecture

`apps/atlas-app` uses every package. The packages depend on few others.

| Part            | Path                                                   | What it does                                         |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Editor          | `code/apps/atlas-app`                                  | The editor, the read-only viewer and the embed       |
| Excalidraw fork | `code/packages/{excalidraw,element,math,common,utils}` | The drawing engine. Owned outright, not tracked      |
| Geo             | `code/packages/geo`                                    | World coordinates and measurement. Pure functions    |
| Map             | `code/packages/basemap`                                | MapLibre host, basemaps, camera bridge, layer styles |
| Tools           | `code/packages/tools`                                  | The pin tool, the measure session, unit text         |
| Data            | `code/packages/data`                                   | `.atlasdraw` read and write, importers, exporters    |
| Protocol        | `code/packages/protocol`                               | Room links and the comment schema                    |
| Storage server  | `code/apps/storage`                                    | Fastify HTTP API: maps, write keys, share links      |
| Relay           | `code/apps/realtime`                                   | One Y.Doc per room over y-websocket, saved to SQLite |
| CLI             | `code/packages/cli`                                    | `lint` and `convert`. Frozen (ADR-0016)              |

<details>
<summary>Repository layout</summary>

```
atlasdraw/
├── code/                    # Yarn 4 workspace
│   ├── apps/
│   │   ├── atlas-app/       # editor — Vite + React 19
│   │   ├── realtime/        # relay — ws + y-protocols + SQLite
│   │   └── storage/         # HTTP API — Fastify
│   ├── packages/
│   │   ├── geo/ basemap/ data/ tools/ protocol/ cli/
│   │   └── excalidraw/ element/ math/ common/ utils/   # the fork
│   ├── decisions/           # ADR 0001–0010: fork, licence, early design
│   └── LICENSING.md
├── docs/
│   ├── architecture/adr/    # ADR 0013 and later: product decisions
│   ├── self-host/           # operator guides
│   ├── performance/
│   └── security/
├── infra/                   # Compose files, Caddyfile, Makefile
├── PRD.md  PRFAQ.md  atlasdraw-tech-spec.md
└── SECURITY.md  CHANGELOG.md  VENDOR.md
```

The Excalidraw fork is plain files in `code/`, with no submodule. The fork
point, and how to port a security fix, are in [`VENDOR.md`](VENDOR.md).

</details>

## Tech stack

| Concern         | Choice                                        |
| --------------- | --------------------------------------------- |
| UI              | React 19                                      |
| Drawing         | Excalidraw fork (`@atlasdraw/excalidraw`)     |
| Map             | `maplibre-gl` 4, PMTiles                      |
| Live rooms      | `yjs`, `y-websocket`                          |
| State           | `zustand`                                     |
| Local saves     | IndexedDB (`idb`)                             |
| Schemas         | `zod`                                         |
| PDF             | `pdf-lib`                                     |
| Build and tests | Vite 5, Vitest 3, Playwright                  |
| Storage server  | Fastify; SQLite and files, or Postgres and S3 |
| Relay           | `ws`, `y-protocols`, `better-sqlite3`         |

## Development

Run these from `code/`:

```bash
yarn start                                # editor dev server, port 5174
yarn build                                # production build of the editor
yarn test:typecheck                       # TypeScript, all workspaces
yarn test --watch=false                   # Vitest, all workspaces
yarn test:all                             # typecheck, lint, prettier, vitest
yarn workspace @atlasdraw/atlas-app e2e   # Playwright, chromium
```

## Contributing

Read [`code/CONTRIBUTING.md`](code/CONTRIBUTING.md). Decisions are ADRs in
[`code/decisions/`](code/decisions/) and
[`docs/architecture/adr/`](docs/architecture/adr/). The two series use some
of the same numbers, so cite an ADR by its file path.

## Licensing

Atlasdraw uses three open-source licences. The full table is
[`code/LICENSING.md`](code/LICENSING.md).

| Component                                         | Licence        |
| ------------------------------------------------- | -------------- |
| `apps/atlas-app`, `apps/realtime`, `apps/storage` | AGPL-3.0-only  |
| `packages/{cli,geo,data,protocol}`                | MIT            |
| `packages/{basemap,tools}`                        | MPL-2.0        |
| The fork: `packages/{excalidraw,element,math,common,utils}` | MIT (upstream) |

Licence files: [`code/LICENSE-AGPL`](code/LICENSE-AGPL),
[`code/LICENSE-MIT`](code/LICENSE-MIT),
[`code/LICENSE-MPL`](code/LICENSE-MPL),
[`code/LICENSE-EXCALIDRAW-UPSTREAM`](code/LICENSE-EXCALIDRAW-UPSTREAM).

## Further reading

- [`PRD.md`](PRD.md) — product requirements, and what has shipped
- [`PRFAQ.md`](PRFAQ.md) — the read-only map embed
- [`atlasdraw-tech-spec.md`](atlasdraw-tech-spec.md) — the first engineering
  spec. ADR-0015 replaces its coordinate model.
- [`SECURITY.md`](SECURITY.md) — trust-boundary findings and their fixes
- [`VENDOR.md`](VENDOR.md) — the Excalidraw fork point
- [`CHANGELOG.md`](CHANGELOG.md) — release history
