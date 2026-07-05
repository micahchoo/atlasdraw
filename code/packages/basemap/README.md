# @atlasdraw/basemap

MapLibre wrapper for Atlasdraw: the `<MapCanvas>` React component,
`BasemapRegistry`, PMTiles protocol registration, and the data-layer style
compiler.

Workspace-internal package (not published). Consumed by `apps/atlas-app`.

## Capabilities

- **`<MapCanvas>`** — the MapLibre host component (`MapCanvas.tsx`), with
  `CoordinateSync` keeping geo-anchored Excalidraw elements re-projected on
  every pan/zoom.
- **`BasemapRegistry`** — `BASEMAPS` static registry + `getBasemap(id)`
  (protomaps light/dark, OpenFreeMap bright, OSM standard). No runtime
  `register()` API today — extending it means editing the array (plugin
  registration is a Phase 7 roadmap item).
- **PMTiles** — `registerPmtilesProtocol` for the bundled low-zoom world
  tiles used by self-host.
- **Styles** — `buildStyle` / `resolveStyle` for basemap style resolution
  (including the remote-gated error path), and `compileLayer` /
  `defaultLayerStyle` compiling `LayerStyle` (categorical + graduated
  expressions) into deterministic MapLibre expressions.

## Usage

```tsx
import { MapCanvas, getBasemap, registerPmtilesProtocol } from "@atlasdraw/basemap";
```

## Development

```bash
yarn workspace @atlasdraw/basemap test     # vitest
yarn test:typecheck
```

Architecture notes: [`docs/architecture/subsystems/basemap/`](../../../docs/architecture/subsystems/basemap/).

## License

MPL-2.0 (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
