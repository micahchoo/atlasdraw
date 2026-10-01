# @atlasdraw/basemap

MapLibre wrapper for Atlasdraw: the `<MapCanvas>` React component, `BasemapRegistry`, PMTiles protocol registration, and the data-layer style compiler.

Workspace-internal package (not published). Consumed by `apps/atlas-app`.

## Capabilities

- **`<MapCanvas>`** — the MapLibre host component (`MapCanvas.tsx`).
- **`CameraBridge`** — drives Excalidraw's scroll and zoom from the map camera, and sends Excalidraw's own viewport changes back to the map (ADR-0015). A camera move writes no element.
- **`BasemapRegistry`** — `BASEMAPS` and `getBasemap(id)`: Light and Dark (Protomaps, from the bundled PMTiles file), Bright (OpenFreeMap) and OSM (remote). `registerBasemap` / `listBasemaps` add and list entries at run time.
- **PMTiles** — `registerPmtilesProtocol` for the bundled low-zoom world tiles used by self-host.
- **Styles** — `buildStyle` / `resolveStyle` for basemap style resolution (including the remote-gated error path), and `compileLayer` / `compileLayers` / `defaultLayerStyle`, which compile a `LayerStyle` (categorical and graduated colour, labels from a property, a filter by property) into MapLibre layers.
- **Camera rotation** — `applyRotationPolicy` and its helpers: rotation gestures stay off unless the view has a way back to north.

## Usage

```tsx
import {
  MapCanvas,
  getBasemap,
  registerPmtilesProtocol,
} from "@atlasdraw/basemap";
```

## Development

```bash
yarn workspace @atlasdraw/basemap test     # vitest
yarn test:typecheck
```

## License

MPL-2.0 (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
