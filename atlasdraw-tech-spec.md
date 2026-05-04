# Atlasdraw — Technical Specification

**Companion to:** Atlasdraw PRD v0.1
**Status:** Draft v0.1 — for founding contributors
**Audience:** Engineers picking up the repo on day one
**Scope:** From `git clone excalidraw/excalidraw` through v1.5

This document is the engineering counterpart to the PRD. It assumes you've read the PRD and now need to know — concretely — what to build, in what order, where the seams are, and what the data shapes look like. It is mid-level: deep enough to choose libraries and design module boundaries, shallow enough to leave room for engineering judgment in the small.

---

## 0. Mental Model

Atlasdraw is **two superimposed coordinate systems pretending to be one**.

- **Excalidraw** owns a 2D scene-coordinate space (`x, y`, infinite, unitless). Its `AppState` carries `scrollX`, `scrollY`, and `zoom.value` to translate between scene and viewport.
- **MapLibre** owns a geographic coordinate space (`lng, lat`, WGS84) and renders a Mercator projection of it into the same DOM viewport.

The product trick is: **MapLibre is the source of truth for the camera**, and Excalidraw's camera (`scrollX/scrollY/zoom`) is a *derived* view of MapLibre's camera. Every Excalidraw element carries its real-world anchor in `customData.geo`, and on every map-camera change, we re-derive each element's `(x, y, width, height, points)` from its geo anchor through `map.project()`.

Get this right and almost everything else is normal product work. Get it wrong and you'll fight drift bugs forever.

---

## 1. Repo Setup — The First Day

You said "fork excalidraw/excalidraw directly." Do exactly that, then convert it into the Atlasdraw monorepo:

```bash
git clone git@github.com:excalidraw/excalidraw.git atlasdraw
cd atlasdraw
git remote rename origin upstream      # keep upstream for cherry-picks
git remote add origin git@github.com:atlasdraw/atlasdraw.git
```

**Why fork instead of `npm install @excalidraw/excalidraw`?** Three reasons:

1. We will modify the Excalidraw scene format (add `customData.geo`, geo-aware tools, geo-aware rendering hints) and the upstream package surface area is too narrow to do this cleanly through props alone.
2. We need to retune defaults — coordinate space, hit-testing under a tilted Mercator surface, hand-drawn roughness at high zoom, scrollbars, infinite canvas behavior — that aren't configurable.
3. We need to swap the collab room/storage backend with our own, not piggyback on `oss-collab.excalidraw.com`.

The trade-off is keeping up with upstream. Mitigate that by **never editing Excalidraw's `packages/element`, `packages/math`, `packages/common` modules directly**. Instead:

- Add new packages: `packages/geo`, `packages/atlas-app`, `packages/realtime`, `packages/cli`, `packages/sdk`.
- Patch `packages/excalidraw` only where unavoidable, and document each patch in `/decisions/upstream-patches.md` so future merges are tractable.
- Treat upstream as a vendored library: `git fetch upstream && git merge upstream/master` becomes a **monthly** ritual with a checklist.

### Resulting workspace layout

```
atlasdraw/
├── packages/
│   ├── excalidraw/          # vendored upstream (light patches only)
│   ├── element/             # vendored upstream (no patches)
│   ├── math/                # vendored upstream
│   ├── common/              # vendored upstream
│   ├── geo/                 # NEW — coord transforms, GeoJSON adapters, projections
│   ├── basemap/             # NEW — MapLibre wrapper, style management, basemap registry
│   ├── data/                # NEW — file format readers/writers (.atlasdraw, geojson, kml, shp, csv)
│   ├── tools/               # NEW — geo-aware drawing tools (pin, route-snap, polygon, measure)
│   ├── sdk/                 # NEW — embed widget (lean, MIT-licensed)
│   └── cli/                 # NEW — headless tooling (lint, convert, render)
├── apps/
│   ├── atlas-app/           # NEW — the editor SPA (replaces excalidraw-app)
│   └── realtime/            # NEW — WebSocket relay (forks excalidraw/excalidraw-room)
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.cloud.yml
│   └── caddy/
├── docs/                    # Astro site
└── decisions/               # ADRs
```

Excalidraw is a Yarn-workspace monorepo on `yarn@1.22`. Keep that — fighting it gains nothing. We add `pnpm` later only if the workspace grows beyond what Yarn handles.

### First-day commits, in order

1. Rename the package from `excalidraw-monorepo` to `atlasdraw`. Update `package.json`, `LICENSE` (Excalidraw is MIT — your additions can be AGPL-3.0 in `apps/`, MIT in `packages/sdk` and `packages/cli`; document the dual structure clearly in `LICENSING.md`).
2. Strip excalidraw-app to a stub. Delete the parts you won't use: PWA config, hardcoded `oss-collab.excalidraw.com`, Excalidraw-specific branding, analytics.
3. Add ADRs `0001-fork-vs-package.md`, `0002-license-split.md`, `0003-coord-system.md`.
4. Wire CI: typecheck, vitest, lint. Steal Excalidraw's existing GH Actions and rename.
5. Get `yarn dev` to launch a working Excalidraw at `localhost:3000` — confirm baseline before changing anything.

---

## 2. Order of Operations — From Excalidraw Clone to v1.5

This is the operational spine. Each phase is a set of milestones that close together. Don't move on until the previous phase ships.

### Phase 0 · Baseline (Week 1)
The fork runs locally, identical to upstream Excalidraw. CI green. Repo public.

### Phase 1 · Geo Foundation (Weeks 2–4)
The single most important milestone in the project: **a rectangle drawn on MapLibre stays glued to its lat/lng during pan/zoom.**

1. Add `packages/basemap` with `<MapCanvas>` React component wrapping MapLibre GL JS.
2. Stack MapLibre and Excalidraw in `apps/atlas-app/components/MapEditor.tsx`. MapLibre on bottom, Excalidraw on top with `pointer-events: none` on the static canvas wrapper, `pointer-events: auto` only when a draw tool is active.
3. Make Excalidraw's background transparent (`viewBackgroundColor: "transparent"`) and disable its scrollbars/grid.
4. Implement `packages/geo/CoordinateSync.ts` — the brain (see §3).
5. On `map.on('move')`, recompute every Excalidraw element's `x/y/width/height/points` from its `customData.geo` anchor and call `excalidrawAPI.updateScene({ elements, captureUpdate: "never" })`.
6. Disable Excalidraw's native pan/zoom: hijack wheel/drag events when no draw tool is active and forward to MapLibre.

By end of Phase 1: you can pan/zoom the map, drop a rectangle, and watch it stay over the same building.

### Phase 2 · Geo-aware Tools & Data Layers (Weeks 5–7)
1. Pin tool: point + popup with title/description/photo.
2. Polygon, polyline, freehand drawing — all geo-anchored.
3. GeoJSON drag-and-drop import → renders as a "data layer" via MapLibre source/layer (NOT as Excalidraw elements).
4. Distinguish two element classes throughout the app: **annotations** (Excalidraw-managed) and **data layers** (MapLibre-managed). Annotations live in the scene; data layers live in MapLibre sources.
5. Layer panel sidebar (Excalidraw's `<Sidebar>`).
6. PNG export combining both layers (canvas composite — MapLibre's `preserveDrawingBuffer: true` + Excalidraw's existing `exportToCanvas`).

### Phase 3 · File Format & Local Persistence (Week 8)
1. Define `.atlasdraw` format (see §6).
2. Save/load to local disk via File System Access API, IndexedDB fallback.
3. CSV with lat/lng or address columns → import (geocoding stubbed for now, see Phase 6).

### Phase 4 · MVP Polish & Self-Host (Weeks 9–10)
1. Three baked-in basemap styles (Protomaps light/dark, OpenFreeMap satellite-ish).
2. `docker-compose.yml` (web + storage + minio) — single-player only, no realtime yet.
3. Share-via-link (read-only, encoded scene-state in URL hash for tiny maps; otherwise upload to storage and share UUID).
4. **Show HN moment.**

### Phase 5 · Real-time Collaboration (Weeks 11–14)
1. Fork `excalidraw-room` to `apps/realtime`. Add `MAP_CAMERA_UPDATE` and `DATA_LAYER_OP` event types.
2. Yjs document for data-layer mutations (see §5.2 for the rationale and the dual-protocol design).
3. Cursor presence with username + color.
4. End-to-end encryption preserved for annotation traffic.

### Phase 6 · v1.0 — Embeds, Comments, Style Editor (Weeks 15–24)
1. Embed widget (slim bundle, `packages/sdk`).
2. Anchored comments on annotations.
3. Maputnik in an iframe modal, communicating via `postMessage`.
4. Geocoding via configurable Photon/Pelias backend.
5. Categorical/graduated styling on data layers.
6. Print layout (multi-page PDF with title block, scale bar, north arrow).

### Phase 7 · v1.5 — Field, Plugins, Versioning (Months 7–12)
1. Mobile field-collection view ("submit a point").
2. Plugin manifest API.
3. Optional Ollama-compatible AI styling.
4. Versioning, named snapshots, diff viewer.
5. PostGIS layer source.
6. QGIS bridge plugin.

---

## 3. The Coordinate Sync Layer — `packages/geo`

This is the most important module in the codebase. Spend disproportionate care here.

### 3.1 Element geo-anchor schema

Every Excalidraw element gets `customData.geo`, structured as a discriminated union by anchor type:

```ts
// packages/geo/types.ts
export type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };

export type GeoCustomData = {
  geo: GeoAnchor;
  // What controls how the element scales relative to the map. See §3.4.
  scaleMode: "geographic" | "screen" | "hybrid";
  // For diagnostics and migrations.
  schemaVersion: 1;
};
```

`zRef` is the MapLibre zoom level at which the element was first created. It anchors the "natural size" of the element so screen-mode and hybrid-mode scaling can compute the right factor at other zooms.

### 3.2 Two-direction transforms

```ts
// packages/geo/CoordinateSync.ts

export class CoordinateSync {
  constructor(private map: maplibregl.Map, private excalidrawAPI: ExcalidrawImperativeAPI) {}

  /** Map camera → Excalidraw scene. Called on every map.on('move'). */
  syncMapToScene(): void {
    const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted();
    const updated = elements.map((el) => this.projectElement(el));
    this.excalidrawAPI.updateScene({
      elements: updated,
      captureUpdate: "never", // critical — don't pollute undo stack
    });
  }

  /** Single element: read geo anchor, write x/y/width/height/points. */
  private projectElement(el: ExcalidrawElement): ExcalidrawElement {
    const geo = (el.customData as GeoCustomData | undefined)?.geo;
    if (!geo) return el; // non-geo element, leave it alone

    switch (geo.kind) {
      case "point": {
        const { x, y } = this.map.project([geo.lng, geo.lat]);
        return { ...el, x, y };
      }
      case "bbox": {
        const nw = this.map.project([geo.west, geo.north]);
        const se = this.map.project([geo.east, geo.south]);
        return { ...el, x: nw.x, y: nw.y, width: se.x - nw.x, height: se.y - nw.y };
      }
      case "polyline": {
        const projected = geo.coordinates.map(([lng, lat]) => this.map.project([lng, lat]));
        // Excalidraw stores polyline points relative to element x/y
        const minX = Math.min(...projected.map((p) => p.x));
        const minY = Math.min(...projected.map((p) => p.y));
        const points = projected.map((p) => [p.x - minX, p.y - minY] as [number, number]);
        return { ...el, x: minX, y: minY, points };
      }
    }
  }

  /** Excalidraw scene → geo. Called when user finishes drawing/dragging. */
  syncSceneToMap(el: ExcalidrawElement): GeoCustomData {
    // Inverse of projectElement, using map.unproject().
    // ...
  }
}
```

### 3.3 The pan/zoom pump

```ts
// apps/atlas-app/components/MapEditor.tsx
useEffect(() => {
  if (!map || !excalidrawAPI) return;
  const sync = new CoordinateSync(map, excalidrawAPI);

  const onMove = throttle(() => sync.syncMapToScene(), 16, { leading: true, trailing: true });
  map.on("move", onMove);
  map.on("zoom", onMove);
  map.on("rotate", onMove);
  map.on("pitch", onMove);

  return () => {
    map.off("move", onMove);
    // ...
  };
}, [map, excalidrawAPI]);
```

Always pass `captureUpdate: "never"` when the change is camera-driven — otherwise every pixel of pan pollutes the undo stack.

### 3.4 Scale mode — the design decision that matters

When the user zooms out by 4 levels, what should a 100-pixel-wide rectangle do?

- **`geographic`** — it covers the same real-world area, so it shrinks to ~6 pixels. Correct for areas/regions.
- **`screen`** — it stays 100 pixels. Correct for pins, callouts, text labels.
- **`hybrid`** — it scales linearly between ±2 zoom levels of `zRef`, then clamps. Correct for hand-drawn arrows, freehand annotations.

Default by tool:

| Tool | Default scale mode |
|---|---|
| Pin / marker | `screen` |
| Text label | `screen` |
| Arrow | `hybrid` |
| Freehand pen | `hybrid` |
| Polygon (filled) | `geographic` |
| Polyline (route) | `geographic` |
| Rectangle | `geographic` |

The user can override per element via the right sidebar. Persist in `customData.geo.scaleMode`.

### 3.5 Hijacking Excalidraw's pan/zoom

Excalidraw owns wheel and drag events. We need MapLibre to own them when no draw tool is active.

```ts
// apps/atlas-app/components/MapEditor.tsx
const [activeTool, setActiveTool] = useState<ToolType>("hand");

const isDrawingMode = activeTool !== "hand";

// On the Excalidraw wrapper:
<div style={{ pointerEvents: isDrawingMode ? "auto" : "none" }}>
  <Excalidraw ... />
</div>
```

When drawing-mode is off, events pass through to MapLibre. When on, Excalidraw catches them. Tool selection is the toggle.

**Caveat:** Excalidraw's static canvas needs `pointerEvents: none` even in drawing mode for the *background area*; only the rendered shapes themselves should catch events. We handle this by setting `pointerEvents: none` on the Excalidraw container and `pointerEvents: auto` on the canvas elements, with a custom pointer-down handler that does hit-testing first.

This is fiddly. Budget a week for Phase 1's event-routing alone.

---

## 4. Module Breakdown

### 4.1 `packages/geo`
The math.

- `CoordinateSync` — described in §3.
- `projection.ts` — wrappers around `map.project`/`unproject` so we can swap for offscreen projection later.
- `geoToExcalidraw.ts` — converts a GeoJSON Feature into an `ExcalidrawElementSkeleton` (Excalidraw's programmatic creation API) with `customData.geo` populated.
- `excalidrawToGeo.ts` — the inverse. Used at export time.
- `measure.ts` — Turf.js wrappers: `area(el)`, `length(el)`, `centroid(el)`. All return real-world units.
- `bounds.ts` — compute the geographic bounding box of an arbitrary set of elements (for "fit to selection").

**No React in this package.** Pure functions, easy to unit-test, callable from CLI and Node.

### 4.2 `packages/basemap`
The MapLibre wrapper.

- `<MapCanvas ref>` — React component that mounts a `maplibregl.Map`, exposes the instance via ref, manages style switching.
- `BasemapRegistry` — array of style configs:
  ```ts
  export const BASEMAPS = [
    { id: "protomaps-light", label: "Light", styleUrl: "..." },
    { id: "protomaps-dark", label: "Dark", styleUrl: "..." },
    { id: "openfreemap-bright", label: "Bright", styleUrl: "https://tiles.openfreemap.org/styles/bright" },
    // ... custom user style
  ];
  ```
- `pmtiles-protocol.ts` — registers the `pmtiles://` protocol on the global `maplibregl` once, idempotently.
- `style-builder.ts` — builds a custom style from a Maputnik export, injecting our user's data-layer sources.

The decision to default to OpenFreeMap public tiles vs Protomaps PMTiles is config-driven (see §10).

### 4.3 `packages/data`
File format I/O. Pure parsers, no UI.

- `geojson.ts` — read/write. The pivot format; everything else converts through it.
- `kml.ts` — uses `togeojson`.
- `gpx.ts` — uses `togeojson`.
- `csv.ts` — Papa Parse. Detect lat/lng columns by name (`lat`, `latitude`, `lng`, `lon`, `longitude`, case-insensitive) or by column-statistics heuristics (numeric, in valid range). Detect address columns by common headers (`address`, `street`, `location`).
- `shapefile.ts` — uses `shpjs` (calvinmetcalf/shapefile-js), accepts a `.zip` of `.shp/.dbf/.prj`.
- `geotiff.ts` — uses `geotiff.js` for COGs; renders as a MapLibre `raster` source via the `cog://` protocol plugin.
- `atlasdraw.ts` — our own format, see §6.

Each parser exports `{ parse(blob): Promise<GeoJSON.FeatureCollection>, write(fc): Promise<Blob> }`.

### 4.4 `packages/tools`
Geo-aware drawing tools, as Excalidraw `customType` tools.

```ts
// packages/tools/PinTool.ts
export const PinTool: AtlasdrawTool = {
  id: "pin",
  icon: PinIcon,
  cursor: "crosshair",
  onPointerDown(e, ctx) {
    const lngLat = ctx.map.unproject([e.clientX, e.clientY]);
    const element = createPinElement(lngLat, ctx.appState);
    ctx.excalidrawAPI.updateScene({ elements: [...ctx.elements, element] });
  },
};
```

Tools register via Excalidraw's `setActiveTool({ type: "custom", customType: "pin" })`. Excalidraw's API is thin here — most tool logic lives in our handlers, not in Excalidraw's tool system.

The notable special tool is **route-snap** (Phase 4): it sends interpolation requests to a configured OSRM/Valhalla endpoint and snaps the user's freehand strokes to road geometry. This is feature-flagged off by default for self-hosters who don't run a routing service.

### 4.5 `packages/sdk`
The lean embed widget. **MIT licensed** to maximize adoption. Distinct bundle from the editor.

- Single export: `<AtlasdrawEmbed src="..." />` plus a vanilla-JS `mount()` for non-React hosts.
- Uses MapLibre + a *minimal* read-only Excalidraw renderer (no editing, no UI chrome). We extract Excalidraw's `renderStaticScene` directly — it's already isolated in `packages/excalidraw/scene/`.
- Target bundle size: <300 KB gzipped.

### 4.6 `packages/cli`
Headless tooling.

- `atlasdraw lint <file>` — validate a `.atlasdraw` against the schema.
- `atlasdraw convert <in> <out>` — format conversion (GeoJSON ↔ KML ↔ Shapefile ↔ .atlasdraw).
- `atlasdraw render <file> --format png --width 1600` — server-side rendering using Puppeteer + the editor in headless mode. Useful for CI-generated maps in newsrooms.

### 4.7 `apps/atlas-app`
The editor SPA. This is what `apps/excalidraw-app` becomes.

```
apps/atlas-app/
├── components/
│   ├── MapEditor.tsx          # the stacked MapLibre + Excalidraw
│   ├── LayerPanel.tsx         # custom <Sidebar> tab
│   ├── BasemapPicker.tsx
│   ├── ImportDialog.tsx       # drag-and-drop targets
│   ├── ShareDialog.tsx
│   └── Toolbar.tsx            # custom <MainMenu> with our tools
├── hooks/
│   ├── useCoordinateSync.ts
│   ├── useMapStyle.ts
│   └── useScene.ts
├── state/
│   ├── store.ts               # Zustand for non-Excalidraw UI state
│   └── persistence.ts         # IndexedDB + File System Access
└── App.tsx
```

We use Zustand for UI-only state (active tool, panel open/closed, modal). Scene state stays in Excalidraw's AppState. Don't try to lift it out — Excalidraw's reactive update model is the path of least resistance.

### 4.8 `apps/realtime`
Forked from `excalidraw/excalidraw-room` (Node + Socket.IO).

We add three things:
1. Yjs websocket subprotocol on the same port.
2. `MAP_CAMERA_UPDATE` event type (last-write-wins, throttled).
3. Optional Redis adapter for multi-instance deploys (Socket.IO supports this natively via `@socket.io/redis-adapter`).

The relay stays dumb: it never decrypts payloads, never persists scene state. Persistence is the storage server's job, not the relay's.

### 4.9 `apps/storage` (added in Phase 4)
HTTP server that owns persistent `.atlasdraw` files and uploaded blobs.

- Express or Fastify.
- Postgres for metadata (file UUIDs, ownership, share permissions).
- S3-compatible blob (MinIO in default Docker stack) for `.atlasdraw` payloads.
- Auth: token-based for share links, optional OIDC for self-hosters who turn on accounts.

---

## 5. Real-Time Collaboration

### 5.1 The dual-protocol problem

Excalidraw's existing collab is great for *annotations* — last-write-wins per element, conflict-tolerant for sketching. It is not great for *data layers*: a user mid-edit on a polygon's vertices can lose work if another user touches a sibling property. Data layers are structured GeoJSON FeatureCollections that benefit from CRDT semantics.

So we run two protocols on one Socket.IO connection:

| Channel | Payload | Semantics |
|---|---|---|
| `SCENE_UPDATE` | encrypted Excalidraw element diff | Excalidraw's existing version + versionNonce LWW |
| `DATA_LAYER_OP` | Yjs update bytes | CRDT merge |
| `MAP_CAMERA_UPDATE` | `{lng, lat, zoom, bearing, pitch}` | LWW, throttled to 30 Hz |
| `CURSOR` | `{userId, lngLat, color}` | LWW, throttled to 60 Hz |
| `COMMENT` | encrypted comment payload | versioned LWW |

### 5.2 Yjs choice

Pick **Yjs**, not Automerge, for v1. Reasons: Yjs is faster on the workloads we expect (frequent small mutations on FeatureCollections of 100–10k features), has a deeper plugin ecosystem (`y-websocket`, `y-indexeddb` for offline), and is what most production collaborative editors converge on. Automerge has cleaner semantics but its perf and bundle size aren't worth the trade for our scale today.

We model each data layer as a `Y.Map<FeatureId, Y.Map<...>>`. Geometry coordinates go in a `Y.Array<[lng, lat]>`. Properties go in a nested `Y.Map`. This gives per-vertex edit granularity — two users can edit different vertices of the same polygon without conflict.

```ts
// packages/data/yjs-layer.ts
const ydoc = new Y.Doc();
const layers = ydoc.getMap("layers");

const layer = new Y.Map();
layer.set("name", "Bike lanes");
const features = new Y.Array<Y.Map<unknown>>();
layer.set("features", features);
layers.set("bike-lanes", layer);
```

### 5.3 End-to-end encryption

Inherit Excalidraw's existing model: room key in URL fragment (`#room=ROOM_ID,KEY`), scene payloads encrypted client-side with AES-GCM. Yjs payloads we encrypt symmetrically on the same key (Yjs is bytes-in-bytes-out, no problem). Map camera and cursor we leave plaintext — they're not sensitive and the relay needs to dedupe.

### 5.4 Server architecture

```
       ┌────────────┐
       │   Caddy    │  TLS, WebSocket upgrade
       └─────┬──────┘
             │
       ┌─────┴──────────────────────┐
       │                            │
┌──────▼────────┐          ┌────────▼────────┐
│ atlas-app     │          │ realtime        │
│ (nginx/static)│          │ (node + socket) │
└───────────────┘          └────────┬────────┘
                                    │
                            ┌───────┴──────┐
                            │              │
                      ┌─────▼────┐  ┌──────▼─────┐
                      │ storage  │  │ redis      │
                      │ (node)   │  │ (optional) │
                      └─────┬────┘  └────────────┘
                            │
                  ┌─────────┴─────────┐
                  │                   │
            ┌─────▼─────┐       ┌─────▼─────┐
            │ postgres  │       │ minio/s3  │
            └───────────┘       └───────────┘
```

Redis is opt-in for multi-instance realtime deploys. A single instance is fine up to ~500 concurrent users per room and ~50 concurrent rooms — enough for the foreseeable hosted flagship.

---

## 6. The `.atlasdraw` File Format

A zipped bundle, mime type `application/vnd.atlasdraw+zip`. Inside:

```
my-map.atlasdraw                  (zip archive)
├── manifest.json                  (canonical entry point)
├── scene.excalidraw.json          (Excalidraw scene with our customData)
├── data/
│   ├── layer-bike-lanes.geojson
│   └── layer-incidents.geojson
├── style.json                     (MapLibre style snapshot or reference)
├── files/
│   ├── photo-001.jpg              (referenced by pin elements)
│   └── ...
└── meta/
    └── thumbnail.png              (auto-generated 1024×768 preview)
```

### `manifest.json`

```json
{
  "format": "atlasdraw",
  "version": 1,
  "id": "01J9ZQHV...",
  "title": "Brooklyn bike network proposal",
  "createdAt": "2026-05-01T14:22:00Z",
  "updatedAt": "2026-05-03T09:11:00Z",
  "camera": {
    "center": [-73.95, 40.68],
    "zoom": 13.5,
    "bearing": 0,
    "pitch": 0
  },
  "basemap": {
    "type": "registry",
    "id": "protomaps-light"
  },
  "layers": [
    { "id": "bike-lanes", "type": "data", "path": "data/layer-bike-lanes.geojson", "visible": true, "style": { "...": "..." } },
    { "id": "annotations", "type": "annotations", "ref": "scene.excalidraw.json" }
  ],
  "permissions": {
    "publicView": false,
    "shareToken": null
  }
}
```

### Why a zip and not a single JSON

Three reasons: image attachments don't bloat the JSON, GeoJSON layers stay diffable as separate files (good for git), and 50 MB+ files are common with shapefile-derived layers. Zip with `STORE` compression for already-compressed assets, `DEFLATE` for text.

A pure-JSON `.atlasdraw.json` variant exists for small maps without binary attachments, useful for inline embedding and copy-paste. The CLI handles round-trip.

---

## 7. APIs and Data Shapes

### 7.1 The `AtlasdrawAPI` (host integration)

For host applications (CMSes, dashboards), expose an imperative API mirroring Excalidraw's:

```ts
export interface AtlasdrawAPI {
  // Scene
  getScene(): AtlasdrawScene;
  loadScene(scene: AtlasdrawScene): Promise<void>;
  exportScene(format: "atlasdraw" | "geojson" | "png" | "pdf"): Promise<Blob>;

  // Camera
  flyTo(opts: { center: [number, number]; zoom?: number; duration?: number }): void;
  fitBounds(bounds: [[number, number], [number, number]], opts?: FitOpts): void;
  getCamera(): Camera;

  // Layers
  addDataLayer(geojson: GeoJSON.FeatureCollection, opts?: LayerOpts): string;
  removeLayer(id: string): void;
  setLayerVisibility(id: string, visible: boolean): void;
  setLayerStyle(id: string, style: LayerStyle): void;

  // Annotations (delegated to Excalidraw)
  addAnnotation(element: AtlasdrawElement): string;
  updateAnnotation(id: string, patch: Partial<AtlasdrawElement>): void;

  // Tools
  setActiveTool(tool: ToolId): void;

  // Subscriptions
  onSceneChange(cb: (scene: AtlasdrawScene) => void): () => void;
  onCameraChange(cb: (camera: Camera) => void): () => void;
  onSelectionChange(cb: (ids: string[]) => void): () => void;
}
```

This is what plugin authors and embed users program against. Ship it under `packages/sdk` and document it as the stable contract — the rest of the codebase can churn beneath it.

### 7.2 Plugin manifest (v1.5)

```json
{
  "id": "com.example.measure-elevation",
  "version": "0.1.0",
  "name": "Elevation profile",
  "entry": "./index.js",
  "permissions": ["read:layers", "read:camera"],
  "capabilities": {
    "tools": [{"id": "elevation", "label": "Elevation profile", "icon": "..."}]
  }
}
```

Plugins are sandboxed in a Web Worker with a postMessage bridge to the main thread. They cannot directly mutate the scene — they request mutations through the AtlasdrawAPI subset they're permissioned for. This is meaningful security work; defer it to v1.5 deliberately.

### 7.3 The data-layer styling object

This is what users edit when they color a layer by an attribute. A subset of MapLibre's style spec, narrowed to what we expose in UI:

```ts
type LayerStyle = {
  geometryType: "point" | "line" | "polygon";
  fill?: { color: ColorOrExpression; opacity: number };
  stroke?: { color: ColorOrExpression; width: number; dasharray?: number[] };
  marker?: { size: number | DataExpression; symbol?: string };
  label?: { field: string; size: number; color: string };
};

type ColorOrExpression =
  | string                                        // "#ff0000"
  | { type: "categorical"; field: string; stops: Array<[unknown, string]>; default: string }
  | { type: "graduated"; field: string; stops: Array<[number, string]>; interpolate: "linear" | "step" };
```

We compile this to MapLibre's expression language in `packages/basemap/style-compiler.ts`.

---

## 8. Performance Budget

Numbers we will not exceed without an ADR justifying it:

- Cold-start TTI: <2.5s on 4G, <800ms on cache hit.
- Editor JS bundle: <800 KB gzipped (currently Excalidraw alone is ~600 KB; we have ~200 KB headroom).
- Embed SDK bundle: <300 KB gzipped.
- Pan/zoom: 60 fps with 5,000 annotations + 50,000 GeoJSON features. Beyond that, MapLibre's vector renderer handles data-layer perf; annotation perf is bounded by Excalidraw's rendering.
- `CoordinateSync.syncMapToScene()` worst case: <8ms for 5,000 elements (measured on M1 Air baseline). Beyond that, we batch and offload to a worker.
- Memory: <250 MB heap on a typical map.

How we hit these: aggressive code-splitting (Maputnik, Turf, shapefile parser are async-loaded), `requestIdleCallback` for non-camera-driven re-projection, a worker for CSV geocoding batches. Profile early — Phase 1's coord-sync should be benchmarked from week 2.

---

## 9. Testing Strategy

- **Unit (vitest):** all of `packages/geo`, `packages/data`. Coordinate transforms get property-based tests (round-trip a random lng/lat through project/unproject and assert closeness within float epsilon).
- **Component (vitest + @testing-library/react):** `<MapCanvas>`, `<LayerPanel>`, dialogs. Mock MapLibre via `vi.mock`.
- **E2E (Playwright):** the three top user flows from the PRD (import-and-share, draw-and-annotate, present-and-embed). Each must run in <30s in CI.
- **Visual regression (Chromatic or Playwright snapshot):** PNG export at fixed cameras, basemap variants. Catches drift bugs in coordinate-sync that unit tests miss.
- **Multiplayer (custom):** scripted dual-client test that opens the same room from two browser contexts, performs concurrent edits, asserts convergence. Run nightly, not per-PR — they're slow.

CI matrix: Node 20 + 22, Chrome + Firefox + Safari (via WebKit). No IE, no Edge legacy. Mobile Safari and Chrome Android are tested manually until usage warrants automation.

---

## 10. Configuration & Self-Host Story

Single source of truth: `config.toml` mounted into the container, environment variables override.

```toml
# config.toml
[app]
public_url = "https://atlasdraw.example.org"
allow_signup = true

[basemap]
default = "protomaps-light"
custom_styles = []

[basemap.protomaps]
# either "hosted" (uses public Protomaps API, requires key for production)
# or "self" (uses local pmtiles file)
mode = "hosted"
api_key = "${PROTOMAPS_API_KEY}"
# pmtiles_path = "/data/world.pmtiles"

[geocoding]
provider = "photon"  # photon | nominatim | pelias | none
endpoint = "https://photon.komoot.io"  # default; switch to self-hosted

[realtime]
enabled = true
ws_url = "wss://realtime.atlasdraw.example.org"

[storage]
postgres_url = "${DATABASE_URL}"
blob_provider = "minio"  # minio | s3
blob_endpoint = "http://minio:9000"

[ai]
enabled = false
provider = "ollama"
endpoint = "http://localhost:11434"
```

The `docker-compose.yml` for first-run experience:

```yaml
services:
  web:
    image: atlasdraw/atlas-app:latest
    ports: ["3000:80"]
    environment:
      VITE_API_URL: http://localhost:4000
      VITE_WS_URL: ws://localhost:4001
  realtime:
    image: atlasdraw/realtime:latest
    ports: ["4001:4001"]
  storage:
    image: atlasdraw/storage:latest
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgres://atlas:atlas@postgres:5432/atlas
      BLOB_ENDPOINT: http://minio:9000
    depends_on: [postgres, minio]
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: atlas
      POSTGRES_PASSWORD: atlas
      POSTGRES_DB: atlas
    volumes: ["pgdata:/var/lib/postgresql/data"]
  minio:
    image: minio/minio
    command: server /data
    environment:
      MINIO_ROOT_USER: atlas
      MINIO_ROOT_PASSWORD: atlasatlasatlas
    volumes: ["miniodata:/data"]

volumes:
  pgdata:
  miniodata:
```

Five containers feels like a lot. We compensate by ensuring `docker compose up` in a fresh checkout produces a fully functional, end-to-end app at `localhost:3000` — no environment fiddling, no API keys, default basemap from OpenFreeMap public tiles.

---

## 11. Risks Specific to Engineering

PRD §12 covers product risks. These are the ones that will bite during build:

- **Excalidraw upstream divergence.** Every month, `git merge upstream/master` will conflict on something we patched. Mitigation: minimize patches, prefer wrapping over modifying, document each patch with line-anchored comments and an entry in `decisions/upstream-patches.md`.
- **MapLibre/Excalidraw event-routing fragility.** Pointer events, touch events, and pen pressure all interact with stacked canvases in subtly wrong ways across browsers. Budget more time than feels right. Write E2E tests for each tool × browser combination.
- **Coordinate-sync performance cliff.** At ~10k elements, naïve `syncMapToScene` becomes the frame-time bottleneck. Mitigation: incremental projection (only project elements whose `customData.geo` has been touched OR whose screen-space bbox intersects the dirty viewport region), offload to a worker for >5k elements.
- **MapLibre globe mode (v1.5+).** When globe view ships, projections become non-Mercator and existing `customData.geo` anchoring assumptions break for tilted/curved views. Plan for a `projection` field in `customData.geo` from day one; v1 ignores it but the schema accommodates it.
- **PMTiles bundle size.** Self-hosting Protomaps for a single country is ~5 GB; for the world ~120 GB. Document this clearly in the self-host guide so users don't `git clone` and expect a single binary.
- **License contagion.** AGPL on `apps/atlas-app` means SaaS-resellers must open source. Some contributors will read this as "Atlasdraw is AGPL" and refuse to use it. Mitigation: split licenses cleanly. The libraries you can embed in your own product (`packages/sdk`, `packages/cli`, `packages/geo`, `packages/data`) are MIT. Only the running app is AGPL. Make this loud in the README.

---

## 12. The First Two Weeks, in Commits

To make this concrete, here's what week 1–2 of commits look like. If you can't get these done in the first 14 days, the architecture or team needs revisiting.

| Day | Commit |
|---|---|
| 1 | `chore: fork upstream, rename to atlasdraw` |
| 1 | `chore: add LICENSE-AGPL, LICENSE-MIT, LICENSING.md` |
| 2 | `chore: strip excalidraw-app PWA, analytics, branding` |
| 2 | `docs: add ADR 0001 (fork rationale), 0002 (license split), 0003 (coord system)` |
| 3 | `feat(basemap): add packages/basemap with MapCanvas component` |
| 4 | `feat(geo): add packages/geo with CoordinateSync skeleton + tests` |
| 5 | `feat(app): mount MapCanvas + Excalidraw stacked, transparent canvas` |
| 6 | `feat(app): wire pointer-events toggle on tool change` |
| 7 | `feat(geo): implement projectElement for point + bbox anchors` |
| 8 | `feat(app): hijack wheel events to MapLibre when not drawing` |
| 9 | `feat(geo): implement polyline anchor` |
| 10 | `feat(geo): scaleMode (geographic | screen | hybrid)` |
| 11 | `test(geo): property-based coord round-trip tests` |
| 12 | `feat(tools): pin tool with geo anchor + popup` |
| 13 | `chore: GitHub Actions CI green` |
| 14 | `docs: README, architecture diagram, contributing guide` |

End of week 2 demo: open the app, see a Protomaps Light basemap, switch to Pin tool, drop pins on locations, pan and zoom, watch them stay glued to their lat/lng. Refresh — pins persist via IndexedDB. Tweet it.

Everything in the rest of this spec is downstream of getting that demo working.
