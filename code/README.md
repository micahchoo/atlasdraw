<div align="center">
  <h1>Atlasdraw</h1>
  <p>
    A collaborative web map studio — hand-drawn annotation and sketching,
    layered directly on real basemaps.
  </p>
</div>

## What it is

Atlasdraw lets teams sketch, annotate, and collaborate on top of an actual map — routes, hazard zones, transit plans, site notes — with the same free-form, hand-drawn feel as a whiteboard, instead of forcing map markup into rigid GIS tooling.

- 🗺️&nbsp;Real basemaps (MapLibre GL, vector tiles via PMTiles/Protomaps), not a static background image.
- ✍️&nbsp;Hand-drawn sketching, shapes, text, and arrows anchored to real coordinates.
- 🤼&nbsp;Real-time multiplayer collaboration (Yjs CRDT sync over Socket.IO).
- 📍&nbsp;GeoJSON / shapefile import, asset libraries, and layer management.
- 🖼️&nbsp;Export to PNG/SVG, and a portable `scene.json` + `data/*.geojson` + `style.json` bundle.

## Repository layout

This is a Yarn workspaces monorepo. See [`CLAUDE.md`](./CLAUDE.md) for the full development guide; in short:

- `apps/atlas-app/` — the product (editor SPA).
- `apps/realtime/` — collaboration server.
- `apps/storage/` — backend API (auth, storage, billing).
- `packages/basemap/`, `packages/geo/`, `packages/tools/`, `packages/data/`, `packages/protocol/`, `packages/sdk/`, `packages/cli/` — atlasdraw-native packages.
- `packages/excalidraw/`, `packages/element/`, `packages/math/`, `packages/common/` — the forked [Excalidraw](https://github.com/excalidraw/excalidraw) canvas engine that powers the sketching layer.

## Quick start

```bash
corepack enable      # pins yarn@4 via packageManager
yarn install
yarn workspace @atlasdraw/atlas-app dev
```

Run `yarn test:typecheck` and `yarn test` before committing.

## License

Atlasdraw is multi-licensed by package — see [`LICENSING.md`](./LICENSING.md) for the breakdown (application code is AGPL-3.0, the SDK/integration libraries are MIT, and the basemap/tools wrappers are MPL-2.0).

## Credits

The sketching engine is built on a fork of [Excalidraw](https://github.com/excalidraw/excalidraw), an excellent open-source whiteboard project — see [`LICENSE-EXCALIDRAW-UPSTREAM`](./LICENSE-EXCALIDRAW-UPSTREAM) for its original license terms. Map rendering is built on [MapLibre GL](https://maplibre.org/) and the [Protomaps](https://protomaps.com/) basemap format.
