# ADR 0003: Coordinate System (Two Stacked Surfaces)

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Two coordinate systems must coexist:

- **Excalidraw owns** — 2D scene coordinates (x, y, infinite canvas, unitless)
- **MapLibre owns** — Geographic coordinates (lng, lat, WGS84) rendered as Web Mercator

Keeping these synchronized is load-bearing: changing the map view must reposition every geographic element; changing an element's scene position must update its geographic anchor.

## Decision

**MapLibre is the source of truth for the camera.**

Excalidraw's scrollX, scrollY, and zoom are a derived view computed from the map's center and zoom level.

Every Excalidraw element carries a `customData.geo` field (a `GeoAnchor` discriminated union):

```
{
  kind: "point" | "bbox" | "polyline",
  lng: number,
  lat: number,
  zRef: number,           // reference zoom level for scale
  projection: "mercator"
}
```

**Synchronization process:**
1. On every `map.move` event, recompute each element's screen coordinates via `map.project()`
2. Update Excalidraw's internal position: `(x, y, width, height, points)` derived from geo anchor
3. Trigger Excalidraw render

Pitch is locked at 0° in v1 (parameter: `maxPitch: 0` at MapCanvas construction). Globe mode deferred to v2+.

## Consequences

### Positive
- Single source of truth eliminates sync drift
- Map view changes cascade correctly to all elements
- Geographic data is persistent and portable

### Negative / Risks
- **Performance budget** — Must recompute 5k+ elements per camera tick in <8ms
- **Pitch limitation** — No tilted map views in v1
- **Projection coupling** — Changes to projection require batch element recalculation

**Mitigation:**
- Phase 1 includes benchmark gate: must achieve <8ms per camera tick at 5k elements
- Spatial indexing in Phase 1 for efficient culling
- Future ADR can lift pitch constraint in v1.5 if perf allows

## References

- tech-spec.md §0, §3 (coordinate architecture)
- Phase 1 plan (performance gates)
- cross-phase-audit.md MISMATCH-1/3/5 (coordinate system gaps)
