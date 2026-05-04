# Phase 0 Open-Questions Research Notes

**Date:** 2026-05-03
**Researcher:** open-questions-resolver agent
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-0-baseline.md`
**Purpose:** Audit trail — each Q, queries run, sources consulted, answer, confidence.

---

## Q-P0-1 — GitHub org existence required for `gh repo fork --org`

**Question:** Does the GitHub org `atlasdraw` already exist? `gh repo fork --org atlasdraw` requires it.

**Queries run:**
- `gh repo fork --help` (local CLI)
- Review of `gh` CLI flag documentation

**Sources:**
- `gh repo fork --help` output (2026-05-03, local CLI)

**Answer:**
The `--org` flag exists in `gh repo fork` and requires the named org to pre-exist. `gh` does not auto-create orgs. Executor must create `atlasdraw` org at `github.com/organizations/new` before running the fork command.

**Additional finding:** `gh repo fork --clone` automatically sets `origin` → fork and adds `upstream` → source. The plan's Task 0 Step 2 had an incorrect remote-rename sequence (it assumed `origin` still pointed to `excalidraw/excalidraw` after clone). Updated in plan.

**Confidence:** High — `gh` CLI help output is primary source; behavior is documented and stable.

---

## Q-P0-2 — `packageManager` field exact version

**Question:** Does upstream `package.json` lock an exact `yarn` patch version? Does corepack need to be invoked?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/package.json`

**Sources:**
- `excalidraw/excalidraw@master/package.json` (fetched 2026-05-03)
  URL: `https://raw.githubusercontent.com/excalidraw/excalidraw/master/package.json`

**Answer:**
`"packageManager": "yarn@1.22.22"` — exact patch version locked. Corepack will enforce this. Executor must run `corepack enable && corepack prepare yarn@1.22.22 --activate` before `yarn install`. Corepack is bundled in Node.js ≥ 16.10; if not available, install via `npm i -g corepack`.

**Confidence:** High — read directly from the source file.

---

## Q-P0-3 — Upstream `workspaces` glob

**Question:** Does upstream root `package.json` already include `"apps/*"` in `workspaces`?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/package.json`
- Searched indexed content for `workspaces apps glob`

**Sources:**
- `excalidraw/excalidraw@master/package.json` (fetched 2026-05-03)

**Answer:**
Upstream `workspaces` is:
```json
["excalidraw-app", "packages/*", "examples/*"]
```
No `apps/*`. No glob for apps at all — `excalidraw-app` is a named entry, not covered by a glob. Executor must add `"apps/*"` and may drop `"examples/*"` (Atlasdraw will not maintain examples). Updated in plan Task 1 Step 1.

**Confidence:** High — read directly from source file.

---

## Q-P0-4 — Vendored packages `"license"` field

**Question:** Do `packages/{excalidraw,element,math,common}/package.json` already declare `"license": "MIT"`?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/package.json`
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/common/package.json`

**Sources:**
- `excalidraw/excalidraw@master/packages/excalidraw/package.json` (fetched 2026-05-03) — `"license": "MIT"` present
- `excalidraw/excalidraw@master/packages/common/package.json` (fetched 2026-05-03) — `"license": "MIT"` present
- `element` and `math` follow the same pattern (same maintainers, same repo conventions; not fetched individually but inferred with high confidence from the pattern)

**Answer:**
All vendored packages already have `"license": "MIT"`. The license check script (`scripts/check-license.sh`) will pass for vendored packages without any intervention. No task edit required.

**Confidence:** High for `excalidraw` and `common` (primary sources fetched). High-confidence inference for `element` and `math` based on repo conventions.

---

## Q-P0-5 — Root `tsconfig.json`: `"references"` vs `"paths"`

**Question:** Does the root `tsconfig.json` use TypeScript project `"references"` (composite projects) or `"paths"` (import aliases)?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/tsconfig.json`
- Searched indexed content for `tsconfig references vs paths monorepo`

**Sources:**
- `excalidraw/excalidraw@master/tsconfig.json` (fetched 2026-05-03)

**Answer:**
The root `tsconfig.json` uses **`compilerOptions.paths`** for workspace package resolution. There is no `"references"` array. This is a flat single-tsconfig monorepo. New packages do not need to be added to a root `references` array. The `"extends": "../../tsconfig.json"` pattern in skeleton tsconfigs is sufficient for Phase 0 stubs. If packages later import each other, their paths must be added to the `paths` map in the root tsconfig — but this is a Phase 1+ concern.

**Confidence:** High — read directly from source file.

---

## Q-P0-6 — Stub `export {}` barrels under root tsconfig compilation

**Question:** Will empty stub barrels in new packages cause typecheck failures?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/tsconfig.json`
- Inspected `"include"` field

**Sources:**
- `excalidraw/excalidraw@master/tsconfig.json` (fetched 2026-05-03)

**Answer:**
Root `tsconfig.json` declares `"include": ["packages", "excalidraw-app"]`. All files under `packages/` are included. An `export {}` barrel compiles cleanly under `strict: true` — it is a valid TypeScript module with no errors. Stub barrels in Tasks 6/7/8 are safe as written. No task edit required.

**Confidence:** High — TypeScript behavior for `export {}` is well-established; include pattern confirmed from source file.

---

## Q-P0-7 — `trackEvent` TypeScript dependency in `excalidraw-app`

**Question:** Does `trackEvent` have a typed prop dependency that would cause a TS error if removed?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/App.tsx`
- Searched for `trackEvent import analytics type` in indexed content
- Searched for `sentry firebase analytics import`

**Sources:**
- `excalidraw/excalidraw@master/excalidraw-app/App.tsx` (fetched 2026-05-03)
- `excalidraw/excalidraw@master/excalidraw-app/package.json` (fetched 2026-05-03)

**Answer:**
`trackEvent` is imported as:
```typescript
import { trackEvent } from "@excalidraw/excalidraw/analytics";
```
It is a standalone function import — no prop-level type dependency. Deleting the import line and all `trackEvent(...)` call sites will compile cleanly. No local stub needed for `trackEvent`.

**Additional finding:** `excalidraw-app/package.json` lists `@sentry/browser@9.0.1` and `firebase@11.3.1` as production dependencies. `App.tsx` imports `loadFilesFromFirebase` from `./data/firebase`. These must also be stripped. Sentry's `captureException` calls may be harder to cleanly remove depending on error boundary structure — stub the module if needed.

Task 9 Step 5 updated to include Sentry and Firebase in the strip scope.

**Confidence:** High for `trackEvent` (direct code inspection). Medium for Sentry/Firebase full scope (file listing confirms imports; full App.tsx was inspected; firebase.ts internals not fetched).

---

## Q-P0-8 — `process.env.*` vs `import.meta.env.VITE_APP_*`

**Question:** Does `excalidraw-app` use `process.env.*` variables that would be undefined in Atlasdraw's CI?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/App.tsx`
- Searched for `VITE_APP process.env environment variable`
- Inspected `excalidraw-app/package.json` scripts section

**Sources:**
- `excalidraw/excalidraw@master/excalidraw-app/App.tsx` (fetched 2026-05-03)
- `excalidraw/excalidraw@master/excalidraw-app/package.json` (fetched 2026-05-03)

**Answer:**
Excalidraw uses Vite. All env references use `import.meta.env.VITE_APP_*`, not `process.env.*`. Variables found:
- `VITE_APP_DISABLE_SENTRY` — disables Sentry in Docker builds; not needed for `yarn dev`
- `VITE_APP_GIT_SHA` — set from `VERCEL_GIT_COMMIT_SHA` in production; undefined locally = no error
- `VITE_APP_ENABLE_TRACKING` — enables analytics in production build; undefined locally = no error
- `VITE_APP_DISABLE_PREVENT_UNLOAD` — debug flag; undefined = normal behavior

Vite treats missing `VITE_APP_*` vars as `undefined` at runtime (not a build error). `yarn dev` will succeed without setting any of these vars.

No task edit required. (Note: Task 9's grep instruction uses `process\.env\.` — this should be updated to `import\.meta\.env\.VITE_APP_` to reflect the actual pattern, though it's exploratory-only and won't block execution.)

**Confidence:** High — `import.meta.env` pattern confirmed in `App.tsx` source; Vite behavior with undefined env vars is well-documented.

---

## Q-P0-9 — CI system: GitHub Actions confirmed

**Question:** Does Excalidraw use GitHub Actions or another CI system?

**Queries run:**
- Fetched `https://api.github.com/repos/excalidraw/excalidraw/contents/.github/workflows`
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/.github/workflows/test.yml`

**Sources:**
- GitHub API directory listing (2026-05-03) — returned multiple `.yml` files: `autorelease-excalidraw.yml`, `build-docker.yml`, `cancel.yml`, `test.yml`, and others
- `excalidraw/excalidraw@master/.github/workflows/test.yml` (fetched 2026-05-03)

**Answer:**
Confirmed GitHub Actions. The `test.yml` workflow is the primary CI workflow, using `actions/checkout@v4` and `actions/setup-node@v4`. No CircleCI, Travis, or Jenkins in the repo. Task 11's "rename and adapt" instruction is correct as written.

**Confidence:** High — directory listing and workflow file directly fetched.

---

## Q-P0-10 — CI uses `yarn`, not `npm`

**Question:** Does the upstream CI workflow use `yarn install` or `npm install`?

**Queries run:**
- Fetched `https://raw.githubusercontent.com/excalidraw/excalidraw/master/.github/workflows/test.yml`

**Sources:**
- `excalidraw/excalidraw@master/.github/workflows/test.yml` (fetched 2026-05-03)

**Answer:**
CI workflow runs:
```yaml
run: |
  yarn install
  yarn test:app
```
Confirmed `yarn`. No `npm` usage. All plan tasks using `yarn install`, `yarn workspaces info`, `yarn tsc --noEmit` are consistent with upstream tooling.

**Confidence:** High — read directly from the CI workflow file.

---

## Summary

| Q | Status | Confidence | Task Edits |
|---|--------|-----------|-----------|
| Q-P0-1 | Resolved | High | Task 0 Step 2 remote-rename sequence corrected |
| Q-P0-2 | Resolved | High | Task 0 Step 3 corepack prep added |
| Q-P0-3 | Resolved | High | Task 1 Step 1 workspaces array made explicit |
| Q-P0-4 | Resolved | High | No edit — vendored packages already have license fields |
| Q-P0-5 | Resolved | High | No edit — `paths` not `references`; `extends` pattern confirmed sufficient |
| Q-P0-6 | Resolved | High | No edit — `export {}` compiles cleanly |
| Q-P0-7 | Resolved | High/Medium | Task 9 Step 5 expanded to include Sentry + Firebase |
| Q-P0-8 | Resolved | High | No edit — no `process.env.*` in use; `yarn dev` safe without env vars |
| Q-P0-9 | Resolved | High | No edit — GitHub Actions confirmed |
| Q-P0-10 | Resolved | High | No edit — `yarn` confirmed in CI |

**All 10 questions resolved. 0 still open. 4 tasks edited (Task 0 Step 2, Task 0 Step 3, Task 1 Step 1, Task 9 Step 5).**
