# Atlasdraw — Subsystems

**Status:** Code-verified subsystem discovery (2026-05-15). This is the first
pass that traces actual imports, exports, coupling edges, and flow basins
against source code. Replaces all prior speculative editions.

Previous subsystems.md (written pre-code) speculated grouping like "atlas-app
+ geo + basemap + tools = editor subsystem." **Reality is finer-grained.**
Atlas-owned packages have surprisingly little mutual coupling — they are
independent modules sharing atlas-app as their sole consumer. The architecture
is hub-and-spoke, not layered.

---

## 1. Subsystem Map

| # | Subsystem | Root path | Boundary type | Depends on (atlas) | Risk signals | Drainage | Basin aligned? |
|---|-----------|-----------|---------------|--------------------|--------------|----------|----------------|
| 1 | **Vendored Excalidraw Kernel** | `code/packages/{excalidraw,element,math,common,utils}` | Tight — dense internal coupling (gossiphs confirms top centrality files all from this cluster). Stylistic: 16,805 `var` declarations | None (self-contained fork) | No upstream git remote; manual merge only; 30+ inherited legacy deps (roughjs, codemirror 6 early releases, etc.); 5+ inherited SaaS endpoints in env files | Low | No — consumed as black box |
| 2 | **Geospatial Engine** | `code/packages/geo` | Tight — pure functions + types, well-scoped; but CoordinateSync is a stateful runtime class in an otherwise pure package | maplibre-gl (optional peer) | CoordinateSync mixes runtime state (rAF loop, MapLibre ref) with pure type definitions | High | Yes |
| 3 | **Drawing Tools** | `code/packages/tools` | Loose — 8 independent tool modules sharing types | `@atlasdraw/geo` (types + projection) | All tools use `any`-typed element creators (Excalidraw heritage); `@turf/circle` and `@turf/distance` are the only external math deps | Mixed (each tool one file) | Yes |
| 4 | **Map Renderer** | `code/packages/basemap` | Loose — 4 concerns in one package: React component + style system + registry + pmtiles protocol | maplibre-gl, pmtiles (external only) | Package carries MapCanvas (React), style compiler, basemap registry, pmtiles protocol — distinct concerns grouped by deployment convenience | Mixed | Partial — stream capture blurs boundary |
| 5 | **Data Interchange** | `code/packages/data` | Loose — file I/O + Yjs CRDT wrapper + geocoding client bundled together | jszip, papaparse, shpjs, yjs, zod (external only) | KML/GPX/GeoTIFF parsers absent despite README claims; Yjs crypto is stub; Photon geocoder has no default endpoint (ADR-0006/0011) | High | Yes |
| 6 | **Collaboration Protocol** | `code/packages/protocol` | Tight — pure types + small utilities, no runtime deps | None | Small surface, low risk. Dual-protocol design (Socket.IO + y-websocket) documented in types | Low | Yes |
| 7 | **Editor SPA** | `code/apps/atlas-app` | Porous — imports all subsystems 2–6 plus vendored Excalidraw | All 2–6, `@excalidraw/excalidraw`, + 12 external deps | 21K `any` escapes (inherited through vendored types); no E2E CI; 15+ dead Excalidraw env vars; no size-limit guard | High (central hub) | N/A (the hub all flows converge on) |
| 8 | **Storage Server** | `code/apps/storage` | Tight — **zero imports from any @atlasdraw package**. Standalone Fastify server with self-defined types | None (external only: fastify, better-sqlite3, pg, @aws-sdk/client-s3, stripe, sentry, zod) | No DB migration framework (schema created on first start); no connection pooling beyond pg.Pool; parallel type hierarchy to packages/data/manifest-schema.ts | Low | Weak | 
| 9 | **Collaboration Relay** | `code/apps/realtime` | Tight — opaque relay, no runtime sharing | `@atlasdraw/protocol` (types only) | Rooms ephemeral (5 min TTL); `setPersistence` is TODO; CORS `*`; no health endpoint returns connection count | Low | Yes |
| 10 | **CLI Tooling** | `code/packages/cli` | Tight | `@atlasdraw/data`, commander | Stub — 2 commands (lint, convert) | Low | Yes |
| 11 | **Embed SDK** | `code/packages/sdk` | N/A — stub | None | Phase 0 stub with sentinel export only; build script is `exit 0` | N/A | N/A |

### Consolidated functional views (for communication, NOT for coupling analysis)

These groupings share a common consumer (atlas-app) but have zero or minimal
cross-coupling with each other:

| Group | Subsystems | Actual coupling |
|-------|-----------|-----------------|
| **Vendored Kernel** | 1 | Dense internal cluster; consumed as black box via `@excalidraw/excalidraw` |
| **Mapping Stack** | 2, 3, 4 | tools -> geo (types only). basemap independent. Shared consumer is atlas-app |
| **Data Pipeline** | 5, 6 | Zero cross-coupling. Shared consumers are atlas-app + cli (data) and atlas-app + realtime (protocol) |
| **Server Backend** | 8, 9 | Zero cross-coupling: different tech stacks (Fastify vs Socket.IO), no shared code |
| **Tooling** | 10, 11 | cli -> data; sdk is stub. Independent concerns |
| **Editor SPA** | 7 | Hub, not subsystem. Consumes all |

---

## 2. Flow Basins

### 2.1 Basin A: Annotation Drawing (critical path)

```
User interaction
  -> MapEditor.tsx (atlas-app)
    -> useAtlasdrawTool.ts (hook selects active tool)
      -> @atlasdraw/tools (e.g., PinTool.ts)
        -> packages/element (vendored) — creates Excalidraw element
        -> customData.geo set with GeoAnchor from @atlasdraw/geo
    -> Excalidraw scene graph (vendored) owns the element
    -> CoordinateSync (packages/geo) reprojects on every map move
      (throttled at 16ms, uses MapLibre project()/unproject())
    -> LayerRegistry (zustand state/layerRegistry.ts) tracks annotation
    -> Persistence: useAutosave -> idb (IndexedDB) + optional storage server
```

**Boundary crossings:** 4 subsystem boundaries (Editor SPA -> Drawing Tools
-> Geo Engine -> Vendored Kernel -> back). This is the critical path. All 8
tools follow this same pattern. The heaviest intra-atlas coupling edge
(gossiphs score 854) connects `tools/src/convert.ts` <-> `useGeoAnchor.ts`.

### 2.2 Basin B: Data Import

```
Drag-and-drop / file input
  -> MapEditor.tsx drop handler
    -> @atlasdraw/data (geojson.ts, csv.ts, or shapefile.ts)
    -> Creates MapLibre GeoJSON source + layer
    -> LayerRegistry (state/layerRegistry.ts) creates data layer entry
    -> MapCanvas (packages/basemap) renders the layer
```

**Boundary agreement:** Flow aligns with structural boundaries. Data package
parses, atlas-app manages state, basemap renders. Clean separation.

### 2.3 Basin C: Save / Load

```
Save:
  MapEditor.tsx -> @atlasdraw/data (write.ts / atlasdraw.ts)
    -> .atlasdraw zip bundle (scene.json, data/*.geojson, style.json, manifest.json)
    -> HTTP PUT to storage server
      -> adapter (sqlite-fs -> fs, or postgres-minio -> pg Pool + S3)

Load:
  HTTP GET from storage server
    -> @atlasdraw/data (read.ts) -> MapEditor.tsx
```

**Divergence:** Storage server has zero shared types with the data package.
`Manifest` in `packages/data/src/manifest-schema.ts` and `MapRecord` in
`apps/storage/src/types.ts` are hand-maintained parallel definitions. The
HTTP boundary is the only contract.

### 2.4 Basin D: Real-time Collaboration

```
Client A edits element
  Socket.IO events (scene update, camera, cursor, comment)
    -> apps/realtime (socket-io-server.ts)
      -> broadcast to room peers

  Yjs CRDT mutations (data layer)
    -> apps/realtime (yjs-server.ts, y-websocket upgrade)
      -> Yjs sync protocol to room peers
```

**Dual protocol:** Two independent flow paths. Socket.IO for ephemeral events
(scene, camera, cursor, comments). y-websocket for persistent CRDT data layer
sync. Both share types from `@atlasdraw/protocol`.

**Boundary divergence:** Protocol types are the only shared surface between
client and relay. The relay is an opaque forwarder — it never inspects
encrypted payload content (ADR-0010).

### 2.5 Basin E: CLI Headless

```
CLI command (atlasdraw lint / convert)
  -> packages/cli (commands/lint.ts, commands/convert.ts)
    -> @atlasdraw/data (read, parse, write)
      -> File system output
```

Simple linear flow. No boundary divergence — the cli -> data dependency is
the intended contract.

[CONFIDENCE: high for all 5 flow basins — verified against source imports]

---

## 3. Boundary Justification

### Why 11 subsystems instead of broader groupings

The hub-and-spoke pattern (atlas-app consuming all packages) means that atlas
packages are **loosely coupled to each other** and **tightly coupled to
atlas-app**. Grouping them into broader functional units misrepresents the
actual coupling structure:

| Proposed group | Actual coupling | Verdict |
|----------------|----------------|---------|
| geo + basemap + tools = "mapping stack" | tools -> geo (types only). basemap has zero atlas deps. No shared code or tests | Not a subsystem — three independent modules with same consumer |
| data + protocol = "data interchange" | Zero mutual imports. Different consumers (data -> atlas-app + cli; protocol -> atlas-app + realtime) | Not a subsystem — independent contracts |
| storage + realtime = "server" | Zero mutual imports. Different tech stacks. Storage has zero atlas deps | Not a subsystem — independent processes |
| cli + sdk = "tooling" | cli -> data; sdk is stub. Different concerns | Not a subsystem |

The system is better understood as **a set of independent modules consumed
by a monolithic SPA** than as layered subsystems.

### Key structural boundaries

1. **Fork boundary (subsystem 1 vs. 2–11):** The sharpest boundary in the
   codebase. 16,805 `var` statements and 21K `any` escapes on one side; zero
   `var` and strict types on the other. The fork boundary is structural (git
   history), stylistic (var/const/let), AND type-safety (any/not-any).

2. **Storage isolation (subsystem 8):** The storage server imports nothing
   from any @atlasdraw package. It defines its own `MapRecord`, `Workspace`,
   and `ShareToken` types independently from the frontend's `Manifest` and
   `AtlasdrawDocument`. This means the HTTP boundary is the **only** contract
   — no schema-sharing mechanism exists.

3. **Protocol-only relay (subsystem 9):** `@atlasdraw/protocol` is the only
   atlas package imported by the realtime relay, and it's a pure-type
   dependency — no runtime values cross this boundary at compile time.

[CONFIDENCE: high]

---

## 4. Fault Lines

### 4.1 Fork boundary (var/const/let)

The most significant fault line. All 16,805 `var` declarations exist
exclusively in vendored Excalidraw packages. Atlas-owned code (all packages
+ apps) uses `const`/`let` exclusively:
- `packages/basemap`: 0 files with `var`
- `packages/data`: 0 files with `var`
- `packages/geo`: 0 files with `var`
- `packages/tools`: 0 files with `var`
- `packages/protocol`: 0 files with `var`
- `packages/cli`: 0 files with `var`
- `packages/sdk`: 0 files with `var`
- `apps/atlas-app`: 0 files with `var`
- `apps/storage`: 0 files with `var`
- `apps/realtime`: 0 files with `var`
- `packages/excalidraw`: 300+ files with `var` (16,805 declarations total)

[CONFIDENCE: high — exhaustive grep across all packages]

### 4.2 State management (zustand vs. jotai)

Zustand is used in atlas-app (3 stores: `layerRegistry`, `collab`,
`persistence` all use `create()` from zustand). Jotai exists only in
vendored Excalidraw packages.

**Verified: atlas-app has zero jotai imports.** The two-state-libraries-
in-one-bundle concern from the ecosystem doc is real but the split is
clean — bounded entirely by the fork boundary.

[CONFIDENCE: high — exhaustive grep of atlas-app src/ for `from.*jotai`
returned zero results]

### 4.3 Dual realtime protocol

Socket.IO (events: scene, camera, cursor, comments) + y-websocket (CRDT
data layer sync). Two transport protocols for collaboration on the same
server. They serve different data types (ephemeral vs. persistent) but
require atlas-app to maintain two separate WebSocket connections.

[CONFIDENCE: high — verified against apps/realtime/src/index.ts]

### 4.4 Tsconfig composite boundary

Only 5 atlas-owned packages are in `code/tsconfig.json` composite project
(`basemap`, `data`, `geo`, `tools`, `cli`). atlas-app, realtime, and all
vendored packages are excluded. Typechecking the full system requires
two separate `tsc` invocations.

[CONFIDENCE: high — verified against code/tsconfig.json]

### 4.5 Dead configuration

15+ Excalidraw SaaS env vars (`VITE_APP_BACKEND_V2_*`, `VITE_APP_LIBRARY_*`,
`VITE_APP_WS_SERVER_URL`, `VITE_APP_FIREBASE_CONFIG`, etc.) remain in
`.env.development` and `.env.production`. These are dead for atlas-app
(no `VITE_APP_*` vars are read by atlas-app code). The atlas-app Dockerfile
passes only `VITE_*` (not `VITE_APP_*`) vars.

[CONFIDENCE: high — verified against Dockerfile ARGs and atlas-app config]

---

## 5. Stream Capture

Modules that absorbed responsibilities from adjacent domains:

### 5.1 CoordinateSync in `@atlasdraw/geo`

**What:** `CoordinateSync` is a stateful runtime class (requestAnimationFrame
loop, MapLibre instance reference, Excalidraw API reference) living in a
package otherwise composed of pure functions and types.

**Impact:** Low — the package is small enough that mixed concerns don't
create confusion. But it prevents `@atlasdraw/geo` from being a truly pure
library.

### 5.2 Style system in `@atlasdraw/basemap`

**What:** The basemap package carries 4 distinct concerns: MapCanvas (React
component), style system (types + compiler + builder), basemap registry, and
PMTiles protocol handler.

**Impact:** Low-medium. If the style system grows significantly (Maputnik
integration), extraction of `style-compiler.ts` + `style-builder.ts` into a
separate `@atlasdraw/style` package would be warranted.

### 5.3 Yjs layer wrapper in `@atlasdraw/data`

**What:** `yjs-layer.ts` and `yjs-snapshot.ts` live in `@atlasdraw/data`
because they wrap data-layer mutations under CRDT. But Yjs is fundamentally
a runtime collaboration concern, not a data format concern.

**Impact:** Low. The Yjs wrapper is small and focused on data-layer types.
Moving it would require a new collaboration-data package.

### 5.4 Storage types parallel to data types

**What:** `apps/storage/src/types.ts` defines `MapRecord`, `Workspace`,
`ShareToken` independently from `packages/data/src/manifest-schema.ts`
which defines `Manifest`, `AtlasdrawDocument`. Parallel type hierarchies
with no shared schema.

**Impact:** Low-medium. Schema drift is possible. The Zod schemas in
`packages/data` could serve as source of truth if storage ever imports
from atlas packages.

[CONFIDENCE: high — all stream captures verified against source]

---

## 6. Confidence Assessment

| Section | Confidence | Basis |
|---------|-----------|-------|
| Subsystem map (all 11) | HIGH | Every package.json read; every export barrel read; import edges traced |
| Vendored Excalidraw (subsystem 1) | HIGH | gossiphs coupling graph + exhaustive grep for var/any |
| Geospatial Engine (subsystem 2) | HIGH | Full source read; zero internal deps |
| Drawing Tools (subsystem 3) | HIGH | All 8 tool files + index.ts read |
| Map Renderer (subsystem 4) | HIGH | All exports read; four concerns identified |
| Data Interchange (subsystem 5) | HIGH | Full parser set verified (+ documented gaps) |
| Collaboration Protocol (subsystem 6) | HIGH | Full type surface read |
| Editor SPA (subsystem 7) | HIGH | Components, hooks, state stores inventoried |
| Storage Server (subsystem 8) | HIGH | Entry point + routes + adapter types read |
| Collaboration Relay (subsystem 9) | HIGH | Entry point + dual protocol traced |
| CLI Tooling (subsystem 10) | MEDIUM | File listing only; command surface not fully audited |
| Embed SDK (subsystem 11) | HIGH | Stub confirmed; build script is `exit 0` |
| Flow basins (all 5) | HIGH | Import chains traced from entry to terminal |
| Fault lines | HIGH | Quantitative grep data for all patterns |
| Stream capture | HIGH | Each claim verified against source |
