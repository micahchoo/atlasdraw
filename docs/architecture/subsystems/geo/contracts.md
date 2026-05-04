# `packages/geo` — Contracts

<!-- updated 2026-05-04: aligned with Wave 0 implementation; see decisions/phase0-ci-evidence.md drifts D-GEO-1 (geo), D-TOOLS-4/6 (tools). Implementation is canonical. -->

**Status: Wave 0 implementation-aligned.** Speculative pre-code contracts updated against real code.

**License:** MIT (per Q5 / decisions/0002-license-split.md)
**Package name:** `@atlasdraw/geo`

---

## Public Export Surface

All exports from `packages/geo/index.ts`. TypeScript-style signatures given.

---

### Types

#### `GeoAnchor` — **stable**
[CONFIDENCE: high — per Phase 1 plan, tech spec §3.1, E-03/escalations.md, Q12]

**Canonical discriminated union. Field on Excalidraw elements: `element.customData.geo`. Field name is `geo`, NOT `geoAnchor` (MISMATCH-3 correction).**

```ts
export type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };
```

**Backward-compat policy (stable):** The three `kind` variants are frozen from Phase 1 onward. New variants may be added in a minor release; consuming code must handle an unknown `kind` gracefully (type-narrowing exhaustiveness check recommended). Field names within each variant are frozen. `projection` is NOT a field on individual `GeoAnchor` variants — it lives on the `GeoCustomData` wrapper (see below). Future CRS support will be a new variant, not a mutation of existing ones.

**Cross-phase audit note:** MISMATCH-1 (Phase 3 consumer), MISMATCH-5 (Phase 5 consumer) both describe a flat `{lng, lat, zoom}` shape. Those are wrong. This discriminated union is authoritative. Any downstream module using a flat shape must be corrected. MISMATCH-3: field is `customData.geo` not `customData.geoAnchor`.

---

#### `GeoCustomData` — **stable**
[CONFIDENCE: high]

```ts
export type GeoCustomData = {
  geo: GeoAnchor;
  scaleMode: ScaleMode;
  projection: "mercator";   // Q12: always "mercator" in v1; CoordinateSync asserts this and throws otherwise. Future: globe view (v2+).
  schemaVersion: 1;
};
```

This is the shape stored in `ExcalidrawElement.customData`. Not all Excalidraw elements have geo data (native Excalidraw shapes without a geo anchor will have `customData.geo === undefined`). `projection` and `schemaVersion` live here at the wrapper level, NOT on individual `GeoAnchor` variants.

---

#### `ScaleMode` — **stable**
[CONFIDENCE: high — per tech spec §3.2]

```ts
export type ScaleMode =
  | "geographic"   // element scales with map zoom (default for drawn shapes)
  | "screen"       // element stays fixed pixel size (pins, annotations)
  | "hybrid";      // scales but clamps at min/max pixel size
```

---

#### `Projection` — **stable**
[CONFIDENCE: med — spec implies mercator-only; type exists for future extensibility per Q12]

```ts
export type Projection = "mercator";  // v1: only mercator; type reserved for future
```

---

### Classes / Objects

#### `CoordinateSync` — **stable**
[CONFIDENCE: high — per Phase 1 plan, tech spec §3]

```ts
export class CoordinateSync {
  constructor(opts: {
    map: maplibregl.Map;
    excalidrawAPI: ExcalidrawAPI;
    throttleMs?: number;  // default 16
  });

  /** Attach map event listeners. Call once after map.loaded(). */
  attach(): void;

  /** Remove all event listeners. Call on React component unmount. */
  detach(): void;

  /**
   * Re-project all geo-anchored elements to current map viewport.
   * Hot-path — called on every camera event.
   * Never writes customData.geo; only writes x/y/width/height/points.
   */
  syncMapToScene(): void;

  /** Freeze sync (e.g. during active drawing). */
  freeze(): void;

  /** Resume sync after freeze. Immediately calls syncMapToScene(). */
  thaw(): void;
}
```

**Stability:** stable from Phase 1. `freeze()`/`thaw()` added Phase 2 when tools need to suppress camera-sync during active stroke.

---

### Functions

#### `geoToExcalidraw` — **stable**
[CONFIDENCE: high — per tech spec §4.1]

```ts
export function geoToExcalidraw(
  feature: GeoJSON.Feature,
  opts?: { scaleMode?: ScaleMode }
): ExcalidrawElementSkeleton;
```

Converts a GeoJSON Feature into an Excalidraw element skeleton with `customData.geo` populated. Input geometry type determines `GeoAnchor.kind`: `Point` → `"point"`, `LineString`/`MultiLineString` → `"polyline"`, `Polygon`/`MultiPolygon` → `"polyline"` (closed ring).

---

#### `excalidrawToGeo` — **stable**
[CONFIDENCE: high — per tech spec §4.1]

```ts
export function excalidrawToGeo(
  element: ExcalidrawElement
): GeoJSON.Feature | null;
```

Inverse of `geoToExcalidraw`. Returns `null` for elements without `customData.geo`.

---

#### `projectElement` — **stable**
[CONFIDENCE: high — per Phase 1 plan Flow A]

```ts
export function projectElement(
  element: ExcalidrawElement,
  map: maplibregl.Map
): Partial<ExcalidrawElement>;
```

Reads `customData.geo`, calls `map.project()` for each coordinate, returns the updated `x/y/width/height/points` fields. Called by `CoordinateSync.syncMapToScene()` in the hot-path loop.

---

#### `measure.area` — **stable**
[CONFIDENCE: high — per tech spec §4.1]

```ts
export function area(element: ExcalidrawElement): number;  // m²
```

---

#### `measure.length` — **stable**
[CONFIDENCE: high — per tech spec §4.1]

```ts
export function length(element: ExcalidrawElement): number;  // meters
```

---

#### `measure.centroid` — **stable**
[CONFIDENCE: high]

```ts
export function centroid(element: ExcalidrawElement): GeoJSON.Position;  // [lng, lat]
```

---

#### `bounds` — **stable**
[CONFIDENCE: high — per tech spec §4.1]

```ts
export function bounds(
  elements: readonly ExcalidrawElement[]
): maplibregl.LngLatBoundsLike | null;
```

Returns `null` if no elements have geo anchors.

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `GeoAnchor` | stable | Phase 1 |
| `GeoCustomData` | stable | Phase 1 |
| `ScaleMode` | stable | Phase 1 |
| `Projection` | stable | Phase 1 |
| `CoordinateSync` | stable | Phase 1 |
| `geoToExcalidraw` | stable | Phase 1 |
| `excalidrawToGeo` | stable | Phase 1 |
| `projectElement` | stable | Phase 1 |
| `area`, `length`, `centroid` | stable | Phase 2 |
| `bounds` | stable | Phase 2 |

---

## License Notes

All files in `packages/geo` are MIT-licensed (per Q5, decisions/0002-license-split.md). This is intentional: `packages/geo` must be embeddable in the MIT-licensed `packages/sdk` without license contamination.

---

## Backward-Compatibility Policy

Stable exports: no removal, no rename, no type narrowing without a major version bump. New overloads and optional parameters are additive and allowed in minors. The `GeoAnchor` variant set is frozen in v1; new CRS support is a new variant, not a mutation.
