# @atlasdraw/geo

Coordinate math for Atlasdraw: plain functions, no React, no MapLibre.

A drawing's scene coordinates are Web Mercator world pixels at a reference zoom (22), measured from the document's origin (ADR-0015). This package maps between scene coordinates, lng/lat and the map camera.

Workspace-internal package (not published). Consumed by `@atlasdraw/basemap`, `@atlasdraw/tools`, `@atlasdraw/data` and `apps/atlas-app`.

## Capabilities

- **World frame** (`world.ts`): `documentFrame`, `toScene` / `toLngLat`, `viewportFor` / `cameraFor` (map camera to Excalidraw scroll and zoom), `sceneUnitsPerPixel`.
- **Scene geometry** (`sceneGeometry.ts`, `bounds.ts`): the outline of an element as Excalidraw draws it, and the lng/lat box of a drawing.
- **Version 1 migration** (`migrateV1.ts`): a version 1 element (screen pixels plus `customData.geo`) to world coordinates.

## Usage

```ts
import { documentFrame, toLngLat, toScene } from "@atlasdraw/geo";

const frame = documentFrame(-122.4194, 37.7749);
const p = toScene(frame, -122.4194, 37.7749); // { x: ~0, y: ~0 }
const { lng, lat } = toLngLat(frame, p);
```

## Development

```bash
yarn workspace @atlasdraw/geo test         # vitest (incl. property tests)
yarn test:typecheck
```
