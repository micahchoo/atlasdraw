# Phase 2 Open-Questions Research Notes

**Resolver:** open-questions-resolver agent  
**Date:** 2026-05-03  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md`  
**Status:** All 5 questions resolved (4 confirmed, 1 plan amended)

---

## OQ-P2-1 — LayerRegistry ID space: `"dl:"` prefix vs typed field

**Research method:** Logical analysis against Phase 5 Yjs constraint + existing `LayerRegistryEntry` discriminated union shape.

**Finding:** The `"dl:"` prefix is correct and sufficient. Excalidraw element IDs are bare UUIDs (no prefix). Yjs Y.Map keys are arbitrary strings — the prefix prevents any accidental collision at zero cost. The `kind` field already handles TypeScript-level discrimination; the prefix adds observability in logs/diffs/manifests. No source contradicts this approach.

**Decision:** CONFIRMED. Plan default stands. `registerDataLayer` enforces `id.startsWith("dl:")`.

**Sources:** Phase 5 constraint from `open-questions-resolution.md` Q2 (Yjs); Excalidraw element ID format (UUID, no prefix).

---

## OQ-P2-2 — PNG export resolution: DPR × 2 vs fixed 2×

**Research method:** MapLibre MapOptions API docs (maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/).

**Finding:** `map.getCanvas()` returns the backing WebGL canvas. On retina (DPR=2) devices, MapLibre internally creates this canvas at `cssWidth * devicePixelRatio` physical pixels already. So `getCanvas().width` is already 2× CSS on retina. The plan's `OffscreenCanvas(width * scale, height * scale)` with `scale=2` would produce `cssWidth * DPR * 2` — 4× logical resolution on retina, producing unexpectedly large files (16 megapixels for a 1280×800 viewport on a retina MacBook).

**Decision:** AMENDED. Use CSS logical pixel dimensions, not the physical canvas dimensions. Fix: `const { clientWidth: width, clientHeight: height } = mapCanvas;` rather than `mapCanvas.width/height`. Then `OffscreenCanvas(width * scale, height * scale)` with `scale=2` always produces exactly 2× CSS pixels regardless of DPR. T15 implementation step amended accordingly.

**Constraint imposed:** The `exportPNG` function must read `mapCanvas.clientWidth`/`clientHeight` (CSS pixels), not `mapCanvas.width`/`height` (physical pixels). This is the load-bearing change.

**Sources:** MapLibre MapOptions docs — `preserveDrawingBuffer` note; WebGL canvas sizing behavior (physical vs CSS pixel dimensions).

---

## OQ-P2-3 — MapLibre `moveLayer` cost: does it trigger re-tile or full re-render?

**Research method:** MapLibre source — `maplibre-gl-js/src/ui/map.ts` line 2851; MapLibre Map API docs.

**Finding:** `map.moveLayer(id, beforeId?)` is a first-class MapLibre method (not a `removeLayer`+`addLayer` workaround). It operates on **style layer ordering only** — it does not touch the source data. For GeoJSON sources (client-side, all data resident in memory), there is no server tile re-fetch. The operation triggers a single repaint (one WebGL frame re-draw). For tile-based (vector/raster) sources, tile data is already cached in the GPU — no re-fetch on layer reorder. The concern about `removeLayer`+`addLayer` being needed is moot: `moveLayer` exists and is cheap.

**Decision:** CONFIRMED with clarification. The plan's assumption holds. `moveLayer` is the correct call; it does not trigger re-tile. T12 LayerPanel executor should call `map.moveLayer(id, beforeId)` directly — no need for remove+re-add.

**Sources:** MapLibre GL JS source `ui/map.ts:2851`; MapLibre API docs `Map.moveLayer()` parameter table.

---

## OQ-P2-4 — Convert-to-data-layer: disabled or hidden for text/arrow?

**Research method:** UX reasoning + accessibility standards.

**Finding:** Disabled-with-tooltip is the correct pattern for communicating a capability boundary that exists due to type constraints rather than state. Hiding the item entirely removes discoverability — users won't understand why the option exists for polygons but not for text. The tooltip surfaces the reason. Standard accessible UI practice: disable + describe > silently hide when the constraint is architectural (not conditional).

**Decision:** CONFIRMED. Plan default stands: disabled state with tooltip `"Text and arrow annotations cannot be converted to data layers"`.

**Sources:** WCAG 2.1 advisory technique (inform users of disabled controls); UX principle — "don't hide, explain."

---

## OQ-P2-5 — GeoJSON validation library: inline vs `@placemarkio/check-geojson`

**Research method:** GitHub repository inspection for both `mapbox/geojsonhint` and `placemark/check-geojson`.

**Key findings:**

1. `mapbox/geojsonhint` was **archived on May 29, 2024** with the explicit notice: "IMPORTANT: This repo will be archived. Use @placemarkio/check-geojson instead." It is now read-only.

2. `@placemarkio/check-geojson` is the active successor. It is TypeScript-native, uses `momoa` for JSON parsing with line-level error reporting, and is explicitly designed for "validating user-generated GeoJSON content." However, its README notes: **"the API is not yet stable."**

3. Critically, `@placemarkio/check-geojson` explicitly **does not** check right-hand rule / winding order or the `crs` member. These are the edge cases the plan notes we don't currently surface in the UI.

4. `ajv` (generic JSON Schema Validator) is not GeoJSON-specific and would require maintaining a copy of the GeoJSON schema — unnecessary overhead.

**Decision for OQ-P2-5:** Plan default (inline validation in T10) is confirmed for Phase 2. The `@placemarkio/check-geojson` "not yet stable" API warning makes it unsuitable for a locked phase plan. Inline validation covers our actual use cases (type check, geometry non-null, features array). Amend the plan note to correctly identify `@placemarkio/check-geojson` as the relevant library (not `geojsonhint`, which is archived) and to note the "not yet stable" caveat as the blocking reason for deferral to Phase 3.

**Sources:**
- github.com/mapbox/geojsonhint — archived May 29, 2024, banner: "IMPORTANT: This repo will be archived."
- github.com/placemark/check-geojson — README: "A spiritual successor to geojsonhint, which is no longer maintained"; "the API is not yet stable."

---

## Supplementary: Turf.js function geodesic accuracy

**Context:** OQ-P2-1 touches `@turf/distance` and `@turf/circle` correctness; T05 touches `@turf/simplify` tolerance.

**Findings:**

- `@turf/distance` (v7.3.0): Uses the **Haversine formula** to account for global curvature. Geodesic. Accurate for circle radius readout in km/mi at all scales. Source: turfjs.org/docs/api/distance.

- `@turf/circle` (v7.3.0): Generates a **geodesic polygon** using bearing + distance offsets from center. Default 64 steps. Source: turfjs.org/docs/api/circle. The convert-to-data-layer output for circles will be a 64-vertex geodesic polygon — correct behavior for geographic coordinates.

- `@turf/simplify` (v7.3.0): Uses **simplify-js (2D RDP/Visvalingam)**. Default `tolerance: 1` (interpreted in the coordinate system's units — degrees for geographic GeoJSON). `tolerance: 1` = ~111km at the equator — catastrophically coarse for street-level freehand. The plan's `epsilon=0.00001°` (≈1.1m) is correct for freehand at zoom 12–18. This is NOT a new finding but confirms the plan's explicit override is load-bearing and must not be removed. Source: turfjs.org/docs/api/simplify.

---

## Summary Table

| OQ | Question | Resolution | Tasks affected |
|---|---|---|---|
| OQ-P2-1 | ID prefix vs kind field | CONFIRMED: `"dl:"` prefix | T01, T11 unchanged |
| OQ-P2-2 | PNG DPR × 2 vs fixed 2× | AMENDED: use `clientWidth/clientHeight` | T15 Step 2 amended |
| OQ-P2-3 | moveLayer re-tile cost | CONFIRMED: no re-tile; `moveLayer` exists | T12 clarified |
| OQ-P2-4 | disabled vs hidden for text/arrow | CONFIRMED: disabled + tooltip | T14 unchanged |
| OQ-P2-5 | inline vs library validation | CONFIRMED inline; note geojsonhint archived | T10 note amended |
