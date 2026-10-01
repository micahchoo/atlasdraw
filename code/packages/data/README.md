# @atlasdraw/data

File-format I/O for Atlasdraw: read/write the `.atlasdraw` container, import GeoJSON / CSV / Shapefile / KML / KMZ / GPX, and geocode CSV address columns.

Workspace-internal package (not published). Consumed by `apps/atlas-app` and `@atlasdraw/cli`.

## Capabilities

- **`.atlasdraw` container** — `read(blob)` / `write(doc)` for the versioned zipped format (comments in `comments.json`), plus `readJSON` / `writeJSON` for the bare-JSON variant and a zod manifest schema (`manifest-schema.ts`).
- **Format readers** — GeoJSON (`geojson.ts`), CSV with typed column options (`csv.ts`), Shapefile via shpjs (`shapefile.ts`), KML / KMZ / GPX via @tmcw/togeojson (`geoxml.ts`; needs a global `DOMParser`). KML and GPX files often mix points, lines and areas: `splitByGeometryKind` (`geojson.ts`) divides one into a FeatureCollection per kind.
- **Geocoding** — `geocode.ts`: fetch-based Photon client with an LRU cache, wired into the CSV reader's address-column path. Opt-in by configuration; makes no requests unless an endpoint is supplied.
- **Misc** — map thumbnail generation (`thumbnail.ts`), `.excalidrawlib` asset-library reader (`asset-library.ts`).

## Usage

```ts
import { read, write, parseCSV, parseShapefile } from "@atlasdraw/data";

const doc = await read(blob); // .atlasdraw → AtlasdrawDocument
const blob2 = await write(doc); // AtlasdrawDocument → .atlasdraw
```

## Development

```bash
yarn workspace @atlasdraw/data test        # vitest
yarn test:typecheck                        # repo-wide TS check
```

Architecture notes: [`docs/architecture/subsystems/data/`](../../../docs/architecture/subsystems/data/).

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
