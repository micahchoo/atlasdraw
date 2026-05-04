# `packages/data` — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5)
**Package name:** `@atlasdraw/data`

---

## Public Export Surface

### Shared Interface Pattern

All vector format parsers/writers follow this interface:
[CONFIDENCE: high — per tech spec §4.3]

```ts
interface FormatModule {
  parse(blob: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection>;
  write(fc: GeoJSON.FeatureCollection): Promise<Blob>;
}
```

---

### `geojson` — **stable**
[CONFIDENCE: high]

```ts
export const geojson: {
  parse(blob: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection>;
  write(fc: GeoJSON.FeatureCollection): Promise<Blob>;
};
```

GeoJSON is the pivot format. `parse` normalizes bare `Geometry` and `Feature` inputs to `FeatureCollection`. Write produces a deterministic UTF-8 JSON blob.

---

### `kml` — **stable**
[CONFIDENCE: high — per tech spec §4.3]

```ts
export const kml: {
  parse(blob: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection>;
  write(fc: GeoJSON.FeatureCollection): Promise<Blob>;
};
```

---

### `gpx` — **stable**
[CONFIDENCE: high — per tech spec §4.3]

```ts
export const gpx: {
  parse(blob: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection>;
  write(fc: GeoJSON.FeatureCollection): Promise<Blob>;
};
```

---

### `csv` — **stable**
[CONFIDENCE: high — per tech spec §4.3]

```ts
export const csv: {
  parse(blob: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection>;
  // no write — CSV is import-only in v1
};

/** Exported for testing coordinate-detection heuristics */
export function detectLatLngColumns(headers: string[]): {
  latCol: string | null;
  lngCol: string | null;
};
```

---

### `shapefile` — **stable**
[CONFIDENCE: high — per tech spec §4.3]

```ts
export const shapefile: {
  /** Accepts a .zip ArrayBuffer containing .shp/.dbf/.prj */
  parse(blob: ArrayBuffer): Promise<GeoJSON.FeatureCollection>;
  // no write in v1
};
```

---

### `geotiff` — **stable**
[CONFIDENCE: med — COG raster source API shape extrapolated from spec §4.3]

```ts
export interface RasterLayerSpec {
  type: "raster-cog";
  url: string;               // cog:// protocol URL or https:// COG URL
  bounds: [number, number, number, number];  // [west, south, east, north]
  attribution?: string;
}

export const geotiff: {
  /** Returns RasterLayerSpec, not GeoJSON — COGs are raster, not vector */
  parse(blob: ArrayBuffer): Promise<RasterLayerSpec>;
};
```

---

### `atlasdraw` — **stable**
[CONFIDENCE: high — per tech spec §6, Phase 2 plan]

```ts
export interface AtlasdrawFile {
  version: number;
  elements: ExcalidrawElement[];
  layers: LayerRecord[];
  basemapStyleId: string;
  viewport: {
    center: [number, number];
    zoom: number;
  };
}

export const atlasdraw: {
  parse(blob: ArrayBuffer | string): Promise<AtlasdrawFile>;
  write(file: AtlasdrawFile): Promise<Blob>;
};
```

**GeoAnchor in serialization:** `element.customData.geo` is serialized as the canonical `GeoAnchor` discriminated union (per `packages/geo/types.ts`). Field name in serialized JSON is `"geo"` (not `"geoAnchor"` — MISMATCH-3 correction). Any `.atlasdraw` file using the flat shape must be migrated by the parse path.

---

### `importFelt` — **stable** (read-only, Q13)
[CONFIDENCE: high — per Phase 6 plan Task 15, Q13]

```ts
export async function importFelt(
  source: ArrayBuffer | string  // Felt-Export.zip or GeoJSON string
): Promise<AtlasdrawFile>;
```

Permissive importer. Logs `console.warn` on unknown Felt feature types; never throws. Returns best partial output if input is partially invalid. No write path, no round-trip sync (read-only per Q13).

---

### `LayerRegistry` type — **stable**
[CONFIDENCE: high — per cross-phase audit MISMATCH-2]

```ts
/** Type definition only. Runtime Zustand slice at apps/atlas-app/state/store.ts */
export interface LayerRecord {
  id: string;
  name: string;
  visible: boolean;
  source: "geojson" | "geotiff" | "yjs" | "felt" | "external";
  styleId?: string;
}

export interface LayerRegistryState {
  layers: LayerRecord[];
  addLayer(record: LayerRecord): void;
  removeLayer(id: string): void;
  updateLayer(id: string, patch: Partial<LayerRecord>): void;
}
```

**Authoring note:** `LayerRegistryState` is the TypeScript interface. The concrete Zustand slice is created in `apps/atlas-app/state/store.ts` using `create<LayerRegistryState>()(...)`. This package provides the type; `apps/atlas-app` provides the implementation. Do not import the Zustand slice from `packages/data` — it does not exist here.

---

### `YjsLayer` — **stable**
[CONFIDENCE: high — per Phase 5 plan Task 4]

```ts
export class YjsLayer {
  readonly doc: Y.Doc;

  constructor(doc?: Y.Doc);

  addFeature(layerId: string, featureId: string, geometry: GeoJSON.Geometry): void;
  deleteFeature(layerId: string, featureId: string): void;
  setProperty(layerId: string, featureId: string, key: string, value: unknown): void;
  appendVertex(layerId: string, featureId: string, coord: [number, number]): void;
  deleteVertex(layerId: string, featureId: string, index: number): void;
}

export function toGeoJSON(layer: YjsLayer, layerId: string): GeoJSON.FeatureCollection;
```

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `geojson` | stable | Phase 2 |
| `atlasdraw` | stable | Phase 2 |
| `LayerRecord`, `LayerRegistryState` | stable | Phase 2 |
| `kml`, `gpx`, `csv`, `shapefile`, `geotiff` | stable | Phase 3 |
| `YjsLayer`, `toGeoJSON` | stable | Phase 5 |
| `importFelt` | stable | Phase 6 |

---

## License Notes

`packages/data` is MIT-licensed. Required because `packages/cli` and `packages/sdk` (both MIT) import from it — a copyleft license here would contaminate those packages.

---

## Backward-Compatibility Policy

Stable exports: no removal, no signature narrowing. `AtlasdrawFile.version` field enables forward migration — the `parse` function must handle older versions. New optional fields in `AtlasdrawFile` are additive and allowed in minors.
