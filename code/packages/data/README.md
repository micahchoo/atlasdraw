# @atlasdraw/data

File-format I/O for Atlasdraw: read and write the `.atlasdraw` container, migrate old files, import GeoJSON / CSV / Shapefile / KML / KMZ / GPX / GeoTIFF, export GeoJSON / CSV, and geocode CSV address columns.

Workspace-internal package (not published). Consumed by `apps/atlas-app` and `@atlasdraw/cli`.

## Capabilities

- **`.atlasdraw` container** — `read(blob)` / `write(doc)` for the versioned zipped format (comments in `comments.json`), plus `readJSON` / `writeJSON` for the bare-JSON variant and a zod manifest schema (`manifest-schema.ts`).
- **Format readers** — GeoJSON (`geojson.ts`), CSV with typed column options (`csv.ts`), Shapefile via shpjs (`shapefile.ts`), KML / KMZ / GPX via @tmcw/togeojson (`geoxml.ts`; needs a global `DOMParser`). KML and GPX files often mix points, lines and areas: `splitByGeometryKind` (`geojson.ts`) divides one into a FeatureCollection per kind.
- **Migrations** — `migrate` brings a stored document to `CURRENT_MANIFEST_VERSION` (2); `read` calls it. A newer version than the build reads throws `MigrationError`.
- **GeoTIFF** — `geotiff.ts` decodes an EPSG:4326 or EPSG:3857 raster to an image and its corners.
- **Export** — `toGeoJSONText`, `toCSV` (a cell never starts a spreadsheet formula), `toWKT`.
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

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
