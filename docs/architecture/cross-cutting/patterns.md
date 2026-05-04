# Atlasdraw — Architectural Patterns

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.
**Schema:** codebase-mapping-schema.md § Patterns
**Last updated:** 2026-05-03

---

## Overview

This document catalogs the load-bearing architectural patterns that recur across two or more subsystems in Atlasdraw. Each entry names the pattern, locates it in the codebase, explains why it was chosen, and records what alternatives were rejected.

[CONFIDENCE: high] marks claims that follow directly from the tech spec, PRD, or open-questions resolutions. [CONFIDENCE: med] marks claims derived from phase plans where the spec is silent. [CONFIDENCE: low] marks extrapolations.

---

## P-01 — Two Stacked Rendering Surfaces

**Name:** Dual-canvas stacking with `pointerEvents` toggle
**Where used:** `apps/atlas-app/components/MapEditor.tsx`, Phase 1 core
**Source:** Tech Spec §0 "Mental Model", Phase 1 plan Flow A/B [CONFIDENCE: high]

### Description

The editor presents a single DOM viewport containing two full-bleed rendering surfaces stacked via CSS `position: absolute`:

1. **MapLibre GL JS canvas** (bottom layer) — renders the geographic basemap and all data layers (GeoJSON sources/layers). Owns geographic camera state.
2. **Excalidraw canvas** (top layer) — renders annotations (shapes, text, arrows, pins). Owns the drawing interaction surface.

The two canvases share a viewport but have independent coordinate systems. Switching between "map navigation mode" and "drawing mode" is implemented by toggling `pointer-events: none` on the Excalidraw layer:

- **Map mode:** Excalidraw layer has `pointer-events: none` → map receives all pointer input → panning and zooming work normally.
- **Drawing mode:** Excalidraw layer has `pointer-events: auto` → Excalidraw captures pointer events → drawing tools are active.

### Why chosen

Excalidraw's renderer is a canvas element that cannot be made transparent in the sense of "pass events through when not drawing." The toggle is the simplest mechanism that avoids re-implementing either renderer. It was confirmed workable in Phase 0 research and cross-browser hardened in Phase 1 Task 17.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Single SVG/Canvas renderer combining geo + annotations | Would require reimplementing Excalidraw's entire interaction model. Out of scope. |
| Excalidraw as a React overlay (position: fixed, no canvas) | Excalidraw is canvas-native; DOM overlay loses performance and hit-test accuracy. |
| MapLibre custom layer implementing Excalidraw draw calls | MapLibre custom layers are WebGL; Excalidraw is 2D Canvas. Context mismatch. |

### Cross-browser hazard

Pointer events, wheel events, and touch events behave differently across Chrome, Firefox, Safari, and iOS Safari. Phase 1 Task 17 dedicates a hardening week to this. See `docs/test-matrix/phase-1.md`.

---

## P-02 — Discriminated Union Geo-Anchor (`GeoAnchor`)

**Name:** Discriminated union on `kind` field for element geographic anchoring
**Where used:** `packages/geo/types.ts`, consumed by `CoordinateSync`, all geo-aware tools
**Source:** Tech Spec §3.1, Phase 1 plan Task 4 [CONFIDENCE: high]

### Description

Every Excalidraw element that participates in geo-projection carries a `customData.geo` field typed as `GeoCustomData`:

```ts
export type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };

export type GeoCustomData = {
  geo: GeoAnchor;
  scaleMode: "geographic" | "screen" | "hybrid";
  schemaVersion: 1;
  projection: "mercator";   // reserved; always "mercator" in v1 (Q12)
};
```

The `kind` discriminant drives the projection logic in `CoordinateSync.projectElement()`:
- `point` → single `map.project([lng, lat])` call
- `bbox` → `map.project(nw)` + `map.project(se)`, derives width/height
- `polyline` → project each coordinate, offset to element-local space

`zRef` records the MapLibre zoom level at element creation time, anchoring the "natural size" for `screen` and `hybrid` scale modes.

### Why chosen

Discriminated unions make exhaustive matching typesafe (TypeScript `switch` on `kind` gets compile-time exhaustiveness). The three kinds cover all Excalidraw element shapes without over-generalizing. Adding a fourth kind (`polygon`) in v2 requires no schema migration — add a variant and update `projectElement`.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Flat `{ lng, lat, lng2?, lat2?, coords? }` | Ambiguous at runtime; no compiler-enforced exhaustiveness. |
| GeoJSON `Feature` as the anchor | Carries unnecessary GeoJSON envelope weight; `CoordinateSync` doesn't need it. |
| Storing pixel position as canonical (no geo anchor) | Breaks on every camera change; geo anchor must be the source of truth. |

### Field name constraint

[CONFIDENCE: high] The field is `customData.geo`, not `customData.geoAnchor`. See cross-phase-audit MISMATCH-3. Any code or documentation using `geoAnchor` as the field name is wrong.

---

## P-03 — Annotation vs. Data Layer Dichotomy

**Name:** Hard semantic split between Excalidraw annotations and MapLibre data layers
**Where used:** Entire application; implemented as `LayerRegistry` in `packages/data`, Phase 2
**Source:** Tech Spec §2 (Mental Model), Phase 2 plan preamble [CONFIDENCE: high]

### Description

Atlasdraw treats two fundamentally different kinds of content as non-interchangeable by default:

| Property | Annotation | Data Layer |
|---|---|---|
| Renderer | Excalidraw canvas | MapLibre GL layer |
| Storage format | Excalidraw scene elements | GeoJSON `FeatureCollection` |
| Conflict resolution | LWW (version + versionNonce) | Yjs CRDT |
| Coordinate source of truth | `customData.geo` → projected to `x/y` | GeoJSON coordinates direct |
| Style | Excalidraw element properties | MapLibre layer style spec |
| Collab channel | `SCENE_UPDATE` Socket.IO | `DATA_LAYER_OP` Yjs |

The `LayerRegistry` (introduced Phase 2) is the authoritative registry of all data layers. It tracks `{ id, featureCollection, style, visible, locked }` per layer and is the single source of truth for what MapLibre sources/layers exist.

Conversion between the two is possible for geometric shapes (polygon, polyline, rectangle, circle) via `annotationToFeatureCollection()` in `packages/tools/convert.ts`. Text and arrow annotations have no lossless GeoJSON projection and cannot be converted.

### Why the split is load-bearing

The split is not cosmetic. The two rendering paths, conflict-resolution strategies, and collaboration protocols are incompatible. Blurring the distinction leads to: applying LWW to structured GeoJSON (losing concurrent edits), running Yjs CRDT on freehand sketch elements (over-engineering), or trying to render GeoJSON in Excalidraw's canvas (coordinate system mismatch). The `LayerRegistry` enforces the boundary.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Single unified element model (everything is an Excalidraw element) | GeoJSON data layers can have 50k+ features; Excalidraw scene cannot render that. |
| Everything as GeoJSON in MapLibre | Loses Excalidraw's free-form annotation capabilities entirely. |
| Dynamic dispatch (decide per-element at runtime) | Eliminates the compiler-enforced boundary; collab protocols diverge. |

---

## P-04 — Dual Collaboration Protocols on One Connection

**Name:** Excalidraw LWW for annotations + Yjs CRDT for data layers, multiplexed over one Socket.IO connection
**Where used:** `apps/realtime/`, `apps/atlas-app/state/collab.ts`, Phase 5
**Source:** Tech Spec §5.1, Q9 resolution [CONFIDENCE: high]

### Description

A single Socket.IO connection carries four event channels with different semantics:

| Channel | Payload | Semantics | Rate |
|---|---|---|---|
| `SCENE_UPDATE` | Encrypted Excalidraw element diff | LWW (version + versionNonce) | max 10/s |
| `DATA_LAYER_OP` | Yjs update bytes | CRDT merge | unbounded |
| `MAP_CAMERA_UPDATE` | `{lng, lat, zoom, bearing, pitch}` | LWW | throttled 30 Hz |
| `CURSOR` | `{userId, lngLat, color}` | LWW | throttled 60 Hz |
| `COMMENT` | Encrypted comment payload | versioned LWW | max 5/s |

The relay (`apps/realtime`) is protocol-agnostic for `DATA_LAYER_OP` — it treats Yjs bytes as opaque and relays them. The relay never decrypts `SCENE_UPDATE` or `COMMENT` payloads.

Q9 resolved the question of whether to use separate WebSocket connections: the decision was **one Socket.IO connection, multiplexed**, to avoid the complexity of two connection lifecycles, two reconnection strategies, and two auth handshakes per room.

### Why chosen

Excalidraw's existing LWW is well-proven for freehand sketching where last-write-wins is acceptable (concurrent annotation edits rarely conflict meaningfully). Data layers are structured GeoJSON where a user editing polygon vertices can have work clobbered by LWW if two users touch different vertex arrays simultaneously. CRDT solves this at the cost of additional complexity — applied only where the cost is justified.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Yjs CRDT for everything | Excalidraw's upstream is LWW; adopting Yjs for annotations means forking conflict-resolution logic and losing upstream merge compatibility. |
| LWW for data layers | Users lose concurrent GeoJSON edits in ways that are hard to undo. |
| Two separate WebSocket connections | Doubled reconnection complexity, doubled auth surface, no gain (Q9). |

---

## P-05 — `postMessage`-Safe API Surface (AtlasdrawAPI)

**Name:** Structured-clone-friendly public API from v1
**Where used:** `packages/sdk/src/api-types.ts`, `packages/sdk/src/AtlasdrawEmbed.tsx`, Phase 6; enforced in Phase 7 Worker host
**Source:** Q11 resolution, Phase 6 Task 1, ADR `0005-sdk-postmessage-contract.md` [CONFIDENCE: high]

### Description

`AtlasdrawAPI` — the public surface exposed to embed consumers and plugin authors — is designed from Phase 6 (v1.0) to be postMessage-safe:

- All methods are `async` or fire-and-forget (no synchronous returns of non-cloneable values).
- All return values are JSON-serializable (no DOM nodes, no class instances, no functions, no `Map`/`Set` objects).
- All arguments are structured-clone-compatible.

A structural test enforces this: every public method on `AtlasdrawAPI` must pass a structured-clone round-trip on its arguments and return value. CI fails if a method is added that violates this contract.

In Phase 7, this constraint pays off: the same `AtlasdrawAPI` surface is exposed to plugin Workers via a `postMessage` bridge without any API changes. Plugin authors use the same types they would use in a React embedding context.

### Why chosen

Retrofitting a synchronous API to be postMessage-safe in v1.5 would break every plugin author's contract. Cheaper to constrain v1 today than to publish a stable contract that contradicts the v1.5 sandbox (Q11 rationale).

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Rich synchronous API in v1, wrapper layer in v1.5 | Creates a permanently divergent API surface: native consumers get one API, Worker consumers get a wrapper. Plugin authors face two contracts. |
| Defer API design until Phase 7 | Phase 6 ships the embed SDK; the API must be published. Deferral means publishing an unstable contract. |

---

## P-06 — Vendored Upstream + Patch Journal

**Name:** Fork-with-patch-journal for Excalidraw packages
**Where used:** `packages/excalidraw/` (vendored), `packages/element/`, `packages/math/`, `packages/common/`; `decisions/upstream-patches.md`; CI guard
**Source:** Q6 resolution, ADR `0004-upstream-merge-policy.md`, Phase 0 Task 3 [CONFIDENCE: high]

### Description

Atlasdraw is a fork of `excalidraw/excalidraw`. Rather than depending on `@excalidraw/excalidraw` via npm (which would prevent the `customData.geo` hook points needed for geo anchoring), the Excalidraw packages are vendored into the monorepo under `packages/`.

Every patch applied to vendored files is required to be documented in `decisions/upstream-patches.md`. A CI guard (`infra/ci/patch-journal-guard.sh` or equivalent) validates that any PR modifying vendored files has a corresponding entry in the patch journal. PRs that modify vendored files without a journal entry fail CI.

A quarterly upstream-merge review is scheduled per ADR `0004-upstream-merge-policy.md`. Hard exit thresholds (patch divergence exceeds N files, or upstream API breaks are detected) trigger an architecture review. The cadence is quarterly, not continuous, to avoid perpetual merge conflict churn.

### Why chosen

`npm install @excalidraw/excalidraw` provides no stable hooks for `customData` mutation at the rendering level. The fork is necessary. The patch journal prevents the fork from silently accumulating undocumented divergence that becomes unmergeable at the quarterly review.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| `npm install`, monkey-patch at runtime | No stable hook points for geo anchor injection in the render loop. |
| Fork with no merge policy | Guaranteed permanent divergence. Upstream bug fixes and features never land. |
| Continuous upstream tracking (merge every PR) | Merge conflicts at high frequency; too expensive for a small team. |

---

## P-07 — Hybrid Basemap Default

**Name:** Bundled minimal PMTiles for self-host + opt-in OpenFreeMap for hosted
**Where used:** `packages/basemap/`, `infra/docker-compose.yml`, `BasemapRegistry`
**Source:** Q3 resolution, Phase 4 plan [CONFIDENCE: high]

### Description

The default basemap strategy is split by deployment context:

- **Self-hosted (docker-compose default):** Ships `infra/data/world-low-zoom.pmtiles` (zoom 0–6, ~200 MB). `BasemapRegistry` defaults to `local-pmtiles` when `realtime.enabled = false` and self-host config is detected. First run shows a world map without any network calls.
- **Hosted flagship (`app.atlasdraw.org`):** `BasemapRegistry` defaults to `openfreemap-bright` when `[basemap.allow_remote] = true` is explicit in config.

`make basemap-world` downloads the full ~120 GB world PMTiles for self-hosters who want full zoom coverage.

The PRD's §5 principle ("no telemetry that calls home, no required basemap key") drove this. A docker-compose default that phones home to `tiles.openfreemap.org` on first run violates that principle. The hybrid resolves both concerns.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Always OpenFreeMap | Violates PRD §5 zero-call-home principle for self-hosters. |
| Always bundled PMTiles (full world) | 120 GB is not shippable in a Docker image. Violates "single Docker command" principle. |
| No default basemap (user must configure) | Terrible first-run experience; "blank canvas" is confusing. |

---

## P-08 — Dual Docker-Compose Stacks

**Name:** Minimal 3-service + full 5-service compose profiles
**Where used:** `infra/docker-compose.minimal.yml` (3 svc), `infra/docker-compose.yml` (5 svc), `infra/docker-compose.cloud.yml`
**Source:** Q10 resolution, Phase 4 plan Task 10/11 [CONFIDENCE: high]

### Description

Two compose profiles serve different deployment contexts:

| File | Services | Use case |
|---|---|---|
| `docker-compose.minimal.yml` | `atlas-app`, `storage`, `tile-server` | Single-player self-host, no realtime |
| `docker-compose.yml` | + `realtime`, `redis` | Multi-user collaboration |
| `docker-compose.cloud.yml` | + `stripe-cli` | Hosted-mode local development (Phase 6) |

The minimal stack deliberately excludes `realtime` and `redis` so a solo user running the app locally has a three-service footprint. Q10 confirmed this split is the right default.

### Why chosen

The PRD positions Atlasdraw as "single-player first-class." A mandatory `redis` + `realtime` container for users who never collaborate imposes unnecessary operational overhead. The split makes the default case simple and the collaboration case explicit.

---

## P-09 — Per-Package License Split

**Name:** Three-way AGPL/MPL/MIT license split aligned to package role
**Where used:** Root `LICENSING.md`, per-package `package.json` `"license"` field, CI SPDX check
**Source:** Q5 resolution, ADR `0002-license-split.md`, Phase 0 Task 2 [CONFIDENCE: high]

### Description

| License | Packages/Apps | Rationale |
|---|---|---|
| AGPL-3.0 | `apps/atlas-app`, `apps/realtime` | Server-side and SaaS use triggers copyleft; protects the hosted product |
| MIT | `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data` | Embed SDK and utilities must be freely embeddable without license obligation |
| MPL-2.0 | `packages/basemap`, `packages/tools` | File-level copyleft: forks must share basemap/tool improvements, but can link freely |

CI enforces: every `package.json` must have a `"license"` field matching a valid SPDX identifier. PRs that add a package without a license field fail CI. Plugin manifests (Phase 7) also require a valid SPDX `license` field; validation throws at install time.

---

## P-10 — Stub-Then-Wire

**Name:** Shipping a typed stub that satisfies the contract but has no implementation, with a named gate that triggers wiring
**Where used:** `packages/data/src/yjs-crypto.ts` (Phase 5 stub → Phase 6 wire per E-01), `decisions/0005-sdk-postmessage-contract.md` (Phase 0 stub → Phase 6 content)
**Source:** Phase 5 produces contract table, E-01 escalation [CONFIDENCE: high]

### Description

When a feature's implementation depends on an open architectural decision (an escalation), Atlasdraw ships a stub:

1. The stub file exists with the correct exported API (`encryptUpdate(bytes): Uint8Array`, `decryptUpdate(bytes): Uint8Array`).
2. The stub implementation is a no-op or identity (returns input unchanged).
3. Tests cover the stub's API contract, not its implementation.
4. The real gate condition (E-01 resolution: Option A or Option B for Yjs E2EE) is documented in the Phase 5 → Phase 6 contract table.

When Phase 6 resolves E-01:
- **Option A selected (server-trusted is acceptable):** Drop `yjs-crypto.ts`, remove stub, update ADR.
- **Option B selected (client-side encryption needed):** Wire `yjs-crypto.ts` against the AES-GCM key from the room URL fragment.

This pattern prevents Phase 5 from being blocked by an unsettled architectural decision while ensuring Phase 6 cannot forget to close the gate.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Block Phase 5 on E-01 resolution | Delays three months of parallel work on a decision that can be deferred. |
| Wire the real implementation speculatively | Commits to an approach (Option B) before the threat model ADR is reviewed. |

---

## P-11 — Worker Prelude Sandbox Hardening

**Name:** Nulling or wrapping dangerous Worker globals before plugin entry point executes
**Where used:** `packages/plugin-host/src/PluginPermissions.ts`, Phase 7 Task 2
**Source:** Phase 7 research notes Q: W0-1b, Phase 7 plan Task 2 [CONFIDENCE: high]

### Description

Web Workers retain access to `self.fetch`, `self.XMLHttpRequest`, `self.WebSocket`, and `self.importScripts` by default. These are escape vectors for arbitrary code run by a plugin. The Worker prelude — code that executes before the plugin's entry point is loaded — overrides or deletes these globals:

```ts
// PluginPermissions.ts — Worker prelude (injected before plugin entry)
self.fetch = createPermissionCheckedFetch(grantedPermissions);
self.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest;
self.WebSocket = undefined as unknown as typeof WebSocket;
self.importScripts = () => { throw new Error("importScripts not permitted in Atlasdraw plugins"); };
// dynamic import() cannot be blocked in JS; rely on CSP script-src
```

`fetch` is replaced with a permission-checked wrapper that validates the requested host against the plugin's declared `fetch:<host>` permissions. All other network primitives are set to `undefined` or throw.

**Known limitation:** This is defense-in-depth, not origin isolation. A plugin running in a same-origin Worker can still reach same-origin endpoints. True isolation requires hosting the plugin Worker in a cross-origin iframe on a separate subdomain (`plugins.atlasdraw.app`). This is the **v2 plugin hardening milestone**, explicitly recorded in the Phase 7 produces contract.

### Permission grammar

`PermissionId` union: `"read:layers" | "read:camera" | "write:layers" | "fetch:<host>"`

`fetch:*` wildcard is explicitly disallowed at manifest validation time.

---

## P-12 — Schema-Version + Projection Field (Forward-Compat Sentinel)

**Name:** Reserved fields in `GeoCustomData` that assert invariants today and enable migration tomorrow
**Where used:** `packages/geo/types.ts`, `CoordinateSync.ts`
**Source:** Q12 resolution, ADR `0003-coord-system.md` [CONFIDENCE: high]

### Description

`GeoCustomData` carries two fields that are reserved for future expansion:

```ts
export type GeoCustomData = {
  geo: GeoAnchor;
  scaleMode: "geographic" | "screen" | "hybrid";
  schemaVersion: 1;        // bumped on breaking geo schema changes
  projection: "mercator";  // reserved; always "mercator" in v1
};
```

`CoordinateSync` contains an assertion:

```ts
if (geo.projection !== "mercator") {
  throw new Error(`Unsupported projection: ${geo.projection}. This build only handles Mercator.`);
}
```

When MapLibre globe mode (v1.5+) lands, `projection` can take `"globe"` and `CoordinateSync` gains a globe-aware projection path. Without the reserved field, adding globe support requires a data migration on all existing `customData.geo` entries.

`schemaVersion: 1` is the migration version indicator. Any breaking change to the `GeoAnchor` shape increments it; a migration function handles old documents.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Add `projection` in v1.5 when needed | Requires data migration for all existing maps. Free today, expensive later. |
| No `schemaVersion` | Silent data corruption when old documents meet new code that expects different field shapes. |
