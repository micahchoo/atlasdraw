# @atlasdraw/data

File-format I/O and collaboration data plumbing for Atlasdraw: read/write the
`.atlasdraw` container, import GeoJSON / CSV / Shapefile, geocode CSV address
columns, and wrap data layers in Yjs docs for realtime sync.

Workspace-internal package (not published). Consumed by `apps/atlas-app`,
`apps/realtime`, and `@atlasdraw/cli`.

## Capabilities

- **`.atlasdraw` container** — `read(blob)` / `write(doc)` for the versioned
  zipped format, plus `readJSON` / `writeJSON` for the bare-JSON variant and
  a zod manifest schema (`manifest-schema.ts`).
- **Format readers** — GeoJSON (`geojson.ts`), CSV with typed column options
  (`csv.ts`), Shapefile via shpjs (`shapefile.ts`). KML/GPX are **not
  implemented** (planned adapters; see the note in `src/index.ts`).
- **Geocoding** — `geocode.ts`: fetch-based Photon client with an LRU cache,
  wired into the CSV reader's address-column path. Opt-in by configuration;
  makes no requests unless an endpoint is supplied.
- **Yjs layer plumbing** — `yjs-layer.ts` (data-layer doc wrapper),
  `yjs-snapshot.ts` (`toGeoJSON`, `observeLayer`), `CollabUndoManager`.
  `yjs-crypto.ts` (`encryptUpdate`/`decryptUpdate`) is a tested **stub with no
  callers yet** — see E-01 in `../../../docs/decisions/escalations.md`.
- **Misc** — map thumbnail generation (`thumbnail.ts`), `.excalidrawlib`
  asset-library reader (`asset-library.ts`).

## Usage

```ts
import { read, write, parseCSV, parseShapefile } from "@atlasdraw/data";

const doc = await read(blob);        // .atlasdraw → AtlasdrawDocument
const blob2 = await write(doc);      // AtlasdrawDocument → .atlasdraw
```

## Development

```bash
yarn workspace @atlasdraw/data test        # vitest
yarn test:typecheck                        # repo-wide TS check
```

Architecture notes: [`docs/architecture/subsystems/data/`](../../../docs/architecture/subsystems/data/).

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
