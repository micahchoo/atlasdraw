# @atlasdraw/geo

Coordinate math and GeoAnchor plumbing for Atlasdraw — plain functions, no
React. This is the layer that keeps drawings glued to lat/lng while MapLibre
pans and zooms; projection helpers delegate to a MapLibre map instance passed
in by the caller.

Workspace-internal package (not published). Consumed by `@atlasdraw/basemap`,
`@atlasdraw/tools`, and `apps/atlas-app`.

## Capabilities

- **Projection** — `projectPoint` / `unprojectPoint` / `normalizeLng`
  (Web-Mercator, `projection.ts`, property-tested).
- **GeoAnchor types** — the discriminated union (`point` / `bbox` /
  `polyline`, per escalation E-03) in `types.ts`, plus
  `parseGeoCustomData` for validating anchors read from element
  `customData`.
- **Element ↔ geo conversion** — `geoToExcalidraw` / `excalidrawToGeo`
  reprojection helpers, `computeSceneBounds`, `normalizeElementsForExport`.
- **Scale modes** — `scaleMode.ts` (`screen` vs `map` sizing behaviour,
  Spec §3.4).

## Usage

```ts
import { projectPoint, parseGeoCustomData } from "@atlasdraw/geo";

const { x, y } = projectPoint(map, -122.4194, 37.7749);
```

## Development

```bash
yarn workspace @atlasdraw/geo test         # vitest (incl. property tests)
yarn test:typecheck
```

Architecture notes: [`docs/architecture/subsystems/geo/`](../../../docs/architecture/subsystems/geo/).

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
