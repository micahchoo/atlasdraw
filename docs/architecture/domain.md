# Atlasdraw — Domain

**Status: Speculative.** Derived from PRD.md. No code exists to verify against.

---

## Market Position

Atlasdraw operates in the **cartography prosumer market** — the gap between GIS desktop tools
(QGIS, ArcGIS) and consumer map builders (Google My Maps, Snazzy Maps). The explicit reference
class in the PRD is: "what Figma is to Sketch for design," applied to maps (PRD §2).

[CONFIDENCE: high] The target user is technically capable but not a GIS professional. They want
geographic precision without GIS ceremony, and freehand expressiveness without sacrificing
accurate spatial data.

**Competitive context** (PRD §2):

| Competitor | Relationship | Gap Atlasdraw fills |
|------------|-------------|---------------------|
| Atlas.co | Direct — closest feature match | Atlas.co is a startup; Atlasdraw bets on OSS permanence and self-host option |
| uMap | Indirect — OSS, web-based | uMap lacks freehand drawing; Atlasdraw adds Excalidraw annotation layer |
| Felt | Indirect — polished SaaS | Felt is closed source and SaaS-only; Atlasdraw is AGPL with self-host first-class |
| Mapbox Studio | Adjacent — style editor | Mapbox is infrastructure, not a story-telling tool |
| QGIS | Downstream data source | QGIS is the desktop tool prosumers are trying to escape; Phase 7 adds a bridge |

(PRD §2, spec §0)

---

## Personas

Four primary personas shape the product surface (PRD §3):

### Persona A: Priya, the data journalist

Regional newsroom reporter. Ships 2–4 map-based stories per month. Prior stack: QGIS for
processing, Datawrapper for choropleths, Felt for annotation and embeds.

**Jobs:** Import a CSV of incidents onto a styled basemap in under five minutes; sketch arrows,
callouts, and explanatory text; share a draft link with an editor; embed the final map as a
responsive iframe in her CMS.

**Pain points:** Mapbox and ArcGIS billing surprises; Datawrapper's rigid map types; the
"screenshot of QGIS" anti-pattern.

**Willingness to pay:** $5–15/mo hosted; newsroom can self-host.

[CONFIDENCE: high — verbatim from PRD §3]

### Persona B: Marcus, the civic planner / community organizer

Works at a five-person planning consultancy or neighborhood association. Builds maps to argue
for bike lanes, document zoning impacts, coordinate volunteers.

**Jobs:** Combine a city open-data shapefile with a hand-drawn proposal overlay; collect comments
from non-technical stakeholders on a shared link; print to PDF for a council meeting; preserve
the project as an archivable file his client can keep after the engagement ends.

**Pain points:** ArcGIS Online seats are unaffordable; Google My Maps cannot handle polygons or
layered analysis; QGIS scares his collaborators.

[CONFIDENCE: high — verbatim from PRD §3]

### Persona C: Dr. Ana, the field researcher / academic

Ecologist, archaeologist, or social scientist. Needs offline/airgap capability.
Core requirement: export to a self-contained file that runs with no server.

**Jobs:** Tag field samples with coordinates and photos; annotate satellite imagery; export data
as GeoJSON for R/Python analysis; produce a figure-quality map for publication.

**Pain points:** Any SaaS dependency is a liability on a research vessel or in a remote field
site; academic licenses do not cover institutional self-hosting; embargoed data cannot touch
third-party servers.

[CONFIDENCE: high — verbatim from PRD §3]

### Persona D: Jonas, the developer / indie hacker

Builds on top of Atlasdraw. Wants a self-hostable geo-annotation component he can embed in his
own app without a licensing call to a vendor.

**Jobs:** Embed the map widget in an existing React app; extend the tool palette with a
domain-specific drawing tool; use the CLI for server-side rendering of map thumbnails.

**Pain points:** Mapbox GL JS has a restrictive license for offline/self-host; Leaflet lacks a
drawing layer; Excalidraw lacks geo context.

[CONFIDENCE: high — verbatim from PRD §3]

---

## Three Jobs-to-be-Done

Across all four personas, three jobs dominate (PRD §4):

### Job 1: Import-and-share

> "I have a file (CSV, GeoJSON, KML, Shapefile, GeoTIFF). Get it onto a beautiful basemap and
> give me a link I can send within five minutes."

This job drives: `packages/data` (import), `packages/basemap` (styling), `apps/storage`
(share tokens), Phase 3 (file format), Phase 4 (share API).

### Job 2: Draw-and-annotate

> "I have a map and a story. Let me sketch routes, regions, arrows, callouts, and pins, with a
> few collaborators editing simultaneously, and let the result feel hand-crafted, not
> auto-generated."

This job drives: `packages/tools` (drawing tools), `packages/excalidraw` (freehand renderer),
`apps/realtime` (collaboration), Phase 1–2 (geo tools), Phase 5 (real-time collab).

### Job 3: Present-and-embed

> "Lock down the camera, hide the chrome, generate a static PNG/PDF and a responsive iframe,
> and let me publish without paying per pageview."

This job drives: `packages/sdk` (embed widget), `packages/cli` (headless render),
`apps/atlas-app` (embed mode), Phase 6 (embeds, SDK).

**Secondary jobs** (v1.5 and beyond, per PRD §4): offline/airgap use (Persona C), classroom
use (verified-free-for-edu policy), lightweight field data collection (Personas B and C).

---

## Domain Vocabulary

These terms have precise technical meanings within Atlasdraw. Use them consistently.

### Core spatial concepts

**basemap** — The MapLibre-rendered background tile layer. After Phase 4, defaults to a bundled
PMTiles file (OpenFreeMap-derived tiles, Protomaps-sourced). [CONFIDENCE: high — Q3 resolution]
Note: spec §10 still describes OpenFreeMap as the default; Q3 amended this to a PMTiles hybrid
default (GAP-5 in cross-phase audit).

**scene** — The full Excalidraw document: all elements, appState (camera), files (blobs). Owned
by `packages/excalidraw`. In Atlasdraw, scene elements carry `customData.geo` fields that bind
them to geographic coordinates. [CONFIDENCE: medium — `customData.geo` vs `customData.geoAnchor`
field name is unresolved between Phase 1 and Phase 3; see MISMATCH-3 in cross-phase audit]

**layer** — A logical grouping of map features. Two kinds exist:
- *Annotation layer*: Excalidraw elements (freehand, shapes, text). Lives in the scene.
- *Data layer*: GeoJSON / PMTiles / raster source rendered by MapLibre. Managed by
  `LayerRegistry` (Zustand slice in `apps/atlas-app/state/store.ts` per Phase 2).

**annotation** — A single Excalidraw element geo-anchored to map coordinates. Has a `GeoAnchor`
(see below). The defining characteristic is persistence through map pan/zoom — the element
re-projects to stay attached to its geographic position.

**GeoAnchor** — The data structure binding an Excalidraw element to a map position.
[CONFIDENCE: low — the exact shape is unresolved. Phase 1 defines a discriminated union
`{kind, ..., zRef}`; Phase 3 and Phase 5 consume different flat shapes. See MISMATCH-1, -3, -5
in cross-phase audit. Do not treat any specific field list as authoritative until Phase 1
ships.]

**data layer** — A MapLibre-rendered source (GeoJSON, PMTiles, WMS raster, PostGIS in Phase 7)
displayed beneath the annotation layer. Has its own opacity, filter, and style controls managed
through the layer panel (Phase 2).

**room** — A real-time collaboration session identified by a `roomId`. Maps to one Yjs document
and one Socket.IO namespace. Rooms are in-memory at the relay layer; persistence is not wired
at Phase 5 (TTL eviction after last client disconnects). [CONFIDENCE: high — plan-5 Task 6]

**manifest** — The `manifest.json` file inside a `.atlasdraw` ZIP container. Records schema
version, layer list, thumbnail hash, and metadata. Defined in Phase 3.

**embed** — A rendered Atlasdraw map delivered as a responsive `<iframe>` via a public URL
(`/embed/:shareToken`). The embed renderer is a stripped build of `atlas-app` — no editing
chrome, no authentication. Wired in Phase 6.

**share-link** — A URL containing a `nanoid`-generated token. Two kinds: *view-only* (read
access to a stored map) and *edit-invite* (joins a collaboration room). Generated by
`apps/storage` and validated on read. [CONFIDENCE: high — plan-4 Tasks 5–6]

**scene-crypto** — The encryption layer applied to annotation traffic in E2EE mode. In Phase 5,
ships as an API stub (`yjs-crypto.ts`). The resolved option (E-01 Option C) is server-trusted
relay — the server holds no plaintext annotations, but the room key is not zero-knowledge.
True zero-knowledge E2EE remains unresolved (E-01). [CONFIDENCE: medium — E-01 escalation
is open]

---

## What Atlasdraw Is Not

These boundaries are stated in the PRD or tech spec and hold through Phase 7:

- **Not a GIS.** No coordinate reprojection pipeline for EPSG:anything-other-than-Mercator in
  the main editor. `packages/geo` handles transform utilities but the map renderer is Mercator
  throughout. (spec §3)
- **Not a real-time database.** `apps/realtime` is a dumb relay. It does not persist CRDT state.
  Persistence is the storage service's concern. (plan-5 Task 6)
- **Not a tile server.** Atlasdraw does not generate tiles. PMTiles files are served from object
  storage (CloudFlare R2 recommended; spec §4 via plan-4 research notes).
- **Not a routing engine.** Route-snap in `packages/tools` calls an external OSRM/Valhalla
  endpoint. Running that endpoint is the operator's problem. (spec §4.4)
- **Not open-core.** All features ship in the AGPL OSS package. Hosted billing is an
  operational choice, not a feature gate. (Q4 resolution)
