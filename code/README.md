# Atlasdraw workspace

This folder is the Atlasdraw code: a Yarn 4 workspace with three apps and eleven packages. What the product is and how to host it are in the [repository README](../README.md).

## Layout

- `apps/atlas-app/` — the editor, the read-only viewer (`/m`) and the embed (`/embed`).
- `apps/storage/` — the HTTP API for saved maps, write keys and share links.
- `apps/realtime/` — the relay for live rooms.
- `packages/geo/`, `packages/basemap/`, `packages/tools/`, `packages/data/`, `packages/protocol/`, `packages/cli/` — the Atlasdraw packages.
- `packages/excalidraw/`, `packages/element/`, `packages/math/`, `packages/common/`, `packages/utils/` — the Excalidraw fork. Atlasdraw owns it; nothing syncs from upstream (`decisions/0010-own-the-fork.md`).
- `bench/` — performance benchmarks and the CI regression gate.
- `decisions/` — ADR 0001–0010 and the early research notes.

## Quick start

```bash
corepack enable      # gives the yarn version that package.json pins
yarn install
yarn start           # the editor on http://localhost:5174
```

Before you commit, run `yarn test:typecheck` and `yarn test --watch=false`. [`CLAUDE.md`](CLAUDE.md) lists the other commands.

## Licence

Each package has its own licence. The apps are AGPL-3.0-only; `cli`, `geo`, `data` and `protocol` are MIT; `basemap` and `tools` are MPL-2.0. The table and the reasons are in [`LICENSING.md`](LICENSING.md).

## Credits

The drawing engine is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw); its licence is in [`LICENSE-EXCALIDRAW-UPSTREAM`](LICENSE-EXCALIDRAW-UPSTREAM). The map is [MapLibre GL](https://maplibre.org/), and the bundled basemap uses the [Protomaps](https://protomaps.com/) format.
