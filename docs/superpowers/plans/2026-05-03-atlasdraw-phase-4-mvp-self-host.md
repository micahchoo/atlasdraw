# Phase 4 — MVP Polish & Self-Host
**Status:** ✅ COMPLETE (closed 2026-05-11). All 19 tasks (T1–T18) shipped; T16 acceptance smoke 10/10. See `HANDOFF.md` (commit `cbd6507`) for scoreboard and trajectory. Eleven scrub-note amendments in §5 document plan-vs-shipped drift. Parent seed `atlasdraw-4579` closed `outcome:success`.

**Plan date:** 2026-05-03
**Weeks:** 10–11 (shifted +1 from spec's "Weeks 9–10" per Q7 chain)
**Goal:** The Show HN moment — a stranger clones the repo, runs one command, and immediately understands what Atlasdraw is.

---

> ⚠️ **PLAN-LITERAL DRIFT — READ FIRST**
>
> This plan was authored 2026-05-03 / 2026-05-05, BEFORE Phase 3 W2+W3 closed
> (2026-05-06). A pre-dispatch scrub identified **12 plan-literal drifts** and
> **5 missing Wave 0 prereqs**. Workers MUST consume:
>
> **`docs/decisions/wave0-pre-dispatch-scrub-2026-05-06.md`**
>
> before copying any file path, package name, or API signature from this plan.
>
> Highest-leverage corrections workers will need:
>
> - **Path drift:** all `apps/…` paths in this plan miss `code/` prefix; atlas-app
>   files additionally miss `src/` segment. Actual: `code/apps/atlas-app/src/...`.
> - **Tooling drift:** plan says `pnpm --filter X`; project uses `yarn workspace
>   @atlasdraw/X`. Plan says `packages/sdk`; project uses `@atlasdraw/data`.
> - **T5 wording:** says "Extend `BasemapRegistry`" — but `BasemapRegistry` is
>   greenfield (deferred from Phase 1 T3 per `atlasdraw-2428`). Treat as
>   "Create-or-Extend".
> - **T13 redundant:** Phase 3 T8 already shipped `startAutoSave()` in
>   `code/apps/atlas-app/src/state/persistence.ts:430` with debounce + sequence-
>   counter snapshot guard. Re-scope T13 to wire the existing function, not
>   author a new hook.
> - **Excalidraw barrel:** plan says `index.ts`; actual is `index.tsx`.
> - **Phase 3 prereqs (NOT in this plan):** FC registry (`atlasdraw-ad27`),
>   scene hydration (`atlasdraw-3601`), MainMenu unification (`atlasdraw-9078`).
>   All three must complete in Wave 0 before T1 dispatch.
> - **Vendored Dialog (`atlasdraw-50c0`):** `Dialog.tsx` exists in vendored
>   Excalidraw but is NOT exported from the package barrel. Decide barrel-bump
>   vs internal-import before T8/T9/T14.
>
> Full mapping table + verified literals: see scrub doc Section A and Section C.

---

## 1. Header

### Goal

`cd infra && docker compose -f docker-compose.minimal.yml up` opens `localhost:3000`, shows a world map, accepts a dropped pin, survives a browser refresh, and produces a shareable link that opens read-only in incognito. No API keys. No network dependency. No second command.

### Tech Stack Additions (Phase 4 only)

| Addition | Purpose |
|---|---|
| `fastify` (v5) | HTTP server for `apps/storage` — lighter than Express for this payload pattern. v4 EOL June 2025; use v5.8.x (current stable). |
| `pmtiles` CLI (binary) | Required build tool for `fetch-pmtiles.sh` — extracts low-zoom world cut from full planet download. Not an npm package; installed via `go install github.com/protomaps/go-pmtiles/...@latest` or OS package manager. Must be on `PATH` before `make pmtiles-fetch` runs. <!-- shape-incorporated 2026-05-03: Q1 unblocked — pmtiles extract step adds toolchain prereq not previously listed --> |
| `@fastify/postgres` + `pg` | Postgres adapter for map metadata |
| `minio` JS client (`minio` npm package) | Blob payloads in full stack; filesystem fallback in minimal stack |
| `better-sqlite3` | SQLite driver for `docker-compose.minimal.yml` storage mode |
| `lz-string` | URL-hash compression for tiny maps (<32 KB uncompressed) |
| `nanoid` | Cryptographically random share token generation |
| `zod` | Runtime validation of storage API request/response shapes |
| `planetiler` / `tilemaker` | **Referenced only** — Makefile target `make basemap-world` documents the recipe; not built in this phase |
| `caddy` (Docker image) | TLS termination + WebSocket upgrade in full 5-service stack |

---

## 2. Phase Boundary Contracts

### Consumes (from prior phases)

| Artifact | Source phase | Contract |
|---|---|---|
| `.atlasdraw` reader/writer | Phase 3 | `readAtlasdraw(buffer: ArrayBuffer): AtlasdrawBundle` / `writeAtlasdraw(bundle: AtlasdrawBundle): Blob` — stable interface in `packages/sdk` |
| `BasemapRegistry` initial shape | Phase 1 | `BASEMAPS: BasemapConfig[]` exported from `packages/basemap` — this phase adds three entries and a discriminator field |
| `packages/geo` coordinate sync | Phase 1 | `GeoAnchor`, `projectElement`, `unprojectElement` — consumed but not modified |
| `AtlasdrawAPI` host-integration interface | Phase 0 | `postMessage`-safe from Q11; storage layer calls it via `window.atlasdrawAPI.getScene()` |

### Produces (for downstream phases)

| Artifact | Consumer phase | Contract |
|---|---|---|
| Storage HTTP API (`apps/storage`) | Phase 5 (realtime) | `StorageClient` interface with `createMap`, `getMap`, `updateMap`, `createShareToken` — Phase 5 adds `listRoomParticipants` without changing these |
| `docker-compose.yml` (5 services) | Phase 5 | Phase 5 adds `realtime` service; the compose file is structured with a `profiles: ["realtime"]` guard so `docker compose up` without profiles stays 5-svc Phase 4 shape (see Open Questions for the profiles vs include-file decision) |
| `StorageMode` discriminated union | Phase 5 | `'postgres-minio' \| 'sqlite-fs'` — Phase 5 only targets postgres-minio mode |
| Share link contract | Phase 5 | `/m/:uuid` read-only route; URL-hash scheme frozen (`#v1:<lz-compressed-b64>`) |
| `BasemapRegistry` with 3 styles | Phase 6 (style editor) | Registry is the canonical list; Phase 6 Maputnik integration adds to it without replacing |

---

## 2b. Pre-Work Checklist (Phase Readiness Gates)

> **Updated 2026-05-06 per `wave0-pre-dispatch-scrub-2026-05-06.md`.** Original
> checklist contained drift (`pnpm`, `packages/sdk`, missing `code/` prefix,
> assumed `BasemapRegistry` exists). Replaced with corrected gates plus 4
> blocking prereqs the original plan missed.

Before any Wave 0 task executes, confirm these gates pass. If any fail, raise a
blocker — do not work around them.

### Phase 3 outputs (consume; do not re-implement)

| Gate | Check | Blocking task if absent |
|---|---|---|
| `@atlasdraw/data` exports `read` / `write` / `readJSON` / `writeJSON` | `grep -E 'export.*\\b(read\\|write)\\b' code/packages/data/src/index.ts` returns hits | Tasks 8, 9, 13 |
| `@atlasdraw/data` round-trip acceptance passes | `cd code/packages/data && yarn test --run` exits 0 (83/83) | Tasks 8, 9 |
| atlas-app persistence layer present | `ls code/apps/atlas-app/src/state/{persistence,usePersistenceStore,selectDocument}.ts` exits 0 | Task 13 (re-scoped — wires existing autosave) |
| atlas-app build clean | `cd code/apps/atlas-app && yarn build` exits 0 (1585 latent tsc errors are vite-hidden — see `atlasdraw-dc84`) | Tasks 6, 13, 14 |
| `code/apps/storage/` does not yet exist | `ls code/apps/storage 2>/dev/null` exits non-zero | Task 1 (Wave 0 scaffold creates it) |
| `code/apps/realtime/` exists as a Phase 5 stub — leave alone | `ls code/apps/realtime/package.json` exits 0; do NOT modify | Task 11 (compose file references but does not implement) |
| `pmtiles` CLI installed | `pmtiles --version` exits 0 | Task 10 Step 2 — install via `go install github.com/protomaps/go-pmtiles/...@latest` |
| `code/packages/excalidraw/index.tsx` exports `Dialog` (or import from internal path) | `grep -E '^export.*\\bDialog\\b' code/packages/excalidraw/index.tsx` returns hit OR plan accepts internal-path import | Tasks 8, 9, 14 (`atlasdraw-50c0`) |

### Phase 3 prereqs that block Phase 4 (file in Wave 0 BEFORE T1 dispatch)

These were captured as `[NOTE]` markers in `MapEditor.tsx` and HANDOFF prose during
Phase 3 W2/W3 closure. They are NOT implemented; without them Phase 4 ships on
top of stubs.

| Prereq seed | Title | Block scope |
|---|---|---|
| `atlasdraw-2428` | BasemapRegistry + pmtiles-protocol + style-builder (deferred from P1 T3) | T5, T6, T7 (re-word T5 from "Extend" to "Create-or-Extend") |
| `atlasdraw-ad27` | Data-layer FC registry (selectDocument layers gap, mulch `mx-91343d`) | Any T8/T9 share that needs round-trip with data layers |
| `atlasdraw-3601` | Excalidraw scene hydration on persistence load() | Whole Wave-2 share story (load path silently no-ops without it) |
| `atlasdraw-9078` | MainMenu .excalidraw vs .atlasdraw entry unification (mulch `mx-30002e`) | T8/T9 ergonomics; UX-coherence on Show HN demo |
| `atlasdraw-50c0` | Dialog API barrel-export decision | T8 ShareDialog, T9 useShareLink, T14 AboutDialog |

### Doc/spec debt to fix before dispatch

| Seed | Issue | Why now |
|---|---|---|
| `atlasdraw-5cba` | `tech-spec.md §10` still says OpenFreeMap default basemap | Q3 resolution says hybrid; spec contradicts T5/T7 |

### Visible-UX bugs to triage for demo

| Seed | Severity | Title |
|---|---|---|
| `atlasdraw-4142` | high | Mixed-geometry GeoJSON FCs render only first feature's style |
| `atlasdraw-76b2` | high | Polyline geo-anchor breaks when zoom > creation zoom |

Decision: fix in P4 Wave 0 (demo-blocking) or accept as known issues (announce in
README "Known Limitations").

### Run all gates before Wave 0

```
Run: grep -E 'export.*\b(read|write)\b' code/packages/data/src/index.ts | wc -l
Expected: ≥ 4 (read, write, readJSON, writeJSON)

Run: cd code/packages/data && yarn test --run >/dev/null 2>&1; echo $?
Expected: 0

Run: ls code/apps/atlas-app/src/state/{persistence,usePersistenceStore,selectDocument}.ts 2>/dev/null | wc -l
Expected: 3

Run: ls code/apps/storage 2>/dev/null && echo EXISTS || echo ABSENT
Expected: ABSENT

Run: ls code/apps/realtime/package.json
Expected: exits 0 (P5 stub — leave alone)

Run: sd show atlasdraw-2428 atlasdraw-ad27 atlasdraw-3601 atlasdraw-9078 atlasdraw-50c0 | grep -c '^Status: closed'
Expected: 5  (all 5 prereqs must be closed before Wave 0 task dispatch)
```

If any gate fails, stop and surface the gap before proceeding.

---

## 3. Flow Map Preamble

Two flows share this phase. Both must be traced before Action workers launch.

### Flow A — Save → Share

```
user-edits-canvas
  → autosave-debounce (500 ms, `apps/atlas-app/hooks/useAutosave.ts`)
  → scene-snapshot (AtlasdrawAPI.getScene() → AtlasdrawBundle)
  → size-check (<32 KB uncompressed?)
      ├─ YES → lz-compress → base64 → URL hash → clipboard
      └─ NO  → POST /maps/:id (upload bundle to storage)
               → storage returns share token (nanoid, TTL=30d)
               → /m/:uuid URL → clipboard

[CHANGE SITE: size-check branch] — Codebooks: cache-coherence
Invariant: the published payload must be the LAST COMMITTED autosave state,
not an in-flight buffer. The Share button is disabled until autosave drains.
```

### Flow B — Basemap Switch

```
user-clicks-BasemapPicker-thumbnail
  → BasemapPicker emits onSelect(basemapId)
  → MapCanvas.setStyle(BasemapRegistry.find(id).resolvedStyleUrl)
  → MapLibre reloads tile sources
  → [basemap.allow_remote] gate: if false and id='openfreemap-bright', show warning
```

### Flow C — First Run (docker-compose.minimal.yml)

```
docker compose up
  → web container serves atlas-app at :3000
  → storage container starts, reads STORAGE_MODE env
      → 'sqlite-fs': opens /data/atlas.db (SQLite) + /data/blobs/ (filesystem)
  → web container mounts /data/world-low-zoom.pmtiles at pmtiles:// protocol
  → user opens localhost:3000 → MapCanvas loads protomaps-light style
    → pmtiles:// protocol handler serves local tile range requests
    → no network call leaves the machine
```

---

## 4. File Structure

All paths relative to repo root. One-line responsibility per file.

```
apps/
  atlas-app/
    components/
      BasemapPicker.tsx           — Three-thumbnail UI; emits onSelect(basemapId)
      BasemapPicker.test.tsx      — Render + keyboard nav + remote-gate warning tests
      ShareDialog.tsx             — Share button handler; size-routes to URL-hash or upload
      ShareDialog.test.tsx        — Branch tests for both share modes
      AboutDialog.tsx             — Telemetry policy, license, ADR-0006 link (Phase 0 ADR)
    hooks/
      useAutosave.ts              — 500 ms debounce autosave; exposes isDraining state
      useShareLink.ts             — Orchestrates size-check, compress/upload, returns URL
    pages/
      share/[uuid].tsx            — Read-only shared-map viewer route (/m/:uuid)

  storage/
    src/
      index.ts                    — Fastify app entry; reads STORAGE_MODE, wires routes
      config.ts                   — Zod-validated env config; exports StorageMode type
      routes/
        maps.ts                   — POST /maps, GET /maps/:id, PUT /maps/:id
        share.ts                  — POST /maps/:id/share, GET /share/:token (resolve)
      adapters/
        postgres-minio.ts         — Postgres metadata + MinIO blob implementation
        sqlite-fs.ts              — SQLite metadata + filesystem blob implementation
      types.ts                    — StorageClient interface, MapRecord, ShareToken types

packages/
  basemap/
    src/
      registry.ts                 — BASEMAPS array: protomaps-light, protomaps-dark, openfreemap-bright
      styles/
        protomaps-light.json      — Vendored MapLibre style JSON (protomaps flavor)
        protomaps-dark.json       — Vendored MapLibre style JSON (protomaps flavor)
        openfreemap-bright.json   — Vendored MapLibre style JSON (openfreemap flavor)
      pmtiles-protocol.ts         — Registers pmtiles:// on maplibregl once, idempotently
      resolver.ts                 — Resolves basemap id → styleUrl given config flags

infra/
  docker-compose.yml              — Full 5-service stack: web + storage + postgres + minio + caddy
  docker-compose.minimal.yml      — 3-service stack: web + storage (sqlite-fs mode) + volume mount
  Makefile                        — `make basemap-world` recipe (documented planetiler invocation)
  caddy/
    Caddyfile                     — Reverse proxy: :80→web:3000, :4000→storage:4000, TLS auto
  data/
    .gitkeep                      — Placeholder; world-low-zoom.pmtiles fetched by make target
    fetch-pmtiles.sh              — Downloads world-low-zoom.pmtiles from releases URL

docs/
  architecture/
    adr/
      0007-storage-dual-mode.md   — Decision: sqlite-fs for minimal, postgres-minio for full
      0008-share-link-encoding.md — Decision: lz-string URL hash below 32KB, UUID above
  self-host/
    README.md                     — First-run instructions (minimal stack); links to full stack
    production.md                 — Full 5-service stack walkthrough, Caddy TLS, env vars
```

---

## 5. Tasks

---

### Task 1: Storage Contract Types [Wave 0] — Define `StorageMode` and `StorageClient`

**Orient:** Every storage implementation task and every frontend hook that talks to storage depends on agreed TypeScript types. Defining them first lets Wave 1 workers build against a contract rather than a moving target.
**Flow position:** Step 0 of 4 in Flow A (types → storage-server → share → compose). Contract-only task; no runtime code.
**Upstream contract:** None — this is the root of the DAG.
**Downstream contract:** Produces `StorageMode`, `MapRecord`, `ShareToken`, `StorageClient` interface consumed by Task 3 (storage server), Task 8 (URL-hash share), Task 9 (UUID upload share), Task 12 (compose env config).
**Skill:** `none`
**Files:**
- Create: `apps/storage/src/types.ts`

**Steps:**

- [ ] **Step 1: Define `StorageMode` discriminated union**

  The union governs which adapter loads at startup. Two modes per Q10.

- [ ] **Step 2: Define `MapRecord` shape**

  Fields: `id: string` (nanoid), `created_at: string` (ISO-8601), `updated_at: string`, `blob_ref: string` (path or S3 key), `byte_size: number`.

- [ ] **Step 3: Define `ShareToken` shape**

  Fields: `token: string` (nanoid 21-char), `map_id: string`, `mode: 'read'`, `expires_at: string` (ISO-8601, default +30 days), `created_at: string`.

- [ ] **Step 4: Define `StorageClient` interface**

  Methods: `createMap(blob: Buffer): Promise<MapRecord>`, `getMap(id: string): Promise<MapRecord | null>`, `updateMap(id: string, blob: Buffer): Promise<MapRecord>`, `createShareToken(mapId: string): Promise<ShareToken>`, `resolveToken(token: string): Promise<ShareToken | null>`.

- [ ] **Step 5: Verify type file compiles**

  Run: `cd apps/storage && npx tsc --noEmit --strict src/types.ts`
  Expected: exits 0, no output.

---

### Task 2: Storage Config & `StorageMode` Detection [Wave 0] — Startup Discriminator

> **Scrub note (2026-05-10, scope expansion):** This task as written covers
> only the **backend** `apps/storage/src/config.ts`. The casual-vs-power tier
> split (static GH Pages build for casual users + docker-compose self-host
> for power users) requires a separate **frontend** deployment-mode
> discriminator in `atlas-app` that the current plan does not specify.
>
> **Decision (2026-05-10):** `atlas-app` gets its own `AppConfig` keyed on
> `VITE_BUILD_TARGET` ∈ { `'pages'` | `'local-only'` | `'hosted'` }. Selected
> at build time and tree-shaken so the `pages` bundle ships none of the
> power-tier code paths.
>
> - `pages` — static deploy (GitHub Pages). localStorage-only persistence.
>   No `StorageClient` import, no share UI, no auth UI. AboutDialog renders
>   a "Demo edition — get sharing & collab via self-host at <link>" badge.
> - `local-only` — same surface as `pages` but without the demo badging
>   (for dev runs and personal single-user self-host without docker).
> - `hosted` — full client. Runtime-detects backend via `/config.json` at
>   startup, includes share UI (T4 client), realtime client (Phase 5), etc.
>
> **What changes in this plan:**
> - T1's `StorageMode` union is unchanged — that governs the backend only
>   (`postgres-minio` | `sqlite-fs`); irrelevant when frontend is in `pages`
>   mode because no backend exists.
> - T2 (this task) stays scoped to `apps/storage` as written.
> - **New T2b (Wave 0):** create `code/apps/atlas-app/src/config/app-config.ts`
>   with the `VITE_BUILD_TARGET` Zod schema, `loadAppConfig()` (defaults to
>   `'pages'` if unset), and feature-flag exports (`ENABLE_SHARE_UI`,
>   `ENABLE_REALTIME`, `ENABLE_BACKEND_PERSISTENCE`). Tree-shake-friendly:
>   imports gated on `if (import.meta.env.VITE_BUILD_TARGET === 'hosted')`
>   patterns so Vite rollup can drop dead branches per build.
> - **T4 (share endpoint)** + **T8/T9 (share-link client)** become no-ops
>   in `pages` build; their imports stay behind the `ENABLE_SHARE_UI` flag.
> - **T14 (AboutDialog)** must render the active `VITE_BUILD_TARGET` and
>   the demo-edition badge when in `pages` mode.
> - **Resolver default `pmtilesPath`** can be a build-time constant in the
>   `pages` build (the bundled 43 MB `world-low-zoom.pmtiles` is the only
>   option); the `hosted` build keeps reading `VITE_PMTILES_PATH` at build.
> - **Vite `base` setting** must be set to the GH Pages repo slug (e.g.
>   `base: "/atlasdraw/"`) when `VITE_BUILD_TARGET === 'pages'`; default `/`
>   otherwise. Without this, GH Pages project sites 404 every asset.
>
> **Why up front, not retrofit:** if the casual tier lands after T1/T2/T3/T4
> ship, every share-related task has to be re-edited to add a guard. Cheaper
> to bake the discriminator into Wave 0 — same week as T1/T2 — so all
> downstream tasks code against a known build-target axis.
>
> Originating decision: 2026-05-10 user request to ship GH Pages for casual
> users while keeping `docker-compose.minimal.yml` / `docker-compose.yml` as
> the power-user deploy. Architecture (config-agnostic resolver, AppConfig
> pattern) already shaped for this; the amendment is making the build-target
> split explicit before T1/T2 dispatch so workers don't have to invent it.

**Orient:** The `docker-compose.minimal.yml` (3-svc, per Q10) runs storage in `sqlite-fs` mode; the full stack runs `postgres-minio`. The server must detect mode from env at startup and fail loudly if required env vars are missing.
**Flow position:** Step 0.5 of 4 in Flow A (parallel to Task 1, feeds Task 3).
**Upstream contract:** Receives `StorageMode` type from Task 1.
**Downstream contract:** Produces `AppConfig` (Zod-parsed, typed) consumed by Task 3 (routes/adapters initialization).
**Skill:** `none`
**Files:**
- Create: `apps/storage/src/config.ts`

**Steps:**

- [ ] **Step 1: Write Zod schema**

  Required vars: `STORAGE_MODE` (`'postgres-minio' | 'sqlite-fs'`), `PORT` (default `4000`).
  Conditional: `STORAGE_MODE=postgres-minio` requires `DATABASE_URL`, `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY`, `BLOB_SECRET_KEY`.
  Conditional: `STORAGE_MODE=sqlite-fs` requires `DATA_DIR` (default `/data`).

- [ ] **Step 2: Export `loadConfig()` that throws on parse failure**

  Failure message must name the missing var: `"Missing required env var: DATABASE_URL (required when STORAGE_MODE=postgres-minio)"`.

- [ ] **Step 3: Write unit test**

  Run: `cd apps/storage && npx vitest run src/config.test.ts`
  Expected: PASS — covers missing-var error message, defaults, and both modes.

---

### Task 3: Storage HTTP Server — Routes + Dual Adapters [Wave 1]

> **Scrub note (2026-05-11, pre-dispatch):** Three plan-literal corrections + library
> pinning from pre-dispatch scrub against the T1/T2 outputs (`code/apps/storage/`
> commit `1141a4d`):
>
> 1. **Path correction.** All `Files:` and Step file paths read `apps/storage/...` —
>    actual workspace path is `code/apps/storage/...` (workspace root is `code/`,
>    same correction T1/T2 already applied silently). Workers must use the `code/`
>    prefix verbatim.
> 2. **Library pinning** (none of these exist in `code/yarn.lock` yet — all are new
>    workspace deps in `code/apps/storage/package.json`):
>    - `fastify@^5.2.0` — HTTP server. CJS-compatible per `tsconfig.json` (`module: commonjs`).
>    - `better-sqlite3@^11` + `@types/better-sqlite3` — sqlite-fs metadata store.
>      Sync API, native binding, requires `node-gyp` toolchain at install time
>      (already present on the dev host; CI uses prebuilt binary).
>    - `pg@^8` + `@types/pg` — postgres-minio metadata store.
>    - `@aws-sdk/client-s3@^3` — MinIO/S3 blob layer. Tree-shakeable; smaller than
>      the `minio` npm package. MinIO is S3-API-compatible — point `endpoint` at
>      `BLOB_ENDPOINT`, use path-style addressing (`forcePathStyle: true`).
>    - `nanoid@^5` — 21-char map IDs and share tokens (126 bits entropy each, per
>      T4 adversarial spec).
>    - DevDeps already declared (T1+T2): `vitest`, `typescript`, `@types/node`,
>      `zod`. Plus `tmp@^0.2` (devDep) for sqlite-fs unit-test scratch dirs.
> 3. **Binary body parser.** `POST /maps` and `PUT /maps/:id` take raw binary, not
>    multipart. Use Fastify's built-in raw-body parser registered for
>    `application/octet-stream` with `parseAs: 'buffer'` and `bodyLimit: 50 * 1024 * 1024`
>    set at server construction. Do NOT add `@fastify/multipart` (wrong tool for
>    this content type; would add ~80KB to the server image for no value).
>
> **Adapter contract reminder** (from `code/apps/storage/src/types.ts:44-50`):
> the `StorageClient` interface declares all five methods T3 must implement —
> `createMap`, `getMap`, `updateMap`, `createShareToken`, `resolveToken`. T3 ships
> all five on both adapters even though `createShareToken`/`resolveToken` are not
> exercised by T3's own routes (those are T4's routes). This keeps the adapter
> shape stable for T4 and prevents a follow-up "we missed the share methods" amendment.
>
> **Test strategy refinement** (Step 6 says "testcontainers or mock for postgres-minio"
> — choose mock):
> - `sqlite-fs` adapter: real I/O against `tmp` dir, real `better-sqlite3`, real
>   blob writes. Fast (<200ms), high signal.
> - `postgres-minio` adapter: unit tests stub `pg.Client.query` and the S3 client.
>   Asserts: correct SQL shape, correct S3 key derivation, errors propagate.
>   Integration testing (real Postgres + MinIO) is deferred to T16 compose smoke.
> - Route tests use `fastify.inject()` against the sqlite-fs adapter only.
>
> **Wave decomposition.** Step 1 (postgres-minio) and Step 2 (sqlite-fs) are
> file-disjoint and look parallelizable, but the marginal speedup is not worth
> the worktree-coordination cost (both modify the same `package.json` to add
> deps, both must agree on the adapter contract reading from `types.ts`).
> **Recommended: single executor, sequential within T3.**
>
> **Excalidraw API rule** (`.claude/rules/excalidraw-api.md`): N/A — T3 does not
> touch Excalidraw. No grep gate required.
>
> Originating audit: 2026-05-11 pre-dispatch scrub against the spec; T1/T2
> outputs read at `code/apps/storage/src/{types,config}.ts` to ground contract.

**Orient:** This is the core persistence layer for maps. It must handle both compose stacks (Q10): postgres-minio in the full stack, sqlite-fs in the minimal one. The adapter is selected once at startup; routes are identical in both modes.
**Flow position:** Step 1 of 4 in Flow A (types → **storage-server** → share → compose).
**Upstream contract:** Receives `AppConfig` (StorageMode + validated env) from Task 2; receives `StorageClient`, `MapRecord`, `ShareToken` types from Task 1.
**Downstream contract:** Produces running Fastify server at `http://storage:4000` with routes `POST /maps`, `GET /maps/:id`, `PUT /maps/:id`. Consumed by Task 8 (share upload path) and Task 12/13 (compose env wiring).
**Skill:** `none`
**Files:**
- Create: `code/apps/storage/src/index.ts`
- Create: `code/apps/storage/src/routes/maps.ts`
- Create: `code/apps/storage/src/adapters/postgres-minio.ts`
- Create: `code/apps/storage/src/adapters/sqlite-fs.ts`
- Modify: `code/apps/storage/package.json` (add deps pinned in scrub note above)

**Steps:**

- [ ] **Step 1: Implement `postgres-minio` adapter**

  `createMap`: INSERT into `maps` table, upload blob to MinIO bucket `atlasdraw-maps/{id}`.
  `getMap`: SELECT metadata, return `MapRecord` (no blob in response — client fetches blob separately if needed).
  `updateMap`: UPDATE metadata, overwrite MinIO object.
  Bucket auto-created on first write if absent.

- [ ] **Step 2: Implement `sqlite-fs` adapter**

  Schema: single `maps` table identical to postgres shape.
  Blob: write to `$DATA_DIR/blobs/{id}.atlasdraw`.
  DB file: `$DATA_DIR/atlas.db`.
  No external services — all I/O is local volume.

- [ ] **Step 3: Implement `routes/maps.ts`**

  `POST /maps` — body is raw binary (`application/octet-stream`), max 50 MB. Returns `MapRecord` (201).
  `GET /maps/:id` — returns `MapRecord` JSON (200) or 404.
  `PUT /maps/:id` — replaces blob, returns updated `MapRecord` (200).
  All routes validate `:id` is a valid nanoid (alphanumeric, 21 chars).

- [ ] **Step 4: Wire `index.ts` — load config, select adapter, register routes**

  Fail fast if adapter throws on init (e.g., can't reach postgres).
  Log startup mode: `Storage started in postgres-minio mode on :4000`.

- [ ] **Step 5: Verify server starts in sqlite-fs mode without postgres**

  Run: `STORAGE_MODE=sqlite-fs DATA_DIR=/tmp/atlas-test node dist/index.js &`
  Expected: stdout contains `Storage started in sqlite-fs mode`.
  Cleanup: `kill $!`

- [ ] **Step 6: Run adapter unit tests**

  Run: `cd apps/storage && npx vitest run src/adapters/`
  Expected: PASS — tests use tmp dir for sqlite-fs, testcontainers or mock for postgres-minio.

---

### Task 4: Share Endpoint — `POST /maps/:id/share` + `GET /share/:token` [Wave 1]

> **Scrub note (2026-05-11, pre-dispatch):** Three corrections from pre-dispatch
> scrub against T3's shipped adapter shape (commit not yet landed) and T2's
> config schema (commit `1141a4d`):
>
> 1. **Path correction** (same as T3 scrub): `Files:` paths read `apps/storage/...`
>    — actual is `code/apps/storage/...`.
> 2. **`PUBLIC_URL` config field is missing from T2.** Step 1 below references
>    `config.PUBLIC_URL` but `code/apps/storage/src/config.ts` (T2) only declares
>    `STORAGE_MODE`, `PORT`, and the per-mode envs. T4 must extend `BaseSchema`
>    to add `PUBLIC_URL: z.string().default("")`. Empty default means the response
>    `url` becomes `"/m/<token>"` (relative); operators set `PUBLIC_URL=https://atlasdraw.example.com`
>    in their compose env for an absolute URL. Update `code/apps/storage/src/config.test.ts`
>    to assert the default.
> 3. **TTL is adapter-side, not config-side, in Phase 4.** T3 hard-coded "now + 7 days"
>    inside `createShareToken` on both adapters. Phase 4 keeps it hard-coded;
>    ADR-0008 (T17) will introduce `SHARE_TOKEN_TTL_DAYS` config when revocation /
>    replay semantics are revisited. T4 does not change adapter TTL logic — it
>    only consumes `expires_at` from the `ShareToken` returned by the adapter.
>
> **Token format**: nanoid v3 default alphabet uses `A-Za-z0-9_-`. Validation
> regex is identical to map-id: `/^[A-Za-z0-9_-]{21}$/`. The same validator helper
> from T3's `routes/maps.ts` can be reused — extract to `src/util/id.ts` if it's
> not already shared.
>
> **Adversarial coverage** (Step 2 spec is authoritative; ensure all 4 cases land):
> - expired token → 410 Gone (not 404; distinguishes from "never existed")
> - unknown token → 404
> - `mode` in response is always `"read"`, never reflected from request body
> - `:id` and `:token` with traversal chars (`../`, `..%2F`, `..\`) → 400 before
>   any adapter call (regex-validated)
> - Bonus (not in original spec but cheap): malformed nanoid (wrong length, illegal
>   char) → 400, asserted explicitly.
>
> **Excalidraw API rule** (`.claude/rules/excalidraw-api.md`): N/A — T4 doesn't
> touch Excalidraw.
>
> Originating audit: 2026-05-11 pre-dispatch scrub.

**Orient:** The share token endpoint is the first auth-adjacent surface in Atlasdraw. Token entropy, TTL, server-side read-only enforcement, and replay prevention must be correct from day one — this is the adversarial surface, not a detail.
**Flow position:** Step 1.5 of 4 in Flow A (storage-server → **share-endpoint** → share-link-modes → compose).
**Upstream contract:** Receives `StorageClient` (createShareToken, resolveToken) from Task 3's adapter. Receives `ShareToken` type from Task 1.
**Downstream contract:** Produces `POST /maps/:id/share → { token, url }` and `GET /share/:token → MapRecord | 404/410` consumed by Task 9 (UUID upload share) and Task 15 (smoke test).
**Skill:** `adversarial-api-testing`
**Files:**
- Create: `code/apps/storage/src/routes/share.ts`
- Create: `code/apps/storage/src/routes/share.test.ts`
- Modify: `code/apps/storage/src/index.ts` (register share routes)
- Modify: `code/apps/storage/src/config.ts` (add `PUBLIC_URL` field)
- Modify: `code/apps/storage/src/config.test.ts` (assert `PUBLIC_URL` default)

**Adversarial sub-checks (per skill annotation):**
1. Token entropy: `nanoid(21)` — 126 bits, adequate for non-secret tokens with TTL.
2. TTL: server-side expiry check on `GET /share/:token`; expired tokens return 410 Gone (not 404, to distinguish "never existed" from "expired").
3. Scope enforcement: `GET /share/:token` returns `{ map: MapRecord, mode: 'read' }` — the `mode` field is set server-side from `ShareToken.mode`, never from request input.
4. Revocation: no revocation in MVP — flag as known gap in `0008-share-link-encoding.md`.
5. Replay: tokens are single-TTL, not single-use in MVP — flag same ADR.
6. Path traversal: `:id` and `:token` validated to alphanumeric before DB lookup.

**Steps:**

- [ ] **Step 1: Implement `routes/share.ts`**

  `POST /maps/:id/share`: verify map exists (404 if not), call `adapter.createShareToken(id)`, return `{ token, url: config.PUBLIC_URL + '/m/' + token, expires_at }`.
  `GET /share/:token`: call `adapter.resolveToken(token)`, check `expires_at > now()` (410 if expired), return `{ map: MapRecord, mode: 'read' }`.

- [ ] **Step 2: Write adversarial tests**

  Cases: expired token returns 410; unknown token returns 404; `mode` in response is always `'read'` regardless of any crafted request body; `:id` with `../` path chars returns 400.

  Run: `cd apps/storage && npx vitest run src/routes/share.test.ts`
  Expected: PASS — all adversarial cases covered.

- [ ] **Step 3: Register routes in `index.ts`**

  Run: `cd apps/storage && npx vitest run`
  Expected: full suite PASS.

---

### Task 5: Vendor Basemap Style JSONs + Create-or-Extend `BasemapRegistry` [Wave 1]

> **Scrub note (2026-05-06):** `BasemapRegistry` was deferred from Phase 1 T3
> per `atlasdraw-2428`; it does NOT exist in `code/packages/basemap/`. T5 must
> first scaffold `BasemapRegistry.ts` and `pmtiles-protocol.ts` (per the
> ORIGINAL Phase 1 T3 spec lines 186-189) BEFORE the "extend" steps below run.
> Treat the "Modify: registry.ts" file as "Create-or-Modify".
>
> **Scrub note (2026-05-10, plan-literal drift):** Steps 1 + 2 below name an
> incorrect source for the Protomaps styles. Protomaps GitHub releases do NOT
> ship `light.json` / `dark.json` as downloadable assets — themes are published
> as a CJS npm module that produces the layer array at call time. **Use the
> npm package `protomaps-themes-base@^4.5.0` instead** (verified 2026-05-10,
> `main: dist/cjs/index.cjs`). Concrete procedure replaces Step 1+2 verbatim
> instructions:
>
> 1. Add `protomaps-themes-base@^4.5.0` to `code/packages/basemap`
>    `devDependencies` (build-time only — generated JSON is committed; no
>    runtime dep on the npm package). 2. Write a one-shot generator script `code/packages/basemap/scripts/build-styles.mjs`
>    that:
>    - Imports `{ layers, namedFlavor }` (or the equivalent exported helpers — grep `node_modules/protomaps-themes-base/dist/cjs/index.cjs` to pin actual names).
>    - For each of `light` and `dark`, builds a complete `StyleSpecification` with `version: 8`, a single `protomaps` vector source whose `url` is the literal `"pmtiles://__PMTILES_PATH__"`, the `glyphs` URL pointing at `"https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf"` (or vendor locally later), and the theme's layer array.
>    - Writes `code/packages/basemap/src/styles/{protomaps-light,protomaps-dark}.json` (pretty-printed).
> 3. Wire the script into `package.json` as a `prebuild` / `build:styles`
>    script, then commit the generated JSONs. The `protomaps-themes-base`
>    dep stays as a `devDependency` — runtime loads from the committed JSON.
> 4. Verification command in Step 1 (the `node -e` check for `__PMTILES_PATH__`
>    in `s.sources`) remains valid as-is.
>
> Step 3 (OpenFreeMap bright) is unchanged — `https://tiles.openfreemap.org/styles/bright` returns valid JSON (verified 2026-05-10, 200 OK).
>
> Originating audit: 2026-05-10 review of botched prior dispatch that hand-rolled toy 5-layer stubs as fake "vendored" styles.

**Orient:** Per Q3, the default basemap for self-hosted first run is `protomaps-light` (local PMTiles, no network). `openfreemap-bright` is gated behind `[basemap.allow_remote] = true`. Style JSONs are vendored so first run needs no network to resolve styles.
**Flow position:** Step 0 of 3 in Flow B (styles → **registry** → BasemapPicker → MapLibre setStyle).
**Upstream contract:** None — this is the root of Flow B.
**Downstream contract:** Produces `BASEMAPS: BasemapConfig[]` with `{ id, label, styleUrl, requiresRemote: boolean }` consumed by Task 6 (BasemapPicker), Task 7 (resolver).
**Skill:** `none`
**Files:**
- Create: `packages/basemap/src/styles/protomaps-light.json` (vendored style)
- Create: `packages/basemap/src/styles/protomaps-dark.json` (vendored style)
- Create: `packages/basemap/src/styles/openfreemap-bright.json` (vendored style)
- Modify: `packages/basemap/src/registry.ts`

**Steps:**

- [ ] **Step 1: Fetch and vendor protomaps-light style JSON**

  Source: Protomaps GitHub releases — `https://github.com/protomaps/basemaps/releases` (pin to a specific tag, e.g., `v4`). Download `light.json`.
  Mutation: in the downloaded JSON, find the `sources` block containing the tile URL; replace its `url` value with the literal string `"pmtiles://__PMTILES_PATH__"` (the `__PMTILES_PATH__` token is replaced at runtime by `resolver.ts` — never at build time).
  Save to: `packages/basemap/src/styles/protomaps-light.json`.

  Run: `node -e "const s=require('./packages/basemap/src/styles/protomaps-light.json'); console.log(JSON.stringify(s.sources))"`
  Expected: output contains `"__PMTILES_PATH__"` and no `https://` tile URLs in the sources block.

- [ ] **Step 2: Fetch and vendor protomaps-dark style JSON**

  Same procedure as Step 1 using `dark.json` from the same Protomaps release tag.
  Save to: `packages/basemap/src/styles/protomaps-dark.json`.

  Run: `node -e "const s=require('./packages/basemap/src/styles/protomaps-dark.json'); console.log(JSON.stringify(s.sources))"`
  Expected: output contains `"__PMTILES_PATH__"`.

- [ ] **Step 3: Fetch and vendor openfreemap-bright style JSON**

  Source: `https://tiles.openfreemap.org/styles/bright` (HTTP GET, pinned version via `?v=` query param if available).
  No token substitution — tile source URLs remain intact (`https://tiles.openfreemap.org/...`). This is intentional: the style only loads when `allow_remote=true` (gated in Task 7 `resolver.ts`).
  Save to: `packages/basemap/src/styles/openfreemap-bright.json`.

  Run: `node -e "const s=require('./packages/basemap/src/styles/openfreemap-bright.json'); console.log(Object.keys(s.sources))"`
  Expected: prints source keys without error; file is valid JSON.

- [ ] **Step 4: Extend `BasemapConfig` type and populate `BASEMAPS` array**

  Add `requiresRemote: boolean` field to `BasemapConfig` interface in `registry.ts`.
  Three entries:
  - `{ id: 'protomaps-light', label: 'Light', styleFile: 'protomaps-light.json', requiresRemote: false }`
  - `{ id: 'protomaps-dark', label: 'Dark', styleFile: 'protomaps-dark.json', requiresRemote: false }`
  - `{ id: 'openfreemap-bright', label: 'Bright', styleFile: 'openfreemap-bright.json', requiresRemote: true }`
  `styleFile` is a relative path resolved at runtime — not a URL.

- [ ] **Step 5: Verify package builds cleanly**

  Run: `cd packages/basemap && pnpm build`
  Expected: exits 0, no TypeScript errors, no unresolved imports.

---

### Task 6: `BasemapPicker` UI Component [Wave 1]

**Orient:** Users need to switch basemap with a single click. Three thumbnail cards — light, dark, bright — with the remote-gated option visually disabled (not hidden) when `allow_remote=false`. Keyboard navigable.
**Flow position:** Step 1 of 3 in Flow B (registry → **BasemapPicker** → MapLibre setStyle).
**Upstream contract:** Receives `BASEMAPS: BasemapConfig[]` and `allowRemote: boolean` prop from app config. Receives current `activeBasemapId: string`.
**Downstream contract:** Emits `onSelect(basemapId: string)` consumed by `MapCanvas.setStyle`.
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/components/BasemapPicker.tsx`
- Create: `apps/atlas-app/components/BasemapPicker.test.tsx`

**Steps:**

- [ ] **Step 1: Implement component**

  Three thumbnail cards (static PNG previews, generated from style colors).
  Active basemap has `aria-selected=true` ring.
  `requiresRemote=true` card when `allowRemote=false`: render with opacity-50, tooltip "Enable remote basemaps in config to use this style", click is a no-op.
  Props: `basemaps`, `activeId`, `allowRemote`, `onSelect`.

- [ ] **Step 2: Write tests**

  Cases: renders 3 cards; click on unlocked card calls `onSelect`; click on locked card does NOT call `onSelect`; locked card has tooltip; keyboard nav (ArrowRight/ArrowLeft) cycles unlocked cards.

  Run: `cd apps/atlas-app && npx vitest run src/components/BasemapPicker.test.tsx`
  Expected: PASS.

- [ ] **Step 3: Integrate into toolbar**

  Wire into existing app toolbar (exact file depends on Phase 1/2 output). Confirm visible at `localhost:3000`.
  Run: `pnpm --filter atlas-app dev` and visually verify three thumbnails appear.
  Expected: picker visible, selecting a card changes the basemap.

---

### Task 7: PMTiles Protocol Registration + `resolver.ts` Config Gate [Wave 1]

> **Scrub note (2026-05-10, plan-literal drift):** Step 1 below says "Update
> `pmtiles-protocol.ts` to accept a base path." That conflates protocol
> registration (a one-time MapLibre `addProtocol` call) with style-token
> substitution. The current `code/packages/basemap/src/pmtiles-protocol.ts`
> (verified 2026-05-10) takes no arguments and registers `pmtiles://` once,
> idempotently. **Do NOT add a parameter to `registerPmtilesProtocol`.**
> Path substitution is the resolver's job:
>
> - `pmtiles-protocol.ts` (Phase 1): unchanged — `registerPmtilesProtocol(): void`, no path arg.
> - `style-builder.ts` (Phase 4 Wave 0 — already exists): already performs the `__PMTILES_PATH__` → caller-supplied path substitution via `JSON.stringify().split(TOKEN).join(path)`. Keep as the substitution engine.
> - `resolver.ts` (new this task): provides `getPmtilesPath()` (reads `import.meta.env.VITE_PMTILES_PATH` with a dev fallback) and `resolveStyle(id, opts)` that does the gate check + delegates substitution to `buildStyle()`.
>
> Net effect of T7: a single `resolveStyle(id, { allowRemote })` call in `MapEditor.tsx` (replacing the current hardcoded `buildStyle(config, { pmtilesPath: "/data/india.pmtiles" })` shape that landed and was reverted on 2026-05-10).
>
> Originating audit: 2026-05-10 review of botched prior dispatch that hardcoded `/data/india.pmtiles` directly in `MapEditor.tsx` and skipped the resolver entirely.

**Orient:** Per Q3, the local PMTiles file must be wired at app startup without network. `pmtiles-protocol.ts` already exists from Phase 1; this task wires it to the volume-mounted file path and gates the remote basemap option via config.
**Flow position:** Step 2 of 3 in Flow B and Step 2 of 3 in Flow C (protomaps-style → **pmtiles-protocol** → MapCanvas tile requests).
**Upstream contract:** Receives `VITE_PMTILES_PATH` env var (set by docker-compose volume mount to `/data/world-low-zoom.pmtiles`). Receives `BasemapConfig.requiresRemote` from Task 5.
**Downstream contract:** Produces `resolveStyleUrl(id, config) → string` consumed by `MapCanvas.setStyle` in `BasemapPicker.onSelect` handler.
**Skill:** `none`
**Files:**
- Modify: `packages/basemap/src/pmtiles-protocol.ts`
- Create: `packages/basemap/src/resolver.ts`

**Steps:**

- [ ] **Step 1: Update `pmtiles-protocol.ts` to accept base path**

  Accept `pmtilesBasePath: string` parameter; replace the `{config.pmtiles_path}` placeholder in protomaps style JSONs with the actual path on first call.
  Remain idempotent (second call with same path is a no-op).

- [ ] **Step 2: Implement `resolveStyleUrl(id: string, opts: { allowRemote: boolean, pmtilesPath: string }): string`**

  If `BASEMAPS.find(id).requiresRemote && !opts.allowRemote` → throw `BasemapRemoteGatedError`.
  If protomaps style → return the style JSON with tile source pointing to `pmtiles://${opts.pmtilesPath}`.
  If openfreemap-bright and `allowRemote=true` → return the remote style URL.

- [ ] **Step 3: Verify resolver throws on gated access**

  Run: `cd packages/basemap && npx vitest run src/resolver.test.ts`
  Expected: PASS — `resolveStyleUrl('openfreemap-bright', { allowRemote: false })` throws `BasemapRemoteGatedError`.

---

### Task 8: Share-via-Link — URL Hash Mode (tiny maps <32 KB) [Wave 2]

> **Scrub note (2026-05-11, pre-dispatch — covers T8 and T9):** Four
> corrections from pre-dispatch grounding against the Phase 4 shipped
> surface:
>
> 1. **Path correction.** Plan literals `apps/atlas-app/...` are
>    `code/apps/atlas-app/...`. `apps/atlas-app/pages/share/[uuid].tsx`
>    assumes Next.js routing — this app is Vite SPA, no router. Replace
>    with a path-based switch in `App.tsx` (currently a one-liner
>    `<MapEditor />` per mulch convention `mx-3342d8`).
> 2. **AtlasdrawBundle is not a thing.** The plan invokes a `packages/sdk`
>    `AtlasdrawBundle` that does not exist. The canonical persisted
>    type is `AtlasdrawDocument` from `@atlasdraw/data` (mulch
>    `mx-4b9e4e`). For hash mode, JSON-stringify the document directly
>    and lz-string-compress that string. For upload mode, use
>    `write(doc)` to produce the Blob (same as autosave), POST to
>    storage. No SDK indirection needed.
> 3. **Dialog primitive: do NOT depend on Excalidraw's Dialog.** The
>    audit-amended note at line 779 says to grep `code/packages/excalidraw/`
>    for an exported Dialog — but the established convention (handoff
>    2026-05-10, AboutDialog implementation) is to author standalone
>    modals mirroring `BasemapPickerDialog` and `AboutDialog`
>    (root-level mount, no `@excalidraw/Dialog` import, jsdom-testable,
>    Escape + click-outside dismiss). ShareDialog follows the same
>    pattern. Skip the Excalidraw-Dialog grep.
> 4. **Storage server has no blob-retrieval HTTP route.** T3 shipped
>    `GET /maps/:id` returning `MapRecord` JSON (metadata only, no
>    blob). T9's viewer needs the blob bytes. This dispatch therefore
>    extends T3:
>    - Add `getBlob(id: string): Promise<Buffer | null>` to the
>      `StorageClient` interface (`code/apps/storage/src/types.ts`).
>    - Implement on both adapters (`sqlite-fs` reads
>      `$DATA_DIR/blobs/{id}.atlasdraw`; `postgres-minio` issues
>      `GetObjectCommand` against the `atlasdraw-maps` bucket).
>    - Add `GET /share/:token/blob` route to `routes/share.ts` —
>      validates token, checks expiry (410 if expired/orphaned),
>      fetches `getBlob(map.id)`, returns 200 with
>      `application/octet-stream` body. Same 400/404/410 traversal
>      and existence guards as `GET /share/:token`.
>    - Mirror the storage-side blob route on the atlas-app
>      `createHttpStorageClient` as a new `getShareBlob(token)`
>      method. The 5-method `StorageClient` interface stays as-is;
>      this is an HTTP-only addition since adapter-level `getBlob`
>      lives behind the share route, not directly exposed.
>
> **Tests required:**
> - storage: `getBlob` unit tests on both adapters; `/share/:token/blob`
>   route tests (200/404/410/400).
> - atlas-app: `useShareLink` hash-mode round-trip; upload-mode
>   round-trip (mock fetch); `ShareDialog` render + drain-gated copy;
>   path router test in `App.tsx` (hash, token, default).
>
> **lz-string** is not in `code/yarn.lock`. Install
> `lz-string@^1.5.0` as an atlas-app dep + `@types/lz-string` devDep.
>
> Originating audit: 2026-05-11 pre-dispatch scrub.



**Orient:** Maps below 32 KB uncompressed should share as a fully self-contained URL hash — no server round-trip, no storage dependency. This is the zero-infrastructure share path.
**Flow position:** Step 2a of 4 in Flow A (scene-snapshot → **size-check → lz-compress → URL hash** → clipboard).

<contracts>
**Upstream (scene-snapshot → this node):**
- `AtlasdrawBundle` from `packages/sdk`: `{ scene: ExcalidrawScene, layers: GeoJSON[], style: MapLibreStyle, manifest: Manifest }`
- Behavioral invariant: bundle is the last-drained autosave state (not in-flight)

**Downstream (this node → clipboard):**
- URL string: `<origin>/m#v1:<lz-base64-encoded-bundle>`
- Behavioral invariant: decoding the hash must reproduce the full `AtlasdrawBundle` losslessly
</contracts>

**Codebooks: cache-coherence** — The Share button must check `useAutosave().isDraining` before snapshotting. If draining, show a "Saving…" spinner and retry after drain completes. Publishing a stale in-flight buffer is the primary failure mode.

**Skill:** `atlasdraw-ui-conventions` — invoke before building `ShareDialog.tsx`. This is a modal (new standalone surface) — correct because it's a distinct multi-step flow. Check color tokens, button pattern (primary filled for "Copy link", default for cancel), text sizing, aria labels, data-testid on all interactive elements.

<!-- audit-amended 2026-05-04: dialog primitive — before implementing ShareDialog as a raw React portal, grep `code/packages/excalidraw/` for exported `Dialog` or `ConfirmDialog` primitives (focus trap, Escape, scroll lock already wired). If found, extend them. If NOT found → vendored fork required: add `registerDialog` API (~50 LOC patch, same pattern as the vendored `registerContextMenuItem` extension in Wave 4c). Justifiable: Excalidraw's dialog UX (focus trap, Escape handling, scroll lock) must not be re-implemented independently. Pre-dispatch scrub: grep `code/packages/excalidraw/index.ts` for `Dialog` export before writing any dialog code. -->

**Files:**
- Create: `apps/atlas-app/hooks/useShareLink.ts`
- Create: `apps/atlas-app/components/ShareDialog.tsx`

**Steps:**

- [ ] **Step 1: Implement `encodeHashShare(bundle: AtlasdrawBundle): string`** <!-- shape-incorporated 2026-05-03: Q2 resolved — Safari hash limit ~50K chars; lz-string produces ~17.5K chars for 32KB input; 32KB threshold confirmed safe -->

  Serialize bundle to JSON, compress with `lz-string.compressToBase64`, prefix with `v1:`, prepend `#`. Max result length guard: **50 000 chars** (Safari/WebKit URL hash limit; at 32 KB uncompressed input lz-string produces ~17 500 chars — well within bounds). `compressToBase64` output is URL-safe directly; no additional `encodeURIComponent` needed.

- [ ] **Step 2: Implement size gate in `useShareLink`**

  Serialize bundle → check uncompressed byte size → if < 32 768: use hash mode. Else: use UUID upload mode (Task 9).
  Block on `isDraining` before snapshotting.

- [ ] **Step 3: Implement `ShareDialog.tsx`**

  Spinner state during drain wait.
  Success state: read-only URL displayed in a copyable input, "Copy link" button.
  Hash-mode URL example: `http://localhost:3000/m#v1:N4Igx...`.

- [ ] **Step 4: Implement hash decode on `/m` route**

  `apps/atlas-app/pages/share/[uuid].tsx` must also handle hash-only loads (no `:uuid` segment, just a `#v1:...` hash). Detect on mount; decode; render read-only `AtlasCanvas`.

- [ ] **Step 5: Round-trip test**

  Run: `cd apps/atlas-app && npx vitest run src/hooks/useShareLink.test.ts`
  Expected: PASS — encode then decode produces identical bundle JSON.

---

### Task 9: Share-via-Link — UUID Upload Mode (maps ≥32 KB) [Wave 2]

**Orient:** Maps over the URL hash threshold are uploaded to the storage server, a share token is minted, and the URL is `/m/:token`. The read-only viewer fetches the map from storage using the token.
**Flow position:** Step 2b of 4 in Flow A (size-check → **upload → share token → /m/:token** → clipboard).

<contracts>
**Upstream (size-check → this node):**
- `AtlasdrawBundle` from Task 8's size gate (≥32 KB uncompressed path)
- `StorageClient.createMap(blob)` + `StorageClient.createShareToken(id)` from Task 3/4

**Downstream (this node → viewer route):**
- `GET /share/:token → { map: MapRecord, mode: 'read' }` (Task 4 contract)
- URL: `<PUBLIC_URL>/m/:token`
</contracts>

**Codebooks: cache-coherence** — Same drain invariant as Task 8. Additionally: if the user edits after sharing, the shared URL is a snapshot — it does not update. The Share dialog must state this: "This link shows the map as it was when you shared it."

**Skill:** `none`
**Files:**
- Modify: `apps/atlas-app/hooks/useShareLink.ts` (add upload branch)
- Modify: `apps/atlas-app/pages/share/[uuid].tsx` (fetch from storage by token)

**Steps:**

- [ ] **Step 1: Add upload branch to `useShareLink`**

  `writeAtlasdraw(bundle)` → `POST /maps` → get `map.id` → `POST /maps/:id/share` → get `token` → construct URL.

- [ ] **Step 2: Update `/m/[uuid].tsx` to load from storage**

  On mount, call `GET /share/:uuid` → receive `{ map, mode }` → fetch blob from storage → `readAtlasdraw(buffer)` → render read-only canvas.
  Error states: 404 (map not found), 410 (link expired) — both show user-facing message.

- [ ] **Step 3: Test upload path with mock storage**

  Run: `cd apps/atlas-app && npx vitest run src/hooks/useShareLink.upload.test.ts`
  Expected: PASS — mock storage server verifies `POST /maps` then `POST /maps/:id/share` are called in order with correct content-type.

---

### Task 10: `docker-compose.minimal.yml` — 3-Service Stack [Wave 2]

> **Scrub note (2026-05-11, pre-dispatch):** Three scope adjustments from
> pre-dispatch grounding against the shipped Phase 4 surface:
>
> 1. **Path correction.** Plan literal `infra/...` is correct — workspace
>    root is `code/`, but compose lives one level up at repo root next to
>    `docs/`. No `code/` prefix needed for this task.
> 2. **Dockerfiles required and not in the spec.** Plan asks for a
>    compose file but the services (`web`, `storage`) need Dockerfiles
>    that don't exist yet. T10 must also create:
>    - `code/apps/atlas-app/Dockerfile` — multi-stage: yarn build → serve
>      `dist/` via nginx:alpine.
>    - `code/apps/storage/Dockerfile` — multi-stage: yarn build → node:20
>      runtime. Run `node dist/index.js`.
>    Plus `.dockerignore` files for both apps to avoid sending
>    `node_modules`, build artifacts, and (critically) the gitignored
>    `india.pmtiles` 4.9 GB local archive into the build context.
> 3. **`fetch-pmtiles.sh` is unnecessary for T10.** The 43 MB
>    `world-low-zoom.pmtiles` is already committed to repo via Git LFS at
>    `code/apps/atlas-app/public/data/world-low-zoom.pmtiles` and is
>    baked into the atlas-app Vite build output (`dist/data/`). The web
>    image ships with the pmtiles file inside its nginx serving root —
>    no runtime fetch needed. The shared compose volume is therefore
>    only for the storage server's sqlite db + blobs (`/data` in the
>    storage container). T12 (Makefile basemap-world) covers rebuilding
>    the pmtiles from upstream Protomaps; T10 just consumes the
>    pre-built asset.
>
> **Service set** (down from spec's 3 to 2 + 1 named volume):
> - `web` — atlas-app dist served by nginx:alpine. Port 3000.
>   Built with `VITE_BUILD_TARGET=local-only` (no demo badge, no GH-Pages
>   base prefix) and `VITE_STORAGE_BASE_URL=http://localhost:4000` (so
>   `enableBackendPersistence=true` would route to storage — but note:
>   `enableBackendPersistence` is gated on `buildTarget === "hosted"`,
>   not on `local-only`; minimal stack DOES NOT autosave to storage by
>   default. T10 ships the stack; T11 full stack uses `buildTarget=hosted`.)
>
>   **Sub-decision:** for the minimal stack, build with
>   `VITE_BUILD_TARGET=hosted` so autosave actually exercises the
>   storage server. Otherwise the minimal stack is browser-only and the
>   storage container is unused — defeats the purpose of bundling
>   storage in the compose.
> - `storage` — apps/storage image. `STORAGE_MODE=sqlite-fs`,
>   `DATA_DIR=/data`, `LOG_LEVEL=info`. Port 4000.
> - Named volume `atlas-storage-data` mounted at `/data` in the storage
>   container only.
>
> **No `depends_on` health gate** (per spec) — Phase 5 hardening adds
> healthchecks. T10's `depends_on: storage` is sufficient.
>
> **Verification command** — `docker compose -f infra/docker-compose.minimal.yml config --quiet` validates YAML/compose syntax without needing the daemon. If docker is unavailable in CI / orchestrator env, `python3 -c "import yaml; yaml.safe_load(open('infra/docker-compose.minimal.yml'))"` is a fallback.
>
> Originating audit: 2026-05-11 pre-dispatch scrub.

**Orient:** This is the first-run stack (Q10). A curious user runs one command and gets a working Atlasdraw with zero external dependencies. Services: web + storage (sqlite-fs mode) + shared data volume. No postgres, no minio, no caddy. (Q1: no realtime container in Phase 4.)
**Flow position:** Step 3 of 3 in Flow C (config-detection → **minimal compose** → first-run experience).
**Upstream contract:** Receives `STORAGE_MODE=sqlite-fs`, `DATA_DIR=/data` — these env vars activate the sqlite-fs adapter from Task 3. Requires `code/apps/atlas-app/public/data/world-low-zoom.pmtiles` (already committed via Git LFS) to be present at image-build time.
**Downstream contract:** Running stack at `localhost:3000` consumed by Task 15 (smoke test).
**Skill:** `none`
**Files:**
- Create: `infra/docker-compose.minimal.yml`
- Create: `code/apps/atlas-app/Dockerfile`
- Create: `code/apps/atlas-app/.dockerignore`
- Create: `code/apps/storage/Dockerfile`
- Create: `code/apps/storage/.dockerignore`

**Steps:**

- [ ] **Step 1: Write `docker-compose.minimal.yml`**

  Services: `web` (atlas-app, port 3000), `storage` (apps/storage, port 4000, `STORAGE_MODE=sqlite-fs`, `DATA_DIR=/data`).
  Shared volume: `atlasdata` mounted at `/data` in both containers.
  Storage depends on volume existing; web depends on storage.
  No health checks beyond `depends_on` in MVP (add in Phase 5 hardening).

- [ ] **Step 2: Write `fetch-pmtiles.sh`** <!-- shape-incorporated 2026-05-03: Q1 unblocked — no stable hotlink exists; script now queries builds.json, downloads dated planet, runs pmtiles extract --maxzoom=5 -->

  Behavior (no stable hotlink URL exists — Protomaps explicitly discourages hotlinking):
  1. Query `https://build-metadata.protomaps.dev/builds.json` to get the latest dated build key (e.g., `20260503`).
  2. If `PMTILES_SOURCE_URL` env var is set, skip steps 1–3 and download directly from that URL instead (operator override for pre-hosted R2 objects).
  3. Download `https://build.protomaps.com/${key}.pmtiles` (full planet, ~135 GB) and pipe through `pmtiles extract --maxzoom=5 --output=infra/data/world-low-zoom.pmtiles` to produce the ~200 MB low-zoom cut. Requires `pmtiles` CLI on PATH (see Pre-Work Checklist).
  4. Idempotent: skip if `infra/data/world-low-zoom.pmtiles` exists and byte size matches expected.
  Estimated wall time: ~10 min on a fast connection (download + extract). First run only.
  Operators who want to avoid the extract step: upload the extracted file to their own Cloudflare R2 bucket (recommended by Protomaps — no bandwidth fees), then set `PMTILES_SOURCE_URL` to the R2 object URL.

- [ ] **Step 3: Add `Makefile` target `pmtiles-fetch`**

  `make pmtiles-fetch` runs `infra/data/fetch-pmtiles.sh`. Prerequisite for `make up-minimal`.
  `make up-minimal` = `make pmtiles-fetch && docker compose -f infra/docker-compose.minimal.yml up`.

- [ ] **Step 4: Verify compose file parses**

  Run: `docker compose -f infra/docker-compose.minimal.yml config --quiet`
  Expected: exits 0 (config valid, no warnings).

---

### Task 11: `docker-compose.yml` — Full 5-Service Stack + Caddyfile [Wave 2]

**Orient:** The production-recommended stack (Q10): web + storage + postgres + minio + caddy. Phase 5 adds realtime as a sixth service without restructuring this file (see profiles note in Phase Boundary Contracts). Caddy handles TLS and WebSocket upgrade for the eventual realtime service.
**Flow position:** Parallel to Task 10 — both are compose stacks. This one targets production self-hosters.
**Upstream contract:** Receives `STORAGE_MODE=postgres-minio` env, postgres + minio service names. Requires storage routes from Task 3/4.
**Downstream contract:** Documented deployment path; Phase 5 adds `realtime` service by appending to this file. Consumed by `docs/self-host/production.md` (Task 14).
**Skill:** `none`
**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/caddy/Caddyfile`

**Steps:**

- [ ] **Step 1: Write `docker-compose.yml` (5 services)**

  `web`: atlas-app image, port 3000 (behind Caddy).
  `storage`: apps/storage image, port 4000 (behind Caddy), `STORAGE_MODE=postgres-minio`, `DATABASE_URL`, `BLOB_ENDPOINT=http://minio:9000`.
  `postgres`: postgres:16, persistent volume `pgdata`, credentials from env file.
  `minio`: minio/minio, persistent volume `miniodata`, credentials from env file. Console on 9001 (not exposed outside Caddy by default). Add `deploy.resources.limits.memory: 1g` — single-node MinIO idles at ~300–600 MB; cap prevents runaway on dev laptops. <!-- shape-incorporated 2026-05-03: Q5 resolved — 1g limit confirmed adequate for single-node dev MinIO -->
  `caddy`: caddy:2-alpine, Caddyfile mount, ports 80+443 exposed. Add named volume `caddy_data` mounted at `/data` inside the Caddy container — without it, auto-renewed TLS certs (Let's Encrypt ACME and `tls internal` CA) are lost on container restart, triggering re-provisioning and rate-limit exposure in production. <!-- shape-incorporated 2026-05-03: Q4 resolved — caddy_data named volume required to persist certs across restarts -->
  Note: Phase 5 adds `realtime` using compose `profiles: ["realtime"]` — add comment placeholder. <!-- shape-incorporated 2026-05-03: Q3/compose profiles confirmed safe (Compose v2.2+) -->

- [ ] **Step 2: Write `Caddyfile`**

  `{$PUBLIC_DOMAIN} { reverse_proxy /api/* storage:4000; reverse_proxy /* web:3000 }`.
  TLS: `tls {$ACME_EMAIL}` for auto Let's Encrypt in production; `tls internal` for local testing.

- [ ] **Step 3: Verify compose file parses**

  Run: `docker compose -f infra/docker-compose.yml config --quiet`
  Expected: exits 0.

---

### Task 12: `Makefile` — `basemap-world` Recipe [Wave 2]

**Orient:** Self-hosters who want full-zoom tile coverage need a documented, reproducible way to build or download the full world PMTiles. The tool (planetiler or tilemaker) is referenced, not built; the Makefile target documents the recipe and accepts a pre-built download URL as the default path.
**Flow position:** Parallel to Task 10/11 — infra tooling, no runtime dependency.
**Upstream contract:** None — standalone Makefile target.
**Downstream contract:** Produces `infra/data/world.pmtiles` (full resolution, ~120 GB). Documented in `docs/self-host/production.md`.
**Skill:** `none`
**Files:**
- Modify: `infra/Makefile` (add `basemap-world` target)

**Steps:**

- [ ] **Step 1: Add `basemap-world` download target** <!-- shape-incorporated 2026-05-03: Q1 resolved — no stable pinned URL; key must be resolved from builds.json; full planet is 135 GB, not a semver-tagged file -->

  Default behavior: query `https://build-metadata.protomaps.dev/builds.json` for the latest daily build key, then `curl https://build.protomaps.com/${key}.pmtiles` (full planet, ~135 GB). Output: `infra/data/world.pmtiles`. Operators with a hosted file set `PMTILES_SOURCE_URL` to skip the API query and download directly.
  Guard: print `"WARNING: This downloads approximately 120 GB. Proceed? [y/N]"` and read stdin before starting. If the user types anything other than `y` or `Y`, abort with exit code 1.
  Progress: use `curl --progress-bar` so download progress is visible. Resume with `-C -` on partial download.

- [ ] **Step 2: Add commented `planetiler` build alternative**

  Immediately below the curl command, add a commented block showing the `planetiler` invocation for users who want to regenerate from an OSM PBF extract. Comment must include: the required Java version (17+), the approximate build time (~2 h on 8-core), and a pointer to `https://github.com/onthegomap/planetiler`.
  The comment block is documentation, not executable. No CI test needed.

- [ ] **Step 3: Add `basemap-region` target**

  `make basemap-region BBOX="<minLon,minLat,maxLon,maxLat>"` — downloads a regional Protomaps extract from `https://build.protomaps.com/extract?bbox=$(BBOX)` (or equivalent endpoint). Output: `infra/data/region.pmtiles`.
  If `BBOX` is unset, abort with: `"Usage: make basemap-region BBOX='minLon,minLat,maxLon,maxLat'"`.
  Guard: print estimated download size (derived from bbox area heuristic — "a country-sized extract is typically 1–10 GB") before proceeding.

- [ ] **Step 4: Add `help` target**

  `make help` prints a one-line description of every target: `pmtiles-fetch`, `up-minimal`, `basemap-world`, `basemap-region`, `help`. This is the discoverability surface for new contributors.

- [ ] **Step 5: Verify all Makefile targets parse**

  Run: `make -n basemap-world SKIP_CONFIRM=1 2>&1 | head -5`
  Expected: prints the curl command; exits 0; no `make: *** No rule to make target` errors.

  Run: `make -n basemap-region BBOX="-180,-90,180,90" 2>&1 | head -5`
  Expected: prints the region download command; exits 0.

  Run: `make help`
  Expected: prints all 5 target descriptions, one per line.

---

### Task 13: Wire `startAutoSave` into Drain-State Hook + Storage Client [Wave 1]

> **Scrub note (2026-05-06) — RE-SCOPED.** Original spec authored a debounced
> autosave hook from scratch. **Phase 3 T8 already shipped this.**
>
> Existing surface (verified literals):
> - `code/apps/atlas-app/src/state/persistence.ts:430 startAutoSave(opts)` —
>   trailing-edge debounce + 30s ceiling + sequence-counter snapshot guard.
> - `code/apps/atlas-app/src/state/usePersistenceStore.ts:33 usePersistenceStore`
>   — Zustand store with `markDirty`, `setLastSavedAt`, etc.
> - `code/apps/atlas-app/src/components/MapEditor.tsx:470+` — wiring +
>   `markDirty` invocation in `handleExcalidrawChange`.
>
> T13 is now **wire-only**: surface a thin `useAutosave()` hook that exposes
> `{ isDraining, lastSavedAt, forceSave }` derived from `usePersistenceStore`,
> and bridge `startAutoSave`'s save callback to `StorageClient.updateMap` (when
> in `postgres-minio` mode) instead of (or in addition to) IndexedDB.
> Estimated diff: ~30 lines + 1 test file. NOT a hook author.

**Orient:** The Share button and the share link encoding both depend on having a clean, committed snapshot of the current map state. `useAutosave` is the single source of truth for "is the canvas dirty relative to the last persisted version" — without it, both share modes can silently publish stale data.
**Flow position:** Step 0.5 of 4 in Flow A (canvas-edits → **autosave-debounce** → scene-snapshot → share). Parallel to Task 3 — provides `isDraining` flag consumed by Tasks 8 and 9.
**Upstream contract:** Wraps existing `startAutoSave` + `usePersistenceStore`. Receives `StorageClient.updateMap(id, blob)` from Task 3 and routes the save callback to it when storage mode is remote.
**Downstream contract:** Exports `{ isDraining: boolean, lastSavedAt: Date | null, forceSave(): Promise<void> }` consumed by `ShareDialog.tsx` (Task 8) and `useShareLink.ts` (Tasks 8/9).
**Skill:** `none`
**Files:**
- Create: `code/apps/atlas-app/src/hooks/useAutosave.ts` (thin wrapper, ~30 lines)
- Create: `code/apps/atlas-app/src/hooks/useAutosave.test.ts`
- Modify (do NOT duplicate): `code/apps/atlas-app/src/state/persistence.ts` — extend `CreatePersistenceStoreOptions` to accept an optional `remoteSave?: (blob: Blob) => Promise<void>` callback that fires alongside the IndexedDB write.

**Steps:**

- [ ] **Step 1: Implement debounce loop**

  On every Excalidraw `onChange` event: set `isDraining = true`, schedule `forceSave` after 500 ms. If another `onChange` arrives within the window, reset the timer (trailing-edge debounce).

- [ ] **Step 2: Implement `forceSave()`**

  Calls `AtlasdrawAPI.getScene()` → `writeAtlasdraw(bundle)` → `StorageClient.updateMap(mapId, blob)` → on success set `lastSavedAt = new Date()`, `isDraining = false`. On error: set `isDraining = false`, surface error toast (do not retry silently — user must see the failure).

- [ ] **Step 3: Expose `isDraining` as a reactive state**

  Use React state (`useState` + `useEffect`). `isDraining` is `true` from the first `onChange` until the `updateMap` call resolves. This must be synchronously observable (no async gap between "user typed" and `isDraining = true`).

- [ ] **Step 4: Write unit tests**

  Cases: `isDraining` is `false` on init; becomes `true` immediately on first `onChange`; reverts to `false` after `forceSave` resolves; multiple rapid `onChange` calls produce exactly one `updateMap` call; `forceSave` rejection leaves `isDraining = false` (not stuck).

  Run: `cd apps/atlas-app && npx vitest run src/hooks/useAutosave.test.ts`
  Expected: PASS — all 5 cases green.

- [ ] **Step 5: Verify integration in canvas**

  Run: `pnpm --filter atlas-app dev`
  Expected: browser DevTools → React DevTools shows `isDraining` flipping true/false within ~600 ms of a canvas edit.

---

### Task 14: `AboutDialog.tsx` — Telemetry Policy UI [Wave 1]

**Orient:** ADR-0006 from Phase 0 established the telemetry policy. Users need an in-app surface to see this policy without leaving the app. "Show HN moment" credibility depends on this being present and honest.
**Flow position:** Standalone UI task, no data flow dependency.
**Upstream contract:** Reads `app version` from `package.json` (injected via Vite define). Links to `ADR-0006-telemetry.md`.
**Downstream contract:** Displayed via Help menu or `?` button in toolbar.
**Skill:** `atlasdraw-ui-conventions` — invoke before building `AboutDialog.tsx`. Modal is correct (distinct informational surface). The trigger "?" button slots into the existing toolbar (not a new floating element). Check button pattern, color tokens, data-testid.

<!-- audit-amended 2026-05-04: dialog primitive — same constraint as ShareDialog (Task 8). Grep `code/packages/excalidraw/index.ts` for exported `Dialog` or `ConfirmDialog` before writing AboutDialog. If Excalidraw exposes its dialog primitive, extend it; if not, the vendored `registerDialog` fork (Task 8 amendment) covers both dialogs. Do not build a second independent portal. -->

**Files:**
- Create: `apps/atlas-app/components/AboutDialog.tsx`
- Create: `apps/atlas-app/components/AboutDialog.test.tsx`

**Steps:**

- [ ] **Step 1: Implement `AboutDialog` component**

  Sections: version + build hash (from `import.meta.env.VITE_APP_VERSION` and `VITE_GIT_HASH`), license badge (AGPL-3.0 per Q5), telemetry policy block (verbatim from ADR-0006 summary: "No analytics. No call-home. No required API keys."), link to `docs/architecture/adr/0006-telemetry.md` (opens in new tab).

- [ ] **Step 2: Wire into Help menu**

  Add "About Atlasdraw" menu item to existing Help or `?` button (exact insertion point determined by Phase 0/1 toolbar structure — search for `HelpMenu` or `AboutButton` in `apps/atlas-app/`).

- [ ] **Step 3: Inject version env vars in Vite config**

  `vite.config.ts`: add `define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version), 'import.meta.env.VITE_GIT_HASH': JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim()) }`.

- [ ] **Step 4: Write tests and verify**

  Cases: component renders version string, policy text "No analytics", AGPL link with correct href, and build hash.

  Run: `cd apps/atlas-app && npx vitest run src/components/AboutDialog.test.tsx`
  Expected: PASS — all 4 assertions green.

---

### Task 15: Self-Host Documentation — `README.md` First-Run + `production.md` [Wave 2]

**Orient:** The Show HN post links to the README. A first-timer must reach a working local install without hitting a wall. **First run takes ~10 min** (PMTiles download + extract, once only; subsequent `make up-minimal` is <30s). The README must be honest about this — set expectations before `make pmtiles-fetch` is run. The README points to `docker-compose.minimal.yml`; `production.md` covers the full stack. <!-- shape-incorporated 2026-05-03: Q1 unblocked — ~10 min first-run is a known UX cost; "under 2 minutes" claim was false after resolver findings -->
**Flow position:** Parallel to compose tasks — documentation, no code dependency. Deliverable of the demo moment.
**Upstream contract:** Consumes confirmed commands from Task 10 (minimal compose), Task 11 (full compose), Task 12 (Makefile targets).
**Downstream contract:** README first-run section is the entry point for every new user. `production.md` is the self-hoster's deployment guide. Both consumed by Task 16 (smoke test — the tester walks the README step by step).
**Skill:** `none`
**Files:**
- Create: `docs/self-host/README.md`
- Create: `docs/self-host/production.md`

**Steps:**

- [ ] **Step 1: Write `README.md` first-run section** <!-- shape-incorporated 2026-05-03: Q1 unblocked — README must document ~10 min first-run, pmtiles CLI prereq, and R2 hosting recommendation -->

  Prerequisites block (before the numbered steps): Docker, `pmtiles` CLI on PATH (`go install github.com/protomaps/go-pmtiles/...@latest`).
  Steps: (1) `git clone`, (2) `make pmtiles-fetch` (**first run: ~10 min** — downloads full planet ~135 GB, extracts zoom 0–5 cut to ~200 MB; subsequent runs are instant if file exists), (3) `cd infra && docker compose -f docker-compose.minimal.yml up`, (4) open `localhost:3000`.
  R2 hosting tip: if you host the extracted `world-low-zoom.pmtiles` on Cloudflare R2, set `PMTILES_SOURCE_URL=<your-r2-url>` before running `make pmtiles-fetch` to skip the full planet download. R2 has no bandwidth fees — Protomaps' explicit recommendation.
  Screenshot placeholder: `![First run screenshot](../assets/first-run.png)` — actual screenshot taken in Task 16.

- [ ] **Step 2: Write `production.md`**

  Sections: prerequisites (Docker, domain, port 80/443 open), env file setup, `docker compose up`, Caddy TLS verification, backup (postgres dump + minio sync), upgrade path (pull + `docker compose up --build`).
  Reference Q10 decision: "why two compose files."

- [ ] **Step 3: Verify all commands in docs are copy-paste correct**

  Run: `grep -n 'docker compose\|make ' docs/self-host/README.md docs/self-host/production.md`
  Expected: every command matches an actual Makefile target or compose file confirmed in Tasks 10/11/12.

---

### Task 16: First-Run Smoke Test — E2E Acceptance [Wave 3]

**Orient:** This is the acceptance gate for the entire phase. Clone → run → pin → save → share → incognito — all must work. If any step fails, Phase 4 is not done.
**Flow position:** Final step of all three flows — this task verifies Flow A, B, and C end-to-end.
**Upstream contract:** Requires Tasks 3, 4, 6, 7, 8, 9, 10, 13 all complete and integrated. Walks `docs/self-host/README.md` (Task 15) exactly as a new user would.
**Downstream contract:** Phase 4 is complete when this task passes. README screenshot captured. Phase 5 plan may begin.
**Skill:** `shadow-walk`
**Files:**
- Create: `tests/e2e/phase4-smoke.test.ts`

**Shadow-walk persona:** new user who cloned the repo after reading the Show HN post. Has Docker. Has never seen Atlasdraw. Follows README exactly.

**Steps:**

- [ ] **Step 1: Start minimal stack**

  Run: `make pmtiles-fetch && cd infra && docker compose -f docker-compose.minimal.yml up -d`
  Expected: all containers reach `running` state within 30 seconds. No "exited" in `docker compose ps`.

- [ ] **Step 2: Verify world map loads**

  Run: `curl -s http://localhost:3000 | grep -c 'atlasdraw'` (or Playwright `goto localhost:3000`)
  Expected: returns count > 0; MapCanvas visible; no console errors about missing tile files.

- [ ] **Step 3: Drop a pin and save**

  Via Playwright: click pin tool, click map center, fill in title "Test Pin", press Save.
  Run: `npx playwright test tests/e2e/phase4-smoke.test.ts --grep "pin and save"`
  Expected: pin appears on canvas; `PUT /maps/:id` returns 200.

- [ ] **Step 4: Refresh and verify persistence**

  Run: `npx playwright test tests/e2e/phase4-smoke.test.ts --grep "persistence"`
  Expected: pin still present after `page.reload()`.

- [ ] **Step 5: Share via URL hash (small map)**

  Run: `npx playwright test tests/e2e/phase4-smoke.test.ts --grep "share hash"`
  Expected: Share dialog opens; URL contains `#v1:`; opening URL in new context shows read-only pin; no network calls to storage server.

- [ ] **Step 6: Share via UUID (large map, simulated)**

  Inject a >32 KB bundle via test fixture. Trigger share.
  Run: `npx playwright test tests/e2e/phase4-smoke.test.ts --grep "share uuid"`
  Expected: `POST /maps` called; `POST /maps/:id/share` called; `/m/:token` loads read-only map.

- [ ] **Step 7: Switch basemap**

  Run: `npx playwright test tests/e2e/phase4-smoke.test.ts --grep "basemap switch"`
  Expected: clicking protomaps-dark thumbnail changes map style; `openfreemap-bright` card is visually disabled; clicking it does not change style.

- [ ] **Step 8: Capture first-run screenshot for README**

  Run: `npx playwright screenshot --full-page http://localhost:3000 docs/assets/first-run.png`
  Expected: file exists at `docs/assets/first-run.png`, size > 100 KB.

- [ ] **Step 9: Tear down**

  Run: `cd infra && docker compose -f docker-compose.minimal.yml down -v`
  Expected: all containers stopped, volumes removed.

---

### Task 17: ADR Documents — `0007-storage-dual-mode` + `0008-share-link-encoding` [Wave 1]

**Orient:** Two decisions made in this phase need ADRs so Phase 5 workers and future maintainers don't re-open them. These are quick records, not design documents.
**Flow position:** Parallel to implementation tasks — documentation, no code dependency.
**Upstream contract:** None.
**Downstream contract:** Referenced by `config.ts` (Task 2), `share.ts` (Task 4), `production.md` (Task 14).
**Skill:** `none`
**Files:**
- Create: `docs/architecture/adr/0007-storage-dual-mode.md`
- Create: `docs/architecture/adr/0008-share-link-encoding.md`

**Steps:**

- [ ] **Step 1: Write `0007-storage-dual-mode.md`**

  Required ADR sections: Title, Date, Status (`Accepted`), Context (Q10 decision — two compose stacks; PRD single-command principle; sqlite-fs eliminates postgres+minio dependency for first-run), Decision (sqlite-fs adapter activated by `STORAGE_MODE=sqlite-fs` at startup; postgres-minio adapter activated by `STORAGE_MODE=postgres-minio`; routes are identical in both modes — no branching above the adapter layer), Consequences (positive: zero-dep first run; negative: sqlite-fs is not tested under load, not recommended for multi-user production; Phase 5 realtime only targets postgres-minio mode; sqlite-fs may be deprecated in v2.0 if adoption is low — flag then, not now).

- [ ] **Step 2: Write `0008-share-link-encoding.md`**

  Required ADR sections: Title, Date, Status (`Accepted`), Context (two share scenarios: zero-infra tiny maps vs. server-backed large maps; URL hash is fully self-contained but browser-truncated at scale; UUID token requires storage server but works for any size), Decision (threshold: 32 KB uncompressed; below → lz-string base64 URL hash scheme `#v1:<payload>`; above → storage upload → nanoid share token → `/m/:token`; hash scheme version prefix `v1:` reserved for future migration), Consequences (known gaps: no token revocation in MVP; tokens are single-TTL not single-use; Safari iOS URL hash truncation is a risk at 32 KB — see Open Question 2; Phase 5 may add server-side room share integration that reuses the UUID token path), Follow-ups (Q: lower threshold to 16 KB after measuring Safari behavior in Task 16 smoke test?).

- [ ] **Step 3: Verify ADR files exist and are non-empty**

  Run: `ls -la docs/architecture/adr/000{7,8}-*.md`
  Expected: both files listed with size > 500 bytes.

  Run: `grep -l "Status.*Accepted" docs/architecture/adr/000{7,8}-*.md | wc -l`
  Expected: `2` — both ADRs have `Status: Accepted`.

---

### Task 18: Observability Baseline — `/health` endpoint, pino logger, Sentry ADR [Wave 1] <!-- audit-incorporated 2026-05-03 (cross-phase-audit#GAP-6): no phase plan had structured error logging, health endpoints, or distributed tracing before Show HN demo; this task adds the minimum to not run blind -->

**Orient:** The Show HN demo runs at the end of Phase 4 Week 11. Without a `/health` endpoint, a structured JSON logger, and a basic error-capture hook, the first live deployment runs blind — no way to know if the storage server is up, no stacktraces when it isn't. This task adds the minimum viable observability layer to `apps/storage`: a health endpoint, pino as the structured logger (already the Fastify ecosystem default), and an ADR capturing the Sentry-or-self-hosted decision so Phase 5 wires the same logger without re-deciding.
**Flow position:** Parallel to Task 3 in Wave 1 (both touch `apps/storage`; this task adds to index.ts + routes, Task 3 creates them — coordinate on shared file ownership; this task should be applied on top of Task 3's output).
**Upstream contract:** Receives running Fastify app instance from Task 3's `apps/storage/src/index.ts`.
**Downstream contract:** Produces `GET /health` route returning `{"status":"ok","uptime":<seconds>,"storageMode":"<mode>"}` (200). Produces pino logger instance exported from `apps/storage/src/logger.ts` — consumed by all route handlers in Tasks 3 and 4. Produces `docs/architecture/adr/0009-error-capture.md` capturing the Sentry-vs-self-hosted decision.
**Skill:** `none`
**Files:**
- Modify: `apps/storage/src/index.ts` (register `/health` route; wire pino logger)
- Create: `apps/storage/src/routes/health.ts`
- Create: `apps/storage/src/logger.ts`
- Create: `docs/architecture/adr/0009-error-capture.md`

**Steps:**

- [ ] **Step 1: Add `GET /health` route**

  Create `apps/storage/src/routes/health.ts`. Handler reads `process.uptime()` and `config.storageMode`; returns JSON `{"status":"ok","uptime":<seconds>,"storageMode":"<mode>"}`. Register in `index.ts`: `fastify.register(healthRoutes)`.

  Run: `curl -s http://localhost:4000/health`
  Expected: `{"status":"ok","uptime":<N>,"storageMode":"sqlite-fs"}` (or `postgres-minio` depending on env). HTTP 200.

- [ ] **Step 2: Add pino structured logger**

  Create `apps/storage/src/logger.ts`. Export `const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })`. Pass to Fastify as `fastify({ logger })` in `index.ts` — Fastify accepts a pino instance directly. All route handlers import `logger` from this module instead of using `console.log`.

  Run: `pnpm -F @atlasdraw/storage dev`
  Expected: startup logs emit structured JSON lines with `level`, `time`, `msg` fields. No `console.log` calls remain in `apps/storage/src/`.

- [ ] **Step 3: Write `0009-error-capture.md` ADR**

  Required ADR sections: Title (`Error Capture Strategy for Hosted Instance`), Date, Status (`Accepted`), Context (Show HN demo needs error visibility; two options: (a) Sentry hosted — fast setup, third-party data processor, requires GDPR note in privacy policy; (b) self-hosted Sentry or OpenTelemetry-to-Grafana — no third-party, more ops burden), Decision (use Sentry hosted for Phase 4–5 demos; re-evaluate self-hosted in Phase 6 if GDPR obligations are confirmed; wire via `@sentry/node` `Sentry.init({ dsn: process.env.SENTRY_DSN })` in `index.ts`; if `SENTRY_DSN` is unset, Sentry is a no-op — no crash), Consequences (positive: immediate error visibility for Show HN; negative: user PII in stacktraces must be scrubbed — `beforeSend` hook strips `Authorization` headers and IP addresses; Phase 6 evaluation gate added to `escalations.md` if self-hosted migration is needed).

  Run: `grep -l "Status.*Accepted" docs/architecture/adr/0009-*.md | wc -l`
  Expected: `1`

- [ ] **Step 4: Wire Sentry opt-in to `index.ts`**

  Add to `index.ts` preamble: `if (process.env.SENTRY_DSN) { Sentry.init({ dsn: process.env.SENTRY_DSN, integrations: [new Sentry.Integrations.Http()], beforeSend: (event) => { /* strip Authorization, remove ip */ return event; } }); }`. Add `SENTRY_DSN` (optional, no default) to `config.ts` Zod schema as `z.string().optional()`.

  Run: `SENTRY_DSN= pnpm -F @atlasdraw/storage dev`
  Expected: server starts without error; no Sentry initialization log (DSN absent = no-op).

  Run: `curl -s http://localhost:4000/health`
  Expected: `{"status":"ok",...}` — health endpoint unaffected by Sentry wiring.

---

## 6. Execution Waves

```
Wave 0 (serial — must complete before Wave 1):
  Task 1 — StorageMode + StorageClient types
  Task 2 — Storage config Zod schema + StorageMode detection
  Rationale: All Wave 1 workers consume these types. Writing them first prevents parallel workers from diverging on interface shape.

Wave 1 (parallel — all are independent after Wave 0):
  Task 3  — Storage HTTP server + dual adapters
  Task 4  — Share endpoint (adversarial surface)
  Task 5  — Vendor style JSONs + extend BasemapRegistry
  Task 6  — BasemapPicker UI component
  Task 7  — PMTiles protocol registration + resolver
  Task 13 — useAutosave hook (drain-state invariant; feeds Tasks 8/9)
  Task 14 — AboutDialog (no dependencies)
  Task 17 — ADR documents (no code dependencies)
  Task 18 — Observability baseline: /health endpoint + pino logger + Sentry ADR (GAP-6) <!-- audit-incorporated 2026-05-03 (cross-phase-audit#GAP-6): added to Wave 1 — parallel with Task 3; apply on top of Task 3 output -->
  Rationale: Storage implementation, basemap UI, autosave hook, telemetry policy, and observability baseline are independent systems. Parallelize all nine. Task 13 must complete before Wave 2 Tasks 8/9 can begin (intra-wave soft dependency). Task 18 has a soft dependency on Task 3 (applies on top of storage server).

Wave 2 (parallel — can start as soon as Wave 1 completes):
  Task 8  — URL hash share mode (consumes Task 13 isDraining, Task 3 StorageClient)
  Task 9  — UUID upload share mode (consumes Task 4 share endpoint, Task 13 isDraining)
  Task 10 — docker-compose.minimal.yml (consumes Task 3 adapter)
  Task 11 — docker-compose.yml full stack + Caddyfile
  Task 12 — Makefile basemap-world recipe
  Task 15 — Self-host documentation (consumes confirmed commands from Tasks 10/11/12)
  Rationale: Share modes depend on storage API and autosave hook (Wave 1). Compose files depend on storage being wired. Documentation depends on compose files being confirmed.
  Note: Task 15 has a soft dependency on Tasks 10/11/12 completing first within Wave 2.

Wave 3 (serial — must be last):
  Task 16 — First-run E2E smoke test
  Rationale: Acceptance gate. Requires all implementation complete and integrated.
```

**Cross-wave verification rule:** Before Wave 3 launches, run the following gate checks in order. Any failure blocks Wave 3 — do not proceed until all pass.

```
Run: docker compose -f infra/docker-compose.minimal.yml config --quiet
Expected: exits 0

Run: docker compose -f infra/docker-compose.yml config --quiet
Expected: exits 0

Run: cd apps/storage && npx vitest run
Expected: PASS (covers Tasks 1–4 — types, config, adapters, share routes)

Run: cd apps/atlas-app && npx vitest run src/hooks/useAutosave.test.ts
Expected: PASS (Task 13 drain-state invariant)

Run: cd apps/atlas-app && npx vitest run src/hooks/useShareLink.test.ts
Expected: PASS (Task 8 round-trip + Task 9 upload path)

Run: cd packages/basemap && pnpm build
Expected: exits 0 (Tasks 5, 7 — vendored styles + resolver)
```

---

## 7. Open Questions

> These are unresolved at plan-write time. Each must be answered before the relevant task executes, or treated as a risk in Wave 3.

1. **PMTiles download URL and hosting.** Where is `world-low-zoom.pmtiles` (~200 MB) hosted for `fetch-pmtiles.sh`? Options: GitHub Releases (100 MB file limit — too small), public S3 bucket, Cloudflare R2, or regenerated locally via `make basemap-world`. Blocking for Task 10 first-run experience. Recommendation: R2 free tier (10 GB/month free egress).

   > **RESOLVED (2026-05-03):** There is no stable public hotlink URL for `world-low-zoom.pmtiles`. Protomaps docs explicitly state **“hotlinking to these downloads is discouraged”** — `build.protomaps.com` serves daily builds keyed by date (e.g., `20260503.pmtiles`, ∼135 GB full planet) and URLs change without notice. The Protomaps-recommended approach is to copy to your own cloud storage.
   >
   > **Decision for Task 12 (`make basemap-world` + `fetch-pmtiles.sh`):**
   > - `fetch-pmtiles.sh` does **not** hotlink to `build.protomaps.com`. Instead it queries `https://build-metadata.protomaps.dev/builds.json` (stable API returning `[{key, version, size, …}]`) to get the latest key, then downloads and pipes through `pmtiles extract --maxzoom=5` to produce the ~200 MB low-zoom cut.
   > - The extracted `world-low-zoom.pmtiles` must be hosted by the operator on their own Cloudflare R2 bucket (no bandwidth fees; R2 is Protomaps’ explicit recommendation). `fetch-pmtiles.sh` accepts a `PMTILES_SOURCE_URL` env override so operators who have already uploaded can point directly to their R2 object.
   > - For first-run demo: `make fetch-pmtiles` runs the extract pipeline locally; no pre-hosted URL needed. Document in `docs/self-host/README.md` that the first `make fetch-pmtiles` takes ~10 min (download + extract).
   > - Source: [docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads); [github.com/protomaps/basemaps — app/src/Builds.tsx](https://github.com/protomaps/basemaps/blob/main/app/src/Builds.tsx).

2. **Safari/iOS URL hash length limit.** Safari on iOS reportedly truncates URLs above ~65 000 chars. The 32 KB threshold (with lz-string compression yielding ~2× size increase) could exceed this on complex maps. Is the 32 KB threshold conservative enough, or should it be 16 KB? Affects Task 8. [Note: lz-string base64 output from 32 KB input is approximately 85 KB — likely above Safari’s threshold.]

   > **RESOLVED (2026-05-03):** The “85 KB” note above was wrong — it assumed raw base64 without LZ compression. lz-string’s `compressToBase64` compresses first (LZW, ~2.5× ratio on JSON) then base64-encodes, producing roughly **17 500 chars** for a 32 KB JSON input (32768 / 2.5 × 4/3 ≈ 17 476). Safari’s practical URL hash limit is ~50 000 chars (WebKit sources). At 32 KB uncompressed the hash output is ~17.5 K chars — well within bounds. **32 KB threshold is safe; do not lower to 16 KB.** The lz-string `compressToBase64` method produces URL-safe base64 directly — no additional URI encoding needed, which further confirms lz-string over pako for this use case. Remove the “(Note: lz-string base64 output...)” caveat from Task 8. Source: [github.com/pieroxy/lz-string](https://github.com/pieroxy/lz-string); WebKit source analysis.

3. **`docker-compose.yml` Phase 5 extension strategy.** Should Phase 5 use `profiles: ["realtime"]` to add the realtime service, or a separate `docker-compose.realtime.yml` with `--file` override? Profiles are cleaner but require compose v2.2+; separate files are more explicit. Decision needed before Phase 5 plan is written.

   > **RESOLVED (2026-05-03):** Use `profiles: ["realtime"]`. Docker Compose v2 has supported profiles since Compose spec 3.9 / v2.2 (released Dec 2021). Valid profile name regex `[a-zA-Z0-9][a-zA-Z0-9_.-]+` is satisfied by `"realtime"`. `docker compose up` (no `--profile`) starts only services without a `profiles` key; `docker compose --profile realtime up` adds the realtime container. One canonical compose file beats `--file` chaining. Minimum requirement: Docker Compose v2.2+ — safe to require in 2026. Source: [docs.docker.com/compose/how-tos/profiles/](https://docs.docker.com/compose/how-tos/profiles/).

4. **Caddy TLS in fresh Docker network — local testing.** `tls internal` generates a self-signed cert that browsers reject. Does the smoke test (Task 16) run against `docker-compose.minimal.yml` (no Caddy) or must it also test the full stack with Caddy? Recommendation: smoke test targets minimal stack only; Caddy is tested in a separate `make test-full-stack` target.

   > **RESOLVED (2026-05-03):** Smoke test (Task 16) targets `docker-compose.minimal.yml` only — no Caddy, no TLS. `tls internal` creates a local CA via Smallstep libraries; the root must be imported into the OS trust store for browsers to accept it, which is impractical in headless CI. Full-stack Caddy testing uses `make test-full-stack` with `--ignore-certificate-errors` (Playwright). **Task 11 action item:** add a named volume `caddy_data` mounted at Caddy’s data directory (`/data`) so auto-renewed certs survive container restarts. Source: [caddyserver.com/docs/automatic-https](https://caddyserver.com/docs/automatic-https).

5. **MinIO minimum RAM footprint.** MinIO’s official minimum is 1 GB RAM. Is this acceptable for a demo container on a developer laptop? Alternative: use Garage (S3-compatible, ~50 MB RAM) for the demo stack and MinIO only in production. Affects Task 11 compose design.

   > **RESOLVED (2026-05-03):** Use `minio/minio` (current release 2025-09-07) with `deploy.resources.limits.memory: 1g` in Task 11 `docker-compose.yml`. Single-node MinIO is functional at ~512 MB–1 GB RAM in practice; the 256 GiB figure in MinIO AIStor enterprise docs applies to production clusters, not the community single-node binary. Acceptable on a developer laptop with ≥8 GB RAM. Do **not** substitute Garage — Garage is a distributed object store for home-lab clusters, not a single-container S3 drop-in. The minimal stack already avoids MinIO entirely (sqlite-fs adapter).

6. **Share token TTL user-configurability.** 30-day hardcoded TTL is in the spec. Should self-hosters be able to set `[storage.share_token_ttl_days]` in `config.toml`? Not in MVP, but flag in ADR-0008 as a known future knob.

   > **RESOLVED (2026-05-03):** Not in MVP. Hardcode 30-day TTL. Add `share_token_ttl_days` as a named future config knob in ADR-0008 `Consequences → Follow-ups` section. Tasks 4 and 17 unchanged.

7. **git-LFS vs Makefile-fetch for PMTiles.** Should `world-low-zoom.pmtiles` be tracked in git-LFS (simple `git lfs pull`) or always fetched via `fetch-pmtiles.sh`? git-LFS requires contributor setup; Makefile-fetch requires the hosting URL to be stable. Recommendation: Makefile-fetch (no contributor overhead), but document git-LFS as an option in `production.md`.

   > **RESOLVED (2026-05-03):** Makefile-fetch. Q1 above confirms there is no stable hotlink URL — the build key is a date-keyed path resolved at fetch-time from `build-metadata.protomaps.dev/builds.json`. git-LFS tracking a frequently-rotated 200 MB binary is not viable. Document `git lfs` as an operator option in `production.md` for those who want to pin a specific build in their own fork.

8. **`VITE_PMTILES_PATH` injection.** The web container needs to know the path to the PMTiles file inside the container. In docker-compose.minimal.yml this is `/data/world-low-zoom.pmtiles`. Is this hardcoded in the image or injected via env? Recommendation: inject via `VITE_PMTILES_PATH` env var with default `/data/world-low-zoom.pmtiles` — allows override without rebuild.

   > **RESOLVED (2026-05-03):** Inject via `VITE_PMTILES_PATH` env var with default `/data/world-low-zoom.pmtiles`. Both compose files set this explicitly. Task 7 (resolver.ts config gate) and Task 10 already reflect this pattern. No change needed to those tasks.
---

## 8. Artifact Manifest

<!--MANIFEST:START-->
| Artifact | Type | Path | Status | Produced by |
|---|---|---|---|---|
| `StorageMode` + `StorageClient` types | Create | `apps/storage/src/types.ts` | planned | Task 1 |
| Storage Zod config | Create | `apps/storage/src/config.ts` | planned | Task 2 |
| Fastify storage server | Create | `apps/storage/src/index.ts` | planned | Task 3 |
| Storage maps routes | Create | `apps/storage/src/routes/maps.ts` | planned | Task 3 |
| postgres-minio adapter | Create | `apps/storage/src/adapters/postgres-minio.ts` | planned | Task 3 |
| sqlite-fs adapter | Create | `apps/storage/src/adapters/sqlite-fs.ts` | planned | Task 3 |
| Share routes | Create | `apps/storage/src/routes/share.ts` | planned | Task 4 |
| `protomaps-light.json` style | Create | `packages/basemap/src/styles/protomaps-light.json` | planned | Task 5 |
| `protomaps-dark.json` style | Create | `packages/basemap/src/styles/protomaps-dark.json` | planned | Task 5 |
| `openfreemap-bright.json` style | Create | `packages/basemap/src/styles/openfreemap-bright.json` | planned | Task 5 |
| `BasemapRegistry` (extended) | Modify | `packages/basemap/src/registry.ts` | planned | Task 5 |
| `BasemapPicker` component | Create | `apps/atlas-app/components/BasemapPicker.tsx` | planned | Task 6 |
| `pmtiles-protocol.ts` (updated) | Modify | `packages/basemap/src/pmtiles-protocol.ts` | planned | Task 7 |
| `resolver.ts` | Create | `packages/basemap/src/resolver.ts` | planned | Task 7 |
| `useShareLink` hook | Create | `apps/atlas-app/hooks/useShareLink.ts` | planned | Tasks 8, 9 |
| `ShareDialog` component | Create | `apps/atlas-app/components/ShareDialog.tsx` | planned | Task 8 |
| `/m/[uuid].tsx` share viewer | Create | `apps/atlas-app/pages/share/[uuid].tsx` | planned | Tasks 8, 9 |
| `docker-compose.minimal.yml` | Create | `infra/docker-compose.minimal.yml` | planned | Task 10 |
| `fetch-pmtiles.sh` | Create | `infra/data/fetch-pmtiles.sh` | planned | Task 10 |
| `Makefile` (pmtiles-fetch + up-minimal + basemap-world) | Modify | `infra/Makefile` | planned | Tasks 10, 12 |
| `docker-compose.yml` (5-svc) | Create | `infra/docker-compose.yml` | planned | Task 11 |
| `Caddyfile` | Create | `infra/caddy/Caddyfile` | planned | Task 11 |
| `useAutosave` hook | Create | `apps/atlas-app/hooks/useAutosave.ts` | planned | Task 13 |
| `AboutDialog` component | Create | `apps/atlas-app/components/AboutDialog.tsx` | planned | Task 14 |
| First-run README | Create | `docs/self-host/README.md` | planned | Task 15 |
| Production self-host guide | Create | `docs/self-host/production.md` | planned | Task 15 |
| E2E smoke test | Create | `tests/e2e/phase4-smoke.test.ts` | planned | Task 16 |
| ADR 0007 storage dual-mode | Create | `docs/architecture/adr/0007-storage-dual-mode.md` | planned | Task 17 |
| ADR 0008 share link encoding | Create | `docs/architecture/adr/0008-share-link-encoding.md` | planned | Task 17 |
| `apps/storage/package.json` (Fastify v5.8.x) | Modify | `apps/storage/package.json` | planned | Task 3 <!-- shape-incorporated 2026-05-03: Fastify v4 EOL June 2025; v5.8.x required; marker added to manifest so executor doesn't reach for v4 --> |
| Health route | Create | `apps/storage/src/routes/health.ts` | planned | Task 18 <!-- audit-incorporated 2026-05-03 (cross-phase-audit#GAP-6): new artifact added for observability baseline --> |
| Pino logger module | Create | `apps/storage/src/logger.ts` | planned | Task 18 <!-- audit-incorporated 2026-05-03 (cross-phase-audit#GAP-6): structured JSON logger for storage server --> |
| ADR 0009 error capture | Create | `docs/architecture/adr/0009-error-capture.md` | planned | Task 18 <!-- audit-incorporated 2026-05-03 (cross-phase-audit#GAP-6): Sentry-vs-self-hosted decision ADR --> |
<!--MANIFEST:END-->

---

## 9. Q-Reference Summary

| Decision ID | Applied where |
|---|---|
| Q1 (single-player first-class, no realtime container in Phase 4) | `docker-compose.minimal.yml` has no realtime service (Task 10); `docker-compose.yml` has a Phase 5 placeholder comment (Task 11); `StorageClient` interface omits room/collaboration methods (Task 1) |
| Q3 (hybrid basemap: bundled PMTiles self-host, OpenFreeMap demo only) | `BasemapRegistry` defaults to `protomaps-light`; `openfreemap-bright` gated on `allow_remote=true` (Tasks 5, 7); `world-low-zoom.pmtiles` bundled in `infra/data/` volume (Task 10) |
| Q10 (ship both minimal 3-svc and full 5-svc compose) | Task 10 (`docker-compose.minimal.yml`), Task 11 (`docker-compose.yml`); README points to minimal, production.md points to full (Task 15) |

---

## 10. Shape Changes Summary

*Appended 2026-05-03 by shape-incorporator after resolver Q1–Q8 + Fastify version correction.*

| # | Section edited | Change | Cited Q |
|---|---|---|---|
| 1 | §1 Tech Stack table | Added `pmtiles` CLI row as a build-tool prereq (not npm); install instruction included | Q1 |
| 2 | §2b Pre-Work Checklist | Added gate row: `pmtiles --version` exits 0; blocking for Task 10 Step 2 | Q1 |
| 3 | Task 10 Step 2 | Rewrote `fetch-pmtiles.sh` description: now queries `builds.json`, downloads dated planet, pipes through `pmtiles extract --maxzoom=5`, respects `PMTILES_SOURCE_URL` override, documents ~10 min first-run time and R2 hosting recommendation | Q1 |
| 4 | Task 11 Step 1 | Added `deploy.resources.limits.memory: 1g` on minio service; added `caddy_data` named volume at `/data` on Caddy container with rationale (cert persistence across restarts) | Q4, Q5 |
| 5 | Task 8 Step 1 | Fixed wrong max-length guard from 200 000 to 50 000 chars (Safari hash limit); removed stale "~85 KB" caveat; noted `compressToBase64` is URL-safe directly | Q2 |
| 6 | Task 12 Step 1 | Replaced stale "pinned semver URL" description with `builds.json` query + dated key download; corrected planet size to ~135 GB | Q1 |
| 7 | Task 15 Orient + Step 1 | Corrected "under 2 minutes" claim to "~10 min first run, <30s thereafter"; added `pmtiles` CLI prereq block and R2 hosting tip to README steps | Q1 |
| 8 | §8 Artifact Manifest | Added `apps/storage/package.json` Modify row as Fastify v5.8.x marker | Fastify version correction |

**Escalations (STILL OPEN at project level):** None. All 8 resolver questions are closed. The ~10 min first-run UX cost is a known constraint (documented in Task 15 and README), not an open question — project Goal at §1 implies "one command" but not "instant"; the resolver already accepted this trade-off.

---

### Audit Incorporation 2026-05-03

*Applied by audit-incorporator agent. Each entry cites the finding ID from `docs/decisions/cross-phase-audit.md`.*

| # | Section edited | Change | Finding ID |
|---|---|---|---|
| 1 | Tasks — new Task 18 added | Added Task 18: Observability Baseline (`/health` endpoint + pino structured logger + Sentry ADR `0009-error-capture.md`). Four steps with Run/Expected. Scope kept tight: no full observability stack, just enough to not run blind at Show HN demo. | GAP-6 (MED) |
| 2 | §6 Execution Waves — Wave 1 | Added Task 18 to Wave 1 parallel bucket; updated rationale to note soft dependency on Task 3 | GAP-6 (MED) |
| 3 | §8 Artifact Manifest | Added three new rows: `health.ts` route, `logger.ts` pino module, `0009-error-capture.md` ADR | GAP-6 (MED) |
