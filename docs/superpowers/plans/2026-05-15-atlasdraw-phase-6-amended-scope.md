# Atlasdraw Phase 6 — Amended Scope (v1.0 standalone app)

**Plan date:** 2026-05-15
**Status:** Ready to execute
**Supersedes scope of:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-6-v1-embeds-comments.md`
**Decision:** Q-P6-1 in `docs/decisions/phase-6-research-notes.md` §"Locked Decisions (Phase 6 amendment, 2026-05-15)"

## Why this amendment exists

The original Phase 6 plan was framed as the "Felt-class v1.0" release — a bundle that included an Embed SDK, AtlasdrawAPI postMessage contract, and Felt-format importer. Atlasdraw is only *inspired by* Felt; it is not a Felt-compatible product and does not ship a third-party automation API. This amendment cuts:

| Original task | Cut reason |
|---|---|
| Task 1 — AtlasdrawAPI types + ADR-0005 | No third-party automation surface in v1.0 |
| Task 3 — Felt importer discovery | Not chasing Felt compatibility |
| Task 4a — Embed SDK package scaffold | No SDK product |
| Task 4b — Embed SDK component | No SDK product |
| Task 5 — Embed SDK postMessage bridge | Collapses with API drop |
| Task 15 — Felt importer implementation | Not chasing Felt compatibility |
| Task 19 — AtlasdrawAPI workspace-scoped methods | Collapses with API drop |
| Task 22 — Bundle-size CI gate for `packages/sdk` | No SDK package |
| Task 23 — postMessage round-trip CI | No postMessage surface |
| Task 24 — Embed SDK telemetry guard CI | No SDK package |
| Task 26 — AtlasdrawAPI surface freeze + v1.0 tag | v1.0 tag stays; API freeze does not |

Original-plan **Task 2** (LayerStyle schema + style-compiler skeleton) is also redundant — `LayerStyle` already exists in `@atlasdraw/basemap` and is consumed by `layerRegistry.ts`. Folded into the kept Task 10 (style-compiler expression work).

## What survives — 14 tasks across 5 waves

Tasks below are numbered fresh (A1–A14) to avoid confusion with the original plan's T1–T26. The "Source" column points to the original task spec that survives unchanged (read it for full implementation detail).

### Wave 0 — Foundations (serial)

| ID | Title | Source | Notes |
|---|---|---|---|
| **A1** | ADR-0011 — Hosted-mode telemetry (extends ADR-0006) | Original T4 (adapted) | ADR-0006 already exists (backfilled Phase 4 T17) and remains authoritative for OSS/self-host. ADR-0011 satisfies its deferred §Follow-ups by adding the hosted-mode (`MANAGED_MODE=true`) posture — server-side `pino` operational events only, no client beacon, Stripe holds billing PII. Gates Wave 3 A13b/A13c. |

### Wave 1 — Core features (parallel after Wave 0)

| ID | Title | Source | Notes |
|---|---|---|---|
| **A2** | Anchored comments — Yjs second `Y.Doc` + server routing | Original T6 | Reuses `apps/realtime` Y.Doc infrastructure from Phase 5. Adds a second per-room doc. |
| **A3** | Anchored comments — `CommentsPanel` + `CommentAnchor` UI | Original T7 | Atlas-app components. Anchors attach to map coordinates AND Excalidraw element ids. |
| **A4** | Maputnik iframe integration | Original T8 | Modal dialog hosting Maputnik against the active basemap style URL. |
| **A5** | `StylePanel` + `ColorRampPicker` UI | Original T9 | Atlas-app component. Consumes existing `LayerStyle` from `@atlasdraw/basemap`. |
| **A6** | Style compiler — categorical + graduated expressions | Original T10 (absorbs original T2) | Extends `code/packages/basemap/src/style-compiler.ts`. Schema additions: `style.expression: { kind: "categorical" \| "graduated", property, stops }`. |
| **A7** | Geocoding — Photon client + LRU cache | Original T11a | `packages/data/src/geocode.ts`. Fetch-based; no SDK. |
| **A8** | Geocoding — CSV wire-up + config.toml | Original T11b | Hooks the Photon client into the existing CSV reader's address column. |
| **A9** | Workspace abstraction (foundation) | Original T12 | `WorkspaceId` plumbed through storage routes. Self-host scope; multi-tenant SaaS lives in Wave 3. |

### Wave 2 — Secondary features (parallel after Wave 1)

| ID | Title | Source | Notes |
|---|---|---|---|
| **A10** | Print PDF layout | Original T13 | `pdf-lib`-based. Atlas-app `PrintLayoutPanel`. |
| **A11** | Asset library — `.excalidrawlib` reader + tests | Original T14a | `packages/data/src/excalidrawlib.ts`. |
| **A12** | Asset library — curated fixtures + `AssetLibraryPanel` UI | Original T14b | |

### Wave 3 — Hosted mode + accessibility (parallel)

| ID | Title | Source | Notes |
|---|---|---|---|
| **A13a** | `WorkspaceSwitcher` UI + context provider | Original T16 | Builds on A9's `WorkspaceId`. |
| **A13b** | Per-workspace quotas | Original T17 | Server-side enforcement in `apps/storage`. |
| **A13c** | Stripe integration — checkout + webhook handler | Original T18 | Wires into `apps/realtime` (per original plan's tech stack table). |
| **A14a** | Accessibility — keyboard nav + focus mgmt | Original T20 | `@react-aria/focus`. |
| **A14b** | Accessibility — screen-reader announcements | Original T21 | `@react-aria/announce`. |

### Wave 4 — Release-candidate gates (serial)

| ID | Title | Source | Notes |
|---|---|---|---|
| **A15** | Hosted-mode E2E smoke test | Original T25 | Multi-tenant signup → workspace → upload → share. |
| **A16** | v1.0 release tag + changelog | Original T26 (re-scoped) | No AtlasdrawAPI freeze. Simple `v1.0.0` git tag + `CHANGELOG.md` entry summarizing the standalone-app feature set. |

## Updated Phase Boundary Contracts

### Consumes (unchanged from original)

| Contract | Source |
|---|---|
| `.atlasdraw` file format | Phase 3 |
| `MapLibre` wrapper, `LayerStyle` schema | Phase 2 + already-shipped basemap pkg |
| Yjs WebSocket room | Phase 5 |
| `packages/data` readers (incl. CSV) | Phase 3 |
| Docker Compose stack | Phase 4 |
| `#room:` collab URL convention (Q-P5-2) | Phase 5 collab-integration |

### Produces (revised — no SDK row)

| Contract | Consumed by | Invariant |
|---|---|---|
| Comment Yjs doc protocol | (no Phase 7 consumer at this time — see Phase 7 impact below) | Second `Y.Doc` per room; schema versioned. |
| `WorkspaceId` abstraction | Self-host operators | Every server route workspace-scoped. |
| `LayerStyle` schema + style-compiler with categorical/graduated expressions | Future styling work | Stable TypeScript type; MapLibre expression output deterministic. |
| (no AtlasdrawAPI row) | — | Cut per Q-P6-1. |
| (no `packages/sdk` row) | — | Cut per Q-P6-1. |

## Tech stack additions (revised)

Removed from original: `size-limit` (no SDK bundle to gate). Everything else stays:

`pdf-lib`, `stripe` (Node SDK), `@stripe/stripe-js`, `@react-aria/focus`, `@react-aria/announce`, Photon geocoder fetch wrapper.

## Phase 7 impact (flagged, not amended)

`docs/superpowers/plans/2026-05-03-atlasdraw-phase-7-v1.5-field-plugins.md` Task 2 assumes "AtlasdrawAPI is already postMessage-safe from Phase 6 (Q11) — no retrofit required." That assumption is now invalid:

- Phase 7's plugin Worker host has no `AtlasdrawAPI` to consume.
- Tasks 7 (Plugin SDK Surface), 23–26 (Pre-built Plugins), 28 (Plugin Sandbox E2E) all consume the AtlasdrawAPI surface.

**Phase 7 needs a separate revision before execution.** Likely directions:
- (a) Replace the postMessage Worker sandbox with direct npm-loaded extensions (no sandbox, plugins are trusted code).
- (b) Defer Phase 7 indefinitely.
- (c) Author a smaller plugin API designed-for-purpose, not a general-automation API.

Filed as seeds issue for follow-up. **Do NOT execute Phase 7 against the current plan.**

## §9 Q-Reference Summary

| ID | Title | Recorded | Scope of constraint |
|----|-------|----------|---------------------|
| Q-P6-1 | Drop Felt importer and entire Embed-SDK / AtlasdrawAPI direction; v1.0 is the standalone app | 2026-05-15 | Plan scope (this document); blocks Phase 7 as currently authored |

Full record: `docs/decisions/phase-6-research-notes.md` §"Locked Decisions (Phase 6 amendment, 2026-05-15)".

## §10 Shape Changes Summary

<!-- SHAPE_CHANGES_START -->
| Date | Role | Finding | Summary |
|------|------|---------|---------|
| 2026-05-16 | scrub-incorporator | scrub-2026-05-15 | Pre-dispatch scrub: 10/10 PASS — DISPATCHABLE. All patch markers verified, no plan-literal drift. |
<!-- SHAPE_CHANGES_END -->

## §11 Plan Manifest (drift-detection anchors)

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `code/packages/basemap/src/style-compiler.ts` | patch | `export function compileLayer` |
| `code/packages/basemap/src/index.ts` | patch | `export { compileLayer, defaultLayerStyle }` |
| `code/apps/atlas-app/src/state/layerRegistry.ts` | patch | `import type { LayerStyle } from "@atlasdraw/basemap"` |
| `code/packages/data/src/csv.ts` | patch | `downstream geocoding consumes` |
| `code/apps/realtime/src/socket-io-server.ts` | patch | `MAX_ROOM_SIZE` |
| `code/apps/realtime/src/yjs-server.ts` | patch | `setupWSConnection` |
| `code/apps/storage/src/routes/maps.ts` | patch | `createMap` |
| `code/apps/storage/src/routes/share.ts` | patch | `createShareToken` |
| `code/apps/atlas-app/src/components/MapEditor.tsx` | patch | `excalidrawAPI` |
| `code/apps/atlas-app/src/components/LayerPanel.tsx` | patch | `LayerStyle` |
<!-- PLAN_MANIFEST_END -->
