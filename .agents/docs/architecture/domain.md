# Atlasdraw — Domain

**Status:** Verified against v1.0.0 source (2026-05-15). Replaces prior speculative edition.

---

## Domain Summary

Atlasdraw is an open-source, self-hostable collaborative web map studio. It stacks an Excalidraw drawing surface on top of a MapLibre GL JS basemap so that hand-drawn annotations (freehand sketches, arrows, labels, polygons) stay geographically anchored under pan, zoom, and collaborative editing. The product serves the **prosumer cartography market** — the gap between GIS desktop tools (QGIS, ArcGIS) and consumer map builders (Google My Maps). The explicit reference class is "what Figma is to Sketch for design" applied to maps (PRD §2), and it directly targets users displaced when Felt pivoted to enterprise GIS in 2025.

[CONFIDENCE: high — verified against README, PRD §1–2, and code/apps/atlas-app/src/components/MapEditor.tsx line 4–6 (the component docblock that states "Stacks MapLibre GL (bottom) + Excalidraw (top, transparent)")]

### Key differentiators

- **Self-hostable** — one `docker compose up` (AGPL-3.0, no open-core split).
- **Local-first** — IndexedDB persistence (idb) + bundled PMTiles basemap; no network required in default config.
- **File-portable** — `.atlasdraw` is a zipped bundle of JSON + GeoJSON. Human-readable, diff-friendly, importable into QGIS.
- **Real-time collaboration** — Yjs CRDT + Socket.IO relay, inherited from the Excalidraw upstream.
- **Not a GIS** — no raster algebra, network analysis, or coordinate reprojection outside Mercator.

[CONFIDENCE: high — verified against MapEditor.tsx persistence wiring (lines 667–754, using idb), bundled PMTiles path (line 609), and code/apps/realtime/src/]

---

## Core Capabilities

What the system actually does, verified against source code:

| Capability | Status | Evidence |
|---|---|---|
| Stacked MapLibre + Excalidraw with CoordinateSync | Shipped | MapEditor.tsx lines 4–6, useCoordinateSync hook |
| Drawing tools: pin, polygon, polyline, freehand, text, arrow, rectangle, circle | Shipped | packages/tools/src/index.ts exports all 8 tools |
| GeoAnchor discriminated union (point/bbox/polyline) + ScaleMode | Shipped | packages/geo/src/types.ts lines 16–39 |
| LayerPanel (sidebar tab in Excalidraw's DefaultSidebar) | Shipped | MapEditor.tsx lines 1011–1018, LayerPanel.tsx |
| Basemap picker + basemap registry | Shipped | BasemapPickerDialog.tsx, packages/basemap/src/BasemapRegistry.ts |
| Maputnik style editing in modal | Shipped | MaputnikDialog.tsx, MapEditor.tsx lines 1451–1465 |
| Categorical + graduated layer styling | Shipped | StylePanel.tsx, ColorRampPicker.tsx |
| GeoJSON drag-and-drop import | Shipped | MapEditor.tsx lines 800–865, packages/data/src/geojson.ts |
| CSV import with lat/lng or address geocoding | Shipped | packages/data/src/csv.ts, geocode.ts (Photon) |
| Shapefile import | Shipped | packages/data/src/shapefile.ts |
| `.atlasdraw` zip format (read/write) | Shipped | packages/data/src/atlasdraw.ts |
| `.atlasdraw.json` pure-JSON format | Shipped | packages/data/src/atlasdraw-json.ts |
| PNG composite export (basemap + annotations) | Shipped | MapEditor.tsx lines 1077–1094, export.ts |
| PDF print layout (pdf-lib) | Shipped | PrintDialog.tsx, MapEditor.tsx lines 1496–1509 |
| GeoJSON export of geo-anchored annotations | Shipped | MapEditor.tsx lines 200–276 |
| Real-time collab (Yjs + Socket.IO) | Shipped | apps/realtime/src/, packages/data/src/yjs-layer.ts |
| Presence + cursors | Shipped | useCollab hook, PresenceList.tsx |
| Anchored comments (Y.Doc threads) | Shipped | CommentsPanelHost.tsx, CommentAnchorsOverlay.tsx |
| Photon geocoder client (opt-in) | Shipped | packages/data/src/geocode.ts |
| Asset library (.excalidrawlib reader + curated atlas fixtures) | Shipped | AssetLibraryPanel.tsx, packages/data/src/asset-library.ts |
| Workspace abstraction + hosted/managed mode | Shipped | WorkspaceSwitcher.tsx, state/workspace.ts |
| Annotation-to-data-layer conversion | Shipped | tools/src/convert.ts, MapEditor.tsx lines 964–1002 |
| Accessibility: FocusTrap, AriaAnnouncer | Shipped | MapEditor.tsx line 63 (AriaAnnouncer), FocusTrap across dialogs |
| Zustand state management | Shipped | state/layerRegistry.ts, state/collab.ts, state/persistence.ts |
| CLI (headless lint/convert/render stub) | Shipped | packages/cli/src/ |

**Features listed in README/PRD but NOT found in v1.0 code:**

| Claimed feature | Status | Notes |
|---|---|---|
| KML/KMZ importer | NOT IMPLEMENTED | No parser in packages/data/src/ |
| GPX importer | NOT IMPLEMENTED | No parser in packages/data/src/ |
| GeoTIFF importer | NOT IMPLEMENTED | No parser in packages/data/src/ |
| Spatial transforms (buffer/intersect/union/centroid/simplify) | NOT IMPLEMENTED | No Turf.js wrappers found; PRD lists this for v1.0 but code does not ship it |
| Route-snap tool (OSRM/Valhalla) | NOT IMPLEMENTED | PolylineTool exists but no route-snapping wrapper |
| Embed widget / SDK | STUB ONLY | packages/sdk/ exists as a package slot; README explicitly marks out of scope |

[CONFIDENCE: high — all claims verified against file system and grep of packages/data/src/ and packages/tools/src/]

---

## Domain Concepts

These terms have precise technical meanings within Atlasdraw, verified against source code.

### Spatial concepts

**annotation** — An Excalidraw element (freehand, shape, text, arrow, etc.) that carries geographic anchor data in its `customData.geo` field. Survives map pan/zoom via CoordinateSync. Two characteristics define it: (a) it is managed by Excalidraw's scene graph, and (b) its `customData` passes the `isGeoCustomData()` type guard (packages/geo/src/types.ts line 56). [CONFIDENCE: high]

**data layer** — A MapLibre-rendered GeoJSON source, managed by the LayerRegistry (Zustand slice in state/layerRegistry.ts). Has its own style (fillColor, opacity), visibility toggle, and ordering separate from annotations. Created via drag-and-drop GeoJSON import (MapEditor.tsx lines 800–865) or annotation-to-data-layer conversion (lines 964–1002). [CONFIDENCE: high]

**GeoAnchor** — The discriminated union anchoring an Excalidraw element to map coordinates. Defined in packages/geo/src/types.ts lines 16–19:
```typescript
{ kind: "point"; lng: number; lat: number; zRef: number }
| { kind: "bbox"; west; south; east; north; zRef: number }
| { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number }
```
Field path on the Excalidraw element: `customData.geo` (NOT `customData.geoAnchor`). The `zRef` field records the MapLibre zoom level at creation time for scaling calculations. [CONFIDENCE: high — verified against packages/geo/src/types.ts]

**GeoCustomData** — The wrapper type around GeoAnchor. Contains `{ geo, scaleMode, projection: "mercator", schemaVersion: 1 }` (packages/geo/src/types.ts lines 34–39). `scaleMode` is one of `"geographic" | "screen" | "hybrid"` (line 25). [CONFIDENCE: high]

**basemap** — A MapLibre style registered in BasemapRegistry (packages/basemap/src/BasemapRegistry.ts). Each entry has an `id`, `label`, `styleFile` (JSON URL or vendored path), and `requiresRemote` flag. Default is `protomaps-light` from a bundled PMTiles file. Basemap resolution (packages/basemap/src/resolver.ts) gates remote tile sources behind an `allowRemote` flag — local is the default. [CONFIDENCE: high]

**CoordinateSync** — The layer that reprojects Excalidraw scene geometry on every map `move` event. Lives in packages/geo/src/CoordinateSync.ts. Uses MapLibre's `project()`/`unproject()` to translate between (lng, lat) and screen (x, y). Throttled at 16ms. [CONFIDENCE: high — MapEditor.tsx line 758, packages/geo/src/index.ts line 4]

### Application concepts

**scene** — The Excalidraw document: elements array + appState (camera, selectedIds, etc.) + files (blobs). Owned by `@excalidraw/excalidraw`. In Atlasdraw, scene elements carry `customData.geo` fields. [CONFIDENCE: high]

**layer** — Two kinds exist in the LayerRegistry (state/layerRegistry.ts):
- *Annotation layer*: tracks Excalidraw scene element IDs, visibility, opacity
- *Data layer*: backed by a MapLibre GeoJSON source + layer, with its own fillColor, label, and style
[CONFIDENCE: high — verified against state/layerRegistry.ts and MapEditor.tsx LayerPanel wiring]

**.atlasdraw file** — A zipped bundle containing:
- `scene.json` — Excalidraw scene elements
- `data/*.geojson` — per imported data layer
- `style.json` — active MapLibre style reference
- `manifest.json` — schema version, layer list, camera, metadata
Defined in packages/data/src/manifest-schema.ts and packages/data/src/atlasdraw.ts. [CONFIDENCE: high]

**room** — A real-time collaboration session. Maps to one Yjs document + one Socket.IO namespace. Managed by `CollabState` (state/collab.ts). Rooms are in-memory at the relay layer (apps/realtime/src/yjs-server.ts); persistence is handled by the storage service. [CONFIDENCE: high]

**workspace** — A logical tenant for hosted/managed mode. Identified by a ULID. Plumbed through storage routes via the `X-Workspace-ID` header (state/workspace.ts, WorkspaceSwitcher.tsx). In self-host mode, defaults to a single workspace from env config. [CONFIDENCE: high]

**share-link** — A URL containing a nanoid-generated token. Two modes: view-only read access, or collaborate invite that joins a collab room. Generated via storage service HTTP API. [CONFIDENCE: medium — the exact link structure needs verification against apps/storage/src/routes/]

---

## User Personas

Verified against PRD §3 (not cross-checked against code — these are product personas, not code artifacts):

- **Persona A: Priya, data journalist** — imports CSVs, annotates with arrows/callouts, shares embeddable links, self-hosts or pays $5–15/mo.
- **Persona B: Marcus, urban planner / community organizer** — combines shapefiles with hand-drawn overlays, collects stakeholder comments, prints PDF for council meetings.
- **Persona C: Dr. Ana, field researcher / academic** — needs offline/airgap, multiple data formats, publication-quality exports, embargoed data never touches third-party servers.
- **Persona D: Jonas, developer / indie** — wants embeddable map widget, extensible tools, CLI for headless use.

The PRD names a fifth latent persona — indie developer embedding a "draw on a map" widget — marked out of MVP scope. This matches the `packages/sdk` stub and the README's explicit out-of-scope declaration for the embed SDK.

[CONFIDENCE: high — verbatim from PRD §3, consistent with README's v1.0 scope boundaries]

---

## Scope Boundaries

### In scope for v1.0 (code-verified)

- Stacked map + drawing canvas with CoordinateSync
- 8 geo-aware drawing tools (pin, polygon, polyline, freehand, text label, arrow, rectangle, circle)
- Layer panel (annotations vs. data layers)
- Basemap picker + Maputnik style editor
- Data layer styling (categorical + graduated color ramps)
- GeoJSON, CSV, and Shapefile import
- `.atlasdraw` and `.atlasdraw.json` file formats
- PNG and PDF export
- GeoJSON export of annotations
- Real-time collaboration via Yjs + Socket.IO
- Presence (multi-cursor)
- Anchored comments
- Photon geocoding for CSV address columns (opt-in)
- Asset library (.excalidrawlib)
- Print layout dialog
- Workspace abstraction + optional hosted/managed mode
- Accessibility (FocusTrap, AriaAnnouncer, keyboard nav)
- CLI tools (stub)
- IndexedDB local persistence + optional remote storage

### Out of scope for v1.0 (verified)

- **Embed widget / SDK** — `packages/sdk/` is an empty package slot; README explicitly excludes from v1.0 per Q-P6-1 decision.
- **KML/KMZ importer** — listed in README features but no parser exists in packages/data/src/.
- **GPX importer** — listed in README features but no parser exists in packages/data/src/.
- **GeoTIFF importer** — listed in README features but no parser exists in packages/data/src/.
- **Spatial transforms** (buffer/intersect/union/centroid/simplify) — listed in PRD §7.2 v1.0 scope but no code exists; no Turf.js wrappers found.
- **Route-snap tool** — PRD describes route tool snapping to OSRM/Valhalla; only PolylineTool exists.
- **Felt importer** — README explicitly excludes.
- **Phase 7 plugin sandbox** — flagged for revision.
- **PostGIS direct connection** — PRD v1.5.
- **Enterprise auth / SSO / audit** — out of scope per PRD §13.

[CONFIDENCE: high — all "not implemented" claims verified via grep of packages/data/src/ and packages/tools/src/]

### What Atlasdraw is NOT (per PRD §13, verified against code)

- **Not a GIS** — no raster algebra, network analysis, coordinate reprojection outside Mercator.
- **Not a tile server** — PMTiles served from object storage; Atlasdraw does not generate tiles.
- **Not a routing engine** — no route-snapping in v1.0 code; PolylineTool draws free polylines.
- **Not open-core** — all features ship in the AGPL OSS package. Hosted billing is operational, not a feature gate.

---

## Confidence Assessment

| Section | Confidence | Evidence |
|---|---|---|
| Domain summary | HIGH | README, PRD §1–2, MapEditor.tsx docblock |
| Core capabilities table (shipped) | HIGH | Verified against packages/*/src/index.ts exports and MapEditor.tsx imports |
| Core capabilities table (not shipped) | HIGH | Verified via grep of packages/data/src/ for KML/GPX/GeoTIFF parsers — zero hits |
| Domain concepts (spatial) | HIGH | Verified against packages/geo/src/types.ts |
| Domain concepts (application) | HIGH | Verified against state/*.ts and packages/data/src/ |
| User personas | HIGH | Verbatim from PRD §3; not code-checked (personas are product artifacts, not code) |
| Scope boundaries (in scope) | HIGH | Verified against file system and component imports in MapEditor.tsx |
| Scope boundaries (out of scope) | HIGH | Verified via grep; none of the claimed-unimplemented parsers exist |
| Share-link structure | MEDIUM | Storage route handling inferred from createHttpStorageClient; exact link schema needs apps/storage/src/routes/ verification |
| CLI capabilities | MEDIUM | packages/cli/src/ exists with commands/ directory but full command surface area not audited |
| SDK/embed widget | HIGH | packages/sdk/ exists as package.json only; no implementable code |

**Confidence scale:**
- **HIGH** = verified against two or more source files + grep cross-reference
- **MEDIUM** = verified against one source file or inferred from imports; direct evidence exists but was not fully traced
- **LOW** = based on plans/spec without code evidence (not used in this document — all claims have at least medium confidence)
