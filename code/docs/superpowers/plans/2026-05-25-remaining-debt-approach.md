# Remaining Debt Items — Approach Reference

**Date:** 2026-05-25

Each entry names the problem, the recommended tool/skill, key files, and the first concrete move.

---

## 1. MapEditor Decomposition

**Problem:** 1736 lines, 53 imports, 6 package dependencies, 7 hooks. Grows ~250 lines/phase. Central accretion point for the entire app.

**Recommended skill:** `improve-codebase-architecture`

**Key files:**

- `apps/atlas-app/src/components/MapEditor.tsx` (1736 lines — the hub)
- `apps/atlas-app/src/hooks/{useCoordinateSync,useGeoAnchor,useLayerRegistrySync,useToolState,useAtlasdrawTool,useMapWheelRouter,useCollab,useCollabRoom,useYjsLayer}.ts`
- `code/docs/architecture/cross-cutting/patterns.md` (coupling graph context)

**Target extraction (5 modules):**

1. `MapController` — map init, basemap switching, PMTiles protocol
2. ~~`FileIO`~~ — GeoJSON import extracted to `useGeoJsonDrop.ts` (2026-05-25); PNG/PDF export still inline
3. `CollabInit` — collab room join, cursor overlay lifecycle, Yjs layer init
4. `CommentManager` — comment anchor overlays, comment panel wiring
5. `EnvConfig` — `getAppConfig()` reads, env var gating, managed-mode branching

**Progress (2026-05-25):** GeoJSON drop handler (75 lines) extracted to `apps/atlas-app/src/hooks/useGeoJsonDrop.ts`. MapEditor line count reduced accordingly.

**First move:** Run `improve-codebase-architecture` with focus on MapEditor.tsx coupling graph. Identify which hooks share state (the ones that can't be independently extracted) vs. which are independent (can be).

**Risk:** Wrong cut creates 5 files that all import each other instead of 1. Need the coupling graph first.

---

## 2. E2E Test Strategy

**Problem:** 1 spec file (710 lines, Phase 1 geo foundation). Zero integration/E2E coverage for Phase 2-7. Playwright config is wired (3 browsers, webServer, video-on-failure) but unused.

**Recommended skill:** `quality-linter` (design mode)

**Key files:**

- `apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts` (710 lines — reference pattern)
- `apps/atlas-app/playwright.config.ts` (55 lines — already wired)
- `apps/atlas-app/package.json` (Playwright in devDependencies)

**Progress (2026-05-25):** Second E2E spec written — `e2e/layer-panel-reorder.spec.ts` (4 test cases for DnD reorder). Playwright config already wired with 3 browsers + webServer.

**First move:** Run `quality-linter` in Evaluate mode to catalog what test coverage exists, then Design mode to define the E2E test architecture.

**Risk:** Rendering stack (MapLibre + Excalidraw composite) needs deterministic basemap tiles and CRDT replay snapshots. No infrastructure for these exists.

---

## 3. Yarn Classic v1 → Yarn 4

**Status:** Investigated 2026-05-25. Migration path documented; execution deferred to standalone session.

**Problem:** Yarn v1.22 blocks `yarn add` with "expected workspace package to exist for vitest." Monorepo with 10+ packages, two build systems (tsc -b for packages, Vite for atlas-app), vendored Excalidraw v0.18 as workspace members (not `link:` protocol).

**Root cause analysis (2026-05-25):** No workspace member declares `"name": "vitest"`. The error is a Yarn v1 resolution bug — the root `devDependencies` includes `@vitest/coverage-v8` and `@vitest/ui`, and Yarn v1 may be confusing `vitest` with a workspace requirement. Not reproducible with `yarn install` (only `yarn add` within a workspace).

**Recommended skill:** `migrate-deps` (Docs MCP lacks Yarn docs; use Yarn's official migration guide as source of truth)

**Key files:**

- Root `package.json` (workspaces: `["excalidraw-app", "packages/*", "apps/*", "bench"]`)
- `yarn.lock` → `.yarnrc.yml` + `yarn.lock` (new format)
- All `package.json` files in workspace members

**Migration steps:**

1. Enable Corepack: `corepack enable && corepack prepare yarn@4.x --activate`
2. Create `.yarnrc.yml`:
   ```yaml
   nodeLinker: node-modules
   nmMode: hardlinks-local
   compressionLevel: mixed
   enableGlobalCache: false
   ```
3. Remove Yarn v1-specific fields from root `package.json` (`workspaces` becomes standard, no changes needed)
4. `yarn install` — resolve any resolution errors
5. Update CI: replace `yarn` commands with `corepack yarn`
6. Verify `yarn workspace @atlasdraw/atlas-app add @dnd-kit/core` works

**Risk:** Medium-HIGH. Yarn 4 changes hoisting defaults, lockfile format, and module resolution. The two-build-system setup (`tsc -b` for packages, Vite for atlas-app) and 10+ workspace members mean a failed migration blocks ALL development. Do in a dedicated session with a clean working tree.

---

## 4. `any` Type Leak (53/56 files)

**Problem:** 53 of 56 atlas-app source files contain `any` escapes. Three root causes:

1. Excalidraw type boundary (vendored types loose by nature)
2. Yjs observer patterns (untyped callbacks)
3. File System Access API (not yet standardized in TypeScript)

**Recommended skill:** `codebase-diagnostics` + progressive narrowing

**Key files:**

- `apps/atlas-app/src/components/MapEditor.tsx` (highest `any` density)
- `apps/atlas-app/src/state/collab.ts` (Yjs observer boundaries)
- `code/packages/excalidraw/types.ts` (Excalidraw type boundary)

**Progress (2026-05-25):** Verified only 1 explicit `any` usage in atlas-app source (not tests). The 53/56 figure in evolution.md includes vendored Excalidraw code and test files. MapEditor `import.meta.env` cast is a necessary Vite type-boundary — not a type leak.

**Approach:** Phased narrowing — start with the Excalidraw boundary (write explicit adapter types), then Yjs observers (typed callbacks), then FSA API (declare module augmentation).

**First move:** Run `codebase-diagnostics` at zoom level 3 (type analysis) to get a per-file `any` count breakdown. Identify the 10 highest-density files. Start with the Excalidraw boundary — define explicit `ExcalidrawElement` / `ExcalidrawImperativeAPI` adapter types in a shared `types/excalidraw.ts`.

**Risk:** Narrowing one boundary exposes cascading errors in consumers relying on the escape hatch. Must work boundary-by-boundary, not file-by-file.

---

## 5. CoordinateSync Extraction from `@atlasdraw/geo`

**Problem:** `CoordinateSync` class (373 lines) lives in `@atlasdraw/geo` — a package otherwise usable in Node.js CLI contexts. Contains a stateful runtime class with MapLibre instance reference and Excalidraw element APIs.

**Recommended skill:** `brainstorming` for package home decision

**Key files:**

- `code/packages/geo/src/CoordinateSync.ts` (373 lines — the class)
- `code/apps/atlas-app/src/hooks/useCoordinateSync.ts` (the rAF throttle hook)
- `code/packages/geo/src/index.ts` (barrel export)

**Options:**

1. Move to `@atlasdraw/basemap` (already has MapLibre dep, MapCanvas component)
2. Create `@atlasdraw/coordsync` (new package, clean separation)
3. Keep in geo but mark as browser-only export path

**Recommendation:** Option 1 — `@atlasdraw/basemap` already depends on `maplibre-gl` and owns the map rendering concern. The class is small (373 lines) and already type-decoupled from Excalidraw (defines its own `ExcalidrawElementLike` interface).

**First move:** Verify all consumers of `CoordinateSync` from `@atlasdraw/geo` (grep imports), then move the file + update the barrel export + update consumer imports.

**Risk:** Low. The class exports a clean public API (`syncMapToScene`, `attach`, `detach`). Only 2 consumers (MapEditor, useCoordinateSync hook).

---

## Summary: Priority Order

| # | Item | Status (2026-05-25) | When |
| --- | --- | --- | --- |
| 1 | CoordinateSync extraction | Implemented — moved to `@atlasdraw/basemap` | Done |
| 2 | DB migration framework | Implemented — plain SQL runner, 5/5 tests | Done |
| 3 | LayerPanel DnD | Implemented — HTML5 DnD + keyboard fallback | Done |
| 4 | MapEditor decomposition | Partial — GeoJSON drop extracted to `useGeoJsonDrop.ts` | Before Phase 7 |
| 5 | E2E test strategy | Partial — layer-panel-reorder.spec.ts written | Before Phase 7 rendering features |
| 6 | `any` type leak | Verified — 1 `any` in atlas-app source (not 53) | Ongoing |
| 7 | Yarn v1→v4 | Documented — concrete steps in §3 above | When @dnd-kit or next dep forces it |
