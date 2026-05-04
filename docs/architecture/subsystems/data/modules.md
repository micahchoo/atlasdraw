# `packages/data` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/data`

---

## Internal Module Dependency Graph

```
packages/data/
├── index.ts                    ← barrel export
│
├── layer-registry.ts           ← type declarations only; NO runtime deps
│
├── geojson.ts                  ← pivot format; NO internal deps
│   └── ext: geojson types
│
├── kml.ts                      ← ext: @tmcw/togeojson
│
├── gpx.ts                      ← ext: @tmcw/togeojson
│
├── csv.ts                      ← ext: papaparse
│
├── shapefile.ts                ← ext: shpjs
│
├── geotiff.ts                  ← ext: geotiff (COG)
│
├── atlasdraw.ts                ← deps: packages/geo (GeoAnchor, geoToExcalidraw,
│   │                                         excalidrawToGeo)
│   └── ext: @excalidraw element types
│
├── felt.ts                     ← deps: geojson.ts
│   │                              ext: (none — permissive inline parsing)
│   └── (Phase 6)
│
├── yjs-layer.ts                ← ext: yjs
│   └── (Phase 5)
│
└── yjs-snapshot.ts             ← deps: yjs-layer.ts, geojson.ts
                                   ext: yjs
                                   (Phase 5)
```

---

## ASCII Layering

```
┌────────────────────────────────────────────────────┐
│                    index.ts                        │
│                 (barrel export)                    │
└──┬───────────┬───────────┬───────────┬─────────────┘
   │           │           │           │
   ▼           ▼           ▼           ▼
geojson.ts  atlasdraw.ts  yjs-layer  layer-registry.ts
(pivot)       │            .ts        (types only)
              │            │
              ▼            ▼
        packages/geo   yjs-snapshot.ts
        (GeoAnchor,       │
         converters)      └── geojson.ts
                              yjs-layer.ts

kml / gpx / csv / shapefile / geotiff / felt
  (all independent; no inter-module deps within data)
```

---

## Layering Rules

1. **No React, no DOM.** `packages/data` is callable from Node.js, workers, and the CLI without a browser context. All `parse`/`write` functions are async but use only `Promise`/`ArrayBuffer` — no `File`, `FileReader`, or `Blob` DOM APIs in the core logic. (Callers may pass `Blob.arrayBuffer()` before calling parse.)
2. **GeoJSON is the pivot format.** All format modules produce and consume `GeoJSON.FeatureCollection`. No module converts directly between two non-GeoJSON formats — it goes through the pivot.
3. **`layer-registry.ts` is type-only.** It must never import Zustand or any state library. It is a type contract file only.
4. **`atlasdraw.ts` is the only module that imports from `packages/geo`.** Other format modules operate on GeoJSON and do not need geo-anchor types.
5. **`yjs-layer.ts` and `yjs-snapshot.ts` may only be imported in contexts where `yjs` is available.** They are tree-shaken — do not import them from the barrel unless you need Yjs.

---

## Knot Complement — Independent Refactor Units

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `geojson.ts` | Yes | No internal deps |
| `kml.ts` | Yes | Only calls `@tmcw/togeojson` |
| `gpx.ts` | Yes | Only calls `@tmcw/togeojson` |
| `csv.ts` | Yes | Only calls `papaparse` |
| `shapefile.ts` | Yes | Only calls `shpjs` |
| `geotiff.ts` | Yes | Only calls `geotiff` |
| `felt.ts` | Yes | Calls `geojson.ts` (stable interface) |
| `layer-registry.ts` | Yes | Pure types |
| `yjs-layer.ts` | Yes | No internal deps beyond `yjs` |
| `yjs-snapshot.ts` | Partially | Depends on `yjs-layer.ts` and `geojson.ts` interfaces |
| `atlasdraw.ts` | Partially | Depends on `packages/geo` — refactor-safe if geo interface is stable |

---

## External Dependencies

| Dep | Usage | Phase |
|-----|-------|-------|
| `@tmcw/togeojson` | kml, gpx | Phase 3 |
| `papaparse` | csv | Phase 3 |
| `shpjs` | shapefile | Phase 3 |
| `geotiff` | geotiff (COG) | Phase 3 |
| `yjs` | yjs-layer, yjs-snapshot | Phase 5 |
| `packages/geo` | atlasdraw.ts only | Phase 2 |
| `geojson` | type-only across all modules | Phase 0 |

---

## Package Boundary

`packages/data` must not import from:
- `packages/basemap`
- `packages/tools`
- `packages/sdk`
- `apps/*`

It may import from:
- `packages/geo` (for `GeoAnchor`, `geoToExcalidraw`, `excalidrawToGeo` in `atlasdraw.ts`)
- `packages/excalidraw-vendored` (element types, type-only)
