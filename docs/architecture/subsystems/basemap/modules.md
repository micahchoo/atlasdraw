# `packages/basemap` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0
**Package name:** `@atlasdraw/basemap`

---

## Internal Module Dependency Graph

```
packages/basemap/
├── index.ts                        ← barrel export
│
├── MapCanvas.tsx                   ← React component (ONLY React-touching file)
│   ├── deps: BasemapRegistry.ts
│   ├── deps: pmtiles-protocol.ts
│   └── ext: maplibre-gl, react
│
├── BasemapRegistry.ts              ← module-level Map<string, StyleEntry>
│   └── deps: (none internal)
│       ext: (none)
│
├── pmtiles-protocol.ts             ← singleton registration guard
│   └── ext: pmtiles, maplibre-gl
│
├── style-builder.ts                ← assembles StyleSpecification
│   ├── deps: BasemapRegistry.ts
│   └── ext: maplibre-gl types
│
└── style-compiler.ts               ← LayerStyle → MapLibre expression
    └── ext: maplibre-gl types (type-only)
```

---

## ASCII Layering

```
┌──────────────────────────────────────────────────────┐
│                     index.ts                         │
│                  (barrel export)                     │
└────┬──────────────┬──────────────────────────────────┘
     │              │
     ▼              ▼
MapCanvas.tsx   style-builder.ts    style-compiler.ts
     │              │
     ▼              ▼
pmtiles-protocol  BasemapRegistry.ts
     │
     ▼
 (maplibre-gl singleton — global side effect, guarded)
```

---

## Layering Rules

1. **React is allowed only in `MapCanvas.tsx`.** All other modules must remain React-free so they are callable from `packages/cli` and tests without a DOM.
2. **`style-compiler.ts` has zero runtime deps** — no imports, only TypeScript type imports from `maplibre-gl`. This keeps it tree-shakeable and prevents the compiler from pulling in MapLibre at bundle time in non-map contexts.
3. **`pmtiles-protocol.ts` is a side-effecting module.** It modifies the global `maplibregl` singleton. The guard prevents double-registration but the side effect is real. Do not import it in contexts where the global is absent (SSR, workers) — use the `registerPmtilesProtocol()` exported function instead and guard with an environment check.
4. **`BasemapRegistry` is a module-level singleton.** In tests, call `BasemapRegistry.reset()` (internal test helper) to restore default registrations.

---

## Knot Complement — Independent Refactor Units

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `style-compiler.ts` | Yes | No internal deps; can be replaced wholesale |
| `BasemapRegistry.ts` | Yes | Only `MapCanvas` and `style-builder` consume it |
| `pmtiles-protocol.ts` | Yes | Only `MapCanvas` calls it; swap for a different PMTiles implementation without changing the interface |
| `style-builder.ts` | Yes | Depends on `BasemapRegistry` interface, not impl |
| `MapCanvas.tsx` | Partially | Depends on `BasemapRegistry` and `pmtiles-protocol` interfaces; can be refactored if interfaces held |

---

## External Dependencies

| Dep | Usage | Notes |
|-----|-------|-------|
| `react` | `MapCanvas.tsx` only | peerDep; not bundled |
| `maplibre-gl` | `MapCanvas`, `pmtiles-protocol`, `style-builder` types | Core dep |
| `pmtiles` | `pmtiles-protocol.ts` | Registers protocol handler |

---

## Package Boundary

`packages/basemap` must not import from:
- `packages/data`
- `packages/tools`
- `packages/sdk`
- `apps/*`

It may import from:
- `packages/geo` (for `GeoAnchor` types if needed in future style-by-geo-type logic — currently not used)
- `packages/excalidraw-vendored` (type-only, if element types are needed)
