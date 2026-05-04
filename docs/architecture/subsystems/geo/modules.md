# `packages/geo` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/geo`

---

## Internal Module Dependency Graph

```
packages/geo/
├── index.ts                    ← barrel; re-exports all public symbols
│
├── types.ts                    ← NO deps; pure type declarations
│   └── (consumed by everything below)
│
├── projection.ts               ← deps: maplibre-gl interface (injected)
│   └── (thin wrapper; swappable for headless impl)
│
├── CoordinateSync.ts           ← deps: types.ts, projection.ts
│   │                              ext: maplibre-gl, @excalidraw API
│   └── (core hot-path; see behavior.md)
│
├── geoToExcalidraw.ts          ← deps: types.ts
│   │                              ext: geojson types, @excalidraw element types
│   └── (import-time bridge)
│
├── excalidrawToGeo.ts          ← deps: types.ts
│   │                              ext: geojson types, @excalidraw element types
│   └── (export-time bridge)
│
├── measure.ts                  ← deps: types.ts
│   │                              ext: @turf/turf (area, length, centroid)
│   └── (real-world measurements)
│
└── bounds.ts                   ← deps: types.ts
                                   ext: maplibre-gl (LngLatBounds)
                                   (bounding box for selection/export)
```

Dependency direction: always from higher-level → `types.ts`. Types has no internal deps. This is a strict DAG.

---

## ASCII Layering

```
┌──────────────────────────────────────────────────────────┐
│                      index.ts                            │
│                   (barrel export)                        │
└────────┬─────────┬──────────┬────────┬──────────────────┘
         │         │          │        │
         ▼         ▼          ▼        ▼
  CoordinateSync  geo↔Excalidraw   measure   bounds
   projection.ts   converters    (turf.js)
         │              │
         └──────┬────────┘
                ▼
            types.ts
         (GeoAnchor etc.)
```

---

## Knot Complement — Independent Refactor Units

The following modules can be refactored independently without touching others:

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `types.ts` | **No** — it's the root | Any type change is a breaking change for all consumers |
| `projection.ts` | Yes | Only `CoordinateSync` calls it; can swap impl for headless |
| `geoToExcalidraw.ts` | Yes | No inter-module deps beyond types |
| `excalidrawToGeo.ts` | Yes | No inter-module deps beyond types |
| `measure.ts` | Yes | Only `packages/tools` calls it externally |
| `bounds.ts` | Yes | Only `packages/tools` and `packages/data` call it |
| `CoordinateSync.ts` | Partially | Depends on `projection.ts`; if `projection.ts` interface is stable, CoordinateSync can be refactored |

---

## Layering Rules

1. **No React imports anywhere in this package.** The package.json `peerDependencies` must not include `react`. Violation is a CI failure.
2. **No DOM APIs** (no `document`, `window`, `requestAnimationFrame`). `CoordinateSync` uses event listeners on `maplibregl.Map` only — the map instance owns the event loop.
3. **No async I/O.** All functions are synchronous. The only exception is if Turf is ever swapped for a WASM implementation — wrap in a sync-compatible shim.
4. **Injection pattern for MapLibre.** `CoordinateSync` and `projection.ts` receive the `maplibregl.Map` instance by parameter injection, never by global import. This is what makes the package testable in Node and callable from the CLI.
5. **Pure functions at the leaf level.** `geoToExcalidraw`, `excalidrawToGeo`, `measure.*`, `bounds` have no side effects. They are referentially transparent given the same inputs.

---

## External Dependencies

| Dep | Usage | Tree-shaken? |
|-----|-------|-------------|
| `maplibre-gl` | `Map` type + `project`/`unproject` methods | Type-only in projection.ts; runtime in CoordinateSync |
| `@turf/turf` | `area`, `length`, `centroid`, `feature` | Yes — only named imports |
| `geojson` | Type definitions only | Type-only (no runtime) |
| `@excalidraw/excalidraw` (vendored) | `ExcalidrawAPI`, element types, `ExcalidrawElementSkeleton` | Type-only |

No runtime dependency on React, ReactDOM, or any browser-only API.

---

## Package Boundary

`packages/geo` must not import from:
- `packages/basemap` (would create a circular dependency)
- `packages/data`
- `packages/tools`
- `packages/sdk`
- `apps/*`

The dependency graph is strictly: `apps/*` and `packages/*` → `packages/geo`, never the reverse.
