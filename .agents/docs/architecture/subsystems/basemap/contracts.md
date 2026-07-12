# `packages/basemap` — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MPL-2.0 (per Q5)
**Package name:** `@atlasdraw/basemap`

---

## Public Export Surface

All exports from `packages/basemap/index.ts`.

---

### Components

#### `MapCanvas` — **stable**
[CONFIDENCE: high — per Phase 1 plan Task 3]

```ts
export interface MapCanvasProps {
  styleId?: string;           // default: "protomaps-light"
  onLoad?: (map: maplibregl.Map) => void;
  className?: string;
}

export const MapCanvas: React.ForwardRefExoticComponent<
  MapCanvasProps & React.RefAttributes<maplibregl.Map>
>;
```

Usage:
```tsx
const mapRef = useRef<maplibregl.Map>(null);
<MapCanvas ref={mapRef} styleId="protomaps-light" onLoad={handleLoad} />
```

**Invariant:** `ref.current` is a live `maplibregl.Map` after `onLoad` fires and until unmount. Style switches do not cause the ref to go null.

**Backward-compat policy (stable):** Props additions are additive. `ref` type is frozen at `maplibregl.Map`. `onLoad` signature is frozen.

---

### Registries

#### `BasemapRegistry` — **stable**
[CONFIDENCE: high — per Phase 1 plan]

```ts
export interface StyleEntry {
  type: "pmtiles" | "network";
  url: string;               // pmtiles:// or https://
  attribution?: string;
}

export const BasemapRegistry: {
  /** Register a custom basemap style. Call before <MapCanvas> mounts. */
  register(id: string, entry: StyleEntry): void;

  /** Look up a style entry by ID. Returns undefined if not found. */
  get(id: string): StyleEntry | undefined;

  /** List all registered IDs. */
  list(): string[];
};
```

**Built-in registrations (Phase 1):**
- `"protomaps-light"` — PMTiles bundled (offline capable, Q3)
- `"protomaps-dark"` — PMTiles bundled
- `"protomaps-satellite"` — network-backed
- `"openfreemap-liberty"` — OpenFreeMap demo (Q3: demo only, not for production self-hosting)

---

#### `registerPmtilesProtocol` — **stable**
[CONFIDENCE: high — per Phase 1 plan Task 3 Step 2]

```ts
export function registerPmtilesProtocol(): void;
```

Registers `pmtiles://` on the global `maplibregl` instance. Idempotent — safe to call multiple times (guarded by module-level boolean). Called automatically by `MapCanvas` on first mount; exported for manual use in SSR/test contexts.

---

### Style Building

#### `buildStyle` — **stable**
[CONFIDENCE: med]

```ts
export function buildStyle(
  styleId: string,
  dataLayers?: MapLibreLayerSpec[]
): maplibregl.StyleSpecification;
```

Resolves the style entry from `BasemapRegistry`, merges in the provided data layer specifications, and returns a valid `StyleSpecification`. Throws `StyleNotFoundError` if `styleId` is unregistered.

---

### Style Compiler

#### `LayerStyle` — **stable**
[CONFIDENCE: high — per Phase 6 plan Task 10, Phase 6 produces contract table]

```ts
export type LayerStyle =
  | {
      type: "solid";
      color: string;           // CSS color string
      opacity?: number;        // 0–1, default 1
    }
  | {
      type: "categorical";
      field: string;           // feature property name
      stops: Array<[string | number, string]>;  // [value, color]
      default?: string;        // fallback color
    }
  | {
      type: "graduated";
      field: string;
      stops: Array<[number, string]>;  // [value, color]
      interpolate: "linear" | "step";
    };
```

**Stability:** stable from Phase 6 (schema defined Phase 3, categorical/graduated Phase 6). Phase 7 plugin sandbox consumes this type — it is frozen from Phase 6 onward.

---

#### `compileLayerStyle` — **stable**
[CONFIDENCE: high — per Phase 6 plan Task 10]

```ts
export function compileLayerStyle(
  style: LayerStyle,
  layerType: "fill" | "line" | "circle" | "symbol"
): maplibregl.LayerSpecification;
```

Compiles a `LayerStyle` into a MapLibre `LayerSpecification` suitable for `map.addLayer()`.

- `"solid"` → direct `paint` property assignment
- `"categorical"` → `["match", ["get", field], ...stops, default]` expression
- `"graduated"` with `"linear"` → `["interpolate", ["linear"], ["get", field], ...stops]`
- `"graduated"` with `"step"` → `["step", ["get", field], ...stops]`

Output is deterministic: same input always produces the same MapLibre expression. This determinism is required by Phase 7 plugin-authored styles (Phase 6 produces contract: "MapLibre expression output is deterministic").

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `MapCanvas` | stable | Phase 1 |
| `BasemapRegistry` | stable | Phase 1 |
| `registerPmtilesProtocol` | stable | Phase 1 |
| `buildStyle` | stable | Phase 1 |
| `LayerStyle` (solid only) | stable | Phase 3 |
| `LayerStyle` (categorical/graduated) | stable | Phase 6 |
| `compileLayerStyle` (solid only) | stable | Phase 3 |
| `compileLayerStyle` (full) | stable | Phase 6 |

---

## License Notes

`packages/basemap` is MPL-2.0 (per Q5). This means:
- Modifications to files in this package must be shared under MPL-2.0.
- Applications that use (but do not modify) `@atlasdraw/basemap` are not affected by MPL copyleft.
- `packages/sdk` (MIT) may use `@atlasdraw/basemap` as a runtime peer dep — the SDK itself remains MIT-licensed as long as it does not bundle/inline modified basemap code.

---

## Backward-Compatibility Policy

Stable exports: no removal, no prop/param removal, no type narrowing. `LayerStyle` union may gain new variants in minors (consumers must handle unknown variant gracefully). `compileLayerStyle` output format may change to accommodate MapLibre spec updates, but the logical rendering intent must be preserved.
