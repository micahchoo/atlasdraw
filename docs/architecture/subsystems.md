# Atlasdraw — Subsystems

**Status: Speculative.** Derived from spec §4, phase plans, and Q5 license resolution.
No code exists to verify against.

For risks associated with subsystem boundaries, see `risk-map.md`.
For evolution of these boundaries over time, see `evolution.md`.

---

## Dependency Graph

```
decisions/
    (no runtime deps — governance only)

packages/geo
    (no internal deps)

packages/excalidraw
    ← packages/element
    ← packages/math
    ← packages/common

packages/basemap
    ← packages/geo

packages/data
    ← packages/geo

packages/tools
    ← packages/geo
    ← packages/basemap
    ← packages/excalidraw

packages/sdk
    ← packages/geo
    ← packages/basemap
    ← packages/excalidraw (via AtlasdrawAPI postMessage surface only)

packages/cli
    ← packages/geo
    ← packages/data
    (no browser runtime dep — Node.js only)

packages/plugin-host  [Phase 7]
    ← packages/sdk  (AtlasdrawAPI surface)

apps/atlas-app
    ← packages/excalidraw
    ← packages/basemap
    ← packages/geo
    ← packages/data
    ← packages/tools
    ← packages/sdk  (embed mode rendering path)
    ← packages/plugin-host  [Phase 7]

apps/realtime
    ← (no internal package deps — pure relay)
    external: y-websocket, socket.io

apps/storage
    ← (no internal package deps — pure API server)
    external: fastify, pg, minio, better-sqlite3
```

[CONFIDENCE: medium — dependency directions are clear from spec §4; exact import graph is
engineering judgment until Phase 0 ships]

---

## 1. `packages/geo`

**Root path (predicted):** `packages/geo/`
**Boundary type:** module (npm workspace package)
**License:** MIT (Q5)
**Drainage density:** low (pure utility functions; no UI, no side-effects)
**Phase introduced:** Phase 1

### Responsibility

Coordinate transforms, GeoJSON adapters, and projection utilities. This is the shared math
layer that every other geo-aware package depends on. It knows nothing about MapLibre, nothing
about Excalidraw — only about coordinate systems and GeoJSON data structures.

Key predicted files (spec §3):
- `projection.ts` — wrappers around `map.project`/`map.unproject` for offline/offscreen
  projection (no live MapLibre instance required for CLI use)
- `geojson-adapters.ts` — normalize GeoJSON FeatureCollections from various sources
- `coord-transform.ts` — WGS84 ↔ Mercator pixel conversions used by CoordinateSync

### Upstream contracts in

- GeoJSON FeatureCollection (external standard)
- WGS84 `{lng, lat}` coordinate pairs (external standard)

### Downstream contracts out

- `projection.ts` API: consumed by `packages/basemap`, `packages/tools`, `apps/atlas-app`
- GeoJSON normalization API: consumed by `packages/data`
- [CONFIDENCE: medium on exact API surface]

---

## 2. `packages/basemap`

**Root path (predicted):** `packages/basemap/`
**Boundary type:** module (npm workspace package)
**License:** MPL-2.0 (Q5)
**Drainage density:** mixed (mostly stateful — wraps MapLibre map instance)
**Phase introduced:** Phase 1

### Responsibility

MapLibre GL JS wrapper, style management, and basemap registry. Owns the `MaplibreWrapper`
component that mounts the map into the DOM. Manages the `BasemapRegistry` — the list of
available basemap presets (bundled PMTiles, remote tile URLs). Owns style import/export
for the Maputnik bridge (Phase 6).

Key predicted files (spec §4.2):
- `MaplibreWrapper.tsx` — React component; mounts map; emits camera change events
- `BasemapRegistry.ts` — default presets; default is `local-pmtiles` after Phase 4 (Q3)
- `style-import-export.ts` — serialize/deserialize MapLibre style for `.atlasdraw` (Phase 6)

### Upstream contracts in

- PMTiles file path (bundled or remote URL)
- MapLibre style object (from `.atlasdraw manifest.json`)

### Downstream contracts out

- Camera change events (`{lng, lat, zoom, bearing, pitch}`) — consumed by `apps/atlas-app`
  CoordinateSync
- `map.project` / `map.unproject` — exposed via `packages/geo`
- [CONFIDENCE: medium]

---

## 3. `packages/data`

**Root path (predicted):** `packages/data/`
**Boundary type:** module (npm workspace package)
**License:** MIT (Q5)
**Drainage density:** low (pure I/O — readers, writers, adapters)
**Phase introduced:** Phase 2 (data layers), extended Phase 3 (file format), Phase 6 (geocoding, importers)

### Responsibility

All file format I/O. Reads and writes the `.atlasdraw` ZIP container. Imports external formats
(GeoJSON, KML, Shapefile, CSV, GeoTIFF, Felt JSON snapshots). Exports to GeoJSON and other
formats. Houses the geocoding client (Photon/Nominatim/Pelias, Phase 6) and the CSV geocode
pipeline.

Key predicted files:
- `atlasdraw-format.ts` — ZIP read/write, manifest schema validation (Phase 3)
- `geojson.ts` — GeoJSON import/export
- `kml.ts` — KML import
- `shp.ts` — Shapefile import (via `shapefile` npm package, async-loaded per spec §8)
- `csv.ts` — CSV → GeoJSON; wires geocoding for address columns (Phase 6)
- `geotiff.ts` — COG raster via `geotiff.js`; MapLibre `raster` source via `cog://` protocol (spec §3)
- `felt.ts` — `.felt.json` → `.atlasdraw` importer (Phase 6, Q13; GeoJSON snapshot format per OQ1)
- `geocoding/photon-client.ts` — Photon/Nominatim/Pelias HTTP wrapper with in-memory LRU cache (Phase 6)

### Upstream contracts in

- File byte arrays / Blob objects from the browser or Node.js filesystem
- MapLibre style object (for `.atlasdraw` round-trip)

### Downstream contracts out

- `AtlasdrawFile` typed object (manifest + scene + layers + assets)
- GeoJSON FeatureCollection (for any import path)
- [CONFIDENCE: medium]

---

## 4. `packages/tools`

**Root path (predicted):** `packages/tools/`
**Boundary type:** module (npm workspace package)
**License:** MPL-2.0 (Q5)
**Drainage density:** mixed (event handlers; stateful tool activation)
**Phase introduced:** Phase 2

### Responsibility

Geo-aware Excalidraw custom tools. Each tool implements the `AtlasdrawTool` interface: an
`id`, icon, cursor style, and pointer event handlers that call `ctx.map.unproject` and
`ctx.excalidrawAPI.updateScene`. Tools register via Excalidraw's `setActiveTool({ type:
"custom", customType: "<id>" })`. (spec §4.4)

Planned tools (Phase 2 + Phase 4):
- `PinTool` — places a pin element at a geo-anchored position
- `PolygonTool` — geo-aware polygon drawing
- `RouteTool` (route-snap) — sends strokes to OSRM/Valhalla, snaps to road geometry (Phase 4;
  feature-flagged off by default for self-hosters without a routing service)
- `MeasureTool` — distance/area measurement with geodesic calculation

### Upstream contracts in

- `ctx.map` (MapLibre map instance from `packages/basemap`)
- `ctx.excalidrawAPI` (Excalidraw imperative API from `packages/excalidraw`)
- `ctx.appState` (Excalidraw AppState)

### Downstream contracts out

- Excalidraw `ExcalidrawElement[]` with `customData.geo` fields set
  [CONFIDENCE: low — `customData.geo` vs `customData.geoAnchor` field name is unresolved;
  see MISMATCH-3 in cross-phase audit]

---

## 5. `packages/sdk`

**Root path (predicted):** `packages/sdk/`
**Boundary type:** module (npm workspace package, separately published)
**License:** MIT (Q5) — deliberately separated so embedding devs are not AGPL-bound
**Drainage density:** low (thin postMessage surface only)
**Phase introduced:** Phase 6

### Responsibility

The public embed widget. A lean wrapper that renders an Atlasdraw map in an `<iframe>` and
exposes a postMessage API surface (`AtlasdrawAPI`). All methods are async and
structured-clone-compatible (Q11, ADR 0005). The SDK contains no network calls — enforced by
CI grep check (`sdk-telemetry-guard.yml`). Bundle hard limit: 300 KB (`size-limit` CI, Phase 6).

`AtlasdrawAPI` exposes (Phase 6, Q11):
- `setScene(scene)` / `getScene()` — scene round-trip
- `setCamera(cameraState)` / `getCamera()`
- `setLayers(layers)` / `getLayers()`
- `on(event, handler)` — subscribe to canvas events
- `exportPNG(options)` / `exportPDF(options)`

### Upstream contracts in

- postMessage events from `apps/atlas-app` (embed renderer)

### Downstream contracts out

- `AtlasdrawAPI` — the public TypeScript interface; governed by ADR 0005
- [CONFIDENCE: high on contract stability — Q11 explicitly mandates postMessage-safe, no
  breaking changes without ADR]

---

## 6. `packages/cli`

**Root path (predicted):** `packages/cli/`
**Boundary type:** module (npm workspace package, separately published)
**License:** MIT (Q5)
**Drainage density:** low (command pipeline, no UI)
**Phase introduced:** Phase 0 (skeleton), fleshed out in later phases

### Responsibility

Headless tooling for server-side or CI use cases. Node.js only — no browser runtime.
Commands: `lint` (validate `.atlasdraw` file schema), `convert` (transform between formats),
`render` (headless PNG/PDF render via MapLibre in Node/JSDOM or Puppeteer).
Intended for Persona D (developer) workflows and the QGIS bridge pipeline.

### Upstream contracts in

- `.atlasdraw` file path (filesystem)
- `packages/data` API (format parsing)
- `packages/geo` API (coordinate utilities)

### Downstream contracts out

- stdout / filesystem (render artifacts, lint reports)
- Exit code 0/1 for CI integration
- [CONFIDENCE: low — CLI command surface is not fully specified in plans]

---

## 7. `packages/excalidraw` (vendored)

**Root path (predicted):** `packages/excalidraw/`
**Boundary type:** module (vendored upstream fork — not npm-installed)
**License:** MIT (Excalidraw's license — inherited, not modified by Atlasdraw)
**Drainage density:** high (React components, complex state machine)
**Phase introduced:** Phase 0 (vendored from fork point)

### Responsibility

The freehand drawing engine and scene model. Excalidraw elements, the scene renderer, tool
framework, history (undo/redo), and the `ExcalidrawAPI` imperative handle. Atlasdraw patches
this package to add `customData.geo` support in the element schema, tune defaults, and adjust
hit-testing for Mercator surface rendering. Patches are tracked in `upstream-patches.md`.

**Patched vendored packages:**
- `packages/excalidraw` — patched (geo field support, rendering hints)
- `packages/element` — vendored, no patches
- `packages/math` — vendored, no patches
- `packages/common` — vendored, no patches

### Upstream contracts in

- Monthly upstream merge from `excalidraw/excalidraw` (ADR 0004, Q6)

### Downstream contracts out

- `ExcalidrawAPI` — consumed by `packages/tools`, `apps/atlas-app`
- `ExcalidrawElement` with `customData` — consumed by `packages/geo` (GeoAnchor binding)
- [CONFIDENCE: high on API stability — upstream API surface is mature; risk is in `customData`
  field persistence through upstream merges]

---

## 8. `apps/atlas-app`

**Root path (predicted):** `apps/atlas-app/`
**Boundary type:** process (browser SPA — Vite build artifact)
**License:** AGPL-3.0 (Q5)
**Drainage density:** high (main app — composition hub)
**Phase introduced:** Phase 0 (skeleton), full editor Phase 1–6

### Responsibility

The editor SPA. Composes `packages/excalidraw`, `packages/basemap`, `packages/geo`,
`packages/data`, and `packages/tools` into a single React application. Owns the CoordinateSync
layer (MapLibre is source of truth; Excalidraw scroll/zoom is derived — spec §0). Owns the
Zustand store, layer panel, toolbar, sidebar, embed mode, and plugin UI (Phase 7).

Key predicted areas:
- `AtlasCanvas.tsx` — root composition: MapLibre canvas + Excalidraw canvas layered
- `CoordinateSync.ts` — the bridge: MapLibre camera change → Excalidraw scroll/zoom update;
  Excalidraw tool down → map.unproject → GeoAnchor
- `state/store.ts` — Zustand slices (scene, layers, camera, room, workspace)
- `components/LayerPanel.tsx` — data layer management
- `components/embed/` — embed-mode renderer (stripped chrome)
- `components/plugins/` — plugin manager UI (Phase 7)

**Stream capture risk:** As the composition hub, `atlas-app` will likely absorb concerns that
belong in packages over time. See `evolution.md`.

### Upstream contracts in

- All packages listed in dependency graph above
- `VITE_*` environment variables (see `infrastructure.md`)

### Downstream contracts out

- The built SPA artifact (served by web service)
- postMessage events to `packages/sdk` consumers (embed API)
- [CONFIDENCE: medium]

---

## 9. `apps/realtime`

**Root path (predicted):** `apps/realtime/`
**Boundary type:** process (Node.js server — separate Docker service)
**License:** AGPL-3.0 (Q5 — by symmetry with other apps; Phase 0 does not list `apps/realtime`
  explicitly under license assignment, but `apps/atlas-app` is AGPL and realtime is an app.
  This is a judgment call — flagged for verification at Phase 5.) [CONFIDENCE: medium]
**Drainage density:** low (intentionally dumb relay)
**Phase introduced:** Phase 5

### Responsibility

WebSocket relay only — intentionally no persistence, no business logic. Forks
`excalidraw/excalidraw-room` at Phase 5. Runs two protocols on the same HTTP server (Q9):
1. Socket.IO namespace — scene sync events, camera sync, cursor presence (username + color)
2. `/yjs/:roomId` WebSocket — Yjs binary CRDT sync via `y-websocket` `setupWSConnection`

Room lifecycle: in-memory. TTL eviction after last client disconnects (default 5 min).
Persistence is explicitly out-of-scope for Phase 5 (TODO comment for Phase 6 `setPersistence`).

**`yjs-crypto.ts`** — ships as API stub only in Phase 5. Wiring deferred to Phase 6 pending
E-01 resolution. (plan-5 Task 8)

### Upstream contracts in

- HTTP upgrade requests from Caddy
- `apps/atlas-app` Socket.IO client events

### Downstream contracts out

- Broadcast scene/cursor events to all room participants
- Yjs awareness protocol messages
- [CONFIDENCE: high on relay shape; low on E2EE final form]

---

## 10. `apps/storage`

**Root path (predicted):** `apps/storage/`
**Boundary type:** process (Node.js server — separate Docker service)
**License:** AGPL-3.0 (judgment call — not listed in Phase 0 license task, but consistent with
  AGPL coverage for server apps; flagged for verification at Phase 4) [CONFIDENCE: medium]
**Drainage density:** mixed (REST API with database + blob I/O)
**Phase introduced:** Phase 4

### Responsibility

Persistent storage REST API. Handles map CRUD, share token generation/validation, and blob
upload/download. In Phase 6 adds workspace management, user accounts, and comment threads for
the hosted-flagship deployment.

Key API routes (predicted from plan-4/plan-6 task descriptions):
- `POST /maps` — create map (returns mapId)
- `GET /maps/:id` — fetch map metadata
- `PUT /maps/:id` — update map metadata
- `POST /maps/:id/payload` — upload `.atlasdraw` blob
- `GET /maps/:id/payload` — download `.atlasdraw` blob
- `POST /maps/:id/share` — generate share token (nanoid)
- `GET /share/:token` — resolve share token → map
- `POST /workspaces` — create workspace (Phase 6)
- `GET /workspaces/:id/maps` — list maps in workspace (Phase 6)
- `POST /webhooks/stripe` — Stripe webhook handler (Phase 6, `MANAGED_MODE` only)
- `GET /health` — health check endpoint (GAP-6 mitigation)

[CONFIDENCE: medium — route shapes inferred; exact contract is engineering judgment]

### Upstream contracts in

- `DATABASE_URL` (Postgres connection string)
- `BLOB_ENDPOINT` + credentials (MinIO or S3)
- `STORAGE_MODE` env var (`postgres-minio` | `sqlite-filesystem`)

### Downstream contracts out

- Map metadata JSON (consumed by `apps/atlas-app`)
- Share token URL scheme (consumed by `apps/atlas-app` share UI)
- [CONFIDENCE: medium]

---

## 11. `decisions/` (knowledge subsystem)

**Root path:** `decisions/` (repo root) and `docs/decisions/`
**Boundary type:** knowledge / governance (no runtime artifact, no build output)
**License:** N/A (documentation)
**Drainage density:** low (static markdown files)
**Phase introduced:** Phase 0

### Responsibility

The architectural decision record (ADR) corpus. Captures every load-bearing architectural
decision with its context, rationale, and consequences. Also includes escalations (E-01/E-02/
E-03), open questions resolutions (Q1–Q13), and cross-phase audit results.

Known ADRs post-Phase-7 (predicted):
| ADR | Topic | Status |
|-----|-------|--------|
| 0001 | Fork Excalidraw rather than npm-install | Accepted |
| 0002 | MapLibre as basemap renderer | Accepted |
| 0003 | Yjs for CRDT (not Automerge) | Accepted |
| 0004 | Upstream merge policy + hard-exit threshold | Accepted (Q6) |
| 0005 | SDK postMessage contract (`AtlasdrawAPI`) | Pending → Accepted at Phase 6 |
| 0006 | Telemetry policy (opt-out, embed-absent) | Accepted |
| 0007 | Yjs E2EE threat model | Pending (E-01 unresolved) |
| 0008+ | Phase 6–7 decisions (TBD) | — |

Escalations: `docs/decisions/escalations.md` (E-01, E-02, E-03)
Open questions: `docs/decisions/open-questions-resolution.md` (Q1–Q13)
Cross-phase audit: `docs/decisions/cross-phase-audit.md`

Source glob for staleness tracking: `decisions/**/*.md`, `docs/decisions/**/*.md`

---

## Plugin Host (`packages/plugin-host`) — Phase 7

**Root path (predicted):** `packages/plugin-host/`
**Boundary type:** module (npm workspace package)
**License:** MIT [CONFIDENCE: low — Q5 specifies SDK as MIT; plugin-host not mentioned; MIT
  is consistent with SDK precedent but is a judgment call]
**Phase introduced:** Phase 7

### Responsibility

Web Worker sandbox + PluginRegistry for the Phase 7 plugin/extension API. Spawns plugin code
in a Worker, wires a postMessage bridge (via `comlink` or manual bridge), enforces a permission
model (request/grant/deny per plugin). Plugin manifest uses SPDX license field (Q5 enforcement
at plugin layer, plan-7 Task 1).

Plugins cannot access the DOM directly — they request mutations through the `AtlasdrawAPI`
subset they are permissioned for. (plan-7 Feature 2)

[CONFIDENCE: low — Phase 7 plugin design is high-level; security properties not fully specified]
