# `packages/data` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/data`

---

## Parser Flow (all vector formats)

```
User drops file / opens dialog
  │
  ▼
apps/atlas-app detects MIME type / extension
  │
  ├── .geojson / .json → geojson.parse(buffer)
  ├── .kml             → kml.parse(buffer)
  ├── .gpx             → gpx.parse(buffer)
  ├── .csv             → csv.parse(buffer)
  ├── .zip             → shapefile.parse(buffer)
  ├── .tif / .tiff     → geotiff.parse(buffer)  → RasterLayerSpec (not GeoJSON)
  ├── .atlasdraw       → atlasdraw.parse(buffer) → AtlasdrawFile
  └── .felt / Felt-Export.zip → importFelt(buffer) → AtlasdrawFile
  │
  ▼
GeoJSON.FeatureCollection (or AtlasdrawFile)
  │
  ▼
apps/atlas-app creates layer record via useLayerRegistry (Zustand)
adds features to scene via geoToExcalidraw + excalidrawAPI.updateScene
```

[CONFIDENCE: high — per tech spec §4.3, Phase 2–3 plans]

---

## `.atlasdraw` Format Serialization Flow

```
WRITE:
  AtlasdrawFile (in-memory)
    ├── elements: excalidrawAPI.getSceneElements()
    │     each element.customData.geo preserved as-is (GeoAnchor discriminated union)
    │     field name: "geo" (not "geoAnchor" — MISMATCH-3 fix)
    ├── layers: LayerRegistry snapshot
    ├── basemapStyleId: current style
    └── viewport: map.getCenter() + map.getZoom()
    │
    ▼
  JSON.stringify → Blob (UTF-8)

PARSE:
  JSON.parse → validate version field
    ├── version < current → run migration(s) if any
    │     (future: migration table for each version bump)
    └── validate element.customData.geo shape:
          if flat object found (legacy/mismatch), coerce to discriminated union
          emit console.warn for schema drift
    │
    ▼
  AtlasdrawFile (typed, normalized)
```

[CONFIDENCE: high — per tech spec §6, Phase 2 plan]

---

## CSV Coordinate Detection Flow

```
csv.parse(buffer)
  │
  ▼
Papa.parse(string, { header: true })
  │
  ▼
detectLatLngColumns(headers)
  ├── Strategy 1: Name heuristics
  │     lat candidate: "lat" | "latitude" (case-insensitive)
  │     lng candidate: "lng" | "lon" | "longitude" (case-insensitive)
  │
  └── Strategy 2: Column statistics (if strategy 1 fails)
        for each numeric column:
          sample 50 rows → check range
          lat range: [-90, 90]
          lng range: [-180, 180]
          pick highest-confidence candidate pair
  │
  ▼
Each row → GeoJSON Point feature
  { type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { ...remainingColumns } }
```

[CONFIDENCE: high — per tech spec §4.3]

---

## YjsLayer CRDT Model

The Yjs document structure (Phase 5):

```
Y.Doc
└── ydoc.getMap("layers")  →  Y.Map<layerId, LayerEntry>
      └── LayerEntry: Y.Map
            ├── "meta": Y.Map  (name, visible, source, ...)
            └── "features": Y.Map<featureId, FeatureEntry>
                  └── FeatureEntry: Y.Map
                        ├── "type": string (Point | LineString | Polygon)
                        ├── "properties": Y.Map<string, unknown>
                        └── "geometry": Y.Map
                              ├── "type": string
                              └── "coordinates": Y.Array<Y.Array<[number, number]>>
```

**CRDT merge semantics:** `addFeature` / `deleteFeature` are last-write-wins on the `features` map. `setProperty` is last-write-wins on the properties sub-map. `appendVertex` / `deleteVertex` operate on `Y.Array` — append is order-preserving; delete is index-based (callers must coordinate on indices for concurrent deletes).
[CONFIDENCE: high — per Phase 5 plan Task 4]

---

## Endorheic Basins

`packages/data` is stateless at the module level — no module-level caches or registries. All state lives in:
- The `Y.Doc` instance in `YjsLayer` (caller-owned)
- The Zustand slice at `apps/atlas-app/state/store.ts` (not in this package)

Parser functions are pure async functions — same input always produces same output (modulo file system reads, which are the caller's responsibility).

---

## Felt Importer Behavior (Phase 6, Q13)

```
importFelt(source)
  │
  ├── source is ArrayBuffer → detect if ZIP (magic bytes PK\x03\x04)
  │     └── unzip → find GeoJSON file → parse
  │
  └── source is string → treat as GeoJSON text → geojson.parse()
  │
  ▼
Map Felt layer model → LayerRecord[]
  for each Felt feature type:
    ├── known types (Point, LineString, Polygon, ...) → map to GeoAnchor
    └── unknown types → console.warn("Unknown Felt type: X") → skip feature
  │
  ▼
AtlasdrawFile (partial output if any unknown types skipped)
  Never throws. Always returns.
```

[CONFIDENCE: high — per Phase 6 plan Task 15, Q13 constraint]

---

## Concurrency Model

All `parse`/`write` functions are async Promises. In Phase 3+ there is no Worker offloading — parsing happens on the main thread. Large shapefiles (>50 MB) may block the UI; this is a known limitation noted in Phase 3.

Future: move `shapefile.parse` and `csv.parse` to a dedicated Worker via `comlink` for non-blocking parsing. This is Phase 4+ territory — not yet planned.
[CONFIDENCE: med — Worker offload is speculative extrapolation]
