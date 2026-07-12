# Atlasdraw -- Evolution

**Status: Code-verified.** Synthesized from architecture docs (domain, ecosystem, infrastructure, subsystems, atlas-app components, storage components), git log, ADR corpus, phase plans, and source-level era-marker analysis.

**Last updated:** 2026-05-15

---

## 1. Evolution Timeline

Atlasdraw evolved from an Excalidraw fork through 7 planned phases. Each phase added a new layer of capabilities, but the core architecture pattern -- hub-and-spoke with `apps/atlas-app` (specifically `MapEditor.tsx`) as the single integration point -- remained constant.

### Phase 0 -- Baseline (Week 1)

**What was built:** Monorepo scaffold, vendored Excalidraw fork at commit `2dfcc6f0ce4ce007e0360324e63f02ffc7b7fc1a` (v0.18.0), 9 empty workspace packages (`geo`, `basemap`, `data`, `tools`, `sdk`, `cli`, `protocol`, `element`, `common`), license split (AGPL/MIT/MPL per Q5), upstream telemetry stripped (Sentry, Firebase, `trackEvent`), upstream-merge policy documented (Q6 / ADR 0004), CI green.

**Key outputs:** Workspace skeleton, `LICENSING.md`, `decisions/upstream-patches.md`, `decisions/0004-upstream-merge-policy.md`.

**Architectural pattern set:** Hub-and-spoke design where atlas-app is the sole consumer of all atlas-owned packages. This pattern was never revised -- it is the most load-bearing architectural constant.

### Phase 1 -- Geo Foundation (Weeks 2-5)

**What was built:** MapLibre + Excalidraw composition, `CoordinateSync` (packages/geo, throttled at 16ms), `GeoAnchor` discriminated union (`kind: "point" | "bbox" | "polyline"`), first drawing tool (rectangle), `customData.geo` field on Excalidraw elements, benchmark gate.

**Key contracts produced:** `GeoAnchor` type, `GeoCustomData` wrapper + `isGeoCustomData()` guard, `ScaleMode` enum, `projection: "mercator"` reserved field (Q12), `CoordinateSync` class.

**Architecture decisions set:** MapLibre owns the camera (WGS84/Mercator); Excalidraw scroll/zoom is a derived mirror. This is the fundamental contract still holding at v1.0.

### Phase 2 -- Tools & Data Layers (Weeks 6-8)

**What was built:** 7 more annotation tools (polygon, polyline, freehand, text, image, arrow, measurement), annotation-vs-data-layer architectural split, GeoJSON drag-and-drop import, layer panel sidebar (`LayerPanel.tsx`), `LayerRegistry` Zustand slice, PNG export compositing MapLibre + Excalidraw, `@turf/circle` + `@turf/distance` integration.

**Key contracts produced:** `LayerRegistry` (at `apps/atlas-app/state/layerRegistry.ts` -- NOT at `packages/geo` as originally planned), full tool registry (8 tools at `packages/tools/src/index.ts`), PNG export pipeline.

**Architecture drift origin:** The `LayerRegistry` location mismatch (MISMATCH-2) dates from this phase. Plans specified `packages/geo`; implementation placed it in `atlas-app/state/`.

### Phase 3 -- File Format & Local Persistence (Week 9)

**What was built:** `.atlasdraw` ZIP container format (scene.json + data/*.geojson + style.json + manifest.json), `.atlasdraw.json` pure-JSON format, `read(blob)`/`write(doc)` pure functions, IndexedDB persistence via `idb` (5s debounce + 30s ceiling), File System Access API (Chromium enhancement), CSV parser (papaparse), Shapefile parser (shpjs), Photon geocoder stub.

**Key contracts produced:** `AtlasdrawDocument` type, `Manifest`/`LayerEntry` schemas (Zod), `PersistenceStore` interface, `StorageClient` interface (forward-looking).

**Deferred from spec:** KML/KMZ/GPX/GeoTIFF parsers never materialized despite README claims.

**Architecture pattern set:** The `PersistenceStore` interface was the intended slot for Phase 5's Yjs-backed storage replacement. In practice, Phase 5 wired Yjs into a separate `CollabState` and `yjs-layer.ts`, not through `PersistenceStore` -- a quiet structural drift.

### Phase 4 -- MVP Self-Host (Weeks 10-11)

**What was built:** Fastify v5 storage server (`apps/storage`) with dual-mode adapter pattern: `sqlite-fs` (better-sqlite3 + fs blobs) and `postgres-minio` (pg + @aws-sdk/client-s3), share-link system (ADR-0008: URL-hash for small docs, server-issued tokens with 7-day TTL), full Docker Compose stacks (minimal 2-service + full 5-service + Caddy), opt-in Sentry error capture (ADR-0009), Show HN demo readiness.

**Key contracts produced:** `StorageClient` interface (5 methods), `MapRecord`/`ShareToken`/`Workspace` DTOs, `POST/GET/PUT /maps`, `POST/GET /share/:token`, Zod env config with discriminated union.

**Architecture boundary set:** Storage server imports ZERO @atlasdraw packages. It defines its own type hierarchy parallel to `packages/data/src/manifest-schema.ts`. The HTTP API is the only contract between frontend and storage.

### Phase 5 -- Real-time Collaboration (Weeks 12-15)

**What was built:** Dual-protocol realtime relay (`apps/realtime`): Socket.IO for scene/camera/cursor/comments, y-websocket for CRDT data-layer sync, AES-GCM scene encryption (room key from URL fragment), Yjs `Y.Doc` per room, `CollabState` Zustand store (502 lines), `CollabWrapper`/`CursorOverlay`/`PresenceList` components, `packages/data/src/yjs-layer.ts` bridge.

**Key decisions:** ADR-0010 -- Yjs E2EE threat model. **Option C selected:** server-trusted relay for Yjs data-layer ops; `yjs-crypto.ts` ships as a tested but unwired stub; Phase 6 inherits commitment to evaluate Option B (custom log-replay relay).

**Architecture pattern set:** Single-player is the default (Q1); collab is opt-in via compose profiles (`--profile realtime`). Two WebSocket connections per client (Socket.IO + y-websocket on separate ports per Q9). Yjs rooms are ephemeral (5 min TTL, no persistence -- marked TODO).

### Phase 6 -- v1.0: Comments, Style Editor, Hosted Mode (Weeks 16-25)

**What was built (3 waves):**

**Wave 1-2:** Threaded comments (Yjs-backed `CommentsLayer`, `CommentsPanel`, `CommentAnchorsOverlay` with map- and element-anchored pins), Maputnik JSON style editor, `StylePanel` (572 lines -- second-largest component), `ColorRampPicker`, `BasemapPickerDialog`, `AssetLibraryPanel`, Felt importer stub (Q13, read-only).

**Wave 3:** Hosted/managed mode -- `WorkspaceSwitcher`, `BillingPage` (Stripe integration), workspace abstraction (`X-Workspace-ID` header, branded `WorkspaceId` type), quota middleware (`middleware/quota.ts`), ADR-0011 (hosted-mode telemetry -- pino events for workspace/map/share/quota/billing), accessibility (`FocusTrap`, `AriaAnnouncer`, `AboutDialog`).

**Key contracts produced:** `AtlasdrawAPI` (postMessage-safe per Q11, shipped as type surface), `WorkspaceId` branded type, workspace middleware Fastify plugin, Stripe webhook handler with lazy SDK loading, `idempotency-store.ts` (in-memory, acknowledged production gap).

**Architecture drift accumulated:** MapEditor.tsx (1538 lines) now handles concerns from 6 phases without meaningful decomposition. The `import.meta.env` cast in MapEditor spans PMTiles path, dev logging, and env config -- three concerns that should use `app-config.ts`'s Zod schema.

### Phase 7 -- Planned (v1.5, Months 7-12)

**Planned features:** Plugin API + sandbox, mobile field collection, versioning / DiffEngine, PostGIS direct connection, QGIS bridge, AI-assisted styling.

**Architecture risk:** Phase 7 features cross every subsystem. Without MapEditor decomposition, plugin registration alone will push the file past 2000 lines.

---

## 2. Churn Hotspot Analysis

Top files by commit count, with root causes:

| File | Commits | Root cause |
|------|---------|------------|
| `MapEditor.tsx` | 31 | Accretion pattern -- every phase adds new sections (collab init, comment overlays, PMTiles, import/export) without extracting modules. 3x larger than next largest component. |
| `packages/data/src/index.ts` | 12 | File format revision across phases 3-6. New importers (CSV, shapefile) added one per PR. Yjs layer bridge added in Phase 5. |
| `MapEditor.layers-toggle.test.ts` | 8 | Test co-evolution with layer toggle. High churn on test rather than source suggests brittle selectors. |
| `MapEditor.contextmenu.test.ts` | 8 | Similar -- context menu evolution across phases as more tools registered. |
| `packages/basemap/src/index.ts` | 6 | Basemap registry grew from one default to include remote tile sources, style builder, resolver. |
| `apps/storage/src/index.ts` | 6 | Storage expanded from Phase 4 CRUD to Phase 6 billing + workspace + quota middleware. |
| `apps/atlas-app/src/App.tsx` | 6 | Route additions: share view (P4), collab (P5), billing (P6), workspace switcher. |
| `packages/geo/src/CoordinateSync.ts` | 5 | Optimization passes and bug fixes on the critical rendering path. |

**Pattern:** Most hotspots are integration points, not individual module cores. MapEditor (31 commits, 1538 LOC) is the extreme case -- it absorbs churn from every phase without structural relief.

---

## 3. Architectural Drift Map

### Known plan-to-code mismatches

| ID | Severity | Phases | Issue | Status |
|----|----------|--------|-------|--------|
| MISMATCH-1 | HIGH | P1-P3 | `GeoAnchor` discriminated union vs flat `{lng, lat, zoom}` in P3 plan | Open (E-03) |
| MISMATCH-2 | MED | P2-P3 | `LayerRegistry` at `apps/atlas-app/state/`; P3 plan says `packages/geo` | Accepted drift |
| MISMATCH-3 | MED | P1-P3 | Field `customData.geo` (P1 code) vs `customData.geoAnchor` (P3 plan) | Open (E-03) |
| MISMATCH-4 | LOW | P4-P5 | P5 plan omits `profiles: ["realtime"]` compose guard | Fix planned |
| MISMATCH-5 | HIGH | P1-P5 | P5 consumer table has flat shape with `bearing`; no provenance in P1/P2 | Open (E-03) |

### Intentional structural drifts

1. **Storage server isolation.** Zero imports from `@atlasdraw/*` was a deliberate ADR-0007 decision but diverges from "monorepo as integration unit" ideal. Parallel type hierarchies (`MapRecord` vs `Manifest`) require hand-maintained field sync.

2. **Yjs persistence slot deviation.** Phase 3's `PersistenceStore` was intended as the Phase 5 replacement slot. Phase 5 implemented Yjs through `CollabState` + `yjs-layer.ts` instead, leaving `PersistenceStore` as a single-player-only abstraction.

3. **`comments-anchor-picker` store pattern.** Phase 6 introduced a module-level singleton with `useSyncExternalStore` instead of Zustand. Rationale (avoid context provider wrapping MapEditor) is sound, but creates a second state management pattern in a codebase otherwise unified on Zustand.

4. **Importer gap.** README and spec claim KML, GPX, and GeoTIFF import support. None exist in `packages/data/src/`. Documentation drift affecting user expectations.

---

## 4. Fault Line Map (Era Boundaries)

### Fault Line 1: Fork Boundary (var/const/let)

The sharpest boundary in the codebase.

- **Vendored Excalidraw side:** 16,805 `var` declarations, 21,000 `any` type escapes, 1,267 `require()` calls. 300+ files.
- **Atlas-owned side:** Zero `var` declarations. Storage server has zero `any`. Modern `import`/`export` exclusively.
- **Boundary enforcement:** TypeScript loose coupling through `@excalidraw/excalidraw` types. The vendored packages are consumed as a black box via `<Excalidraw>` component API and `customData` field.

### Fault Line 2: State Management (Zustand vs Jotai)

- **Zustand** (5.0.13) -- atlas-app state stores: `layerRegistry`, `collab`, `persistence`, `useDataLayerFCStore`.
- **Jotai** (2.11.0) -- vendored Excalidraw internal component state.
- **Boundary enforcement:** Clean -- atlas-app imports zero Jotai. Both libraries coexist in the same browser bundle (~5KB overhead) but never mix.

### Fault Line 3: Build System

- **Vite 5** -- atlas-app bundler. Modern.
- **esbuild 0.19** -- vendored Excalidraw package build (`scripts/buildPackage.js`). Two build systems for one monorepo.
- **Yarn Classic v1** (1.22.22) -- 2018-era package manager managing 2025-era deps (React 19, Vite 5). No Corepack, no PnP. Growing risk of install failures as packages drop CommonJS support.

### Fault Line 4: Dual Realtime Protocol

- **Socket.IO** (`/socket.io`) -- scene diffs, camera, cursor, comments. AES-GCM encrypted for scene/comment.
- **y-websocket** (`/yjs/:roomId`) -- CRDT data-layer mutations. Plaintext (server-trusted per ADR-0010).
- **Boundary cost:** Two WebSocket connections per client. Separate handshake logic in `CollabState` (502 lines).

### Fault Line 5: Dead Configuration

- **Active:** `VITE_BUILD_TARGET`, `VITE_STORAGE_BASE_URL`, `VITE_PMTILES_PATH`, `VITE_REALTIME_ENABLED`, `VITE_REALTIME_WS_URL`.
- **Dead (inherited Excalidraw):** 15+ `VITE_APP_*` env vars (Firebase, Excalidraw SaaS, Excalidraw Plus, AI backend, upstream Sentry). Present in `.env.development` and `.env.production`. Not wired to atlas-app, not set by Dockerfiles.

### Fault Line 6: TypeScript Composite Boundary

- **Composable:** 5 atlas-owned packages (`basemap`, `data`, `geo`, `tools`, `cli`). Built via `tsc -b`.
- **Non-composable:** atlas-app (noEmit + Vite), realtime (stub), all vendored Excalidraw packages (internal cycles).
- **Cost:** Full typecheck requires two separate `tsc` invocations.

---

## 5. Diagenetic Code Inventory

Hacks and TODO-marked paths on load-bearing routes that have lithified under pressure.

| Location | Marker | Load-bearing? | Why it is diagenetic |
|---|---|---|---|
| ~~`LayerPanel.tsx:271`~~ | ~~HACK~~ Resolved (2026-05-25) | Yes, layer reorder UI | HTML5 DnD with keyboard fallback implemented. |
| `MapEditor.tsx:~480` | Type cast | Yes, entire app routing | `import.meta.env as Record<string,string>` subverts type system on the single integration point. Three concerns share one escape hatch. |
| `state/comments.ts:~50` | TODO | Yes, comment system (P6) | Yjs observer type workaround on a shipped feature. |
| `CommentsPanel.tsx:262` | TODO(phase-7) | Yes, comment delete gating | Uses `socket.id` as user identity. Documented temporary. |
| `CommentsPanelHost.tsx:33` | TODO(phase-7) | Yes, pending anchor wiring | Placeholder user identity. |
| ~~`MapEditor.tsx:607`~~ | ~~TODO(T14/T15)~~ Resolved (2026-05-25) | Yes, remote basemap gating | Wired via `getAppConfig().allowRemoteBasemaps`. |
| `storage/billing.ts:~150` | TODO | Yes, Stripe webhooks | In-memory idempotency store. Will double-process events in multi-replica. |
| ~~`storage/routes/maps.ts` + `share.ts`~~ | ~~Duplication~~ Resolved (2026-05-25) | Yes, error handling | Extracted to `lib/errors.ts`. |
| ~~`storage/**/*.ts`~~ | ~~Duplication~~ Resolved (2026-05-06) | Yes, ID validation | Single source in `constants.ts`. |
| `storage/adapters/sqlite-fs.ts:78` | Comment acknowledged | Yes, self-host | Workspace table created unconditionally but unused outside managed mode. |

---

## 6. Metamorphic Modules

Modules whose surface position suggests one thing but whose interior belongs to a different era.

### CoordinateSync in `@atlasdraw/basemap` (resolved 2026-05-25)

**Appearance:** Pure geospatial library (types, projection functions).

**Reality (pre-2026-05-25):** Contained a stateful runtime class with MapLibre instance reference and Excalidraw API reference.

**Resolution:** CoordinateSync moved to `@atlasdraw/basemap` (2026-05-25). Excalidraw type decoupling (`ExcalidrawElementLike`, `ExcalidrawAPI`) extracted to `@atlasdraw/geo`'s `excalidrawTypes.ts`. The rAF throttle always lived in the React hook (`useCoordinateSync.ts`), not in the class — the evolution.md description was corrected. Scale-mode utilities (`computeScaleFactor`, `clampHybridFactor`) exported from geo's public barrel for basemap consumption.

### Yjs Layer in `@atlasdraw/data`

**Appearance:** File format and data interchange package.

**Reality:** Contains `yjs-layer.ts` and `yjs-snapshot.ts` -- runtime collaboration CRDT wrappers. A concurrency concern in a data-format package.

**Impact:** Low -- files are small and focused. But introduces a `yjs` runtime dependency for non-collaboration consumers like the CLI tool.

### Style System in `@atlasdraw/basemap`

**Appearance:** Map renderer package (MapCanvas, pmtiles).

**Reality:** Carries 4 concerns: (a) MapCanvas React component, (b) style system (types + compiler + builder), (c) basemap registry, (d) PMTiles protocol handler.

**Impact:** Medium -- style system is 3 files ready for extraction if Maputnik integration grows.

### Storage Server Parallel Type Hierarchy

**Appearance:** Standalone Fastify server.

**Reality:** `apps/storage/src/types.ts` (`MapRecord`, `ShareToken`, `Workspace`) and `packages/data/src/manifest-schema.ts` (`Manifest`, `AtlasdrawDocument`, `LayerEntry`) are hand-maintained parallel hierarchies with zero shared schema.

**Impact:** Low-medium -- the HTTP boundary is the contract. If headless CLI operations need direct storage access, the type disconnect becomes a serialization verification burden.

---

## 7. Decision History Summary

The project maintains 6 ADRs in `docs/architecture/adr/` plus escalation records in `docs/decisions/`.

| ADR | Title | Phase | Key point |
|-----|-------|-------|-----------|
| 0006 | Telemetry Policy -- Zero Call-Home | 0/4 | Default build: no outbound communication. Opt-in Sentry per ADR-0009. |
| 0007 | Storage Dual-Mode | 4 | `sqlite-fs` (minimal) + `postgres-minio` (production) behind one `StorageClient` interface. |
| 0008 | Share-Link Encoding | 4 | Two modes: URL-hash (no server) and server-issued nanoid21 token (7-day TTL). |
| 0009 | Error Capture Strategy | 4 | Opt-in Sentry in storage server only. PII scrubbing in `beforeSend`. |
| 0010 | Yjs E2EE Threat Model | 5 | Option C: server-trusted Yjs relay. `yjs-crypto.ts` ships as unwired stub. Phase 6 evaluates full E2EE. |
| 0011 | Hosted-Mode Telemetry | 6 | Managed-mode-only pino operational events. Client bundle has zero analytics code. |

**Open escalations (`docs/decisions/escalations.md`):**

- **E-01** -- Yjs E2EE wiring (awaiting maintainer, resolved to Option C per ADR-0010)
- **E-02** -- DiffEngine dependency on E-01 (informational, blocked on E-01 path)
- **E-03** -- GeoAnchor type shape (awaiting maintainer confirmation, blocks P3/P5 serialization)

---

## 8. Inverted Strata and Structural Debt

### MapEditor.tsx: The Inverted Column

Every phase adds new concerns to `MapEditor.tsx` instead of extracting modules:

- Phase 1: MapLibre + Excalidraw composition, CoordinateSync wiring
- Phase 2: LayerPanel mounting, tool registry integration
- Phase 3: File import/export handlers, PMTiles path
- Phase 4: Share dialog mounting, storage client wiring
- Phase 5: Collab init, cursor overlay lifecycle
- Phase 6: Comment-anchor overlays, env config, dev-only logging

The file is 1538 lines (3x next largest) and growing. Requires extraction of at least 5 modules (MapController, FileIO, CollabInit, CommentManager, EnvConfig) before Phase 7.

### `any` Type Leak

53 of 56 atlas-app source files contain `any` escapes. Three root causes:
1. Excalidraw type boundary (vendored types loose by nature)
2. Yjs observer patterns (untyped callbacks)
3. File System Access API (not yet standardized)

The systemic density prevents effective type narrowing across the Excalidraw boundary.

### No E2E Coverage

45 unit test files (80% file-pair ratio), zero integration or E2E tests. The rendering stack (MapLibre + Excalidraw composite) is the core value proposition and is untested at the integration level. Playwright is in devDependencies but no CI workflow exists.

---

## 9. Forward-Looking: What Patterns Suggest About Future Evolution

### Near-term (Phase 6-7)

1. **MapEditor decomposition is unavoidable.** At ~250 lines of growth per phase, the file will exceed 2000 lines by Phase 7 mid-point. The coupling graph confirms it is the central hub -- every new feature routes through it. A structural refactor wave is required before Phase 7 plugins land.

2. **Fork divergence cost escalates.** Without an upstream git remote or automated merge process, each month of divergence increases the merge ritual cost. The hard-exit threshold (Q6: two consecutive quarters of broken patches or `customData` field removal) will be tested within 6 months.

3. **Yarn Classic v1 becomes a blocker.** React 19 and Vite 5 already push Yarn 1.22 boundaries. Migration to Yarn 4 / Corepack is a needed infrastructure item not yet scheduled.

4. **Phase 7 plugin API will stress the hub architecture.** The plugin sandbox crosses every subsystem boundary. Without MapEditor decomposition, plugin registration pushes integration complexity past maintainability.

### Medium-term (Phase 8+)

1. **Two build systems converge.** Vendored Excalidraw packages will either migrate to Vite or extract to a sub-path.

2. **Storage server needs shared types.** Headless CLI and server-side document processing create pressure to share `Manifest`/`AtlasdrawDocument` types. A `@atlasdraw/types` shared package is the likely resolution.

3. **DB migration framework needed.** Schema-on-start is viable for 2 table schemas but breaks under Phase 7 versioning. Kysely is the likely candidate.

4. **E2E test gap blocks Phase 7 rendering features.** Pixel-level rendering tests are needed for CRDT replay correctness. Phase 7 versioning and DiffEngine require deterministic rendering snapshots.

### Cross-cutting pattern: accretion without extraction

The defining pattern of Atlasdraw's evolution is **accretion without structural relief**. Every phase adds new capabilities, but the integration architecture (hub-and-spoke through MapEditor) is unchanged from Phase 1. Fault lines are managed by containment, not resolution.

This is viable for v1.0, but Phase 7 (plugins, versioning, PostGIS, QGIS bridge) will be the first phase where accumulated structural debt dominates new development velocity.

---

## Confidence Assessment

| Section | Confidence | Basis |
|---------|-----------|-------|
| Evolution timeline (Phases 0-6) | HIGH | Phase plans + git log + ADR corpus + source verification |
| Churn hotspot analysis | HIGH | Git log commit counts + source file analysis |
| Architectural drift map | HIGH | Cross-phase audit + source verification of each mismatch |
| Fault line map | HIGH | Exhaustive grep for era markers across full codebase |
| Diagenetic code inventory | HIGH | Manual TODO/HACK/FIXME scan of MapEditor and storage server |
| Metamorphic modules | HIGH | Package purpose vs contents analysis across all 11 subsystems |
| Decision history | HIGH | 6 ADRs read in full, 3 escalations reviewed |
| Inverted strata | HIGH | MapEditor per-phase accretion mapped via git blame |
| Forward-looking patterns | MEDIUM | Extrapolation from structural data; Phase 7 plans are speculative |
