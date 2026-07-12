# Atlasdraw — Code and Repository Conventions

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.
**Schema:** codebase-mapping-schema.md § Conventions
**Last updated:** 2026-05-03

---

## Overview

This document records the conventions that govern how Atlasdraw's codebase is organized, typed, tested, committed, and licensed. Some conventions are inherited from the upstream Excalidraw monorepo; others are Atlasdraw additions. Where the two diverge, this document notes it.

[CONFIDENCE: high] marks conventions that follow directly from the tech spec, phase plans, or open-questions resolutions. [CONFIDENCE: med] marks conventions that are standard practice for the tech stack and are implied but not explicitly stated.

---

## Workspace Layout

**Source:** Tech Spec §1, Phase 0 plan Task 1 [CONFIDENCE: high]

```
atlasdraw/
├── packages/
│   ├── excalidraw/        # vendored upstream (light patches only)
│   ├── element/           # vendored upstream (no patches)
│   ├── math/              # vendored upstream
│   ├── common/            # vendored upstream
│   ├── geo/               # NEW — coordinate transforms, GeoAnchor types, CoordinateSync
│   ├── basemap/           # NEW — MapLibre wrapper, BasemapRegistry, style-compiler
│   ├── data/              # NEW — file format I/O (.atlasdraw, GeoJSON, KML, CSV, SHP)
│   ├── tools/             # NEW — geo-aware drawing tools (pin, route-snap, polygon, measure)
│   ├── sdk/               # NEW — embed widget (lean, MIT-licensed)
│   ├── cli/               # NEW — headless tooling (lint, convert, render)
│   └── plugin-host/       # NEW (Phase 7) — Worker host, PluginManifest, PluginRegistry
├── apps/
│   ├── atlas-app/         # NEW — editor SPA (replaces excalidraw-app)
│   └── realtime/          # NEW — WebSocket relay (forks excalidraw-room)
├── infra/
│   ├── docker-compose.yml            # 5-service full stack
│   ├── docker-compose.minimal.yml    # 3-service single-player
│   └── docker-compose.cloud.yml      # + stripe-cli for hosted dev
├── docs/                  # Astro documentation site
└── decisions/             # ADRs (Architecture Decision Records)
```

### Dependency Direction

- `apps/*` may depend on any `packages/*`.
- `packages/*` must not depend on `apps/*`.
- `packages/*` may depend on other `packages/*` only through published package interfaces (declared in `package.json` `dependencies`), not via relative cross-package imports.
- Vendored upstream packages (`packages/excalidraw`, `packages/element`, etc.) are treated as first-party for import purposes but should not be imported by packages that are upstreamable without modification.

### Package Manager

Atlasdraw inherits Excalidraw's Yarn workspace configuration (`yarn@1.22`). A migration to `pnpm` is deferred unless the workspace grows beyond what Yarn handles cleanly. Do not add `pnpm` configuration files without an explicit ADR.

---

## TypeScript Configuration

**Source:** Phase 0 research, Tech Spec §1 [CONFIDENCE: high]

### Strict Mode

All `tsconfig.json` files use `"strict": true`. No exceptions. `noImplicitAny`, `strictNullChecks`, and `strictFunctionTypes` are all active.

### Path Aliases

Use TypeScript `paths` aliases (configured in `tsconfig.json`) rather than TypeScript project `references`. Project references require explicit build ordering; `paths` are simpler for a monorepo where Vite handles bundling. Example:

```json
{
  "compilerOptions": {
    "paths": {
      "@atlasdraw/geo": ["packages/geo/src/index.ts"],
      "@atlasdraw/basemap": ["packages/basemap/src/index.ts"]
    }
  }
}
```

### Per-Package tsconfig

Each `packages/*` and `apps/*` has its own `tsconfig.json` that extends a root `tsconfig.base.json`. Root-level config sets strict mode; package-level config adds its own `include` and `paths`.

---

## Testing Strategy

**Source:** Phase 1 (benchmark + browser matrix), Phase 2 (regression gate), Phase 6 (a11y) [CONFIDENCE: high for frameworks; med for specific coverage targets]

### Test Layers

| Layer | Framework | Scope |
|---|---|---|
| Unit | vitest | Pure functions, type guards, serializers, `GeoAnchor` projection math |
| Component | @testing-library/react | React components in isolation |
| Integration | vitest | Multi-module flows (e.g., round-trip `packages/data` write→read) |
| Property-based | fast-check | Geo math (projection round-trips, coordinate edge cases) |
| E2E (smoke) | Playwright | Critical user flows per phase (one smoke test per phase) |
| Cross-browser | Playwright (WebKit proxy) | See `docs/test-matrix/phase-1.md` through phase-N |
| Adversarial | Custom per adversarial-api-testing skill | Share endpoints, plugin sandbox escape, structured-clone contracts |

### Browser Matrix

All five browser columns must pass before a phase is declared complete:

1. Chrome (latest stable)
2. Firefox (latest stable)
3. Safari / WebKit (Playwright WebKit proxy for automation; manual for some flows)
4. iOS Safari (manual test on physical device or Simulator)
5. Android Chrome (manual test on physical device or emulator)

Known-broken cross-browser items are documented as `[DEFER Pn]` in the phase test matrix with an issue reference. They do not block the phase unless they are in the critical happy path.

### Coverage

Coverage is aspirational, not gated. No CI failure on coverage percentage. The focus is on correctness of critical paths (coordinate sync, file format round-trip, share token adversarial checks), not on coverage numbers.

---

## Commit Conventions

**Source:** Inherited from Excalidraw upstream [CONFIDENCE: high]

Conventional Commits format is required:

```
<type>(<scope>): <short description>

[optional body]
[optional footer: BREAKING CHANGE, Fixes #N]
```

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`.

Scope is the package or app name: `(geo)`, `(basemap)`, `(atlas-app)`, `(realtime)`, `(sdk)`, `(plugin-host)`, `(infra)`, `(decisions)`.

Breaking changes are marked in the footer: `BREAKING CHANGE: <description>`. For packages with a published contract (`packages/sdk` in particular), breaking changes require an ADR or at minimum a callout in the PR description.

---

## Branch Naming and GitHub Flow

**Source:** Phase 0 research [CONFIDENCE: med — standard GitHub flow, inferred from Excalidraw default]

- Default branch: `main` (rebased, not merge-committed)
- Feature branches: `feat/<scope>/<short-description>` (e.g., `feat/geo/polyline-anchor`)
- Fix branches: `fix/<scope>/<short-description>`
- Phase branches: `phase/<N>/<slug>` for large multi-task phase work if needed
- PRs target `main`; squash-merge preferred for atomic history, merge-commit acceptable for phase branches

No force-push to `main`. All changes via PR. Phase plans (e.g., Phase 4 Task 10) specify the exact branch and PR trigger points for executor agents.

---

## License Declaration

**Source:** Q5 resolution, Phase 0 Task 2, CI guard [CONFIDENCE: high]

Every `package.json` must have a `"license"` field with a valid SPDX identifier. CI fails if a package is merged without one. The three valid values are:

| Value | Packages |
|---|---|
| `"AGPL-3.0"` | `apps/atlas-app`, `apps/realtime` |
| `"MIT"` | `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data` |
| `"MPL-2.0"` | `packages/basemap`, `packages/tools` |

New packages must declare their license before merging. The license choice follows the logic in ADR `0002-license-split.md`: AGPL for server/app, MIT for freely embeddable utilities, MPL for basemap/tools where file-level copyleft is appropriate.

Plugin manifests (Phase 7) also require a valid SPDX `license` field; `PluginManifest.validate()` throws at install time if the field is missing or invalid.

---

## Vendored Package Patches

**Source:** Q6 resolution, ADR `0004-upstream-merge-policy.md`, Phase 0 Task 3 [CONFIDENCE: high]

Every patch applied to files in `packages/excalidraw/`, `packages/element/`, `packages/math/`, or `packages/common/` must be documented in `decisions/upstream-patches.md` with:
- The file modified
- A one-line reason for the patch
- The date applied
- A link to the upstream issue or PR if applicable

A CI guard (`infra/ci/patch-journal-guard.sh` or equivalent) validates this: any PR that diffs a vendored file without a corresponding new entry in `decisions/upstream-patches.md` fails CI.

Quarterly upstream-merge reviews are scheduled per ADR `0004`. Hard exit thresholds trigger an architecture review. Do not accumulate vendored patches without entries; retroactive documentation is harder and less accurate.

---

## ADR Sequence and Naming

**Source:** Phase 0 plan, decisions/ structure [CONFIDENCE: high]

ADRs are numbered sequentially and named by slug:

```
decisions/NNNN-slug.md
```

Examples:
- `decisions/0001-fork-vs-package.md`
- `decisions/0002-license-split.md`
- `decisions/0003-coord-system.md`
- `decisions/0004-upstream-merge-policy.md`
- `decisions/0005-sdk-postmessage-contract.md`
- `decisions/0006-telemetry.md`
- `decisions/0007-yjs-e2ee-threat-model.md`
- `decisions/0008-share-link-encoding.md`

ADRs are **never renumbered**. Once a number is assigned, it is permanent, even if the ADR is superseded or amended. Superseded ADRs are marked `Status: Superseded by NNNN` at the top; they are not deleted.

The `upstream-patches.md` file is not an ADR (no number prefix); it is a log file.

---

## The `customData.geo` Field Name

**Source:** cross-phase-audit.md MISMATCH-3 [CONFIDENCE: high]

The field that stores a geo anchor on an Excalidraw element is `customData.geo`. It is **not** `customData.geoAnchor`, `customData.anchor`, or any other variant.

Any code, documentation, or comment that uses `geoAnchor` as the field name is incorrect. The cross-phase audit (MISMATCH-3) flagged this inconsistency across early drafts. The canonical name is `customData.geo` as defined in `packages/geo/types.ts`.

This applies to:
- TypeScript type definitions
- JSON serialization/deserialization
- Documentation and comments
- Test fixtures

---

## CI Pipeline

**Source:** Phase 0 Task 11, Tech Spec §9 [CONFIDENCE: high]

### Jobs (`.github/workflows/ci.yml`)

Phase 0 establishes a five-job CI pipeline adapted from Excalidraw's upstream workflow:

| Job | What it runs | Failure condition |
|---|---|---|
| `typecheck` | `tsc --noEmit` across all packages | Any TypeScript error |
| `test` | `vitest run` across all packages | Any failing test |
| `lint` | ESLint (inherited from Excalidraw config) | Any lint error |
| `license-check` | `scripts/check-license.sh` | Any `package.json` missing `"license"` field |
| `patch-guard` | `scripts/check-upstream-patches.sh` | Any vendored-file diff without a patch journal entry |

Node version matrix: Node 20 + Node 22 (inherited from Excalidraw; do not change until the Q8 benchmark gate establishes a baseline on both).

Later phases add jobs on top of this baseline:
- Phase 4: `bundle-size` (size-limit on `packages/sdk`)
- Phase 6: `postmessage-roundtrip`, `telemetry-guard`, `hosted-e2e`, `a11y`
- Phase 7: `sandbox-escape` (adversarial plugin test suite)

### Branch Protection

`main` is protected: no force-push, required CI status checks before merge, required PR review. The specific status checks required are the five Phase 0 jobs. Phase-specific jobs are added to the required list when they are introduced.

---

## File Format Conventions

**Source:** Phase 3 plan, `packages/data` [CONFIDENCE: high]

### `.atlasdraw` Bundle Structure

The canonical on-disk format is a zip archive with the extension `.atlasdraw`. Internal layout:

```
<bundle>.atlasdraw  (zip)
├── manifest.json          # AtlasdrawManifest: id, version, layers[], schemaVersion, created, modified
├── scene.excalidraw.json  # ExcalidrawScene: elements[], appState, files{}
├── style.json             # MapLibreStyle: the full MapLibre style spec object
└── layers/
    ├── <layer-id>.geojson # one GeoJSON FeatureCollection per data layer
    └── ...
```

`packages/data` owns `write()` and `read()`. `read()` throws `AtlasdrawFormatError` with a typed `code` field on any structural violation: `'BAD_ZIP' | 'MISSING_MANIFEST' | 'INVALID_MANIFEST' | 'MISSING_SCENE'`.

Round-trip invariant: `read(await write(doc))` must return a document structurally equal to `doc` (same manifest id, same layer feature counts, same scene element IDs). This is enforced by `packages/data/src/__tests__/round-trip.test.ts`.

### In-Memory Document Types

Two types from `packages/sdk` represent the document at different levels:

- `AtlasdrawDocument` — the full mutable in-memory document held in the Zustand store. Contains live `Y.Doc` references for data layers.
- `AtlasdrawBundle` — the serializable snapshot used for sharing, exporting, and persistence. Contains only JSON-serializable fields. `AtlasdrawBundle` is what `write()` serializes and `read()` produces.

`AtlasdrawBundle` shape:
```ts
type AtlasdrawBundle = {
  scene: ExcalidrawScene;
  layers: GeoJSON.FeatureCollection[];
  style: MapLibreStyle;
  manifest: AtlasdrawManifest;
};
```

---

## State Management Conventions

**Source:** Tech Spec (Zustand implied by React SPA pattern), Phase 3 Task 8 [CONFIDENCE: med]

### Zustand Store

`apps/atlas-app` uses Zustand for application state. The document store holds the canonical `AtlasdrawDocument`; all components read from the store and write through actions. Direct mutation of store state outside of Zustand actions is not permitted.

The persistence hook (`useAutosave`) subscribes to store snapshots. It uses a 5-second debounce timer: any store write resets the timer; when the timer fires, `PersistenceStore.save()` is called with the current snapshot.

### No Shared State Between Packages

`packages/*` do not hold global mutable state. State lives in `apps/*` (Zustand) or in `Y.Doc` instances (for Yjs CRDT data layers). Packages export pure functions and classes; they do not export singleton stores.

---

## Error Handling Conventions

**Source:** Phase 3 Task 3, Phase 2 Flow B [CONFIDENCE: med]

### Typed Error Classes

Subsystems that can fail in structured ways export typed error classes with a `code` field:

- `AtlasdrawFormatError { code: 'BAD_ZIP' | 'MISSING_MANIFEST' | 'INVALID_MANIFEST' | 'MISSING_SCENE' }` — `packages/data`
- `GeoJSONParseError { message: string }` — `packages/data`, shown as a toast in the UI

Generic `Error` is acceptable for programmer errors (invariant violations, unexpected null). Typed error classes are required for user-facing failure paths where the error code drives UI behavior (error message selection, recovery option display).

### User-Facing Error Surface

Errors that reach the UI surface as toasts (transient, bottom of screen) for non-blocking failures (GeoJSON parse error on drop) or as modal error dialogs for blocking failures (document unreadable on open). The error message shown to the user must be actionable: it must say what went wrong and what the user can do next. Generic "Something went wrong" is not acceptable for known error codes.

---

## Import Convention for `customData.geo`

**Source:** cross-phase-audit.md MISMATCH-3, `packages/geo/types.ts` [CONFIDENCE: high]

All code that reads or writes the geo anchor on an Excalidraw element must import types from `@atlasdraw/geo`:

```ts
import type { GeoCustomData, GeoAnchor } from "@atlasdraw/geo";

// Read:
const geo = (element.customData as GeoCustomData)?.geo;

// Write (at element creation):
const customData: GeoCustomData = {
  geo: { kind: "point", lng, lat, zRef: map.getZoom() },
  scaleMode: "screen",
  schemaVersion: 1,
  projection: "mercator",
};
```

Never inline the `GeoCustomData` shape. Never access `customData.geoAnchor`. Any code that accesses `customData` without going through the `GeoCustomData` type import is a convention violation.
