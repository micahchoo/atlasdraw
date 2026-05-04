# Atlasdraw Phase 6 — v1.0: Embeds, Comments, Style Editor, Felt Importer, Hosted Mode

**Date:** 2026-05-03
**Weeks:** 16–25 (shifted +1 from spec's "Weeks 15–24" per Q7 chain)
**Status:** Ready to execute
**Plan author:** writing-plans skill

---

## Goal

Ship v1.0 of Atlasdraw: the release that earns the "Felt-class" label.

Eleven features land together: embed SDK with AtlasdrawAPI, anchored comments, Maputnik style editor, categorical/graduated layer styling, print-to-PDF, geocoding via Photon, Felt importer, hosted multi-tenant mode with Stripe, accessibility pass, and asset library.

This is the release that closes JTBD #3 (present-and-embed), unlocks the migration narrative ("we read your Felt files"), and provides the hosted flagship that funds maintainer time.

---

## Tech Stack Additions (Phase 6 only)

| Library | Purpose | Package scope |
|---|---|---|
| `pdf-lib` | PDF generation for print layout | `apps/atlas-app` |
| `stripe` (Node SDK) | Billing hooks, webhook handling | `apps/realtime` (server) |
| `@react-aria/focus`, `@react-aria/announce` | Keyboard nav, screen-reader announcements | `apps/atlas-app` |
| `photon-geocoder-client` (thin fetch wrapper) | Geocoding against Photon/Nominatim/Pelias | `packages/data` |
| `size-limit` | CI bundle-size gate for `packages/sdk` | dev tooling |
| `@stripe/stripe-js` | Client-side Stripe.js (checkout redirect only) | `apps/atlas-app` |

---

## Phase Boundary Contracts

### Consumes (from Phases 1–5)

| Contract | Source | What we rely on |
|---|---|---|
| `.atlasdraw` file format (§6) | Phase 3 | Stable ZIP container, `scene.json` + `layers/` structure |
| `MapLibre` wrapper | Phase 2 | `packages/basemap/MapView.tsx` renders the map; style switching already wired |
| Yjs WebSocket room | Phase 5 | `apps/realtime` runs `y-websocket` on the same port; Phase 6 adds a second `Y.Doc` per room for comments |
| `packages/data` readers | Phase 3 | GeoJSON, KML, SHP, CSV already import; CSV geocoding stub exists |
| Docker Compose stack | Phase 4 | `docker-compose.yml` with web + storage + minio; Phase 6 adds `stripe-cli` container for local dev |
| AGPL/MIT/MPL license split | Phase 0 | Already declared in `package.json` per Q5; `packages/sdk` carries MIT |

### Produces (for Phase 7 plugin sandbox)

| Contract | Consumed by | Invariant |
|---|---|---|
| `AtlasdrawAPI` interface (revised, postMessage-safe) | Phase 7 plugin sandbox | All methods `async`; all values structured-clone-compatible; ADR 0005 frozen |
| `packages/sdk` embed widget | Any host application | `<AtlasdrawEmbed>` React component + vanilla `mount()` |
| Workspace abstraction (`WorkspaceId`) | Phase 7 multi-workspace features | Every server route is workspace-scoped; plugin manifest will carry `workspaceId` |
| `LayerStyle` schema + `style-compiler.ts` | Phase 7 plugin-authored styles | Stable TypeScript type; MapLibre expression output is deterministic |
| Comment Yjs doc protocol | Phase 7 (comment reactions, thread subscriptions) | Second `Y.Doc` per room; comment schema is versioned |

---

## File Structure

Files are grouped by feature. Each entry is new (Create) or existing (Modify).

### Feature 1 — AtlasdrawAPI types + ADR 0005

```
packages/sdk/
  src/
    api.ts                          # Create: AtlasdrawAPI interface (async-revised)
    api-types.ts                    # Create: AtlasdrawScene, Camera, LayerOpts, ToolId types
    structured-clone-harness.ts     # Create: test-time utility for round-trip verification
  __tests__/
    api-structured-clone.test.ts    # Create: structural test, every public method
decisions/
  0005-sdk-postmessage-contract.md  # Create: ADR documenting the postMessage contract
```

### Feature 2 — Embed widget (`packages/sdk`)

```
packages/sdk/
  src/
    AtlasdrawEmbed.tsx              # Create: React component wrapping iframe
    mount.ts                        # Create: vanilla-JS mount() for non-React hosts
    embed-renderer.ts               # Create: read-only scene renderer (renderStaticScene)
    index.ts                        # Create: package entry point, re-exports
  package.json                      # Create: MIT license declaration
  vite.config.ts                    # Create: library build, <300KB gzipped target
```

Note: `.size-limit.json` lives in Feature 13 (Wave 4 bundle-size gate) where it is first enforced.
The component source (Task 4b) is split from the package scaffold (Task 4a) to stay within the 5-file limit.

### Feature 3 — Anchored comments

```
packages/sdk/
  src/
    api-types.ts                    # Modify: add Comment, CommentThread types

apps/atlas-app/
  components/
    CommentsPanel.tsx               # Create: threaded comment list sidebar
    CommentAnchor.tsx               # Create: map overlay pin for anchored comment
    CommentComposer.tsx             # Create: text input with @mention picker
  hooks/
    useComments.ts                  # Create: Yjs comments doc subscription
  __tests__/
    CommentsPanel.test.tsx          # Create

apps/realtime/
  src/
    comments-doc.ts                 # Create: second Y.Doc per room for comments
    room-comments-handler.ts        # Create: WebSocket message routing for comment doc
```

### Feature 4 — Maputnik iframe style editor

```
apps/atlas-app/
  components/
    MaputnikModal.tsx               # Create: iframe modal wrapper
    MaputnikBridge.ts               # Create: postMessage bridge (origin-allowlisted)
  __tests__/
    MaputnikBridge.test.ts          # Create

packages/basemap/
  src/
    style-import-export.ts          # Create: style.json read/write to .atlasdraw container
```

### Feature 5 — Categorical/graduated layer styling

```
packages/basemap/
  src/
    style-compiler.ts               # Create: LayerStyle → MapLibre expression compiler
    layer-style-types.ts            # Create: LayerStyle, ColorOrExpression, DataExpression

apps/atlas-app/
  components/
    StylePanel.tsx                  # Create: layer styling UI
    ColorRampPicker.tsx             # Create: categorical/graduated ramp selector
  __tests__/
    style-compiler.test.ts          # Create: compile-to-expression unit tests
    StylePanel.test.tsx             # Create
```

### Feature 6 — Print PDF layout

```
apps/atlas-app/
  components/
    PrintDialog.tsx                 # Create: page size selector, title input
  lib/
    print-pdf.ts                    # Create: pdf-lib compositor (title block, legend, scale bar, north arrow)
  __tests__/
    print-pdf.test.ts               # Create
```

### Feature 7 — Geocoding via Photon

Split across two tasks (Task 11a: client + cache; Task 11b: CSV wire-up + config) to stay within 5-file limit.

```
packages/data/
  src/
    geocoding/
      photon-client.ts              # Create: fetch wrapper for Photon/Nominatim/Pelias  [Task 11a]
      geocoding-cache.ts            # Create: in-memory LRU cache (Komoot rate-limit guard) [Task 11a]
      csv-geocode.ts                # Modify: was stub — wire up photon-client             [Task 11b]
  __tests__/
    photon-client.test.ts           # Create (mock fetch)                                  [Task 11a]
    csv-geocode.test.ts             # Create                                               [Task 11b]

apps/atlas-app/
  config.toml                       # Modify: add [geocoding] section with endpoint + rate_limit [Task 11b]
```

### Feature 8 — Felt importer

<!-- shape-incorporated 2026-05-03: OQ1 resolved — no binary .felt format; fixtures are GeoJSON snapshots, renamed .felt.json -->
```
packages/data/
  src/
    felt.ts                              # Create: .felt.json → .atlasdraw importer
  __tests__/
    felt-importer.test.ts                # Create
  fixtures/
    felt/
      sample-01-basic-layers.felt.json   # Create: GeoJSON API response snapshot
      sample-02-styled-polygons.felt.json # Create: GeoJSON API response snapshot
      sample-03-unknown-types.felt.json  # Create: fixture (tests permissive warn path)
      sample-01-expected.atlasdraw       # Create: expected output
      sample-02-expected.atlasdraw       # Create
      sample-03-expected.atlasdraw       # Create
```

### Feature 9 — Hosted multi-tenant mode

```
apps/atlas-app/
  lib/
    workspace.ts                    # Create: WorkspaceId type, workspace context
  components/
    WorkspaceSwitcher.tsx           # Create: workspace selector UI
  pages/
    billing.tsx                     # Create: Stripe checkout redirect page

apps/realtime/
  src/
    workspace-middleware.ts         # Create: per-workspace room isolation
    stripe-webhooks.ts              # Create: webhook handler (checkout.session.completed, etc.)
    quota-enforcer.ts               # Create: per-workspace storage + member quotas
  __tests__/
    stripe-webhooks.test.ts         # Create
    quota-enforcer.test.ts          # Create

infra/
  docker-compose.cloud.yml          # Modify: add stripe-cli container for local webhook dev
```

### Feature 10 — Accessibility pass

```
apps/atlas-app/
  components/
    FocusTrap.tsx                   # Create: cross-boundary focus trap (editor↔Maputnik↔comments)
    AriaAnnouncer.tsx               # Create: live region for selection announcements
  styles/
    high-contrast.css               # Create: high-contrast mode overrides
  __tests__/
    keyboard-nav.test.tsx           # Create: tab order, focus trap, escape key
```

### Feature 11 — Asset library

Split across two tasks (Task 14a: reader + tests; Task 14b: curated fixtures + panel UI) to stay within 5-file limit.

```
packages/data/
  src/
    asset-library.ts                # Create: .excalidrawlib read/write + library index  [Task 14a]
  __tests__/
    asset-library.test.ts           # Create: parse + error + built-in lookup tests       [Task 14a]
  fixtures/
    libraries/
      wildfire-icons.excalidrawlib  # Create: MIT-licensed set                            [Task 14b]
      transit-symbols.excalidrawlib # Create                                              [Task 14b]
      hazard-markers.excalidrawlib  # Create                                              [Task 14b]

apps/atlas-app/
  components/
    AssetLibraryPanel.tsx           # Create: library browser sidebar                     [Task 14b]
  __tests__/
    AssetLibraryPanel.test.tsx      # Create                                              [Task 14b]
```

### Wave 0 additions

```
decisions/
  0006-telemetry.md                 # Create: ADR telemetry policy (constraint; governs embed SDK, Task 4)
```

### Wave 4 gates

```
packages/sdk/
  .size-limit.json                  # Create: 300KB hard limit config

.github/
  workflows/
    bundle-size.yml                 # Create: size-limit CI check
    postmessage-roundtrip.yml       # Create: structural test in CI
    sdk-telemetry-guard.yml         # Create: grep-check — no network calls in packages/sdk/src/
    hosted-e2e.yml                  # Create: Playwright E2E against docker-compose.cloud.yml
```

---

## Tasks

### Wave 0 — Contracts + Policies (serial; everything downstream depends on these)

---

### Task 1: AtlasdrawAPI — Async-revised interface + ADR 0005

**Orient:** Define the stable public API surface that the embed SDK, plugin sandbox (Phase 7), and all downstream Phase 6 features build against. The spec's §7.1 signatures are sync; Q11 mandates they must be async and structured-clone-safe. Fix this here before anyone builds against it.
**Flow position:** Step 1 of 1 in AtlasdrawAPI contract flow (source → **api.ts** → all consumers)
**Upstream contract:** §7.1 spec text (input); Q11 constraint (guard)
**Downstream contract:** Produces `AtlasdrawAPI` interface consumed by Task 2 (embed), Task 4 (SDK bridge), Task 13 (comments), Task 20 (workspace-scoped methods)
**Skill:** `test-driven-development`

<contracts>
**Downstream (api.ts → embed SDK, editor, plugin sandbox):**
- All methods are `async` (return `Promise<T>`) or are fire-and-forget (`void`)
- All parameter types and return types pass `structuredClone()` without throwing
- Unsubscribe handles are `Promise<void>` rather than returned functions
- No DOM nodes, no class instances, no `Map`/`Set` unless serialized
</contracts>

**Files:**
- Create: `packages/sdk/src/api.ts`
- Create: `packages/sdk/src/api-types.ts`
- Create: `decisions/0005-sdk-postmessage-contract.md`

- [ ] **Step 1: Write the structured-clone harness test first**

  Write `packages/sdk/__tests__/api-structured-clone.test.ts` with a test that imports `AtlasdrawAPI` interface and, for each method signature, asserts that sample arguments and return values survive `structuredClone()` without throwing. Start with a known-failing stub that just imports the (not-yet-existing) interface.

  <!-- shape-incorporated 2026-05-03: OQ2 — structuredClone(new LngLat(0,0)) does NOT throw; it silently strips prototype methods. Test must assert typeof clone.toArray === "undefined", not expect-throws. Tuple approach is already correct. -->

  Run: `pnpm --filter @atlasdraw/sdk test api-structured-clone`
  Expected: FAIL — "Cannot find module '../src/api'"

- [ ] **Step 2: Write the async-revised interface in `api.ts`**

  Key revisions from §7.1:
  - `getScene(): Promise<AtlasdrawScene>` (was sync)
  - `addAnnotation(): Promise<string>` (was sync)
  - `addDataLayer(): Promise<string>` (was sync)
  - `onSceneChange(cb): Promise<string>` returning a `subscriptionId`; add `unsubscribe(id: string): Promise<void>` instead of returning a cleanup function
  - `flyTo()`, `fitBounds()`, `setActiveTool()`, `setLayerVisibility()` remain `void` (fire-and-forget)
  - `LngLat` positions typed as `[number, number]` tuples (not MapLibre class instances)

  Write supporting types in `api-types.ts`: `AtlasdrawScene`, `Camera`, `LayerOpts`, `ToolId`, `FitOpts`.

  Run: `pnpm --filter @atlasdraw/sdk tsc --noEmit`
  Expected: Zero type errors

- [ ] **Step 3: Run structured-clone test to verify it passes**

  Run: `pnpm --filter @atlasdraw/sdk test api-structured-clone`
  Expected: PASS — "all 14 AtlasdrawAPI methods pass structured-clone round-trip"

- [ ] **Step 4: Write ADR 0005**

  File: `decisions/0005-sdk-postmessage-contract.md`
  Contents: context (Q11), decision (all methods async, all values JSON-serializable, subscription pattern via `subscriptionId`), consequences (Phase 7 plugin sandbox can pass `AtlasdrawAPI` through `Worker.postMessage()` without wrapping), alternatives considered (Proxy-over-MessagePort rejected: too complex; SharedArrayBuffer rejected: COOP header cost).

  Run: `test -f decisions/0005-sdk-postmessage-contract.md && echo EXISTS`
  Expected: EXISTS

- [ ] **Step 5: Commit**

  Run: `git add packages/sdk/src/api.ts packages/sdk/src/api-types.ts packages/sdk/__tests__/api-structured-clone.test.ts decisions/0005-sdk-postmessage-contract.md`
  Expected: Clean commit "feat(sdk): async-revised AtlasdrawAPI interface + ADR 0005 [Q11]"

---

### Task 2: LayerStyle schema + style-compiler skeleton

**Orient:** Define the `LayerStyle` type and the `style-compiler.ts` entry point so that the style panel (Task 9), Maputnik bridge (Task 8), and Felt importer (Task 16) all share one canonical type.
**Flow position:** Step 1 of 3 in layer-styling flow (schema → **compiler-skeleton** → UI)
**Upstream contract:** Spec §7.3 `LayerStyle` definition
**Downstream contract:** `LayerStyle` type consumed by Task 9 (StylePanel), Task 8 (Maputnik bridge), Task 16 (Felt importer)
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/basemap/src/layer-style-types.ts`
- Create: `packages/basemap/src/style-compiler.ts` (skeleton — compile returns `{}` initially)
- Create: `packages/basemap/__tests__/style-compiler.test.ts`

- [ ] **Step 1: Write failing tests for compiler**

  Three tests: (a) solid color point compiles to `{type: "circle", paint: {"circle-color": "#ff0000"}}`, (b) categorical fill compiles to a MapLibre `match` expression, (c) graduated fill compiles to `interpolate` expression.

  Run: `pnpm --filter @atlasdraw/basemap test style-compiler`
  Expected: FAIL — "style-compiler is not a function"

- [ ] **Step 2: Write `layer-style-types.ts` with the full `LayerStyle` union**

  Match spec §7.3 exactly. Export: `LayerStyle`, `ColorOrExpression`, `DataExpression`, `GeometryType`.

  Run: `pnpm --filter @atlasdraw/basemap tsc --noEmit`
  Expected: Zero type errors

- [ ] **Step 3: Write skeleton `style-compiler.ts`**

  Export `compileLayerStyle(style: LayerStyle): maplibregl.LayerSpecification`. Initial impl: point → `circle` layer, line → `line` layer, polygon → `fill` layer, all using solid color only. Categorical and graduated left as `TODO` for Task 10.

  Run: `pnpm --filter @atlasdraw/basemap test style-compiler`
  Expected: 1 PASS (solid color), 2 TODO-pending

- [ ] **Step 4: Commit**

  Run: `git add packages/basemap/src/ packages/basemap/__tests__/`
  Expected: Clean commit "feat(basemap): LayerStyle schema + style-compiler skeleton"

---

### Task 3: Felt importer — verify: document Felt API GeoJSON export schema and capture fixtures

**Orient:** OQ1 is resolved (2026-05-03): there is no public `.felt` binary format to reverse-engineer. Felt exposes data exclusively through its REST API (bearer token required). The Layer Exports API returns GeoJSON (and other formats) as a zipped download. This task is **downgraded from "spike/discover" to "verify/document"** — the format is known; the work is to authenticate, call the API, capture 3 representative GeoJSON responses as fixtures, and document the layer schema.
**Flow position:** Step 1 of 2 in felt-importer flow (**api-verify** → importer-impl)
**Upstream contract:** Q13 constraint — permissive importer, read-only, no throw; OQ1 resolution — API-only, bearer token required
**Downstream contract:** Produces `docs/decisions/felt-format-notes.md` and 3 GeoJSON fixture files (renamed `.felt.json`) consumed by Task 16
**Skill:** `none` (research/documentation task)

**Files:**
- Create: `docs/decisions/felt-format-notes.md`
- Create: `packages/data/fixtures/felt/sample-01-basic-layers.felt.json`
- Create: `packages/data/fixtures/felt/sample-02-styled-polygons.felt.json`
- Create: `packages/data/fixtures/felt/sample-03-unknown-types.felt.json`

- [ ] **Step 1: Authenticate and export 3 Felt maps via the Layer Exports API**

  Felt's Layer Exports API: `POST /api/v2/maps/{map_id}/layers/{layer_id}/custom_export` with `output_format: "geojson"`. Requires a Felt API key (bearer token). Use 3 maps spanning: (a) basic point/line/polygon layers, (b) styled polygon data with fill colors, (c) a map with unknown/proprietary element types. Poll `poll_endpoint` until `status: "completed"`, then download the zip and extract the GeoJSON file. Save as `.felt.json` fixture.

  Note in `felt-format-notes.md` if a Felt API key is unavailable at task time — in that case, construct synthetic fixtures from Felt's publicly documented layer schema and the Felt Style Language spec at `developers.felt.com`.

  Run: `file packages/data/fixtures/felt/sample-01-basic-layers.felt.json`
  Expected: "JSON text data"

- [ ] **Step 2: Document the API response schema in `felt-format-notes.md`**

  Record: GeoJSON FeatureCollection structure, `properties` keys for each feature, Felt Style Language fields present, layer metadata (name, type, visibility), coordinate system (EPSG:4326 assumed). Note what maps to `.atlasdraw` fields and what has no analogue. Flag any field where intent is ambiguous.

  Run: `test -f docs/decisions/felt-format-notes.md && wc -l docs/decisions/felt-format-notes.md`
  Expected: file exists, ≥30 lines

- [ ] **Step 3: Create expected output fixtures**

  For each `.felt.json` fixture, hand-author the expected `.atlasdraw` output. These are test oracles for Task 16's tests.

  Run: `ls packages/data/fixtures/felt/*.atlasdraw | wc -l`
  Expected: 3

- [ ] **Step 4: Commit**

  Run: `git add docs/decisions/felt-format-notes.md packages/data/fixtures/`
  Expected: Clean commit "verify(data): document Felt API export schema, add 3 GeoJSON fixtures [Q13/OQ1]"

---

### Task 4: ADR 0006 — Telemetry policy (Wave 0 constraint)

**Orient:** Write the telemetry ADR before any embed SDK or hosted-mode code ships. The embed SDK (Task 4a, Wave 1) commits to "no analytics" — it must cite an existing ADR, not a forthcoming one. ADR 0006 is a constraint document, not an implementation task; it belongs in Wave 0 alongside the other contracts.
**Flow position:** Step 1 of 1 in telemetry-policy flow (**adr-0006**)
**Upstream contract:** Q4 (hosted mode opt-in analytics), Q10 (telemetry policy), ADR 0005 (embed SDK is postMessage-only)
**Downstream contract:** All Phase 6 tasks cite ADR 0006 when touching telemetry. CI telemetry-guard (Task 27) enforces it.
**Skill:** `none`

**Files:**
- Create: `decisions/0006-telemetry.md`

- [ ] **Step 1: Write the ADR**

  Sections: Context, Decision, Enforcement.

  Decision text (verbatim in ADR):
  1. OSS app — zero telemetry by default. No calls to any analytics endpoint unless explicitly configured.
  2. Hosted flagship (`MANAGED_MODE=true`) — opt-in usage events only: `map_created`, `layer_added`, `embed_loaded`. No PII, no session recording.
  3. Anonymous heartbeat — opt-in at install time; sends only `{instance_id, version, maps_created_this_week}` to a configurable endpoint (default `https://telemetry.atlasdraw.org`). Self-hosters may point at `/dev/null` or omit.
  4. Embed SDK (`packages/sdk`) — NEVER sends any data. Zero network calls from SDK bundle. Cite ADR 0005: the SDK is postMessage-only; adding network calls would violate the structured-clone contract and the MIT-license trust expectation.

  Enforcement: CI check (Task 27 in Wave 4) grep-fails if `packages/sdk/src/` imports `fetch`, `XMLHttpRequest`, `sendBeacon`, or any analytics library name (`posthog`, `segment`, `amplitude`, `mixpanel`, `ga`, `gtag`).

  Run: `test -f decisions/0006-telemetry.md && grep -c "Embed SDK" decisions/0006-telemetry.md`
  Expected: 1 (section present)

- [ ] **Step 2: Commit**

  Run: `git add decisions/0006-telemetry.md`
  Expected: Clean commit "docs: ADR 0006 telemetry policy — zero from SDK, opt-in for hosted [Q4/Q10]"

---

## Wave 1 — Core Feature Implementations (parallel after Wave 0)

Wave 1 tasks can all start once Tasks 1–3 complete. Most are independent within this wave; exceptions noted inline.

---

### Task 4a: Embed SDK — package scaffold + Vite build

**Orient:** Create the `packages/sdk` package with its `package.json` (MIT), `vite.config.ts`, and `index.ts` entry. This scaffold must exist before `AtlasdrawEmbed.tsx` (Task 4b) can be written and before the bundle-size gate (Task 23) can fire.
**Flow position:** Step 1 of 3 in embed-sdk flow (**scaffold** → component → api-bridge)
**Upstream contract:** `AtlasdrawAPI` interface from Task 1
**Downstream contract:** Buildable package at `packages/sdk/`; `pnpm --filter @atlasdraw/sdk build` exits 0
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/vite.config.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/tsconfig.json`

- [ ] **Step 1: Verify `renderStaticScene` is importable without React**

  Run: `grep -r "renderStaticScene" packages/excalidraw/src/ | head -5`
  Expected: At least one result confirming the function exists; note the file path for Task 4b.

- [ ] **Step 2: Create `package.json`**

  Fields: `"name": "@atlasdraw/sdk"`, `"version": "0.1.0"`, `"license": "MIT"`, `"type": "module"`, `"main": "dist/atlasdraw-embed.js"`, `"module": "dist/atlasdraw-embed.esm.js"`. Peer deps: `react@>=18`, `react-dom@>=18`. Dev deps: `vite`, `size-limit`.

  Run: `node -e "require('./packages/sdk/package.json')" && echo OK`
  Expected: OK

- [ ] **Step 3: Create `vite.config.ts` (library mode)**

  Config: `build.lib.entry = 'src/index.ts'`, `formats: ['es', 'umd']`, `name: 'AtlasdrawSDK'`. Externalize `react`, `react-dom`, `maplibre-gl`. Post-build step in `package.json` `"postbuild"` script: `openssl dgst -sha384 -binary dist/atlasdraw-embed.js | openssl base64 -A > dist/sri.txt`.

  Run: `pnpm --filter @atlasdraw/sdk build`
  Expected: `dist/atlasdraw-embed.js` created (may be near-empty until Task 4b); no build errors

- [ ] **Step 4: Commit**

  Run: `git add packages/sdk/package.json packages/sdk/vite.config.ts packages/sdk/src/index.ts packages/sdk/tsconfig.json`
  Expected: Clean commit "feat(sdk): package scaffold + Vite library build config [MIT, Q5]"

---

### Task 4b: Embed SDK — `AtlasdrawEmbed` component + `mount()`

**Orient:** Implement the `<AtlasdrawEmbed src="..." />` React component and vanilla `mount()` for non-React hosts. Uses the scaffold from Task 4a. This is the primary v1.0 embed deliverable.
**Flow position:** Step 2 of 3 in embed-sdk flow (scaffold → **component** → api-bridge)
**Upstream contract:** Package scaffold from Task 4a; `AtlasdrawAPI` from Task 1; `renderStaticScene` path confirmed in Task 4a Step 1
**Downstream contract:** `<AtlasdrawEmbed>` renders an iframe; `mount()` inserts one imperatively; both expose `AtlasdrawAPI` via `onReady`
**Skill:** `shadow-walk`

`Codebooks: focus-management-across-boundaries` — the embed iframe introduces a new focus context; Tab must not escape the embed host's document into the iframe without explicit user intent.

**Files:**
- Create: `packages/sdk/src/AtlasdrawEmbed.tsx`
- Create: `packages/sdk/src/mount.ts`
- Create: `packages/sdk/src/embed-renderer.ts`
- Create: `packages/sdk/__tests__/embed-first-load.test.ts`

- [ ] **Step 1: Write shadow-walk tests for first-load UX**

  Scenarios: (a) `src` URL resolves (200) → map renders within 2s; (b) `src` URL 404 → error slot shown, no crash; (c) JavaScript disabled (NOSCRIPT) → `<noscript>` fallback is visible; (d) slow network (fetch delayed 3s) → loading skeleton is shown; (e) `onReady` fires after iframe signals `EMBED_READY` via postMessage.

  Run: `pnpm --filter @atlasdraw/sdk test embed-first-load`
  Expected: FAIL — "AtlasdrawEmbed is not defined"

- [ ] **Step 2: Implement `AtlasdrawEmbed.tsx`**

  Props: `src: string`, `width?: string | number`, `height?: string | number`, `legend?: boolean` (default true), `attribution?: boolean` (default true), `cameraLock?: boolean` (default false), `onReady?: (api: AtlasdrawAPI) => void`, `allowedOrigins?: string[]`.

  Renders `<iframe sandbox="allow-scripts allow-same-origin">`. Wires `onReady` via postMessage handshake (`EMBED_READY` message from inner frame). No analytics — embed SDK never phones home (ADR 0006).

  Run: `pnpm --filter @atlasdraw/sdk tsc --noEmit`
  Expected: Zero type errors

- [ ] **Step 3: Implement `mount.ts`**

  ```ts
  export function mount(container: HTMLElement, options: EmbedOptions): AtlasdrawAPI
  ```
  Creates an iframe, appends to `container`, wires the same postMessage handshake as the React component, returns the API proxy (to be implemented in Task 5).

- [ ] **Step 4: Implement `embed-renderer.ts`**

  Thin wrapper around `renderStaticScene` from `packages/excalidraw/scene/`. Receives the `.atlasdraw` scene JSON, renders to a canvas element. No editing UI, no toolbar.

- [ ] **Step 4b: Add non-removable attribution overlay** <!-- shape-incorporated 2026-05-03: OQ6 — embed SDK renders the same OSM/OpenMapTiles basemap; ODbL attribution is mandatory on ALL rendering surfaces, not only print PDF -->

  The embed iframe must render an attribution bar as a non-removable DOM element (cannot be suppressed via props or CSS overrides). Required text (verbatim):

  ```
  © OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles
  ```

  Implementation: add a `<div class="atlasdraw-attribution">` absolutely positioned bottom-right of the iframe body. Style: `pointer-events: none`, `user-select: none`, `font-size: 11px`. The `attribution` prop (Step 2) controls visibility styling only — the element must remain in the DOM regardless of prop value (CSS `visibility: hidden` max; never `display: none` or removal). This is a legal obligation under ODbL, not a configuration option.

  Acceptance: `grep -c "atlasdraw-attribution" packages/sdk/src/embed-renderer.ts` → 1

- [ ] **Step 5: Run shadow-walk tests**

  Run: `pnpm --filter @atlasdraw/sdk test embed-first-load`
  Expected: All 5 scenarios PASS

- [ ] **Step 6: Commit**

  Run: `git add packages/sdk/src/AtlasdrawEmbed.tsx packages/sdk/src/mount.ts packages/sdk/src/embed-renderer.ts packages/sdk/__tests__/embed-first-load.test.ts`
  Expected: Clean commit "feat(sdk): AtlasdrawEmbed component + mount() + embed-renderer [Q5/Q11]"

---

### Task 5: Embed SDK — `AtlasdrawAPI` postMessage bridge

**Orient:** Wire the `AtlasdrawAPI` interface to both the editor (direct call) and the embed iframe (postMessage relay). Task 5 depends on Task 4b completing — the iframe shape must exist before the bridge can be implemented.
**Flow position:** Step 3 of 3 in embed-sdk flow (scaffold → component → **api-bridge**)
**Upstream contract:** `AtlasdrawAPI` from Task 1; `AtlasdrawEmbed` iframe + `EMBED_READY` protocol from Task 4b
**Downstream contract:** Host applications call `api.getScene()`, `api.flyTo()`, etc. identically inside or outside the iframe
**Skill:** `adversarial-api-testing`

Note: Task 5 is in Wave 1 but serially depends on Task 4b. Start Task 5 only after Task 4b's commit lands.

**Files:**
- Create: `packages/sdk/src/api-bridge.ts`
- Create: `packages/sdk/__tests__/api-bridge.test.ts`

- [ ] **Step 1: Write adversarial tests**

  Tests: (a) `flyTo()` called before embed ready → queued and replayed on ready; (b) `getScene()` called after iframe unloads → rejects with `EmbedDisposedError`; (c) postMessage from untrusted origin → silently ignored (no error thrown, no state change); (d) rapid-fire 10 concurrent `getScene()` calls → all resolve with consistent data (no race); (e) `getScene()` return value passes `structuredClone()` (re-uses harness from Task 1).

  Run: `pnpm --filter @atlasdraw/sdk test api-bridge`
  Expected: FAIL — "api-bridge not found"

- [ ] **Step 2: Implement `api-bridge.ts`**

  Two implementations behind `AtlasdrawAPI`: `DirectApiBridge` (in-process, for editor host) and `PostMessageApiBridge` (cross-origin, for embed hosts). The postMessage bridge:
  - Serializes calls as `{type: "ATLASDRAW_API_CALL", method: string, args: unknown[], callId: string}`
  - Listens for `{type: "ATLASDRAW_API_RESULT", callId: string, result: unknown, error?: string}`
  - Maintains a `pendingCalls: Map<callId, {resolve, reject}>` for in-flight calls
  - Origin validation: checks `event.origin` against `allowedOrigins` prop; defaults to same origin

  Run: `pnpm --filter @atlasdraw/sdk test api-bridge`
  Expected: All 5 adversarial tests PASS

- [ ] **Step 3: Commit**

  Run: `git add packages/sdk/src/api-bridge.ts packages/sdk/__tests__/api-bridge.test.ts`
  Expected: Clean commit "feat(sdk): AtlasdrawAPI postMessage bridge — DirectApiBridge + PostMessageApiBridge [Q11]"

---

### Task 6: Anchored comments — Yjs second document + server routing

**Orient:** Store threaded comments in a separate Yjs document per room (not in the scene Y.Doc). This enables per-room ACL: a viewer-role user can write comments without write access to the scene.
**Flow position:** Step 1 of 2 in comments flow (**yjs-doc** → UI)
**Upstream contract:** Phase 5 `apps/realtime` WebSocket room; Y.Doc per-room pattern already established
**Downstream contract:** Produces `Y.Map` of `CommentThread[]` per room, consumed by `useComments.ts` (Task 7)
**Skill:** `test-driven-development`

`Codebooks: text-editing-mode-isolation` — the comment composer must isolate its text input mode from the map's keyboard shortcuts. Pressing Space in the composer must not pan the map.

**Files:**
- Create: `apps/realtime/src/comments-doc.ts`
- Create: `apps/realtime/src/room-comments-handler.ts`
- Create: `apps/realtime/__tests__/comments-doc.test.ts`

- [ ] **Step 1: Write tests for comments-doc protocol**

  Tests: (a) two clients connect to same room → `Y.Doc` synchronized; (b) client adds comment thread → other client sees it within 100ms; (c) resolve/reopen thread → state propagates; (d) `@mention` stored as plain string handle, not a user object (to avoid coupling to auth).

  Run: `pnpm --filter @atlasdraw/realtime test comments-doc`
  Expected: FAIL

- [ ] **Step 2: Define `CommentThread` Yjs schema**

  In `comments-doc.ts`:
  ```ts
  // Y.Map structure:
  // threadId → { anchorId: string, anchorType: 'annotation' | 'coord',
  //              anchorCoord?: [number, number], resolved: boolean,
  //              replies: Y.Array<Reply> }
  // Reply → { id: string, authorHandle: string, body: string, createdAt: number }
  ```

  Rationale for separate Y.Doc (document in code comment): different ACL granularity, different conflict semantics (last-write-wins on `resolved` boolean; append-only for `replies`), different volume (scenes can be large; comment docs are small).

  Run: `pnpm --filter @atlasdraw/realtime tsc --noEmit`
  Expected: Zero errors

- [ ] **Step 3: Wire `room-comments-handler.ts` into the WebSocket server**

  Add a `y-websocket` sub-protocol on path `/rooms/:roomId/comments` alongside the existing scene doc at `/rooms/:roomId`. Share the same Socket.IO server; use a room-name suffix (`<roomId>:comments`) to namespace the Y.Doc.

  Run: `pnpm --filter @atlasdraw/realtime test comments-doc`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/realtime/src/ apps/realtime/__tests__/`
  Expected: Clean commit "feat(realtime): second Y.Doc per room for comments [Phase 6 comments]"

---

### Task 7: Anchored comments — UI (CommentsPanel + CommentAnchor)

**Orient:** Render threaded comments in the sidebar and as anchor pins on the map. Users can type replies, @-mention collaborators, and resolve threads. This is the "present-and-review" UX.
**Flow position:** Step 2 of 2 in comments flow (yjs-doc → **UI**)
**Upstream contract:** `useComments.ts` hook subscribing to the comments Y.Doc from Task 6
**Downstream contract:** `CommentThread[]` displayed in panel + `CommentAnchor` pins rendered via MapLibre markers
**Skill:** `test-driven-development`

`Codebooks: text-editing-mode-isolation` — space/enter keys in `CommentComposer` must not trigger map tool actions. Mount the composer in a `<div onKeyDown={e => e.stopPropagation()}>` wrapper.
`Codebooks: focus-management-across-boundaries` — opening the comment panel must move focus to the first unresolved thread; closing must return focus to the annotation that was clicked.

**Files:**
- Create: `apps/atlas-app/components/CommentsPanel.tsx`
- Create: `apps/atlas-app/components/CommentAnchor.tsx`
- Create: `apps/atlas-app/components/CommentComposer.tsx`
- Create: `apps/atlas-app/hooks/useComments.ts`
- Create: `apps/atlas-app/__tests__/CommentsPanel.test.tsx`

- [ ] **Step 1: Write tests for CommentsPanel**

  Tests: (a) renders list of threads; (b) resolve button calls `resolveThread(id)`; (c) `@alice` in composer renders as a mention chip; (d) Tab key moves between threads (keyboard nav); (e) pressing Space in composer does not dispatch a map event.

  Run: `pnpm --filter @atlasdraw/atlas-app test CommentsPanel`
  Expected: FAIL

- [ ] **Step 2: Implement `useComments.ts`**

  Subscribes to the room's comments Y.Doc via a WebSocket connection to `/rooms/:roomId/comments`. Returns `{ threads, addReply, resolveThread, reopenThread }`. All mutations are fire-and-forget (update the Y.Doc; Yjs replication handles the rest).

  Run: `pnpm --filter @atlasdraw/atlas-app tsc --noEmit`
  Expected: Zero errors

- [ ] **Step 3: Implement `CommentsPanel.tsx`, `CommentComposer.tsx`, `CommentAnchor.tsx`**

  `CommentAnchor` renders a MapLibre `Marker` at the annotation's bounding-box center. Clicking the marker opens the panel at that thread. `CommentComposer` detects `@` prefix to show a mention picker (list of room members from the existing presence state from Phase 5).

  Run: `pnpm --filter @atlasdraw/atlas-app test CommentsPanel`
  Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/components/ apps/atlas-app/hooks/ apps/atlas-app/__tests__/`
  Expected: Clean commit "feat(app): anchored comments panel + composer [Phase 6]"

---

### Task 8: Maputnik iframe integration

**Orient:** Allow users to edit the basemap style via Maputnik embedded in an iframe modal. Style changes round-trip through `style.json` stored in `.atlasdraw`. This task is the "style editor (embedded Maputnik)" PRD feature.
**Flow position:** Step 1 of 1 in maputnik flow (**iframe-bridge**)
**Upstream contract:** MapLibre style object from `packages/basemap`
**Downstream contract:** Updated style committed to `.atlasdraw` `style.json` file
**Skill:** `adversarial-api-testing`

`Codebooks: focus-management-across-boundaries` — the Maputnik iframe is a full separate document. Tab must be trapped inside the modal while it is open. Escape key must close the modal and return focus to the map canvas.

**Files:**
- Create: `apps/atlas-app/components/MaputnikModal.tsx`
- Create: `apps/atlas-app/components/MaputnikBridge.ts`
- Create: `packages/basemap/src/style-import-export.ts`
- Create: `apps/atlas-app/__tests__/MaputnikBridge.test.ts`

- [ ] **Step 1: Write adversarial tests for the bridge**

  Tests: (a) message from unexpected origin is silently discarded; (b) `STYLE_IMPORT` message with malformed JSON is caught and logged, modal stays open; (c) `STYLE_EXPORT` message dispatched when user clicks "Apply" in Maputnik; (d) closing modal before export → style unchanged.

  Run: `pnpm --filter @atlasdraw/atlas-app test MaputnikBridge`
  Expected: FAIL

- [ ] **Step 2: Implement `MaputnikBridge.ts`**

  Listens for `window.addEventListener('message', handler)`. Validates `event.origin` against `MAPUTNIK_ALLOWED_ORIGIN` (configurable, defaults to `https://maputnik.github.io`). Protocol: on modal open, post `{type: "SET_STYLE", style: currentStyle}` to Maputnik iframe; listen for `{type: "STYLE_SAVED", style: updatedStyle}`; on receipt, call `style-import-export.ts`.

  Run: `pnpm --filter @atlasdraw/atlas-app test MaputnikBridge`
  Expected: All 4 tests PASS

- [ ] **Step 3: Implement `MaputnikModal.tsx`**

  Renders full-screen modal overlay with `<iframe src="https://maputnik.github.io/editor/" />` (or self-hosted URL from `config.toml`). Focus trap: all Tab keypresses cycle within the iframe; Escape dispatches close. Add `FocusTrap` wrapper (will be created in Task 29).

- [ ] **Step 4: Implement `style-import-export.ts`**

  `readStyleFromAtlasdraw(file: AtlasdrawFile): MapLibreStyleSpec | null` — reads `style.json` from ZIP.
  `writeStyleToAtlasdraw(file: AtlasdrawFile, style: MapLibreStyleSpec): AtlasdrawFile` — writes updated `style.json` into ZIP.

  Run: `pnpm --filter @atlasdraw/basemap test style-import-export`
  Expected: PASS

- [ ] **Step 5: Commit**

  Run: `git add apps/atlas-app/components/MaputnikModal.tsx apps/atlas-app/components/MaputnikBridge.ts packages/basemap/src/style-import-export.ts`
  Expected: Clean commit "feat(app): Maputnik iframe style editor + postMessage bridge"

---

### Task 9: Layer styling UI — StylePanel + ColorRampPicker

**Orient:** Give users a UI to apply categorical and graduated color ramps to data layers. This is the "data styling for layers" PRD feature, using the `LayerStyle` schema from Task 2.
**Flow position:** Step 2 of 3 in layer-styling flow (schema → **UI** → compiler-full)
**Upstream contract:** `LayerStyle` type from Task 2; `setLayerStyle(id, style)` from `AtlasdrawAPI`
**Downstream contract:** Updated `LayerStyle` passed to `compileLayerStyle()` from Task 10
**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/components/StylePanel.tsx`
- Create: `apps/atlas-app/components/ColorRampPicker.tsx`
- Create: `apps/atlas-app/__tests__/StylePanel.test.tsx`

- [ ] **Step 1: Write failing tests for StylePanel**

  Tests: (a) renders "Solid color" option by default; (b) selecting "Categorical" reveals field picker and stop list; (c) selecting "Graduated" reveals numeric field picker and ramp; (d) changing a stop color updates the `LayerStyle` object.

  Run: `pnpm --filter @atlasdraw/atlas-app test StylePanel`
  Expected: FAIL

- [ ] **Step 2: Implement `ColorRampPicker.tsx`**

  Props: `mode: 'solid' | 'categorical' | 'graduated'`, `field: string | null`, `stops: [unknown, string][]`, `onChange`. Uses a simple color swatch grid, not a full color picker (defer that to v1.5).

- [ ] **Step 3: Implement `StylePanel.tsx`**

  Displays the current layer's `LayerStyle`. Renders `ColorRampPicker` for fill/stroke. On change, calls `setLayerStyle(layerId, newStyle)` via the AtlasdrawAPI ref.

  Run: `pnpm --filter @atlasdraw/atlas-app test StylePanel`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/components/StylePanel.tsx apps/atlas-app/components/ColorRampPicker.tsx apps/atlas-app/__tests__/StylePanel.test.tsx`
  Expected: Clean commit "feat(app): layer style panel (categorical/graduated)"

---

### Task 10: Style compiler — categorical + graduated expressions

**Orient:** Complete the `compileLayerStyle` function to produce correct MapLibre `match` (categorical) and `interpolate` (graduated) expressions. Task 2 left these as TODOs.
**Flow position:** Step 3 of 3 in layer-styling flow (schema → UI → **compiler-full**)
**Upstream contract:** `LayerStyle` from Task 2 with `categorical`/`graduated` variants
**Downstream contract:** MapLibre `LayerSpecification` passed to `map.addLayer()`
**Skill:** `test-driven-development`

**Files:**
- Modify: `packages/basemap/src/style-compiler.ts`
- Modify: `packages/basemap/__tests__/style-compiler.test.ts`

- [ ] **Step 1: Extend tests for categorical and graduated**

  Add tests (from Task 2's TODO-pending list):
  - Categorical: `{field: "type", stops: [["park", "#00ff00"], ["water", "#0000ff"]], default: "#888"}` → MapLibre `["match", ["get", "type"], "park", "#00ff00", "water", "#0000ff", "#888"]`
  - Graduated: `{field: "population", stops: [[0, "#fff"], [1000000, "#00f"]], interpolate: "linear"}` → MapLibre `["interpolate", ["linear"], ["get", "population"], 0, "#fff", 1000000, "#00f"]`
  - Graduated step: same but `interpolate: "step"` → `["step", ...]`

  Run: `pnpm --filter @atlasdraw/basemap test style-compiler`
  Expected: New tests FAIL (TODOs resolve), solid-color test still PASS

- [ ] **Step 2: Implement categorical and graduated branches**

  Run: `pnpm --filter @atlasdraw/basemap test style-compiler`
  Expected: All tests PASS

- [ ] **Step 3: Commit**

  Run: `git add packages/basemap/src/style-compiler.ts packages/basemap/__tests__/style-compiler.test.ts`
  Expected: Clean commit "feat(basemap): compile categorical/graduated LayerStyle to MapLibre expressions"

---

### Task 11a: Geocoding — Photon client + LRU cache

**Orient:** Build the Photon/Nominatim/Pelias fetch client and the in-memory LRU cache that guards against Komoot's rate limits. This is a pure-function module with no side effects on the app — split from Task 11b to stay within the 5-file limit.
**Flow position:** Step 1 of 2 in geocoding flow (**photon-client + cache** → csv-wire-up)
**Upstream contract:** None (new module)
**Downstream contract:** `geocodeAddress(address: string, opts: GeocodingConfig): Promise<[number, number] | null>` consumed by Task 11b
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/data/src/geocoding/photon-client.ts`
- Create: `packages/data/src/geocoding/geocoding-cache.ts`
- Create: `packages/data/src/geocoding/geocoding-types.ts`
- Create: `packages/data/__tests__/photon-client.test.ts`

- [ ] **Step 1: Write tests with mocked fetch**

  Tests: (a) Photon returns a feature → `[lng, lat]` tuple; (b) Photon returns empty `features` array → `null`; (c) non-200 response → throws `GeocodingNetworkError`; (d) same address queried twice in a row → second call hits cache, `fetch` called only once; (e) cache evicts oldest entry when size exceeds 500.

  Run: `pnpm --filter @atlasdraw/data test photon-client`
  Expected: FAIL — "photon-client not found"

- [ ] **Step 2: Implement `geocoding-types.ts`**

  ```ts
  export type GeocodingConfig = { endpoint: string; rateLimitMs: number };
  export class GeocodingNetworkError extends Error {}
  ```

- [ ] **Step 3: Implement `photon-client.ts`**

  Calls `${config.endpoint}/api/?q=${encodeURIComponent(address)}&limit=1`. Parses `features[0].geometry.coordinates` as `[lng, lat]`. Enforces `rateLimitMs` delay between outbound requests using a timestamp of last call. Returns `null` on empty feature list.

- [ ] **Step 4: Implement `geocoding-cache.ts`**

  Simple LRU (max 500 entries). Key: `address.trim().toLowerCase()`. Value: `[number, number] | null`. No persistence — in-memory only. Export: `createGeocodingCache(maxSize?: number): GeocodingCache`.

  Run: `pnpm --filter @atlasdraw/data test photon-client`
  Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

  Run: `git add packages/data/src/geocoding/ packages/data/__tests__/photon-client.test.ts`
  Expected: Clean commit "feat(data): Photon geocoding client + LRU cache"

---

### Task 11b: Geocoding — CSV wire-up + config.toml

**Orient:** Wire the geocoding client from Task 11a into the Phase 3 CSV import stub. Add `[geocoding]` config section to `config.toml`. This closes the Phase 3 open item.
**Flow position:** Step 2 of 2 in geocoding flow (photon-client → **csv-wire-up**)
**Upstream contract:** `geocodeAddress()` from Task 11a; Phase 3 stub at `packages/data/src/csv-geocode.ts`
**Downstream contract:** CSV files with an `address` column are geocoded to `[lng, lat]` on import
**Skill:** `test-driven-development`

**Files:**
- Modify: `packages/data/src/csv-geocode.ts`
- Create: `packages/data/__tests__/csv-geocode.test.ts`
- Modify: `apps/atlas-app/config.toml`

- [ ] **Step 1: Write CSV geocode integration tests**

  Tests: (a) CSV with `address` column → rows geocoded to GeoJSON points; (b) CSV with `lat`/`lng` columns → geocoding skipped, columns used directly; (c) geocoding failure for one row → row skipped with warning, rest imported; (d) `config.toml` `[geocoding] endpoint` value is passed through to `photon-client`.

  Run: `pnpm --filter @atlasdraw/data test csv-geocode`
  Expected: FAIL

- [ ] **Step 2: Wire `csv-geocode.ts`**

  Replace stub `return null` with `cachedGeocoder.geocode(addressValue)`. Read config from `config.toml` via the existing config loader (Phase 3 already has one — do not introduce a new loader).

- [ ] **Step 3: Add `[geocoding]` to `config.toml`**

  ```toml
  [geocoding]
  endpoint = "https://photon.komoot.io"
  rate_limit_ms = 200
  ```

  Run: `pnpm --filter @atlasdraw/data test csv-geocode`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add packages/data/src/csv-geocode.ts packages/data/__tests__/csv-geocode.test.ts apps/atlas-app/config.toml`
  Expected: Clean commit "feat(data): wire geocoding into CSV import + config.toml [Phase 3 stub closed]"

---

### Task 12: Workspace abstraction (foundation for hosted mode)

**Orient:** Introduce a `WorkspaceId` type and workspace context throughout the server. Every room, every API route, every Yjs document gets a `workspaceId`. This is the foundation for Stripe billing (Task 19) and per-workspace quotas (Task 20). Ship in Wave 1 — not Wave 3 — because comments (Task 6), geocoding rate limits (Task 11), and the AtlasdrawAPI (Task 1) all need workspace scope.
**Flow position:** Step 1 of 3 in hosted-mode flow (**workspace-abstraction** → stripe → quotas)
**Upstream contract:** Phase 5 `apps/realtime` room structure
**Downstream contract:** `WorkspaceId` added to room names, API routes, Yjs doc namespaces; consumed by Tasks 19, 20
**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/lib/workspace.ts`
- Create: `apps/realtime/src/workspace-middleware.ts`
- Create: `apps/realtime/__tests__/workspace-middleware.test.ts`

- [ ] **Step 1: Write tests**

  Tests: (a) request without `X-Workspace-ID` header → 401; (b) request with valid workspace header → passes through; (c) room name includes workspace prefix (`<workspaceId>/<roomId>`); (d) workspace middleware is skipped when `MANAGED_MODE=false` (self-host default).

  Run: `pnpm --filter @atlasdraw/realtime test workspace-middleware`
  Expected: FAIL

- [ ] **Step 2: Implement `workspace.ts` type + context**

  ```ts
  export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
  export const WorkspaceContext = React.createContext<WorkspaceId | null>(null);
  ```

  Self-host: `WorkspaceContext` is `null`; all routes proceed as single-tenant. Managed mode: `WorkspaceContext` required.

- [ ] **Step 3: Implement `workspace-middleware.ts`**

  Express middleware. Reads `X-Workspace-ID` header. In managed mode (`MANAGED_MODE=true` env var): validates workspace exists in DB, attaches to `req.workspace`. In self-host mode: no-op.

  Run: `pnpm --filter @atlasdraw/realtime test workspace-middleware`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/lib/workspace.ts apps/realtime/src/workspace-middleware.ts apps/realtime/__tests__/`
  Expected: Clean commit "feat(realtime): workspace abstraction for hosted mode [Q4]"

---

## Wave 2 — Secondary Features (parallel after Wave 1)

Wave 2 tasks start once Wave 1 completes. They depend on LayerStyle (Task 2), geocoding (Task 11), and workspace (Task 12) being in place.

---

### Task 13: Print PDF layout

**Orient:** Let users export the current map view as a multi-page PDF with cartographic elements (title block, legend, scale bar, north arrow). Page sizes: US Letter, A4, Tabloid.
**Flow position:** Step 1 of 1 in print-flow (**pdf-compositor**)
**Upstream contract:** MapLibre `map.getCanvas()` for current view; `LayerStyle` from Task 2 for legend entries
**Downstream contract:** `Blob` of PDF bytes, downloaded via `<a href="..." download>`
**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/lib/print-pdf.ts`
- Create: `apps/atlas-app/components/PrintDialog.tsx`
- Create: `apps/atlas-app/__tests__/print-pdf.test.ts`

- [ ] **Step 1: Write unit tests for page-layout logic**

  Tests: (a) A4 landscape → page dimensions 297mm × 210mm; (b) legend with 3 entries renders all 3 in the legend block; (c) scale bar value computed correctly from map zoom + latitude; (d) north arrow embedded as SVG at top-right.

  Run: `pnpm --filter @atlasdraw/atlas-app test print-pdf`
  Expected: FAIL

- [ ] **Step 2: Implement `print-pdf.ts` using `pdf-lib`**

  ```ts
  export async function exportPDF(opts: PrintOptions): Promise<Blob>
  ```
  `PrintOptions`: `pageSize: 'letter' | 'a4' | 'tabloid'`, `orientation: 'portrait' | 'landscape'`, `title: string`, `mapCanvas: HTMLCanvasElement`, `layers: LayerLegendEntry[]`.

  Steps inside: create `PDFDocument`, add page, embed map canvas as JPEG, draw title block at top (title, author, date), draw legend at bottom-left (color swatch + label per layer), draw scale bar at bottom-right, draw north arrow SVG at top-right.

  <!-- shape-incorporated 2026-05-03: OQ6 — attribution string locked; embed as non-removable text in every PDF output -->
  **Required attribution (non-removable — ODbL legal obligation):** The title block must embed the following string as rendered text, never omitted:
  ```
  © OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles
  ```
  This string must survive all `PrintOptions` combinations (no `hideAttribution` flag). Add a unit test (e) asserting the attribution string is present in the PDF's embedded text.

  Run: `pnpm --filter @atlasdraw/atlas-app test print-pdf`
  Expected: All 5 tests PASS (including attribution test)

- [ ] **Step 3: Implement `PrintDialog.tsx`**

  UI: page size selector (radio), orientation toggle, title text input, "Export PDF" button. On submit, calls `exportPDF()` and triggers browser download.

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/lib/print-pdf.ts apps/atlas-app/components/PrintDialog.tsx apps/atlas-app/__tests__/print-pdf.test.ts`
  Expected: Clean commit "feat(app): print PDF layout (pdf-lib, title block, legend, scale bar)"

---

### Task 14a: Asset library — `.excalidrawlib` reader + tests

**Orient:** Build the parser and index for `.excalidrawlib` files. Match the upstream Excalidraw schema exactly so libraries are exchangeable with Excalidraw users. The curated fixtures and UI panel are in Task 14b.
**Flow position:** Step 1 of 2 in asset-library flow (**library-reader** → fixtures + UI)
**Upstream contract:** `.excalidrawlib` JSON schema from `packages/excalidraw` (vendored upstream — verify before implementing)
**Downstream contract:** `parseLibraryFile(json): ExcalidrawLibrary | ParseError` and `getBuiltInLibraries(): ExcalidrawLibrary[]` consumed by Task 14b's panel
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/data/src/asset-library.ts`
- Create: `packages/data/__tests__/asset-library.test.ts`

- [ ] **Step 1: Locate and document the upstream schema**

  Run: `grep -r "ExcalidrawLib" packages/excalidraw/src/ | head -20`
  Expected: Type definition containing `{type: "excalidrawlib", libraryItems: ExcalidrawLibraryItem[]}` — note exact file path and field names for the code comment.

- [ ] **Step 2: Write tests**

  Tests: (a) valid `.excalidrawlib` JSON string parses to `ExcalidrawLibrary`; (b) invalid JSON → returns `{error: "parse error", raw: string}`; (c) missing `libraryItems` field → returns parse error; (d) `getBuiltInLibraries()` returns an array of ≥1 library (once fixtures exist in Task 14b — stub returns `[]` for now and this test is marked TODO).

  Run: `pnpm --filter @atlasdraw/data test asset-library`
  Expected: Tests (a)–(c) PASS, (d) TODO

- [ ] **Step 3: Implement `asset-library.ts`**

  ```ts
  export function parseLibraryFile(json: string): ExcalidrawLibrary | ParseError
  export function getBuiltInLibraries(): ExcalidrawLibrary[]  // uses Vite import.meta.glob
  ```
  Import `ExcalidrawLibraryItem` type from `packages/excalidraw/src/types.ts` — do not redefine.

  Run: `pnpm --filter @atlasdraw/data tsc --noEmit`
  Expected: Zero type errors

- [ ] **Step 4: Commit**

  Run: `git add packages/data/src/asset-library.ts packages/data/__tests__/asset-library.test.ts`
  Expected: Clean commit "feat(data): excalidrawlib reader + parse/index API"

---

### Task 14b: Asset library — curated fixtures + `AssetLibraryPanel` UI

**Orient:** Create the 3 curated `.excalidrawlib` fixture files (wildfire, transit, hazard) and the `AssetLibraryPanel` sidebar UI that lets users browse and stamp items into the scene.
**Flow position:** Step 2 of 2 in asset-library flow (library-reader → **fixtures + UI**)
**Upstream contract:** `parseLibraryFile()` and `getBuiltInLibraries()` from Task 14a; `AtlasdrawAPI.addAnnotation()` from Task 1
**Downstream contract:** User can browse libraries in sidebar and click to insert an annotation element
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/data/fixtures/libraries/wildfire-icons.excalidrawlib`
- Create: `packages/data/fixtures/libraries/transit-symbols.excalidrawlib`
- Create: `packages/data/fixtures/libraries/hazard-markers.excalidrawlib`
- Create: `apps/atlas-app/components/AssetLibraryPanel.tsx`
- Create: `apps/atlas-app/__tests__/AssetLibraryPanel.test.tsx`

- [ ] **Step 1: Author curated fixture files**

  Wildfire: fire symbol, evacuation-route arrow, damage-assessment pin (3 items, MIT/CC0).
  Transit: bus stop, train station, bike share (3 items, MIT/CC0).
  Hazard: chemical spill, flood zone, earthquake epicenter (3 items, MIT/CC0).

  **OQ7 resolved — approved sources only:** OpenMoji (CC BY-SA 4.0) and game-icons.net (CC BY 3.0) are NOT MIT-compatible and must not be used. Use one of the following verified MIT or CC0 sources:
  - [Phosphor Icons](https://github.com/phosphor-icons/core) — MIT license
  - [Heroicons](https://github.com/tailwindlabs/heroicons) — MIT license
  - [Lucide](https://github.com/lucide-icons/lucide) — ISC license (MIT-compatible)
  - Hand-drawn SVG paths created in-house (MIT by authorship)
  - CC0/public-domain SVG collections

  Each fixture must be valid `ExcalidrawLibraryItem` JSON matching the schema confirmed in Task 14a Step 1. Each fixture directory must include a `LICENSE.txt` stating the exact source, its license SPDX identifier, and a URL to the upstream license file.

  Run: `pnpm --filter @atlasdraw/data test asset-library`
  Expected: All 4 tests PASS including the previously-TODO `getBuiltInLibraries()` test

- [ ] **Step 2: Write panel tests**

  Tests: (a) panel renders 3 library sections (wildfire, transit, hazard); (b) clicking an item calls `api.addAnnotation()` with the item's element; (c) all items are Tab-navigable; (d) each item has `aria-label` for screen reader.

  Run: `pnpm --filter @atlasdraw/atlas-app test AssetLibraryPanel`
  Expected: FAIL

- [ ] **Step 3: Implement `AssetLibraryPanel.tsx`**

  Grid of thumbnail previews grouped by library. Click to insert via `useAtlasdrawAPI().addAnnotation(element)`. Each item: `role="button"`, `aria-label={item.name}`, Tab-focusable, Enter/Space activates.

  Run: `pnpm --filter @atlasdraw/atlas-app test AssetLibraryPanel`
  Expected: All 4 tests PASS

- [ ] **Step 4: Add CI license-scan guard** <!-- shape-incorporated 2026-05-03: OQ7 — legal risk (OpenMoji CC BY-SA, game-icons CC BY 3.0 both fail MIT); one-time audit is insufficient; make it a regression guard -->
  **Skill: `adversarial-api-testing`** — treat the license check as an adversarial gate: a future contributor adding a new fixture must not be able to ship non-MIT assets without CI failing.

  Extend `scripts/check-license.sh` (from Phase 0 Task 11) to scan `packages/data/fixtures/libraries/**/LICENSE.txt`:
  - Assert every `LICENSE.txt` exists (fail if absent).
  - Assert SPDX identifier in each `LICENSE.txt` is one of: `MIT`, `ISC`, `CC0-1.0`, `Unlicense` (fail on any other value including `CC-BY-SA-4.0`, `CC-BY-3.0`).
  - Add this check as a step in `.github/workflows/ci.yml` under the existing license-check job.

  Run: `bash scripts/check-license.sh`
  Expected: Exits 0 for MIT/CC0 sources; exits non-zero for any CC-BY or CC-BY-SA `LICENSE.txt`

- [ ] **Step 5: Commit**

  Run: `git add packages/data/fixtures/libraries/ apps/atlas-app/components/AssetLibraryPanel.tsx apps/atlas-app/__tests__/AssetLibraryPanel.test.tsx scripts/check-license.sh .github/workflows/ci.yml`
  Expected: Clean commit "feat(data/app): 3 curated asset libraries (wildfire/transit/hazard, MIT) + AssetLibraryPanel + CI license guard [OQ7]"

---

### Task 15: Felt importer — implementation

**Orient:** Implement the permissive Felt API GeoJSON → `.atlasdraw` importer using the API schema doc and fixtures from Task 3. Permissive means: log `console.warn` on unknown types, never throw, return the best partial output. Input is a GeoJSON FeatureCollection (from the Felt Layer Exports API) or a path to a `Felt-Export.zip` containing GeoJSON.
**Flow position:** Step 2 of 2 in felt-importer flow (api-verify → **importer-impl**)
**Upstream contract:** `felt-format-notes.md` from Task 3; 3 `.felt.json` fixture files with expected outputs
**Downstream contract:** `importFelt(source: ArrayBuffer | string): Promise<AtlasdrawFile>` consumed by the file-open dialog
**Skill:** `test-driven-development`

**Files:**
- Create: `packages/data/src/felt.ts`
- Create: `packages/data/__tests__/felt-importer.test.ts`

- [ ] **Step 1: Write fixture-driven tests**

  <!-- shape-incorporated 2026-05-03: OQ1 — fixture extension renamed .felt → .felt.json (GeoJSON snapshots, not binary) -->
  Three tests, one per fixture from Task 3:
  - `sample-01-basic-layers.felt.json` → output matches `sample-01-expected.atlasdraw` (deep-equal)
  - `sample-02-styled-polygons.felt.json` → output matches `sample-02-expected.atlasdraw`
  - `sample-03-unknown-types.felt.json` → output matches `sample-03-expected.atlasdraw` AND `console.warn` was called at least once (spy on warn)

  Run: `pnpm --filter @atlasdraw/data test felt-importer`
  Expected: FAIL — "felt.ts not found"

- [ ] **Step 2: Implement `felt.ts`**

  ```ts
  export async function importFelt(source: ArrayBuffer | string): Promise<AtlasdrawFile>
  ```

  Steps inside: detect container (ZIP → unzip, string → parse JSON), extract layer array, map each layer to an `.atlasdraw` layer using the field mapping from `felt-format-notes.md`, map Felt's style fields to `LayerStyle` (Task 2's schema), assemble into `.atlasdraw` format, return. Unknown layer types: `console.warn(\`[felt-importer] unknown type: ${type}\`)` and skip.

  Run: `pnpm --filter @atlasdraw/data test felt-importer`
  Expected: All 3 tests PASS

- [ ] **Step 3: Wire into file-open dialog**

  In `apps/atlas-app/components/FileOpenDialog.tsx` (existing from Phase 3), add `.felt` to the `accept` attribute and route to `importFelt()`.

  Run: `pnpm --filter @atlasdraw/atlas-app tsc --noEmit`
  Expected: Zero errors

- [ ] **Step 4: Commit**

  Run: `git add packages/data/src/felt.ts packages/data/__tests__/felt-importer.test.ts apps/atlas-app/components/FileOpenDialog.tsx`
  Expected: Clean commit "feat(data): Felt importer (read-only, permissive) [Q13]"

---

## Wave 3 — Hosted Mode + Accessibility + Asset Hardening (parallel)

Wave 3 starts after Wave 2. Stripe (Tasks 19–20) and a11y (Tasks 21–23) are independent within this wave.

---

### Task 16: Workspace UI — WorkspaceSwitcher + workspace context provider

**Orient:** Give users the UI surface for workspaces: a switcher in the nav bar, a workspace context provider for the app, and the billing page entry point. This is the front-end complement to Task 12's server-side workspace abstraction.
**Flow position:** Step 2 of 3 in hosted-mode flow (workspace-abstraction → **workspace-UI** → stripe)
**Upstream contract:** `WorkspaceId` type and `WorkspaceContext` from Task 12
**Downstream contract:** Active `WorkspaceId` available via context to all child components; billing page renders Stripe checkout redirect
**Skill:** `test-driven-development`

**Files:**
- Create: `apps/atlas-app/components/WorkspaceSwitcher.tsx`
- Create: `apps/atlas-app/pages/billing.tsx`
- Create: `apps/atlas-app/__tests__/WorkspaceSwitcher.test.tsx`

- [ ] **Step 1: Write tests**

  Tests: (a) renders list of user's workspaces; (b) clicking a workspace sets it as active via context; (c) "Upgrade" button on free workspace renders, links to `/billing`; (d) when `MANAGED_MODE=false`, WorkspaceSwitcher renders null (self-host hides this UI).

  Run: `pnpm --filter @atlasdraw/atlas-app test WorkspaceSwitcher`
  Expected: FAIL

- [ ] **Step 2: Implement `WorkspaceSwitcher.tsx`**

  Fetches workspace list from `/api/workspaces` (returns `[]` in self-host mode). Displays name + plan tier. Shows "Upgrade" CTA for free-tier workspaces.

- [ ] **Step 3: Implement `billing.tsx`**

  Page: renders plan comparison table (free / pro / org). "Upgrade to Pro" button calls `/api/billing/checkout` which returns a Stripe hosted checkout URL and redirects.

  Run: `pnpm --filter @atlasdraw/atlas-app test WorkspaceSwitcher`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/components/WorkspaceSwitcher.tsx apps/atlas-app/pages/billing.tsx apps/atlas-app/__tests__/`
  Expected: Clean commit "feat(app): workspace switcher + billing page [Q4]"

---

### Task 17: Hosted mode — per-workspace quotas

**Orient:** Enforce per-workspace quotas: storage bytes, member count, embed views per month. Quota checks run in `apps/realtime` middleware. Off by default in self-host (`MANAGED_MODE=false`). Per Q4: quotas are in the OSS code; no open-core split.
**Flow position:** Step 3 of 3 in hosted-mode flow (workspace-abstraction → workspace-UI → **quotas**)
**Upstream contract:** `workspaceId` from Task 12's middleware; workspace record with plan tier from DB
**Downstream contract:** `QuotaExceeded` error returned to client when limit hit; used by Stripe Task 19 to gate feature access
**Skill:** `test-driven-development`

**Files:**
- Create: `apps/realtime/src/quota-enforcer.ts`
- Create: `apps/realtime/__tests__/quota-enforcer.test.ts`

- [ ] **Step 1: Write tests**

  Tests: (a) free tier: >3 maps created → 402 with `{error: "quota_exceeded", limit: "maps", current: 4, max: 3}`; (b) pro tier: same request succeeds; (c) self-host mode (`MANAGED_MODE=false`): no quota check, passes through; (d) quota values are configurable via env vars (`QUOTA_FREE_MAPS=3`).

  Run: `pnpm --filter @atlasdraw/realtime test quota-enforcer`
  Expected: FAIL

- [ ] **Step 2: Implement `quota-enforcer.ts`**

  Express middleware. Reads plan tier from workspace DB record. Compares current usage (from a lightweight counter table) against plan limits. Returns 402 on exceedance. In self-host mode: `if (!MANAGED_MODE) return next()`.

  Run: `pnpm --filter @atlasdraw/realtime test quota-enforcer`
  Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

  Run: `git add apps/realtime/src/quota-enforcer.ts apps/realtime/__tests__/quota-enforcer.test.ts`
  Expected: Clean commit "feat(realtime): per-workspace quota enforcement [Q4]"

---

### Task 18: Stripe integration — checkout + webhook handler

**Orient:** Wire Stripe for workspace billing: checkout session creation, webhook handling for `checkout.session.completed` and `customer.subscription.deleted`. Stripe is a dependency of hosted mode, not OSS — guarded by `MANAGED_MODE`.
**Flow position:** Step 1 of 1 in stripe flow (**checkout + webhooks**)
**Upstream contract:** `WorkspaceId` from Task 12; quota system from Task 18
**Downstream contract:** Successful webhook sets workspace `plan = 'pro'`; subscription cancellation sets `plan = 'free'`
**Skill:** `adversarial-api-testing`

**Files:**
- Create: `apps/realtime/src/stripe-webhooks.ts`
- Create: `apps/realtime/__tests__/stripe-webhooks.test.ts`
- Modify: `infra/docker-compose.cloud.yml`

- [ ] **Step 1: Write adversarial tests for webhook handler**

  Tests: (a) valid `checkout.session.completed` → workspace plan updated to `pro`; (b) invalid Stripe signature → 400 (replay attack rejected); (c) duplicate event (same `event.id`) → idempotent (no double-upgrade); (d) `customer.subscription.deleted` → workspace plan set back to `free`; (e) unknown event type → 200 with no-op (forward-compat).

  Run: `pnpm --filter @atlasdraw/realtime test stripe-webhooks`
  Expected: FAIL

- [ ] **Step 2: Implement `stripe-webhooks.ts` — signature verification**

  Add a POST route `/webhooks/stripe`. Parse the raw body (must NOT parse as JSON first — Stripe signature requires the raw bytes). Call `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)`. On failure → 400. On success → dispatch to event-specific handler.

  Run: `pnpm --filter @atlasdraw/realtime test stripe-webhooks -- --testNamePattern="invalid signature"`
  Expected: PASS (test b from Step 1)

- [ ] **Step 3: Implement idempotency layer**

  Before handling any event, check Redis Set `stripe:processed_events` for `event.id` (TTL 30 days). If present → return 200 with `{status: "already_processed"}`. If absent → add to set, proceed. This prevents double-upgrades on Stripe's at-least-once delivery.

  Run: `pnpm --filter @atlasdraw/realtime test stripe-webhooks -- --testNamePattern="duplicate event"`
  Expected: PASS (test c from Step 1)

- [ ] **Step 4: Implement event handlers**

  `checkout.session.completed`: read `session.metadata.workspaceId`, call `db.workspaces.update({plan: 'pro', stripeCustomerId: session.customer})`.
  `customer.subscription.deleted`: find workspace by `stripeCustomerId`, set `plan = 'free'`.
  Unknown events: log at `debug` level, return 200 (forward-compat).

  Model: per-workspace seats. Products in Stripe: `price_atlasdraw_pro_5` ($9/mo, ≤5 members), `price_atlasdraw_pro_25` ($19/mo, ≤25 members). Pass the price ID in `session.metadata` so the webhook knows which tier was purchased.

  Run: `pnpm --filter @atlasdraw/realtime test stripe-webhooks`
  Expected: All 5 tests PASS

- [ ] **Step 5: Add `/api/billing/checkout` route**

  Express route: validate `workspaceId` from session, call `stripe.checkout.sessions.create({...})` with `metadata: {workspaceId}`, return `{url: session.url}`. Client redirects to Stripe hosted checkout.

  Run: `curl -s -X POST http://localhost:3001/api/billing/checkout -H "X-Workspace-ID: ws_test" | jq .url`
  Expected: Stripe-hosted checkout URL string (in dev: `https://checkout.stripe.com/...`)

- [ ] **Step 6: Add `stripe-cli` to `docker-compose.cloud.yml`**

  Service: `stripe/stripe-cli`, command `stripe listen --forward-to realtime:3001/webhooks/stripe`. Depends on `realtime` being healthy. This enables local webhook testing without a public tunnel.

  Run: `grep "stripe-cli" infra/docker-compose.cloud.yml`
  Expected: service block present

- [ ] **Step 7: Commit**

  Run: `git add apps/realtime/src/stripe-webhooks.ts apps/realtime/__tests__/ infra/docker-compose.cloud.yml`
  Expected: Clean commit "feat(realtime): Stripe checkout + webhook handler (idempotent, per-workspace seats) [Q4]"

---

### Task 19: AtlasdrawAPI — workspace-scoped methods + auth boundary

**Orient:** Add workspace-awareness to the `AtlasdrawAPI`: the `exportScene()` method must check workspace quotas before exporting; `loadScene()` must validate workspace ownership. This closes the auth boundary between the public API and the hosted-mode backend.
**Flow position:** Step 1 of 1 in api-auth flow (**api-workspace-scope**)
**Upstream contract:** `AtlasdrawAPI` from Task 1; `WorkspaceId` from Task 12; quota enforcer from Task 18
**Downstream contract:** `AtlasdrawAPI` methods that touch server resources carry implicit workspace context
**Skill:** `adversarial-api-testing`

**Files:**
- Modify: `packages/sdk/src/api.ts`
- Create: `packages/sdk/__tests__/api-workspace-auth.test.ts`

- [ ] **Step 1: Write adversarial tests**

  Tests: (a) `exportScene()` called from a workspace over quota → rejects with `QuotaExceededError`; (b) `loadScene()` called with a scene owned by a different workspace → rejects with `UnauthorizedError`; (c) self-host (no workspace context) → all methods proceed without workspace checks; (d) `QuotaExceededError` is structured-clone-compatible (re-runs Task 1 harness on the error shape).

  Run: `pnpm --filter @atlasdraw/sdk test api-workspace-auth`
  Expected: FAIL

- [ ] **Step 2: Add optional `workspaceId` context to `AtlasdrawAPI`**

  `AtlasdrawAPI.withWorkspace(id: WorkspaceId): AtlasdrawAPI` — returns a workspace-scoped proxy. In self-host mode: `withWorkspace()` is a no-op identity function.

  Run: `pnpm --filter @atlasdraw/sdk test api-workspace-auth`
  Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

  Run: `git add packages/sdk/src/api.ts packages/sdk/__tests__/api-workspace-auth.test.ts`
  Expected: Clean commit "feat(sdk): workspace-scoped AtlasdrawAPI methods + auth boundary [Q4/Q11]"

---

### Task 20: Accessibility — keyboard navigation + focus management

**Orient:** Implement keyboard navigation across the editor's three focus contexts: map canvas, Maputnik iframe, and comments panel. This is the "accessibility pass" PRD feature — keyboard nav first.
**Flow position:** Step 1 of 2 in a11y flow (**keyboard-nav** → screen-reader + high-contrast)
**Upstream contract:** Existing editor layout in `apps/atlas-app`; `FocusTrap.tsx` needed by Maputnik (Task 8)
**Downstream contract:** Tab key navigates predictably; Escape key dismisses modals; focus returns to correct element after modal close
**Skill:** `test-driven-development`

`Codebooks: focus-management-across-boundaries` — three independent focus contexts: (1) map canvas + toolbar, (2) Maputnik iframe, (3) comments panel. Focus moves between them on explicit user intent only (keyboard shortcut or click). Tab must not accidentally escape into/out of an iframe.
`Codebooks: input-device-adaptation` — all interactive elements must be reachable with Tab/Shift-Tab, activated with Enter/Space, and dismissable with Escape. Pointer-only interactions are bugs.

**Files:**
- Create: `apps/atlas-app/components/FocusTrap.tsx`
- Create: `apps/atlas-app/__tests__/keyboard-nav.test.tsx`

- [ ] **Step 1: Write keyboard-nav tests**

  Tests: (a) Tab order in toolbar cycles through all tools without escaping to browser chrome; (b) opening comments panel moves focus to first thread; (c) closing comments panel returns focus to previously focused annotation; (d) Escape from Maputnik modal returns focus to map canvas; (e) all toolbar buttons activatable with Enter and Space.

  Run: `pnpm --filter @atlasdraw/atlas-app test keyboard-nav`
  Expected: FAIL

- [ ] **Step 2: Implement `FocusTrap.tsx`**

  Uses `@react-aria/focus` `FocusScope`. Props: `contain: boolean` (trap focus within), `restoreFocus: boolean` (return focus on unmount), `autoFocus: boolean`.

  Used by: `MaputnikModal` (contain + restoreFocus), `CommentsPanel` (autoFocus, no contain).

  Run: `pnpm --filter @atlasdraw/atlas-app test keyboard-nav`
  Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

  Run: `git add apps/atlas-app/components/FocusTrap.tsx apps/atlas-app/__tests__/keyboard-nav.test.tsx`
  Expected: Clean commit "feat(app): FocusTrap + keyboard nav pass [a11y]"

---

### Task 21: Accessibility — screen-reader announcements

**Orient:** Add ARIA live regions so screen reader users hear when features are selected, layers are toggled, and comments are added.
**Flow position:** Step 2 of 2 in a11y flow (keyboard-nav → **screen-reader + high-contrast**)
**Upstream contract:** Selection state from the editor; layer visibility state from `AtlasdrawAPI`
**Downstream contract:** Screen-reader users receive live announcements for selection changes, layer toggles, comment additions
**Skill:** `test-driven-development`

`Codebooks: focus-management-across-boundaries` — announcements must not interfere with focus management; the live region is `aria-live="polite"` to avoid interrupting active input.
`Codebooks: input-device-adaptation` — announcements supplement (not replace) visual feedback; never announce for pointer-only interactions.

**Files:**
- Create: `apps/atlas-app/components/AriaAnnouncer.tsx`
- Create: `apps/atlas-app/styles/high-contrast.css`
- Create: `apps/atlas-app/__tests__/AriaAnnouncer.test.tsx`

- [ ] **Step 1: Write tests for announcements**

  Tests: (a) feature selected → live region text = "Selected: {feature name or type}"; (b) layer hidden → "Layer {name} hidden"; (c) comment added → "New comment from {handle}"; (d) in high-contrast mode, all text elements meet 7:1 contrast ratio (visual regression or CSS variable check).

  Run: `pnpm --filter @atlasdraw/atlas-app test AriaAnnouncer`
  Expected: FAIL

- [ ] **Step 2: Implement `AriaAnnouncer.tsx`**

  Uses `@react-aria/announce` (or a single `aria-live="polite"` region). Export `useAnnounce()` hook. Subscriptions: `onSelectionChange`, `onLayerVisibilityChange`, `onCommentAdded` events piped into the announcer.

- [ ] **Step 3: Add high-contrast CSS**

  CSS custom property overrides for `--color-background`, `--color-foreground`, `--color-accent`. Applied when `prefers-contrast: more` media query fires OR when `data-theme="high-contrast"` attribute is present on `<html>`.

  Run: `pnpm --filter @atlasdraw/atlas-app test AriaAnnouncer`
  Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

  Run: `git add apps/atlas-app/components/AriaAnnouncer.tsx apps/atlas-app/styles/high-contrast.css apps/atlas-app/__tests__/`
  Expected: Clean commit "feat(app): ARIA live announcer + high-contrast mode [a11y]"

---

## Wave 4 — Release-Candidate Gates (serial; all must pass before v1.0 tag)

---

### Task 22: Bundle-size CI gate for `packages/sdk`

**Orient:** Enforce the <300KB gzipped target from `packages/sdk` spec (§4.5) in CI. This is a hard gate — merge blocked if size exceeds 300KB.
**Flow position:** Step 1 of 5 in release-gates flow (**bundle-size** → postmessage-roundtrip → telemetry-guard → hosted-e2e → api-freeze)
**Upstream contract:** Built `packages/sdk` bundle from Tasks 4a/4b
**Downstream contract:** CI passes only if `atlasdraw-embed.js` gzipped ≤ 307200 bytes (300KB)
**Skill:** `none`

**Files:**
- Create: `packages/sdk/.size-limit.json`
- Create: `.github/workflows/bundle-size.yml`

- [ ] **Step 1: Configure size-limit**

  `.size-limit.json`:
  ```json
  [
    {
      "path": "packages/sdk/dist/atlasdraw-embed.js",
      "gzip": true,
      "limit": "300 KB"
    }
  ]
  ```

  Run: `pnpm --filter @atlasdraw/sdk exec size-limit`
  Expected: Output shows current size ≤ 300 KB (or lists what to trim if over)

- [ ] **Step 2: Write GitHub Actions workflow**

  `.github/workflows/bundle-size.yml`: triggers on PRs touching `packages/sdk/`. Steps: checkout, install, build, run `size-limit --json`, fail if over limit.

  Run: `cat .github/workflows/bundle-size.yml | grep -c "size-limit"`
  Expected: ≥2

- [ ] **Step 3: Commit**

  Run: `git add packages/sdk/.size-limit.json .github/workflows/bundle-size.yml`
  Expected: Clean commit "ci: bundle-size gate for packages/sdk (<300KB gzipped)"

---

### Task 23: postMessage round-trip CI test

**Orient:** Run the structured-clone harness (Task 1) in CI on every PR touching `packages/sdk`. This is the "structural test" Q11 mandated: every public `AtlasdrawAPI` method passes a structured-clone round-trip.
**Flow position:** Step 2 of 5 in release-gates flow (bundle-size → **postmessage-roundtrip** → telemetry-guard → hosted-e2e → api-freeze)
**Upstream contract:** `api-structured-clone.test.ts` from Task 1
**Downstream contract:** CI fails if any method returns a non-cloneable value
**Skill:** `none`

**Files:**
- Create: `.github/workflows/postmessage-roundtrip.yml`

- [ ] **Step 1: Write CI workflow**

  Triggers on PRs touching `packages/sdk/`. Steps: checkout, install, run `pnpm --filter @atlasdraw/sdk test api-structured-clone --reporter=verbose`. Fail on any FAIL.

  Run: `pnpm --filter @atlasdraw/sdk test api-structured-clone`
  Expected: All tests PASS (regression check from Task 1)

- [ ] **Step 2: Commit**

  Run: `git add .github/workflows/postmessage-roundtrip.yml`
  Expected: Clean commit "ci: postMessage structured-clone round-trip gate [Q11]"

---

### Task 24: Embed SDK telemetry guard CI test

**Orient:** Enforce ADR 0006's invariant that `packages/sdk` never imports any network-making module. Add a CI check that fails if `packages/sdk/src/` contains imports of `fetch`, `XMLHttpRequest`, `sendBeacon`, or any analytics package.
**Flow position:** Step 3 of 5 in release-gates flow (bundle-size → postmessage-roundtrip → **telemetry-guard** → hosted-e2e → api-freeze)
**Upstream contract:** ADR 0006 from Task 15
**Downstream contract:** CI blocks any PR that accidentally adds telemetry to the embed bundle
**Skill:** `none`

**Files:**
- Create: `.github/workflows/sdk-telemetry-guard.yml`

- [ ] **Step 1: Write the guard script**

  Shell one-liner in CI: `grep -r "fetch\|XMLHttpRequest\|sendBeacon\|posthog\|segment\|amplitude\|mixpanel" packages/sdk/src/ && echo "TELEMETRY DETECTED — violates ADR 0006" && exit 1 || exit 0`

  Run: `grep -r "fetch\|sendBeacon" packages/sdk/src/ | wc -l`
  Expected: 0 (confirm the SDK has no network calls)

- [ ] **Step 2: Write CI workflow**

  Triggers on any PR touching `packages/sdk/src/`. Runs the guard script.

- [ ] **Step 3: Commit**

  Run: `git add .github/workflows/sdk-telemetry-guard.yml`
  Expected: Clean commit "ci: embed SDK telemetry guard [ADR 0006]"

---

### Task 25: Hosted-mode E2E smoke test

**Orient:** Run an end-to-end smoke test of the hosted-mode stack (workspace creation, map creation, billing page, quota enforcement) using Playwright against the `docker-compose.cloud.yml` stack.
**Flow position:** Step 4 of 5 in release-gates flow (bundle-size → postmessage-roundtrip → telemetry-guard → **hosted-e2e** → api-freeze)
**Upstream contract:** All Wave 3 hosted-mode tasks complete
**Downstream contract:** CI passes only if the hosted stack boots cleanly and the 4 smoke scenarios pass
**Skill:** `adversarial-api-testing`

**Files:**
- Create: `.github/workflows/hosted-e2e.yml`
- Create: `apps/atlas-app/e2e/hosted-mode.spec.ts`

- [ ] **Step 1: Write Playwright smoke tests**

  Scenarios:
  (a) Create workspace → see workspace in switcher → create map → map saves.
  (b) Free tier: create 4th map → quota exceeded modal shown.
  (c) Click "Upgrade to Pro" → redirected to Stripe (mock Stripe in CI with `stripe-cli` fixtures).
  (d) Embed widget: `<AtlasdrawEmbed src="..." />` renders in a test host page → map visible within 3s.

  Run: `pnpm playwright test e2e/hosted-mode.spec.ts --headed`
  Expected: 4 tests PASS (manual verify before committing)

- [ ] **Step 2: Write CI workflow**

  `.github/workflows/hosted-e2e.yml`: triggers on `main` push and release PRs. Steps: start `docker-compose.cloud.yml`, wait for health checks, run Playwright tests, tear down.

- [ ] **Step 3: Commit**

  Run: `git add .github/workflows/hosted-e2e.yml apps/atlas-app/e2e/hosted-mode.spec.ts`
  Expected: Clean commit "test(e2e): hosted-mode smoke tests [Q4]"

---

### Task 26: AtlasdrawAPI surface freeze + v1.0 tag

**Orient:** Declare the `AtlasdrawAPI` interface frozen. Write the freeze notice in ADR 0005's "status" field. Tag the repository `v1.0.0`. Phase 7 plugin sandbox builds on this frozen surface.
**Flow position:** Step 5 of 5 in release-gates flow — final step in Phase 6
**Upstream contract:** All Wave 0–4 tasks complete; all CI gates green
**Downstream contract:** `AtlasdrawAPI` interface is a stable contract for Phase 7; `packages/sdk@1.0.0` published to npm
**Skill:** `none`

**Files:**
- Modify: `decisions/0005-sdk-postmessage-contract.md`
- Modify: `packages/sdk/package.json`

- [ ] **Step 1: Update ADR 0005 status to "Accepted — Frozen"**

  Change the `Status:` line from "Draft" to "Accepted — Interface frozen at v1.0.0. Breaking changes require a new ADR."

  Run: `grep "Accepted" decisions/0005-sdk-postmessage-contract.md`
  Expected: line found

- [ ] **Step 2: Bump `packages/sdk` to 1.0.0**

  Run: `pnpm --filter @atlasdraw/sdk version 1.0.0`
  Expected: `packages/sdk/package.json` has `"version": "1.0.0"`

- [ ] **Step 3: Confirm all Wave 4 CI workflows are green on HEAD**

  Before tagging, verify that the commit being tagged has passing status for all four Wave 4 workflows. Do not tag a commit where any gate is amber or failing.

  Run: `gh run list --branch main --limit 10 --json name,status,conclusion | jq '[.[] | select(.name | test("bundle-size|postmessage|telemetry-guard|hosted-e2e"))]'`
  Expected: All four workflows show `"conclusion": "success"` on the same commit SHA

- [ ] **Step 4: Run full test suite locally**

  Run: `pnpm test --recursive`
  Expected: All tests PASS, zero failures

- [ ] **Step 5: Tag and release**

  Run: `git tag v1.0.0 && git push origin v1.0.0`
  Expected: Tag visible on remote; CI release workflow triggered

- [ ] **Step 6: Publish `packages/sdk` to npm**

  Run: `pnpm --filter @atlasdraw/sdk publish --access public`
  Expected: Package `@atlasdraw/sdk@1.0.0` visible at `https://www.npmjs.com/package/@atlasdraw/sdk`

---

## Execution Waves

```
Wave 0 (serial — contracts + policies first; 4 tasks):
  Task 1:  AtlasdrawAPI async-revised interface + ADR 0005   [Q11]
  Task 2:  LayerStyle schema + style-compiler skeleton
  Task 3:  Felt importer format verify/document              [Q13/OQ1 — gates Task 15 only; not Wave-1-blocking]
  Task 4:  ADR 0006 telemetry policy                         [Q4/Q10 — gates Task 4b embed SDK]
  → ALL of Wave 1 depends on Wave 0 completing
  <!-- shape-incorporated 2026-05-03: OQ1 — Task 3 label updated spike→verify/document; gate narrowed to Task 15 only -->

Wave 1 (mostly parallel; serial sub-chains noted):
  Task 4a: Embed SDK — package scaffold + Vite build
  Task 4b: Embed SDK — AtlasdrawEmbed component + mount()    [depends on Task 4a]
  Task 5:  AtlasdrawAPI postMessage bridge                   [depends on Task 4b — serial]
  Task 6:  Comments Yjs second document + server routing
  Task 7:  Comments UI (CommentsPanel + CommentAnchor)        [depends on Task 6]
  Task 8:  Maputnik iframe integration
  Task 9:  Layer styling UI (StylePanel + ColorRampPicker)
  Task 10: Style compiler — categorical + graduated           [depends on Task 2 Wave 0]
  Task 11a: Geocoding — Photon client + LRU cache
  Task 11b: Geocoding — CSV wire-up + config.toml             [depends on Task 11a]
  Task 12: Workspace abstraction (server foundation)
  → Independent clusters: {4a→4b→5}, {6→7}, {8}, {9→10}, {11a→11b}, {12}

Wave 2 (parallel — after Wave 1 completes; 4 tasks):
  Task 13:  Print PDF layout
  Task 14a: Asset library reader + tests
  Task 14b: Asset library fixtures + AssetLibraryPanel        [depends on Task 14a]
  Task 15:  Felt importer implementation                      [depends on Task 3 Wave 0]
  → Task 14b depends on Task 14a; Task 15 depends on Task 3; Tasks 13 and 14a parallel

Wave 3 (two parallel tracks — after Wave 2):
  Track A — Hosted mode (serial within track):
    Task 16: Workspace UI (WorkspaceSwitcher + billing page)  [depends on Task 12]
    Task 17: Per-workspace quota enforcement                  [depends on Task 12]
    Task 18: Stripe checkout + webhook handler                [depends on Tasks 16, 17]
    Task 19: AtlasdrawAPI workspace-scoped methods            [depends on Tasks 12, 17]
  Track B — Accessibility (serial within track):
    Task 20: Keyboard navigation + FocusTrap
    Task 21: Screen-reader announcements + high-contrast      [depends on Task 20]
  → Track A and Track B are fully parallel with each other

Wave 4 (serial — all must pass before v1.0 tag; 5 tasks):
  Task 22: Bundle-size CI gate                    (<300KB gzipped)
  Task 23: postMessage round-trip CI test         (structured-clone harness in CI)
  Task 24: Embed SDK telemetry guard              (grep-check: no network calls in packages/sdk)
  Task 25: Hosted-mode E2E smoke test             (Playwright + docker-compose.cloud.yml)
  Task 26: AtlasdrawAPI surface freeze + v1.0 tag (requires Tasks 22–25 all green)
```

**Total tasks: 30** (Wave 0: 4 tasks, Wave 1: 11 tasks, Wave 2: 4 tasks, Wave 3: 6 tasks, Wave 4: 5 tasks)

---

## Open Questions

These are questions that affect implementation choices. They are flagged for decision before the relevant task begins.

1. **Felt format: ZIP archive or JSON blob?**
   Task 3 is specifically designed to answer this. Block Task 16 on Task 3's answer. If Felt's export is not publicly accessible (requires a Felt account), note in `felt-format-notes.md` and use the public Felt API GeoJSON endpoint as the fallback source.

   **RESOLVED:** There is no public `.felt` binary format. Felt exposes data exclusively through its REST API, which requires a bearer token (OAuth/API key). The Layer Exports API (`GET /api/v2/maps/{map_id}/layers/{layer_id}/get_export_link`) produces GeoPackage or GeoTIFF. The custom export endpoint (`POST /api/v2/maps/{map_id}/layers/{layer_id}/custom_export`) supports GeoJSON, CSV, gpkg, geotiff, pmtiles; the download URL is a `.zip` file (`Felt-Export.zip`) containing the exported data in the requested format. **The importer must target this API, not a proprietary binary format.** Task 3 spike is downgraded from "reverse-engineer format" to "verify API authentication flow and GeoJSON layer schema, produce 3 fixtures via the API." Fixtures require a Felt API key — document this in `felt-format-notes.md` and provide the 3 fixture files as checked-in API response snapshots. Sources: [Felt Layer Exports API](https://developers.felt.com/rest-api/api-reference/layers/layer-exports) (verified 2026-05-03).

2. **LngLat structured-clone behavior.**
   MapLibre's `LngLat` class instances are NOT structured-clone-compatible. The `AtlasdrawAPI` interface (Task 1) already addresses this by typing positions as `[number, number]` tuples. Verify in Wave 0: `structuredClone(new maplibregl.LngLat(0, 0))` — assert `typeof clone.toArray === "undefined"` (clone loses prototype methods silently; does not throw).

   <!-- shape-incorporated 2026-05-03: OQ2 — corrected verification assertion: structuredClone does NOT throw on LngLat; it silently strips prototype. Test must check typeof clone.toArray === "undefined", not expect-throws. -->
   **RESOLVED:** Confirmed — `LngLat` is a class (`export class LngLat`) with instance methods including `toArray()`, `distanceTo()`, `wrap()`, `toBounds()`, and `toString()`. `structuredClone` copies only own enumerable data properties; class prototype methods are stripped and the clone loses its `LngLat` identity. **`structuredClone(new LngLat(0,0))` does NOT throw** — it produces a plain object `{lng:0, lat:0}`. The verification assertion must be `typeof clone.toArray === "undefined"`, not an expected throw. The `[number, number]` tuple approach in `AtlasdrawAPI` is correct and required. Source: [MapLibre `lng_lat.ts` source](https://github.com/maplibre/maplibre-gl-js/blob/main/src/geo/lng_lat.ts) (verified 2026-05-03).

3. **Stripe subscription model: per-seat or per-workspace?**
   Decided: per-workspace seats ($9/mo up to 5 members; $19/mo for 6–25). Revisit at v1.5 if usage data suggests a flat-rate model performs better. Decision recorded in Task 19 implementation notes.

   **RESOLVED:** Decision is pre-made in the plan. Stripe Checkout (hosted page) is sufficient for v1.0 — no embedded payment element required. Per Q4 constraint, Stripe billing ships in Phase 6. No further research needed.

4. **Maputnik origin allowlist in self-host.**
   Self-hosters may run Maputnik at a custom URL. `MAPUTNIK_URL` env var (default `https://maputnik.github.io`) must be configurable. Add to `config.toml`: `[style_editor] maputnik_url = "..."`. Task 8 implementation must read this.

   **RESOLVED:** Resolution is fully specified in the question body. The `config.toml` `[style_editor] maputnik_url` key and env-var pattern is the implementation target. Whether the public `maputnik.github.io` instance accepts incoming `postMessage` is a Key Assumption (see §Key Assumptions item 4) — that verification runs before Task 8, not here.

5. **Comments ACL: can a view-only user post comments?**
   Current design: yes — the comments Y.Doc has separate auth from the scene Y.Doc. Workspace middleware (Task 12) enforces this. Verify that `workspace-middleware.ts` correctly allows `COMMENT_WRITE` permission for viewer-role tokens before Task 6 is declared done.

   **RESOLVED:** Design decision is pre-made in the plan. Verification is a Phase 6 implementation gate (Task 6 acceptance criterion), not an open question. No external research needed.

6. **PDF map canvas capture and tile licensing.**
   `map.getCanvas()` captures the current WebGL canvas as a PNG/JPEG. Basemap tiles from Protomaps (PMTiles) are ODbL-licensed and require attribution in print output. The title block in Task 13's `print-pdf.ts` must include the tile attribution string. Verify this is not skippable.

   **RESOLVED:** Attribution is mandatory and not skippable. OSM ODbL requires attribution in all produced works including PDFs and printed maps. The OSMF Attribution Guidelines (adopted 2021-06-25) state: for PDFs and printed maps, credit must appear beside the map or in a footnote/endnote, **and the URL `https://www.openstreetmap.org/copyright` must be printed out** (not just linked). The required text is `"© OpenStreetMap contributors"` with the URL. For OpenFreeMap tiles, the required attribution is `"© OpenMapTiles | Data from OpenStreetMap"` (per OpenFreeMap's own homepage attribution display). Task 13's `print-pdf.ts` title block must embed both strings as non-removable text. This is a legal obligation under ODbL, not a recommendation. Sources: [OSM Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) §"Books, magazines, and printed maps" (verified 2026-05-03); [OpenFreeMap homepage](https://openfreemap.org) (verified 2026-05-03).

7. **Asset library content licensing audit.**
   Each `.excalidrawlib` fixture in Task 14 must have an auditable MIT provenance. Before shipping, verify that the SVG elements were either drawn in-house or sourced from an explicitly MIT-licensed set (e.g., OpenMoji, game-icons.net with MIT filter). Add `LICENSE.txt` alongside each `.excalidrawlib` file.

   **RESOLVED — proposed sources fail MIT requirement:** Both sources named in the parenthetical are incompatible with MIT:
   - **OpenMoji:** licensed under **CC BY-SA 4.0** (ShareAlike). The ShareAlike clause requires any derivative work to be distributed under the same license — incompatible with bundling in an MIT-licensed package. Source: [OpenMoji homepage](https://openmoji.org) (verified 2026-05-03).
   - **game-icons.net:** licensed under **CC BY 3.0** (attribution required). Not MIT — requires per-author credit in every distribution. Source: [game-icons.net/about](https://game-icons.net/about.html) (verified 2026-05-03).
   **Neither source satisfies the MIT provenance requirement.** Task 14 must use one of: (a) icons drawn in-house, (b) icons from an explicitly MIT or Unlicense/CC0-licensed set (e.g., [Phosphor Icons](https://github.com/phosphor-icons/core) MIT, [Heroicons](https://github.com/tailwindlabs/heroicons) MIT, [Lucide](https://github.com/lucide-icons/lucide) ISC, or public-domain/CC0 SVG collections). The parenthetical example in the original OQ text (`OpenMoji, game-icons.net with MIT filter`) is incorrect and must not be used. Update Task 14's Step 1 to reference an approved MIT/CC0 source.

8. **`size-limit` baseline: what's the current `packages/sdk` size?**
   Task 4 will establish the initial bundle. If the first build exceeds 300KB, identify which dependency is over-contributing (likely MapLibre at ~200KB gzipped — acceptable). The hard question is whether `renderStaticScene` from `packages/excalidraw` adds too much. If it does, evaluate extracting only the canvas-drawing primitives (< 10KB). Make this decision in Task 4 Step 4 before configuring size-limit.

   **RESOLVED:** Cannot be answered before the build exists — deferred by design to Task 4 Step 4. No pre-research possible. The decision gate is: first build → measure → if >300KB identify over-contributing dep → configure size-limit accordingly. This is an implementation-time decision, not a pre-phase open question.

9. **Felt API rate limits and bearer token rotation policy.** <!-- shape-incorporated 2026-05-03: new OQ surfaced by OQ1 resolution — API-only access raises production concerns not present with a file format -->
   OQ1 established that Task 15's importer calls the Felt Layer Exports API (bearer token required). Before shipping the importer UI: (a) what are the Felt API rate limits for export endpoints? (b) does the user-supplied bearer token expire, and if so what is the TTL and rotation mechanism? (c) should the importer expose a configurable API key field in `config.toml`, or require the user to supply it per-import session?

   **STILL OPEN — escalated at project level.** Block Task 15 Step 2 (production hardening) on this answer. Minimum acceptable resolution: document rate limit in `felt-format-notes.md` and add a `[felt_importer] api_key = ""` entry to `config.toml` with a note that a blank value disables the importer. Source: [Felt API docs](https://developers.felt.com/rest-api) — verify rate-limit headers (`X-RateLimit-Limit`, `Retry-After`) in Task 3 Step 1 and record findings.

---

## Artifact Manifest

<!--MANIFEST:START-->
| Artifact | Type | Path | Produced by | Status |
|---|---|---|---|---|
| AtlasdrawAPI interface (async-revised) | TypeScript interface | `packages/sdk/src/api.ts` | Task 1 | Planned |
| AtlasdrawAPI types | TypeScript | `packages/sdk/src/api-types.ts` | Task 1 | Planned |
| Structured-clone test harness | Test | `packages/sdk/__tests__/api-structured-clone.test.ts` | Task 1 | Planned |
| ADR 0005 — postMessage contract | Decision record | `decisions/0005-sdk-postmessage-contract.md` | Task 1 | Planned |
| LayerStyle schema | TypeScript | `packages/basemap/src/layer-style-types.ts` | Task 2 | Planned |
| Style compiler (skeleton → full) | TypeScript | `packages/basemap/src/style-compiler.ts` | Tasks 2, 10 | Planned |
| Felt format notes | Decision record | `docs/decisions/felt-format-notes.md` | Task 3 | Planned |
| Felt test fixtures (3×) | Test fixtures | `packages/data/fixtures/felt/` | Task 3 | Planned |
| AtlasdrawEmbed component | React component | `packages/sdk/src/AtlasdrawEmbed.tsx` | Task 4 | Planned |
| Embed vanilla mount() | TypeScript | `packages/sdk/src/mount.ts` | Task 4 | Planned |
| Embed SDK bundle | Built artifact | `packages/sdk/dist/` | Task 4 | Planned |
| SRI hash | Text file | `packages/sdk/dist/sri.txt` | Task 4 | Planned |
| API postMessage bridge | TypeScript | `packages/sdk/src/api-bridge.ts` | Task 5 | Planned |
| Comments Yjs document | TypeScript | `apps/realtime/src/comments-doc.ts` | Task 6 | Planned |
| CommentsPanel | React component | `apps/atlas-app/components/CommentsPanel.tsx` | Task 7 | Planned |
| CommentAnchor | React component | `apps/atlas-app/components/CommentAnchor.tsx` | Task 7 | Planned |
| useComments hook | React hook | `apps/atlas-app/hooks/useComments.ts` | Task 7 | Planned |
| MaputnikModal | React component | `apps/atlas-app/components/MaputnikModal.tsx` | Task 8 | Planned |
| MaputnikBridge | TypeScript | `apps/atlas-app/components/MaputnikBridge.ts` | Task 8 | Planned |
| style-import-export | TypeScript | `packages/basemap/src/style-import-export.ts` | Task 8 | Planned |
| StylePanel | React component | `apps/atlas-app/components/StylePanel.tsx` | Task 9 | Planned |
| Photon geocoding client | TypeScript | `packages/data/src/geocoding/photon-client.ts` | Task 11 | Planned |
| Geocoding LRU cache | TypeScript | `packages/data/src/geocoding/geocoding-cache.ts` | Task 11 | Planned |
| config.toml [geocoding] section | Config | `apps/atlas-app/config.toml` | Task 11 | Planned |
| Workspace abstraction | TypeScript | `apps/atlas-app/lib/workspace.ts` | Task 12 | Planned |
| Workspace middleware | TypeScript | `apps/realtime/src/workspace-middleware.ts` | Task 12 | Planned |
| Print PDF compositor | TypeScript | `apps/atlas-app/lib/print-pdf.ts` | Task 13 | Planned |
| PrintDialog | React component | `apps/atlas-app/components/PrintDialog.tsx` | Task 13 | Planned |
| Asset library reader | TypeScript | `packages/data/src/asset-library.ts` | Task 14 | Planned |
| Wildfire icon library | .excalidrawlib | `packages/data/fixtures/libraries/wildfire-icons.excalidrawlib` | Task 14 | Planned |
| Transit symbol library | .excalidrawlib | `packages/data/fixtures/libraries/transit-symbols.excalidrawlib` | Task 14 | Planned |
| Hazard marker library | .excalidrawlib | `packages/data/fixtures/libraries/hazard-markers.excalidrawlib` | Task 14 | Planned |
| ADR 0006 — telemetry policy | Decision record | `decisions/0006-telemetry.md` | Task 15 | Planned |
| Felt importer | TypeScript | `packages/data/src/felt.ts` | Task 16 | Planned |
| WorkspaceSwitcher | React component | `apps/atlas-app/components/WorkspaceSwitcher.tsx` | Task 17 | Planned |
| Billing page | React page | `apps/atlas-app/pages/billing.tsx` | Task 17 | Planned |
| Quota enforcer | TypeScript | `apps/realtime/src/quota-enforcer.ts` | Task 18 | Planned |
| Stripe webhooks handler | TypeScript | `apps/realtime/src/stripe-webhooks.ts` | Task 19 | Planned |
| docker-compose.cloud.yml (updated) | Infrastructure | `infra/docker-compose.cloud.yml` | Task 19 | Planned |
| AtlasdrawAPI workspace methods | TypeScript | `packages/sdk/src/api.ts` (modified) | Task 20 | Planned |
| FocusTrap component | React component | `apps/atlas-app/components/FocusTrap.tsx` | Task 21 | Planned |
| Keyboard nav tests | Test | `apps/atlas-app/__tests__/keyboard-nav.test.tsx` | Task 21 | Planned |
| AriaAnnouncer component | React component | `apps/atlas-app/components/AriaAnnouncer.tsx` | Task 22 | Planned |
| High-contrast CSS | Stylesheet | `apps/atlas-app/styles/high-contrast.css` | Task 22 | Planned |
| Bundle-size CI workflow | GitHub Actions | `.github/workflows/bundle-size.yml` | Task 23 | Planned |
| postMessage round-trip CI | GitHub Actions | `.github/workflows/postmessage-roundtrip.yml` | Task 24 | Planned |
| Telemetry guard CI | GitHub Actions | `.github/workflows/sdk-telemetry-guard.yml` | Task 25 | Planned |
| Hosted-mode E2E tests | Playwright | `apps/atlas-app/e2e/hosted-mode.spec.ts` | Task 26 | Planned |
| Hosted-mode E2E CI workflow | GitHub Actions | `.github/workflows/hosted-e2e.yml` | Task 26 | Planned |
<!--MANIFEST:END-->

---

## Key Assumptions (verify at each review gate)

1. `packages/excalidraw/scene/renderStaticScene` is a pure function with no React dependency — safe to extract into `packages/sdk`. Verify: `grep -r "renderStaticScene" packages/excalidraw/src/` before Task 4 Step 3.
2. Phase 5 `apps/realtime` uses `y-websocket` and supports multiple Y.Doc namespaces on the same WebSocket server. Verify before Task 6.
3. Stripe Checkout (hosted page) is sufficient for v1.0 — no embedded payment element needed. If a UI designer requests an embedded checkout, treat it as a v1.5 scope change.
4. Maputnik's public instance (`maputnik.github.io`) accepts incoming `postMessage` for `SET_STYLE`. Verify via a quick browser test before Task 8. If Maputnik requires a self-hosted instance, add a `maputnik` container to `docker-compose.cloud.yml`.
5. MapLibre's `getCanvas()` returns a complete snapshot including tile content (no CORS issue for self-hosted PMTiles). Verify before Task 13.
6. `.excalidrawlib` schema is stable in the vendored `packages/excalidraw` version. Do not assume upstream won't change it — check `packages/excalidraw/CHANGELOG.md` before Task 14.

---

## Shape Changes Summary

*Appended by shape-incorporator — 2026-05-03*

| # | Section edited | Change | Cited Q |
|---|---|---|---|
| 1 | Feature 8 file structure | Renamed all `.felt` fixtures to `.felt.json`; updated comment to "GeoJSON API response snapshot" | OQ1 |
| 2 | Execution Waves — Wave 0 | Task 3 label changed from "format spike" to "format verify/document"; gate annotation narrowed to "gates Task 15 only; not Wave-1-blocking" | OQ1 |
| 3 | Task 1 Step 1 | Added inline correction: `structuredClone` does NOT throw on `LngLat`; test must assert `typeof clone.toArray === "undefined"` not expect-throws | OQ2 |
| 4 | Task 4b Step 4b (new) | Added new step requiring non-removable attribution DOM overlay in embed iframe; exact string `© OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles`; `attribution` prop controls visibility only, never removal | OQ6 |
| 5 | Task 13 Step 2 | Embedded exact ODbL-required attribution string; raised test count from 4 to 5; stated legal obligation explicitly | OQ6 |
| 6 | Task 14b Step 4 (renamed) + new Step 4 CI guard | Renamed old Step 4 to Step 5; added new Step 4 extending `scripts/check-license.sh` to scan fixture `LICENSE.txt` files and reject non-MIT/CC0 SPDX identifiers as CI gate; annotated `Skill: adversarial-api-testing` | OQ7 |
| 7 | Task 15 Step 1 | Fixture filenames corrected from `.felt` to `.felt.json` | OQ1 |
| 8 | Open Questions #2 | Corrected verification assertion wording from "expected to throw" to `typeof clone.toArray === "undefined"`; updated RESOLVED block to match | OQ2 |
| 9 | Open Questions #9 (new) | Added new STILL OPEN question: Felt API rate limits, bearer token TTL/rotation, and `config.toml` key field; escalated at project level; blocks Task 15 Step 2 | OQ1 (surfaced) |

**Structural edit count: 9**
**Edited sections: Feature 8 file structure, Execution Waves, Task 1, Task 4b, Task 13, Task 14b, Task 15, Open Questions #2, Open Questions #9**
**Escalations: OQ9 (Felt API rate limits + token policy) — STILL OPEN at project level; block Task 15 Step 2**
**No wave restructuring: Task 3 stays Wave 0, Task 15 stays Wave 2; topology unchanged. Wave-1-blocking annotation removed from Task 3 gate (scope only, not order).**
