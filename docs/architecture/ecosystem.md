# Atlasdraw — Ecosystem

**Status: Speculative.** Derived from spec, phase plans, and research notes. No code exists.

Describes every external system Atlasdraw depends on, integrates with, or sits adjacent to.
Organized by relationship type.

---

## Upstream Dependencies (required at runtime)

These must be present for the editor to function.

### MapLibre GL JS

**Relationship:** upstream-dependency (rendering engine)
**Role:** Renders the basemap tile layer, owns the geographic camera (lng/lat/zoom/bearing/pitch),
and provides the `project`/`unproject` APIs that `packages/geo` wraps for coordinate conversion.
(spec §0, spec §3)

**Version pinning policy:** Pinned to major version at repo bootstrap. MapLibre GL JS publishes
breaking changes in major versions; the spec does not specify a pin target, but the fork-from-
Excalidraw starting point means the first workable version will be whatever Excalidraw's ecosystem
supports at Week 1. [CONFIDENCE: medium]

**Fallback strategy:** No fallback. If MapLibre is unavailable the map canvas does not render.
The CLI headless render path may use `maplibre-gl` in a Node/JSDOM environment.

**Integration points:**
- `packages/basemap` — `MaplibreWrapper` component; style loading; PMTiles protocol registration
- `packages/geo` — `projection.ts` wraps `map.project`/`map.unproject` (spec §3)
- `apps/atlas-app` — `AtlasCanvas` mounts the map and synchronizes viewport with Excalidraw
  scroll/zoom state

---

### Excalidraw (vendored fork)

**Relationship:** upstream-dependency (vendored — not npm-installed)
**Role:** Scene model, element renderer, tool framework, and collaboration scaffolding.
Atlasdraw forks the full Excalidraw repository and modifies it in-tree (spec §1).

**Why fork rather than `npm install`:** Three reasons stated in spec §1:
1. Scene format must be modified (add `customData.geo`, geo-aware tools, geo-aware rendering hints).
2. Defaults need retuning (coordinate space, hit-testing under Mercator, roughness at high zoom).
3. The upstream package surface area is too narrow for clean extension through props alone.

**Packages in scope:** `packages/excalidraw` (patched), `packages/element`, `packages/math`,
`packages/common` (all vendored upstream, no patches on the latter three).

**Version pinning policy:** Monthly `git fetch upstream && git merge upstream/master` (Q6, ADR 0004).
Continue merges while ALL of:
- Merge time ≤ 2 hours
- No patch in `upstream-patches.md` broken more than once per quarter
- `ExcalidrawElement.customData` field not removed or renamed

**Hard exit threshold:** If any threshold breaks for two consecutive quarters, freeze merges and
treat upstream as a one-time vendor. Quarterly review cadence; first review Q3 2026. (Q6)

**Fallback strategy:** Frozen vendor — the code continues to function but receives no upstream
security or feature updates. This is the documented risk (spec §11, plan-0 ADR 0004).

---

## PMTiles / Protomaps

**Relationship:** upstream-dependency (tile data format and serving protocol)
**Role:** `.pmtiles` is the container format for bundled basemap tiles. The `PMTiles` JS library
handles range-request decoding in the browser. After Phase 4, a curated PMTiles file
(OpenFreeMap-derived) ships bundled with the app as the default basemap (Q3).

**Version pinning policy:** Pinned. PMTiles format version is stable (v3 as of writing).
[CONFIDENCE: medium]

**Fallback strategy:** If the bundled PMTiles file is unavailable (CDN outage for the hosted
flagship), fall back to the configured remote OpenFreeMap tile endpoint. In self-host without
a bundled file, operators provide their own PMTiles or configure a remote tile URL (plan-4 Task 6).

**Serving recommendation:** CloudFlare R2 (no egress bandwidth fees, per plan-4 research notes).
R2 requires CORS configuration via `wrangler` or the R2 settings UI.

**Integration points:** `packages/basemap` — `BasemapRegistry` default entry; `PMTilesProtocol`
registration in MapLibre.

---

### Yjs (`yjs` + `y-websocket` + `y-protocols`)

**Relationship:** upstream-dependency (CRDT engine for real-time collaboration)
**Role:** CRDT document store for data-layer mutations in shared rooms. Chosen over Automerge
(Q2: Yjs is faster for the ops-per-second profile expected here; has better awareness protocol).
(spec §5.2, Q2)

**Version pinning policy:** Pinned to minor version. Yjs has historically maintained API
compatibility within minor versions. [CONFIDENCE: medium]

**Fallback strategy:** Collaboration degrades gracefully when realtime is disabled. Single-player
mode uses IndexedDB for persistence without Yjs (Q1). The relay is in-memory; if it restarts,
the in-flight Yjs document is lost (TTL eviction, plan-5 Task 6).

**Integration points:**
- `apps/realtime` — `yjs-server.ts` mounts `setupWSConnection` from `y-websocket/bin/utils`
- `apps/atlas-app` — data-layer Zustand slice binds to a `Y.Map` for shared state
- `packages/excalidraw` — scene sync uses Socket.IO (not Yjs) per Q9 dual-protocol design

**E2EE status:** `yjs-crypto.ts` ships as a stub in Phase 5. True zero-knowledge E2EE is
unresolved (E-01). See `risk-map.md § security`. [CONFIDENCE: low on final E2EE shape]

---

## Optional Integrations (operator-configured)

These are present in the codebase but disabled by default. Operators enable them via `config.toml`.

### Photon / Nominatim / Pelias (geocoding)

**Relationship:** optional-integration (geocoding backend)
**Role:** Powers the "search for a place" UI and the CSV geocode-by-address feature. The
`photon-client.ts` in `packages/data/src/geocoding/` wraps any of these interchangeable APIs
(Phase 6, plan-6 Task 11a/11b).

**Default:** Komoot's public Photon endpoint (rate-limited). Self-hosters are expected to run
their own Photon/Nominatim or configure a Pelias endpoint.

**Fallback strategy:** Geocoding fails gracefully — the CSV import proceeds without lat/lng
columns being auto-populated; the search bar shows "geocoding unavailable."

**Version pinning policy:** N/A — consumed via HTTP API. No version dependency.

---

### OSRM / Valhalla (routing)

**Relationship:** optional-integration (road snap for route-snap tool)
**Role:** The route-snap tool in `packages/tools` sends interpolation requests to a configured
OSRM or Valhalla endpoint. Returns snapped road geometry for freehand strokes. (spec §4.4)

**Default:** Disabled. Self-hosters who want route-snap must run their own routing service.

**Fallback strategy:** Route-snap degrades to straight-line interpolation when no routing
endpoint is configured.

---

### Maputnik (style editor, iframe)

**Relationship:** optional-integration (basemap style editing)
**Role:** Full visual style editor for MapLibre styles, embedded in an `<iframe>` modal in the
Atlasdraw editor. Style changes round-trip through a `postMessage` bridge (`MaputnikBridge.ts`)
and are committed to the `.atlasdraw` container's `style.json` entry. (plan-6 Task 8)

**Security note:** Maputnik iframe is sandboxed; messages from unexpected origins are silently
discarded (plan-6 Task 8 adversarial tests).

**Version pinning policy:** Pinned to the Maputnik Docker image tag used in self-host deployment.
[CONFIDENCE: low — exact version not specified in plans]

**Fallback strategy:** If Maputnik is unavailable, the style editor modal does not open; the
basemap continues to render with its last saved style.

---

### Ollama / OpenAI-compatible AI styling (Phase 7)

**Relationship:** optional-integration (AI styling assistant)
**Role:** Phase 7 adds a local-first AI styling feature. The client is an OpenAI-compatible
fetch wrapper (`/v1/chat/completions` endpoint) — works with Ollama, OpenAI, and any compatible
provider. (plan-7 Feature 3)

**Source contradiction:** Phase 7 plan describes this as "Ollama HTTP client wrapper" in one
place and "OpenAI-compat client targeting `/v1/chat/completions`; works with Ollama, OpenAI,
and any OpenAI-compat provider" in another. The second description is more detailed and likely
supersedes the first, but this is unresolved. [CONFIDENCE: low — cite plan-7]

**Default:** Disabled. Requires operator to run Ollama or configure an external API key.

**Fallback strategy:** AI styling UI is hidden when no AI endpoint is configured.

---

### PostGIS / `pg` (Phase 7)

**Relationship:** optional-integration (vector tile source for large datasets)
**Role:** PostGIS layer source — connects to a Postgres+PostGIS database and streams features
as a MapLibre `geojson` source with server-side filtering. (plan-7 Feature 5)

**Default:** Disabled. Requires operator to run Postgres with PostGIS extension.

**Fallback strategy:** PostGIS layer type is unavailable in the layer panel; existing layers
unaffected.

---

## Adjacent Tools

These are tools in the ecosystem that Atlasdraw interacts with through data formats or bridging
code, but does not depend on at runtime.

### QGIS (Phase 7 bridge plugin)

**Relationship:** adjacent-tool (QGIS Plugin Repository distribution)
**Role:** A PyQGIS bridge plugin that allows QGIS users to export layers directly to an
Atlasdraw file or open a live editing session. Distributed via QGIS Plugin Repository. Lives
outside the monorepo (plan-7 Feature 6).

**Version pinning policy:** Targets QGIS LTR. The bridge plugin is a separate versioned release
from the main Atlasdraw release. [CONFIDENCE: low — plan-7 is high-level on this]

**Fallback strategy:** Not applicable — the plugin is an optional workflow enhancer, not a
runtime dependency.

---

### Felt (Phase 6 importer)

**Relationship:** adjacent-tool (one-way data import)
**Role:** The `felt.ts` importer in `packages/data` converts Felt GeoJSON API snapshots
(`.felt.json` format) into `.atlasdraw` files. [CONFIDENCE: high — plan-6 Task 13, OQ1 resolved]

**Source note:** The importer is not a live Felt API integration. OQ1 resolved that Felt does
not expose a binary file format; fixtures are GeoJSON API response snapshots renamed `.felt.json`.
This is a migration/import tool, not a real-time bridge.

**Fallback strategy:** N/A — import-only, no runtime dependency.

---

## Billing Provider

### Stripe (Phase 6, hosted-flagship only)

**Relationship:** billing-provider (hosted multi-tenant mode)
**Role:** Stripe hosted checkout for workspace subscriptions. Webhook handler processes
`checkout.session.completed` (upgrades workspace to `pro`) and
`customer.subscription.deleted` (downgrades to `free`). (plan-6 Task 18)

**Guard:** All Stripe code is behind `MANAGED_MODE` environment variable. The OSS self-host
build does not include Stripe. Operators can enable workspace billing in self-host by setting
`MANAGED_MODE=true` — Atlasdraw is explicitly not open-core (Q4).

**Version pinning policy:** Pinned to Stripe API version at time of Phase 6 implementation.
Stripe webhooks include the API version in the event payload.

**Fallback strategy:** If Stripe is unreachable, no new checkouts succeed; existing subscriptions
remain unaffected until the next webhook event. Stripe retries webhooks for 72 hours.

---

## CI / Toolchain

These are not runtime dependencies but are part of the ecosystem Atlasdraw depends on for
correctness guarantees.

| Tool | Role | Phase introduced |
|------|------|-----------------|
| GitHub Actions | CI/CD pipeline | Phase 0 |
| `vitest` | Unit + integration tests | Phase 0 |
| Playwright | Browser E2E tests | Phase 1 |
| `size-limit` | Bundle size budget enforcement (SDK hard limit: 300 KB) | Phase 4/6 |
| `better-sqlite3` | SQLite driver for minimal stack storage | Phase 4 |
| `nanoid` | Share token generation | Phase 4 |
| `zod` | Runtime API shape validation | Phase 4 |
| `comlink` or postMessage bridge | Worker RPC for plugin sandboxing | Phase 7 |
| `@stablelib/sha256` | Plugin integrity hashing | Phase 7 |

(plan-0, plan-4 Tech Stack Additions, plan-7)

---

## Ecosystem Risks

- **OpenFreeMap uptime** — The default basemap tile source. If OpenFreeMap's public endpoint
  goes down, self-hosters without a bundled PMTiles file lose basemap rendering. See
  `risk-map.md § operational`.
- **MapLibre GL JS licensing** — MapLibre GL JS is BSD-3 licensed; compatible with AGPL.
  If MapLibre relicenses, this changes. [CONFIDENCE: low — no current signal]
- **Excalidraw upstream instability** — If Excalidraw removes `customData` field support, the
  GeoAnchor binding breaks entirely. This is the primary upstream risk. See `risk-map.md §
  technical`.
