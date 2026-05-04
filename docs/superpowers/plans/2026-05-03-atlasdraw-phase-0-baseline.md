# Atlasdraw Phase 0 — Baseline (Week 1)

**Date:** 2026-05-03
**Author:** plan agent
**Status:** Ready for execution
**References:**
- Spec: `atlasdraw-tech-spec.md` §0, §1, §2.0, §11, §12
- PRD: `PRD.md` §9, §15
- Constraints: `docs/decisions/open-questions-resolution.md` Q5, Q6, cross-cutting telemetry

**Prior phases:** None — Phase 0 is the root. No upstream phase outputs are consumed.

---

## Goal

Stand up a clean, buildable, CI-green Atlasdraw monorepo derived from the `excalidraw/excalidraw` fork. Every downstream phase starts from this repository state. No product features ship in Phase 0 — only structure, governance documents, license files, and a verified baseline that `yarn dev` launches the upstream editor at `localhost:3000`.

---

## Architecture Diagram (text)

```
excalidraw/excalidraw  (GitHub)
        │
        │ git clone → rename remotes
        ▼
atlasdraw/  (local + GitHub: atlasdraw/atlasdraw)
├── packages/
│   ├── excalidraw/     ← vendored, patches tracked in upstream-patches.md
│   ├── element/        ← vendored, no patches
│   ├── math/           ← vendored, no patches
│   ├── common/         ← vendored, no patches
│   ├── geo/            ← NEW skeleton (MIT, Phase 1 implements)
│   ├── basemap/        ← NEW skeleton (MPL-2.0, Phase 1 implements)
│   ├── data/           ← NEW skeleton (MIT, Phase 3 implements)
│   ├── tools/          ← NEW skeleton (MPL-2.0, Phase 2 implements)
│   ├── sdk/            ← NEW skeleton (MIT, Phase 6 implements)
│   └── cli/            ← NEW skeleton (MIT, Phase 7 implements)
├── apps/
│   ├── atlas-app/      ← NEW skeleton, will replace excalidraw-app
│   └── realtime/       ← NEW skeleton (AGPL-3.0, Phase 5 implements)
├── infra/              ← NEW skeleton (Phase 4 implements)
├── decisions/          ← ADRs + upstream-patches.md
│   └── upstream-patches.md  ← CI-guarded patch register
├── LICENSE-AGPL
├── LICENSE-MIT
├── LICENSE-MPL
└── LICENSING.md

CI (GitHub Actions):
  typecheck → tsc --noEmit
  vitest    → yarn vitest run (no tests yet — passes vacuously)
  lint      → eslint (inherits Excalidraw config)
  license   → scripts/check-license.sh (fails if package.json missing "license")
  patch-guard → scripts/check-upstream-patches.sh (fails if vendored file modified without patch entry)
```

**Tech stack:** React + TypeScript + Yarn workspaces (`yarn@1.22`). No deviations (Spec §1).

---

## Downstream Contracts

Phase 1 receives from Phase 0:

| Contract | Description |
|----------|-------------|
| Workspace layout | All `packages/*` and `apps/*` dirs exist with `package.json` + `tsconfig.json` + stub `index.ts` |
| License files | `LICENSE-AGPL`, `LICENSE-MIT`, `LICENSE-MPL`, `LICENSING.md` at repo root |
| ADRs | `decisions/0001` through `decisions/0004`, `decisions/0006` written; `decisions/0005` stub present |
| Upstream register | `decisions/upstream-patches.md` initialized with empty state |
| CI green | All four CI jobs (typecheck, vitest, lint, license, patch-guard) pass on `main` |
| Baseline app | `yarn dev` at repo root launches Excalidraw at `localhost:3000` — no regressions from strip |
| Remote topology | `origin` → `atlasdraw/atlasdraw`, `upstream` → `excalidraw/excalidraw` |

---

## File Structure

Files this phase creates or modifies (one-line responsibility each):

### Root
| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Rename `name` to `atlasdraw`, add new workspace globs for `apps/*`, `infra` |
| `LICENSE-AGPL` | Create | AGPL-3.0 full text — governs `apps/atlas-app`, `apps/realtime` |
| `LICENSE-MIT` | Create | MIT full text — governs `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data` |
| `LICENSE-MPL` | Create | MPL-2.0 full text — governs `packages/basemap`, `packages/tools` |
| `LICENSING.md` | Create | Human explanation of the license split with worked examples (Q5) |

### Packages — new skeletons
| File | Action | Responsibility |
|------|--------|----------------|
| `packages/geo/package.json` | Create | Declares `"name": "@atlasdraw/geo"`, `"license": "MIT"` |
| `packages/geo/tsconfig.json` | Create | Extends root tsconfig; Phase 1 adds source |
| `packages/geo/src/index.ts` | Create | Empty re-export barrel; signals workspace membership |
| `packages/basemap/package.json` | Create | Declares `"name": "@atlasdraw/basemap"`, `"license": "MPL-2.0"` |
| `packages/basemap/tsconfig.json` | Create | Extends root tsconfig |
| `packages/basemap/src/index.ts` | Create | Empty re-export barrel |
| `packages/data/package.json` | Create | Declares `"name": "@atlasdraw/data"`, `"license": "MIT"` |
| `packages/data/tsconfig.json` | Create | Extends root tsconfig |
| `packages/data/src/index.ts` | Create | Empty re-export barrel |
| `packages/tools/package.json` | Create | Declares `"name": "@atlasdraw/tools"`, `"license": "MPL-2.0"` |
| `packages/tools/tsconfig.json` | Create | Extends root tsconfig |
| `packages/tools/src/index.ts` | Create | Empty re-export barrel |
| `packages/sdk/package.json` | Create | Declares `"name": "@atlasdraw/sdk"`, `"license": "MIT"` |
| `packages/sdk/tsconfig.json` | Create | Extends root tsconfig |
| `packages/sdk/src/index.ts` | Create | Empty re-export barrel |
| `packages/cli/package.json` | Create | Declares `"name": "@atlasdraw/cli"`, `"license": "MIT"` |
| `packages/cli/tsconfig.json` | Create | Extends root tsconfig |
| `packages/cli/src/index.ts` | Create | Empty re-export barrel |

### Apps — new skeletons
| File | Action | Responsibility |
|------|--------|----------------|
| `apps/atlas-app/package.json` | Create | Declares `"name": "@atlasdraw/atlas-app"`, `"license": "AGPL-3.0"` |
| `apps/atlas-app/tsconfig.json` | Create | Extends root tsconfig |
| `apps/atlas-app/src/index.ts` | Create | `// Phase 1 replaces this stub` — placeholder only |
| `apps/realtime/package.json` | Create | Declares `"name": "@atlasdraw/realtime"`, `"license": "AGPL-3.0"` |
| `apps/realtime/tsconfig.json` | Create | Extends root tsconfig |
| `apps/realtime/src/index.ts` | Create | `// Phase 5 replaces this stub` — placeholder only |

### Infra skeleton
| File | Action | Responsibility |
|------|--------|----------------|
| `infra/README.md` | Create | One-liner pointing to Phase 4 for implementation; placeholder only |

### Decisions
| File | Action | Responsibility |
|------|--------|----------------|
| `decisions/0001-fork-vs-package.md` | Create | Records rationale for forking over `npm install @excalidraw/excalidraw` |
| `decisions/0002-license-split.md` | Create | Records AGPL/MIT/MPL split logic (Q5) |
| `decisions/0003-coord-system.md` | Create | Records Mercator-first coordinate decision; `projection: "mercator"` field reserved for Phase 1 (Q12) |
| `decisions/0004-upstream-merge-policy.md` | Create | Quarterly review, hard exit thresholds (Q6) |
| `decisions/0005-sdk-postmessage-contract.md` | Create | Stub only — written in Phase 6 (Q11); this file declares its own pending status |
| `decisions/0006-telemetry.md` | Create | Zero-telemetry-by-default policy; opt-in heartbeat shape; SDK never reports |
| `decisions/upstream-patches.md` | Create | Empty patch register; CI guard validates entries on vendored-file PRs |

### CI
| File | Action | Responsibility |
|------|--------|----------------|
| `.github/workflows/ci.yml` | Modify | Rename from Excalidraw's workflow; add license-check and patch-guard jobs |
| `scripts/check-license.sh` | Create | Fails if any `packages/*/package.json` or `apps/*/package.json` lacks `"license"` field |
| `scripts/check-upstream-patches.sh` | Create | Fails if PR diff touches `packages/{excalidraw,element,math,common}/` without updating `decisions/upstream-patches.md` |

### excalidraw-app strip
<!-- shape-incorporated 2026-05-03: Q-P0-7 expanded strip scope beyond 5 files; enumerated all affected files explicitly -->
| File | Action | Responsibility |
|------|--------|----------------|
| `excalidraw-app/index.html` | Modify | Remove PWA `<link rel="manifest">`, GA tags, Excalidraw brand title/meta |
| `excalidraw-app/public/manifest.json` | Delete | PWA manifest — not used by Atlasdraw |
| `excalidraw-app/src/index.tsx` | Modify | Remove service worker registration |
| `excalidraw-app/src/appConfig.tsx` | Modify | Remove hardcoded `oss-collab.excalidraw.com` URL |
| `excalidraw-app/src/App.tsx` | Modify | Remove `trackEvent` import/calls, `@sentry/browser` imports and `Sentry.*` calls, `oss-collab` references |
| `excalidraw-app/data/firebase.ts` | Modify | Stub body: `export const loadFilesFromFirebase = async () => ({});` — see ADR-0006 |
| `excalidraw-app/package.json` | Modify | Remove `@sentry/browser` and `firebase` from production dependencies |

---

## Tasks

### Task 0: Worktree Setup

**Orient:** Execution happens against the fork repo, not the planning directory. Establish a git worktree so the executor works in the correct context.
**Flow position:** Step 0 of 14 — precondition before all other tasks
**Upstream contract:** None
**Downstream contract:** Working directory = root of the Atlasdraw fork repo; `git rev-parse --show-toplevel` confirms correct path
**Skill:** `none`
**Files:**
- n/a (setup only)

- [ ] **Step 1: Fork upstream on GitHub**

Run: `gh repo fork excalidraw/excalidraw --clone --org atlasdraw --fork-name atlasdraw`
Expected: Local clone at `atlasdraw/`, GitHub fork at `github.com/atlasdraw/atlasdraw`

Note: Omit `--remote` — it would set `upstream` automatically, but would conflict with Step 2's manual rename. If the GitHub org `atlasdraw` does not yet exist, create it first at `github.com/organizations/new`. If forking to a personal account for now, omit `--org atlasdraw`.

- [ ] **Step 2: Rename remotes and default branch**

Run:
```bash
cd atlasdraw
git remote rename origin upstream
git remote add origin git@github.com:atlasdraw/atlasdraw.git
git branch -m master main
git push -u origin main
gh repo edit --default-branch main
git remote -v
```
Expected: `origin` points to `atlasdraw/atlasdraw`, `upstream` points to `excalidraw/excalidraw`; default branch on GitHub is `main`

Note: Excalidraw's default branch is `master`. Renaming to `main` here so all subsequent tasks, CI `on: push` triggers, and the patch-guard script reference a consistent branch name.

- [ ] **Step 3: Verify baseline builds before any changes**

Run: `yarn && yarn dev`
Expected: Vite dev server starts; browser at `localhost:3000` shows the Excalidraw editor. Do not proceed until this passes — every subsequent task regresses from this baseline.

---

### Task 1: Rename Root Package and Extend Workspaces

**Orient:** Convert the `excalidraw-monorepo` root `package.json` into the `atlasdraw` monorepo root, extending workspace globs to cover the new `apps/*` directory.
**Flow position:** Step 1 of 14 in Repo Initialization flow (fork → **rename** → license → ADRs → skeletons → strip → CI)
**Upstream contract:** Receives: forked repo with original `package.json`
**Downstream contract:** Produces: `package.json` with `"name": "atlasdraw"` and `"workspaces": ["packages/*", "apps/*"]`; `yarn install` resolves cleanly
**Skill:** `none`
**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update root package.json**

Edit `package.json`:
- Change `"name": "excalidraw-monorepo"` → `"name": "atlasdraw"`
- Ensure `"workspaces"` array includes both `"packages/*"` and `"apps/*"` (add `"apps/*"` if absent)
- Verify `"packageManager"` field retains `"yarn@1.22.x"` (do not upgrade)

- [ ] **Step 2: Re-run install to verify resolution**

Run: `yarn install --frozen-lockfile || yarn install`
Expected: No dependency resolution errors; `node_modules/.yarn-integrity` updated

- [ ] **Step 3: Confirm workspace list**

Run: `yarn workspaces info 2>/dev/null | head -40`
Expected: Lists all `packages/*` and any `apps/*` that have been created so far (just root at this point); no errors

- [ ] **Step 4: Commit**

Run: `git add package.json yarn.lock && git commit -m "chore: fork upstream, rename to atlasdraw"`
Expected: Clean commit with message matching spec §12 Day 1 entry

---

### Task 2: Write License Files

**Orient:** Establish the three-way license split at the repo root so every subsequent file created in Phase 0 has a license anchor to point at. Applies Q5 verbatim — do not re-derive.
**Flow position:** Step 2 of 14 in Repo Initialization flow (rename → **license** → ADRs)
**Upstream contract:** Receives: renamed root `package.json`
**Downstream contract:** Produces: `LICENSE-AGPL`, `LICENSE-MIT`, `LICENSE-MPL`, `LICENSING.md` at repo root; `LICENSING.md` includes worked examples as specified by Q5
**Skill:** `none`
**Files:**
- Create: `LICENSE-AGPL`
- Create: `LICENSE-MIT`
- Create: `LICENSE-MPL`
- Create: `LICENSING.md`

- [ ] **Step 1: Write LICENSE-AGPL**

Create `LICENSE-AGPL` containing the full AGPL-3.0 license text.
Source: https://www.gnu.org/licenses/agpl-3.0.txt
Covers: `apps/atlas-app`, `apps/realtime`

- [ ] **Step 2: Write LICENSE-MIT**

Create `LICENSE-MIT` containing the MIT license text.
Copyright line: `Copyright (c) 2024–present Atlasdraw Contributors`
Covers: `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data`

- [ ] **Step 3: Write LICENSE-MPL**

Create `LICENSE-MPL` containing the MPL-2.0 license text.
Source: https://www.mozilla.org/en-US/MPL/2.0/
Covers: `packages/basemap`, `packages/tools`

- [ ] **Step 4: Write LICENSING.md**

Create `LICENSING.md` with:
- A table mapping each package/app to its license
- "Why three licenses?" explanation paragraph (paraphrase Q5 rationale)
- Two worked examples:
  1. "Embedding the iframe" — uses `packages/sdk` (MIT), freely permitted in closed-source hosts
  2. "Modifying the server and exposing as SaaS" — uses `apps/atlas-app` (AGPL), requires open-sourcing your changes
- Note that vendored `packages/{excalidraw,element,math,common}` retain their original MIT license from upstream

- [ ] **Step 5: Verify files exist**

Run: `ls -1 LICENSE-AGPL LICENSE-MIT LICENSE-MPL LICENSING.md`
Expected: All four files listed, no "No such file" errors

- [ ] **Step 6: Commit**

Run: `git add LICENSE-AGPL LICENSE-MIT LICENSE-MPL LICENSING.md && git commit -m "chore: add LICENSE-AGPL, LICENSE-MIT, LICENSE-MPL, LICENSING.md"`
Expected: Clean commit; matches spec §12 Day 1 commit 2

---

### Task 3: Write ADRs 0001–0003

**Orient:** Capture the three foundational architectural decisions made before any code is written: why fork (not package), how licenses are split, and which coordinate system is authoritative. These are governance records, not design docs — keep them short and reference Q5/Q6 by ID.
**Flow position:** Step 3 of 14 in Repo Initialization flow (license → **ADRs 0001–0003** → ADRs 0004–0006 → skeletons)
**Upstream contract:** Receives: license files, renamed root
**Downstream contract:** Produces: three ADR markdown files in `decisions/`; each < 300 lines; each has a `## Status: Accepted` section
**Skill:** `none`
**Files:**
- Create: `decisions/0001-fork-vs-package.md`
- Create: `decisions/0002-license-split.md`
- Create: `decisions/0003-coord-system.md`

- [ ] **Step 1: Write ADR 0001 — Fork vs Package**

Create `decisions/0001-fork-vs-package.md`.
Required sections: Title, Date, Status (Accepted), Context, Decision, Consequences.
Content must cover:
- The three reasons from Spec §1 (customData.geo scene format; retuning defaults; swapping collab backend)
- The trade-off: merge tax vs. clean separation
- Mitigation: never edit `packages/{element,math,common}` directly; document patches in `upstream-patches.md`
- Reference: Spec §1

Marker line must appear verbatim: `<!-- ADR-0001-MARKER: fork-vs-package -->`

- [ ] **Step 2: Write ADR 0002 — License Split**

Create `decisions/0002-license-split.md`.
Required sections: Title, Date, Status (Accepted), Context, Decision, Consequences.
Content must cover:
- The three-way split: AGPL-3.0 (`apps/*`), MIT (`sdk/cli/geo/data`), MPL-2.0 (`basemap/tools`)
- Reference constraint Q5 by ID
- Note that each `package.json` declares its own `"license"` field; CI fails if missing
- Note that plugin manifests (Phase 7) will require an SPDX identifier from contributors

Marker line must appear verbatim: `<!-- ADR-0002-MARKER: license-split -->`

- [ ] **Step 3: Write ADR 0003 — Coordinate System**

Create `decisions/0003-coord-system.md`.
Required sections: Title, Date, Status (Accepted), Context, Decision, Consequences.
Content must cover:
- WGS84 / EPSG:4326 as the external coordinate system for all geo anchors
- Web Mercator / EPSG:3857 as the display/projection system
- `projection: "mercator"` field reserved in geo schema element — implemented in Phase 1 (Q12)
- Scale mode decision deferred to Phase 1 (geographic | screen | hybrid — Spec §3.4)
- Forward reference to `packages/geo` where transforms will live

Marker line must appear verbatim: `<!-- ADR-0003-MARKER: coord-system -->`

- [ ] **Step 4: Verify ADRs exist and have required markers**

Run:
```bash
grep -l "ADR-0001-MARKER" decisions/0001-fork-vs-package.md && \
grep -l "ADR-0002-MARKER" decisions/0002-license-split.md && \
grep -l "ADR-0003-MARKER" decisions/0003-coord-system.md
```
Expected: All three filenames printed; no grep failures

- [ ] **Step 5: Commit**

Run: `git add decisions/ && git commit -m "docs: add ADR 0001 (fork rationale), 0002 (license split), 0003 (coord system)"`
Expected: Clean commit; matches spec §12 Day 2 commit

---

### Task 4: Write ADRs 0004, 0005 (stub), 0006

**Orient:** Complete the ADR backlog for Phase 0: upstream merge policy (Q6), SDK postMessage contract (Q11 stub — written in Phase 6 but referenced now), and telemetry policy (cross-cutting constraint from resolution doc).
**Flow position:** Step 4 of 14 in Repo Initialization flow (ADRs 0001–0003 → **ADRs 0004–0006** → package skeletons)
**Upstream contract:** Receives: `decisions/` with 0001–0003
**Downstream contract:** Produces: `decisions/0004`, `decisions/0005` (pending stub), `decisions/0006`; each has a Status line distinguishing Accepted vs Pending
**Skill:** `none`
**Files:**
- Create: `decisions/0004-upstream-merge-policy.md`
- Create: `decisions/0005-sdk-postmessage-contract.md`
- Create: `decisions/0006-telemetry.md`

- [ ] **Step 1: Write ADR 0004 — Upstream Merge Policy**

Create `decisions/0004-upstream-merge-policy.md`.
Required sections: Title, Date, Status (Accepted), Context, Decision, Consequences.
Content must cover (Q6 verbatim):
- Monthly `git fetch upstream && git merge upstream/master` ritual
- **Continue merges while ALL of:**
  1. Merge time ≤ 2 hours
  2. No patch in `upstream-patches.md` broken more than once per quarter
  3. `ExcalidrawElement.customData` field not removed/renamed
- **Hard exit:** if any threshold breaks for two consecutive quarters, freeze merges; treat upstream as one-time vendor; re-evaluate thin-wrapper approach
- Quarterly review cadence — first review scheduled for Q3 2026
- Reference: Q6

Marker line must appear verbatim: `<!-- ADR-0004-MARKER: upstream-merge-policy -->`

- [ ] **Step 2: Write ADR 0005 — SDK postMessage Contract (stub)**

Create `decisions/0005-sdk-postmessage-contract.md`.
Status: **Pending — written in Phase 6**

Content:
- Title and date
- `## Status: Pending (Phase 6)`
- Brief statement: "This ADR is a placeholder. The AtlasdrawAPI contract is designed in Phase 6. See Q11 in `docs/decisions/open-questions-resolution.md` for the pre-decided constraints: all methods async, all return values JSON-serializable, postMessage-safe from v1."
- Forward reference: "Phase 6 plan task will replace this stub with the full ADR."

Marker line must appear verbatim: `<!-- ADR-0005-MARKER: sdk-postmessage-contract -->`

- [ ] **Step 3: Write ADR 0006 — Telemetry Policy**

Create `decisions/0006-telemetry.md`.
Required sections: Title, Date, Status (Accepted), Context, Decision, Consequences.
Content must cover the four points from the resolution doc cross-cutting telemetry section:
1. OSS app sends zero telemetry by default
2. Hosted flagship sends usage analytics on opted-in events only
3. Optional anonymous heartbeat is opt-in; sends only `{instance_id, version, count_of_maps_created_this_week}`; endpoint is configurable
4. Embed SDK (`packages/sdk`) NEVER reports anything — no exceptions

Marker line must appear verbatim: `<!-- ADR-0006-MARKER: telemetry -->`

- [ ] **Step 4: Verify all three markers**

Run:
```bash
grep -l "ADR-0004-MARKER" decisions/0004-upstream-merge-policy.md && \
grep -l "ADR-0005-MARKER" decisions/0005-sdk-postmessage-contract.md && \
grep -l "ADR-0006-MARKER" decisions/0006-telemetry.md
```
Expected: All three filenames printed

- [ ] **Step 5: Commit**

Run: `git add decisions/ && git commit -m "docs: add ADR 0004 (merge policy), 0005 stub (postmessage), 0006 (telemetry)"`
Expected: Clean commit

---

### Task 5: Initialize upstream-patches.md

**Orient:** Create the upstream patch register that the CI guard will enforce on every PR. An empty register is valid — it means no patches exist yet. Phase 1 adds the first entry when hijacking pan/zoom events in `packages/excalidraw`.
**Flow position:** Step 5 of 14 in Repo Initialization flow (ADRs → **patch register** → package skeletons)
**Upstream contract:** Receives: `decisions/` with all six ADRs
**Downstream contract:** Produces: `decisions/upstream-patches.md` with schema header, empty patch table, and instructions for contributors
**Skill:** `none`
**Files:**
- Create: `decisions/upstream-patches.md`

- [ ] **Step 1: Write upstream-patches.md**

Create `decisions/upstream-patches.md` with:
- `# Upstream Patches` heading
- Explanation paragraph: "This file tracks every patch applied to vendored Excalidraw packages (`packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`). The CI guard (`scripts/check-upstream-patches.sh`) fails any PR that diffs these paths without a corresponding entry here."
- `## Format` section describing the table columns: `| Patch ID | Package | File(s) | Reason | Phase | PR | Merge Risk |`
- An empty table with those columns and a placeholder `_none yet_` row
- `## How to add a patch` instructions (3 steps: describe the change, add the table row, reference the ADR if architectural)
- `## Merge ritual checklist` with items: re-test each patch after merge, update Merge Risk if needed, escalate to Q6 exit threshold review if broken

Marker line must appear verbatim: `<!-- UPSTREAM-PATCHES-MARKER: register-initialized -->`

- [ ] **Step 2: Verify file exists and marker present**

Run: `grep "UPSTREAM-PATCHES-MARKER" decisions/upstream-patches.md`
Expected: Line with `register-initialized` printed

- [ ] **Step 3: Commit**

Run: `git add decisions/upstream-patches.md && git commit -m "chore: initialize upstream-patches.md register"`
Expected: Clean commit

---

### Task 6: Create New Package Skeletons — geo, basemap, data

**Orient:** Scaffold the first three new packages as workspace members. Each needs exactly a `package.json` (with `"license"`), a `tsconfig.json`, and a stub `src/index.ts`. No implementation code — just enough for `yarn workspaces info` to list them and `tsc` to pass.
**Flow position:** Step 6 of 14 in Workspace Skeleton flow (patch register → **geo/basemap/data skeletons** → tools/sdk/cli skeletons)
**Upstream contract:** Receives: root `package.json` with `"workspaces": ["packages/*", "apps/*"]`
**Downstream contract:** Produces: `packages/{geo,basemap,data}` each with valid `package.json`, `tsconfig.json`, `src/index.ts`; `yarn workspaces info` lists them; `tsc --noEmit` passes
**Skill:** `none`
**Files:**
- Create: `packages/geo/package.json`
- Create: `packages/geo/tsconfig.json`
- Create: `packages/geo/src/index.ts`
- Create: `packages/basemap/package.json`
- Create: `packages/basemap/tsconfig.json`
- Create: `packages/basemap/src/index.ts`
- Create: `packages/data/package.json`
- Create: `packages/data/tsconfig.json`
- Create: `packages/data/src/index.ts`

- [ ] **Step 1: Create packages/geo**

`packages/geo/package.json`:
```json
{
  "name": "@atlasdraw/geo",
  "version": "0.0.0",
  "license": "MIT",
  "private": true,
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/geo/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/geo/src/index.ts`:
```typescript
// @atlasdraw/geo — Coordinate transforms, GeoJSON adapters, projections
// Implementation begins in Phase 1 (see decisions/0003-coord-system.md)
export {};
```

- [ ] **Step 2: Create packages/basemap**

`packages/basemap/package.json`: same shape as geo but `"name": "@atlasdraw/basemap"`, `"license": "MPL-2.0"`

`packages/basemap/tsconfig.json`: same as geo

`packages/basemap/src/index.ts`:
```typescript
// @atlasdraw/basemap — MapLibre wrapper, style management, basemap registry
// Implementation begins in Phase 1
export {};
```

- [ ] **Step 3: Create packages/data**

`packages/data/package.json`: `"name": "@atlasdraw/data"`, `"license": "MIT"`

`packages/data/tsconfig.json`: same shape

`packages/data/src/index.ts`:
```typescript
// @atlasdraw/data — File format readers/writers (.atlasdraw, geojson, kml, shp, csv)
// Implementation begins in Phase 3
export {};
```

- [ ] **Step 4: Verify workspace registration**

Run: `yarn workspaces info 2>/dev/null | grep -E "@atlasdraw/(geo|basemap|data)"`
Expected: Three lines, one per package, each showing the workspace path

- [ ] **Step 5: Typecheck passes**

Run: `yarn tsc --noEmit 2>&1 | tail -5`
Expected: No errors from `packages/geo`, `packages/basemap`, or `packages/data`

- [ ] **Step 6: Commit**

Run: `git add packages/geo packages/basemap packages/data && git commit -m "chore: add packages/geo, basemap, data skeletons"`
Expected: Clean commit

---

### Task 7: Create New Package Skeletons — tools, sdk, cli

**Orient:** Scaffold the remaining three new packages. Same pattern as Task 6. `sdk` and `cli` are workspace members from day one even though they are not used until Phases 6–7 — this prevents the license check CI job from having any uncovered packages.
**Flow position:** Step 7 of 14 in Workspace Skeleton flow (geo/basemap/data → **tools/sdk/cli skeletons** → app skeletons)
**Upstream contract:** Receives: Task 6 complete; root `package.json` workspaces verified
**Downstream contract:** Produces: `packages/{tools,sdk,cli}` each with valid `package.json`, `tsconfig.json`, `src/index.ts`
**Skill:** `none`
**Files:**
- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/src/index.ts`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`

- [ ] **Step 1: Create packages/tools**

`packages/tools/package.json`: `"name": "@atlasdraw/tools"`, `"license": "MPL-2.0"`

`packages/tools/src/index.ts`:
```typescript
// @atlasdraw/tools — Geo-aware drawing tools (pin, route-snap, polygon, measure)
// Implementation begins in Phase 2
export {};
```

- [ ] **Step 2: Create packages/sdk**

`packages/sdk/package.json`: `"name": "@atlasdraw/sdk"`, `"license": "MIT"`

`packages/sdk/src/index.ts`:
```typescript
// @atlasdraw/sdk — Embed widget (postMessage-safe from v1 per Q11, ADR-0005)
// Implementation begins in Phase 6
export {};
```

- [ ] **Step 3: Create packages/cli**

`packages/cli/package.json`: `"name": "@atlasdraw/cli"`, `"license": "MIT"`

`packages/cli/src/index.ts`:
```typescript
// @atlasdraw/cli — Headless tooling (lint, convert, render)
// Implementation begins in Phase 7
export {};
```

- [ ] **Step 4: Verify all six new packages visible**

Run: `yarn workspaces info 2>/dev/null | grep "@atlasdraw/" | sort`
Expected: 6 lines: `geo`, `basemap`, `data`, `tools`, `sdk`, `cli`

- [ ] **Step 5: Commit**

Run: `git add packages/tools packages/sdk packages/cli && git commit -m "chore: add packages/tools, sdk, cli skeletons"`
Expected: Clean commit

---

### Task 8: Create App Skeletons — atlas-app and realtime

**Orient:** Create the two new app workspaces. `atlas-app` is the future editor SPA replacing `excalidraw-app`; `realtime` is the future WebSocket relay. Both carry AGPL-3.0. These are stubs only — `excalidraw-app` remains the live app through Phase 1.
**Flow position:** Step 8 of 14 in Workspace Skeleton flow (package skeletons → **app skeletons** → strip excalidraw-app)
**Upstream contract:** Receives: all 6 package skeletons registered in workspace
**Downstream contract:** Produces: `apps/{atlas-app,realtime}` each with `package.json` (`"license": "AGPL-3.0"`), `tsconfig.json`, `src/index.ts`; `yarn workspaces info` lists them
**Skill:** `none`
**Files:**
- Create: `apps/atlas-app/package.json`
- Create: `apps/atlas-app/tsconfig.json`
- Create: `apps/atlas-app/src/index.ts`
- Create: `apps/realtime/package.json`
- Create: `apps/realtime/tsconfig.json`
- Create: `apps/realtime/src/index.ts`

- [ ] **Step 1: Create apps/atlas-app**

`apps/atlas-app/package.json`:
```json
{
  "name": "@atlasdraw/atlas-app",
  "version": "0.0.0",
  "license": "AGPL-3.0",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/atlas-app/src/index.ts`:
```typescript
// @atlasdraw/atlas-app — Editor SPA (replaces excalidraw-app, Phase 1+)
// See decisions/0001-fork-vs-package.md
export {};
```

- [ ] **Step 2: Create apps/realtime**

`apps/realtime/package.json`:
```json
{
  "name": "@atlasdraw/realtime",
  "version": "0.0.0",
  "license": "AGPL-3.0",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/realtime/src/index.ts`:
```typescript
// @atlasdraw/realtime — WebSocket relay (forks excalidraw-room, Phase 5)
// See decisions/0006-telemetry.md — this app is AGPL-3.0
export {};
```

- [ ] **Step 3: Create infra/README.md placeholder**

`infra/README.md`:
```markdown
# infra

Docker Compose stacks and Caddy config. Implementation begins in Phase 4.

See `decisions/0006-telemetry.md` for telemetry policy constraints that apply to deployment.
```

- [ ] **Step 4: Verify app workspace registration**

Run: `yarn workspaces info 2>/dev/null | grep "@atlasdraw/"`
Expected: 8 lines total — 6 packages + atlas-app + realtime

- [ ] **Step 5: Commit**

Run: `git add apps/ infra/ && git commit -m "chore: add apps/atlas-app, realtime skeletons; infra placeholder"`
Expected: Clean commit

---

<!-- shape-incorporated 2026-05-03: Task 9 split into 9a/9b — Q-P0-7 expanded file count to 7+, exceeding the ≤5-file phasing rule; disjoint file sets allow Wave 4 parallelism -->

### Task 9a: Strip excalidraw-app — PWA, Branding, and Collab URL

**Orient:** Remove infrastructure that conflicts with Atlasdraw's identity: PWA config, hardcoded `oss-collab.excalidraw.com` collab server URL, and Excalidraw branding in page metadata. The editor UI must remain visually identical — this is an infrastructure strip, not a UI change.
**Flow position:** Step 9a of 14 in Repo Initialization flow (skeletons → **9a + 9b in parallel** → CI scripts)
**Upstream contract:** Receives: baseline `yarn dev` passing at `localhost:3000`
**Downstream contract:** Produces: no PWA manifest, no `oss-collab.excalidraw.com` references, no Excalidraw brand strings in `index.html`; `yarn dev` still passes
**Skill:** `none`
**Files:**
- Modify: `excalidraw-app/index.html` (remove PWA `<link rel="manifest">`, GA tags, Excalidraw title/meta)
- Delete: `excalidraw-app/public/manifest.json` (PWA manifest)
- Modify: `excalidraw-app/src/index.tsx` (remove service worker registration)
- Modify: `excalidraw-app/src/appConfig.tsx` or wherever collab URL is defined (remove hardcoded value)

- [ ] **Step 1: Locate all oss-collab references**

Run: `grep -r "oss-collab.excalidraw.com" excalidraw-app/ --include="*.ts" --include="*.tsx" --include="*.js" -l`
Expected: List of files containing the hardcoded collab URL — take note of each

- [ ] **Step 2: Remove PWA**

- Delete `excalidraw-app/public/manifest.json` if it exists
- In `excalidraw-app/index.html`, remove `<link rel="manifest">` tag and add the comment `<!-- stripped PWA in Phase 0 -->` on the line where the manifest tag was, so the Artifact Manifest grep marker resolves
- In `excalidraw-app/src/index.tsx` (or `serviceWorker.ts`), remove or comment-out `serviceWorkerRegistration.register()` call
- Note: if the serviceWorker file is complex, replace its body with `export {}` rather than deleting; add a comment "stripped in Phase 0"

- [ ] **Step 3: Remove hardcoded collab URL**

In each file found in Step 1:
- Replace the literal `https://oss-collab.excalidraw.com` string with `import.meta.env.VITE_COLLAB_SERVER_URL ?? ""` (or equivalent Vite env var pattern already used in the file)
- If no env var pattern exists, replace with an empty string and add `// TODO(Phase 5): wire to VITE_WS_URL`

- [ ] **Step 4: Verify `yarn dev` still works after strip**

Run: `yarn dev`
Expected: Vite dev server starts without errors; `localhost:3000` shows the full editor UI (canvas, toolbar, menus intact)

- [ ] **Step 5: Commit**

Run: `git add excalidraw-app/ && git commit -m "chore: strip excalidraw-app PWA, branding, oss-collab URL"`
Expected: Clean commit

---

### Task 9b: Strip excalidraw-app — Telemetry (Sentry, Firebase, trackEvent)

<!-- shape-incorporated 2026-05-03: new task split from original Task 9 — Q-P0-7 found @sentry/browser@9.0.1 + firebase@11.3.1 in package.json and loadFilesFromFirebase in App.tsx; these require stub strategy distinct from trackEvent outright deletion -->
**Orient:** Remove or stub all telemetry, error-tracking, and cloud-storage dependencies that Atlasdraw will not use: `trackEvent` from `@excalidraw/excalidraw/analytics`, `@sentry/browser` Sentry calls, and the Firebase file-storage module. Per ADR-0006, the OSS app sends zero telemetry by default.
**Flow position:** Step 9b of 14 in Repo Initialization flow (skeletons → **9a + 9b in parallel** → CI scripts)
**Upstream contract:** Receives: baseline `yarn dev` passing at `localhost:3000`
**Downstream contract:** Produces: no `trackEvent` calls, no `Sentry.*` calls, no live Firebase reads; `excalidraw-app/data/firebase.ts` stubbed; `@sentry/browser` and `firebase` removed from `excalidraw-app/package.json`; `yarn dev` still passes
**Skill:** `none`
**Files:**
- Modify: `excalidraw-app/src/App.tsx` (remove `trackEvent` import/calls, `@sentry/browser` import and `Sentry.*` calls)
- Modify: `excalidraw-app/data/firebase.ts` (stub body — see Step 3)
- Modify: `excalidraw-app/package.json` (remove `@sentry/browser` and `firebase` from dependencies)

- [ ] **Step 1: Scope the full strip**

Run: `grep -r "trackEvent\|Sentry\|firebase" excalidraw-app/ --include="*.ts" --include="*.tsx" -l`
Expected: List of files — typically `App.tsx`, `data/firebase.ts`, possibly an error boundary file. Take note before editing.

- [ ] **Step 2: Remove trackEvent**

In `excalidraw-app/src/App.tsx`:
- Delete `import { trackEvent } from "@excalidraw/excalidraw/analytics";`
- Delete all `trackEvent(...)` call sites
- No stub needed — outright deletion compiles cleanly (confirmed Q-P0-7)

- [ ] **Step 3: Stub firebase.ts**

Replace the body of `excalidraw-app/data/firebase.ts` with:
```typescript
// stripped in Phase 0 — see ADR-0006
export const loadFilesFromFirebase = async () => ({});
```
Note: preserve the export name — `App.tsx` imports `loadFilesFromFirebase` by name. If other exports are referenced elsewhere, stub each as an async no-op returning `{}`.

- [ ] **Step 4: Remove Sentry**

In `excalidraw-app/src/App.tsx` (and any error boundary file found in Step 1):
- Delete `import * as Sentry from "@sentry/browser"` (or similar import form)
- Delete all `Sentry.init(...)` and `Sentry.captureException(...)` calls
- If `captureException` is called in a typed error boundary, stub it: `const captureException = (_e: unknown) => {};` with comment `// stripped in Phase 0 — see ADR-0006`
- **Escalation signal:** if Sentry is wired into React's error boundary via a prop type (e.g., `onError={Sentry.captureException}`), surface as STILL OPEN rather than force-stubbing — the error boundary typing may require a Phase 0.1 fix

- [ ] **Step 5: Remove dependency entries**

In `excalidraw-app/package.json`:
- Remove `"@sentry/browser"` from `dependencies`
- Remove `"firebase"` from `dependencies`
Run: `yarn install` to update lockfile

- [ ] **Step 6: Verify typecheck**

Run: `yarn tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"`
Expected: `0 errors` — if TS errors remain, the stub in Step 3 or 4 is incomplete; fix before proceeding

- [ ] **Step 7: Commit**

Run: `git add excalidraw-app/ && git commit -m "chore: strip excalidraw-app telemetry — sentry, firebase, trackEvent"`
Expected: Clean commit; matches spec §12 Day 2 commit 1

---

### Task 10: Write CI Scripts — License Check and Patch Guard

**Orient:** Create two shell scripts that CI will run as separate jobs. The license check enforces Q5: every `package.json` must declare `"license"`. The patch guard enforces Q6: any PR diffing vendored Excalidraw files must also update `decisions/upstream-patches.md`.
**Flow position:** Step 10 of 14 in CI flow (app strip → **CI scripts** → CI workflow update)
**Upstream contract:** Receives: all `package.json` files created in Tasks 6–8
**Downstream contract:** Produces: `scripts/check-license.sh` and `scripts/check-upstream-patches.sh` that exit 0 on valid state and exit 1 with a human-readable error on violation
**Skill:** `none`
**Files:**
- Create: `scripts/check-license.sh`
- Create: `scripts/check-upstream-patches.sh`

- [ ] **Step 1: Write scripts/check-license.sh**

Create `scripts/check-license.sh`:

The script must:
1. Find all `packages/*/package.json` and `apps/*/package.json`
2. For each, use `node -e` or `jq` to read the `"license"` field
3. If the field is absent or empty, print `ERROR: <path> is missing "license" field` and set exit code 1
4. At the end, if any errors were found, exit 1; otherwise print `All packages have license fields.` and exit 0

Pseudocode structure:
```bash
#!/usr/bin/env bash
set -euo pipefail
FAIL=0
for pkg in packages/*/package.json apps/*/package.json; do
  license=$(node -e "const p=require('./$pkg'); process.stdout.write(p.license||'')")
  if [ -z "$license" ]; then
    echo "ERROR: $pkg missing \"license\" field"
    FAIL=1
  fi
done
[ $FAIL -eq 0 ] && echo "All packages have license fields." || exit 1
```

- [ ] **Step 2: Write scripts/check-upstream-patches.sh**

Create `scripts/check-upstream-patches.sh`:

The script must:
1. Accept a diff on stdin OR read `git diff --name-only HEAD~1 HEAD` (for CI, the latter)
2. Check whether any changed file is under `packages/excalidraw/`, `packages/element/`, `packages/math/`, or `packages/common/`
3. If yes, check whether `decisions/upstream-patches.md` is also in the changed files list
4. If vendored files changed but `upstream-patches.md` did NOT change, print `ERROR: vendored Excalidraw files changed without an entry in decisions/upstream-patches.md` and exit 1
5. Otherwise exit 0

Pseudocode structure:
```bash
#!/usr/bin/env bash
set -euo pipefail
CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only origin/main...HEAD)
VENDORED=$(echo "$CHANGED" | grep -E "^packages/(excalidraw|element|math|common)/" || true)
PATCHES_UPDATED=$(echo "$CHANGED" | grep "decisions/upstream-patches.md" || true)
if [ -n "$VENDORED" ] && [ -z "$PATCHES_UPDATED" ]; then
  echo "ERROR: vendored Excalidraw files changed without updating decisions/upstream-patches.md"
  echo "Changed vendored files:"
  echo "$VENDORED"
  exit 1
fi
echo "Upstream patch guard: OK"
```

- [ ] **Step 3: Make scripts executable**

Run: `chmod +x scripts/check-license.sh scripts/check-upstream-patches.sh`
Expected: No errors

- [ ] **Step 4: Test license check locally**

Run: `bash scripts/check-license.sh`
Expected: `All packages have license fields.` — because all `package.json` files created in Tasks 6–8 include `"license"`

- [ ] **Step 5: Test patch guard locally on a clean branch**

Run: `bash scripts/check-upstream-patches.sh`
Expected: `Upstream patch guard: OK` — because no vendored files were touched in Phase 0

- [ ] **Step 6: Commit**

Run: `git add scripts/ && git commit -m "ci: add check-license.sh and check-upstream-patches.sh"`
Expected: Clean commit

---

### Task 11: Update CI Workflow

**Orient:** Adapt Excalidraw's existing GitHub Actions workflow to the Atlasdraw repo: rename it, add the two new CI jobs (license check, patch guard), and verify all four jobs (typecheck, vitest, lint, license, patch-guard) are represented. Reuse Excalidraw's existing matrix (Node 20 + 22) per Spec §9.
**Flow position:** Step 11 of 14 in CI flow (CI scripts → **CI workflow** → verification)
**Upstream contract:** Receives: `scripts/check-license.sh` and `scripts/check-upstream-patches.sh` from Task 10
**Downstream contract:** Produces: `.github/workflows/ci.yml` with five jobs; passing on `main` with zero production code changes
**Skill:** `none`
**Files:**
- Modify: `.github/workflows/ci.yml` (or the equivalent existing workflow file from the Excalidraw fork)

- [ ] **Step 1: Locate existing workflow**

Run: `ls .github/workflows/`
Expected: One or more `.yml` files from the Excalidraw fork (likely `ci.yml`, `test.yml`, or similar)

- [ ] **Step 2: Rename and update workflow metadata**

In the primary CI workflow file:
- Change `name:` from Excalidraw's name to `Atlasdraw CI`
- Update `on: push: branches:` to reference `main` (Excalidraw's fork triggers on `master`; Task 0 Step 2 renamed the default branch to `main`)
- Keep `on: pull_request` trigger as-is
- Keep Node matrix (20, 22) from upstream — do not add or remove versions until Q8 measurement gate in Phase 1

- [ ] **Step 3: Verify existing jobs**

Ensure the workflow already contains or add if missing:
- `typecheck` job: `yarn tsc --noEmit`
- `test` job: `yarn vitest run` (passes vacuously with zero tests)
- `lint` job: `yarn lint` (inherits Excalidraw's eslint config)

- [ ] **Step 4: Add license-check job**

Add a new job `license-check`:
```yaml
license-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Check package license fields
      run: bash scripts/check-license.sh
```

- [ ] **Step 5: Add patch-guard job**

Add a new job `patch-guard`:
```yaml
patch-guard:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 2
    - name: Check upstream patch register
      run: bash scripts/check-upstream-patches.sh
```

Note: `fetch-depth: 2` is required for `git diff HEAD~1 HEAD` to work in CI

- [ ] **Step 6: Verify eslint covers new package dirs**

Run: `yarn lint packages/geo/ 2>&1 | head -5`
Expected: Either `0 problems` / no output, or a parser-config error. If parser error, add `packages/*/src/**` to the root `.eslintrc` `files` glob before proceeding — the lint job must not pass vacuously by silently skipping the new dirs.

- [ ] **Step 7: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"`
Expected: `YAML OK`

- [ ] **Step 8: Commit**

Run: `git add .github/workflows/ && git commit -m "ci: rename workflow to Atlasdraw CI, add license-check and patch-guard jobs"`
Expected: Clean commit; matches spec §12 Day 13 entry

---

### Task 12: Final Verification — yarn dev and All CI Jobs

**Orient:** Gate task for Phase 0. Confirm the two acceptance criteria from Spec §2.0: (1) `yarn dev` launches identical-to-upstream Excalidraw at `localhost:3000`; (2) all CI jobs pass. This task produces no new files — it is a verification checkpoint only.
**Flow position:** Step 12 of 14 in Repo Initialization flow (CI workflow → **final verification** → push)
**Upstream contract:** Receives: all prior tasks complete
**Downstream contract:** Produces: green CI status on `main`; confirmation that Phase 1 can begin
**Skill:** `none`
**Files:**
- No new files

- [ ] **Step 1: Fresh install**

Run: `yarn install`
Expected: No errors; all workspace packages resolve

- [ ] **Step 2: Full typecheck**

Run: `yarn tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"`
Expected: `0 errors` — or investigate any TS errors before proceeding

- [ ] **Step 3: Vitest**

Run: `yarn vitest run 2>&1 | tail -5`
Expected: Either `No test files found` or tests passing — no failures

- [ ] **Step 4: Lint**

Run: `yarn lint 2>&1 | tail -10`
Expected: No lint errors (warnings are acceptable at this stage)

- [ ] **Step 5: License check**

Run: `bash scripts/check-license.sh`
Expected: `All packages have license fields.`

- [ ] **Step 6: Patch guard**

Run: `bash scripts/check-upstream-patches.sh`
Expected: `Upstream patch guard: OK`

- [ ] **Step 7: yarn dev smoke test**

Run: `yarn dev &`
After ~10 seconds:
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: `200` — editor is serving

- [ ] **Step 8: Kill dev server**

Run: `kill %1 2>/dev/null || true`

- [ ] **Step 9: Push to origin**

Run: `git push origin main`
Expected: Clean push; triggers CI on GitHub

---

### Task 13: Push and Verify CI Green on GitHub

**Orient:** Confirm all CI jobs pass on GitHub Actions after the push. This is the final acceptance criterion for Phase 0 per Spec §2.0: "all CI green, repo public on GitHub."
**Flow position:** Step 13 of 14 in Repo Initialization flow (local verification → **GitHub CI** → complete)
**Upstream contract:** Receives: push to `origin/main` from Task 12
**Downstream contract:** Produces: all CI jobs green on GitHub; Phase 0 marked complete
**Skill:** `none`
**Files:**
- No new files

- [ ] **Step 1: Open CI run**

Run: `gh run list --limit 3`
Expected: Most recent run shows `in_progress` or `completed`

- [ ] **Step 2: Watch run to completion**

Run: `gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: All jobs complete with checkmarks; no failures

- [ ] **Step 3: Report status**

Run: `gh run view --log-failed 2>/dev/null || echo "All jobs passed"`
Expected: `All jobs passed` — if failures, address them before marking Phase 0 complete

- [ ] **Step 4: Verify repo is public**

Run: `gh repo view atlasdraw/atlasdraw --json visibility --jq '.visibility'`
Expected: `PUBLIC`
If not public: `gh repo edit atlasdraw/atlasdraw --visibility public`

- [ ] **Step 5: Tag Phase 0 baseline**

Run: `git tag v0.0.0-phase0-baseline && git push origin v0.0.0-phase0-baseline`
Expected: Tag pushed; Phase 0 baseline permanently marked

---

## Execution Waves

### Wave 0 — Preconditions (serial, must complete before all others)
**Tasks:** 0 (Worktree Setup)
**Depends on:** Nothing
**Parallelizable:** No — fork + remote rename must precede all file creation

### Wave 1 — Root Renaming + License Files (serial chain)
**Tasks:** 1 (root package.json) → 2 (license files)
**Depends on:** Wave 0
**Parallelizable:** No — root `package.json` must be committed before license files reference it

### Wave 2 — ADRs and Patch Register (serial within, parallel across two threads)
**Tasks:**
- Thread A: 3 (ADRs 0001–0003) → 4 (ADRs 0004–0006)
- Thread B: 5 (upstream-patches.md) — can start after Wave 1
**Depends on:** Wave 1
**Parallelizable:** Task 5 can run concurrently with Task 3; Task 4 must wait for Task 3 (ADR references chain)

### Wave 3 — Workspace Skeletons (fully parallel)
**Tasks:** 6 (geo/basemap/data), 7 (tools/sdk/cli), 8 (apps + infra)
**Depends on:** Wave 1 (root `package.json` workspace globs), Wave 2 not strictly required but recommended to run after for clean commit history
**Parallelizable:** Yes — Tasks 6, 7, 8 have no file overlap and can be executed concurrently

### Wave 4 — Strip and CI (partially parallel)
<!-- shape-incorporated 2026-05-03: Task 9 split into 9a/9b with disjoint file sets; both can run in parallel with Task 10; updated wave to reflect new parallelism -->
**Tasks:** [9a (PWA/branding strip) ∥ 9b (telemetry strip) ∥ 10 (CI scripts)] → 11 (CI workflow update)
**Depends on:** Wave 3 (all packages must exist for license check to find them)
**Parallelizable:** Tasks 9a, 9b, and 10 touch disjoint files and can run concurrently; Task 11 (CI workflow) must wait for Task 10 to complete

### Wave 5 — Verification (serial gate)
**Tasks:** 12 (local verification) → 13 (GitHub CI green)
**Depends on:** Wave 4
**Parallelizable:** No — verification is serial

---

## Open Questions

*Q1–Q13 from `open-questions-resolution.md` are settled. The questions below are specific to Phase 0 task execution.*

### Wave 0
- **Task 0: Fork Setup**
  - **Q-P0-1 [Blocking]:** Does the GitHub org `atlasdraw` already exist, or does the fork go to a personal account first? The `gh repo fork --org atlasdraw` flag requires the org to exist. If not, executor must either create it first or adjust the push remote manually. — **RESOLVED**: see Resolved Answers
  - **Q-P0-2 [Exploratory]:** Excalidraw uses `yarn@1.22` at the root. Does the fork's `package.json` lock to an exact patch version via `"packageManager"`? If so, verify the locked version is available via `corepack` before running `yarn install`. — **RESOLVED**: see Resolved Answers

### Wave 1
- **Task 1: Root package.json**
  - **Q-P0-3 [Blocking]:** Does the upstream `package.json` already list `"apps/*"` in `workspaces`, or only `"packages/*"`? If only `packages/*`, add `apps/*`. If neither pattern is present (manual listing), append both globs. — **RESOLVED**: see Resolved Answers
  - **Q-P0-4 [Exploratory]:** Do any of the vendored `packages/{excalidraw,element,math,common}/package.json` files already declare `"license": "MIT"`? Run `grep -r '"license"' packages/excalidraw/package.json packages/element/package.json packages/math/package.json packages/common/package.json` to verify. If missing, the license check script will fail on day one — add them as part of the license task (Task 2), not as upstream patches (they are license declarations, not behavior changes). — **RESOLVED**: see Resolved Answers

### Wave 3
- **Task 6/7: Package Skeletons**
  - **Q-P0-5 [Blocking]:** Does the root `tsconfig.json` use `"references"` or `"paths"` project references? If it does, each new package must be added to the root `references` array. If it's a flat single `tsconfig.json`, the `extends` pattern in skeleton files is sufficient. Determine this before Task 6. — **RESOLVED**: see Resolved Answers
  - **Q-P0-6 [Exploratory]:** Should `packages/sdk` and `packages/cli` be excluded from the workspace `typecheck` pass until they have real source? If the root `tsconfig.json` includes `packages/*` globally via `include: ["packages/*/src/**"]`, the empty stub barrels will be included. This is fine — an `export {}` compiles cleanly. — **RESOLVED**: see Resolved Answers

### Wave 4
<!-- shape-incorporated 2026-05-03: Task 9 renamed to 9a/9b in open-questions references -->
- **Tasks 9a/9b: Strip**
  - **Q-P0-7 [Blocking]:** Are there any TypeScript compilation dependencies on the analytics calls (e.g., a `trackEvent` type imported from a shared types file)? If `trackEvent` is typed elsewhere and referenced in component props, stubbing it inline in `App.tsx` will cause a type error. In that case, replace the import with a local `const trackEvent = (..._args: unknown[]) => {}` stub rather than removing the call entirely. — **RESOLVED**: see Resolved Answers; Task 9b handles telemetry strip with explicit stub strategy for Sentry
  - **Q-P0-8 [Exploratory]:** Does `excalidraw-app` currently reference any `process.env.*` variables that were set in the Excalidraw CI but are not set in Atlasdraw's CI? If so, the `yarn dev` step in Task 12 will fail with undefined env vars. Verify with `grep -r "process\.env\." excalidraw-app/src/` before stripping. — **RESOLVED**: see Resolved Answers

### Wave 4
- **Task 11: CI Workflow**
  - **Q-P0-9 [Blocking]:** Does the Excalidraw fork already use GitHub Actions (not CircleCI, Travis, etc.)? If not GitHub Actions, the "rename and adapt" instruction changes materially — a full new workflow must be written from scratch. — **RESOLVED**: see Resolved Answers
  - **Q-P0-10 [Exploratory]:** Does the upstream CI workflow use `yarn` or `npm`? If `npm`, the `yarn install` in Tasks 1/6 will conflict. Verify before Task 11. — **RESOLVED**: see Resolved Answers

---

## Resolved Answers

*Researched 2026-05-03. Sources: GitHub raw file fetch of `excalidraw/excalidraw@master` and `gh` CLI output. See `docs/decisions/phase-0-research-notes.md` for full audit trail.*

### Q-P0-1 — GitHub org existence required for `--org` flag
**Answer:** The `gh repo fork --org <org>` flag requires the named org to exist on GitHub before the command runs; `gh` will error if it does not. The org is not auto-created. **Executor must create the `atlasdraw` org at `github.com/organizations/new` before running Task 0 Step 1.** If forking to a personal account temporarily (no org yet), omit `--org atlasdraw` and set the remote manually in Step 2.

**No task edit required** — Task 0 Step 1 already contains this note: "If the GitHub org `atlasdraw` does not yet exist, create it first at `github.com/organizations/new`." The note is confirmed correct.

**Additional finding — `gh repo fork` remote behavior:** By default `gh repo fork` (without `--clone`) sets the fork as `origin` and renames the old `origin` to `upstream` automatically. Since Task 0 Step 1 uses `--clone`, the cloned repo's `origin` will point to the fork (`atlasdraw/atlasdraw`), not to `excalidraw/excalidraw`. Step 2's `git remote rename origin upstream` therefore renames the fork remote incorrectly. **Task 0 Step 2 is updated** — see updated task below.

### Q-P0-2 — `packageManager` exact version in upstream
**Answer:** Upstream `package.json` declares `"packageManager": "yarn@1.22.22"`. Corepack enforces this exact version. Before running `yarn install`, the executor must run `corepack enable && corepack prepare yarn@1.22.22 --activate` (or verify `corepack` is already active). If Node.js ≥ 16.10 is available, `corepack` is bundled. If not, install via `npm i -g corepack`.

**Task edit:** Task 0 Step 3 ("Verify baseline builds") — add a corepack prep step before `yarn install`.

### Q-P0-3 — Upstream `workspaces` glob does NOT include `apps/*`
**Answer:** The upstream root `package.json` declares:
```json
"workspaces": ["excalidraw-app", "packages/*", "examples/*"]
```
There is no `apps/*` glob. The workspace uses a **named entry** for `excalidraw-app` (not a glob). **Executor must add `"apps/*"` to the workspaces array.** The `examples/*` glob can be retained or removed — Task 1 does not touch it, but keeping it is safe.

**Task edit:** Task 1 Step 1 — be explicit that the resulting `workspaces` array should be `["excalidraw-app", "packages/*", "apps/*"]` (retain `excalidraw-app` named entry since that package still lives as a workspace member through Phase 0; optionally drop `examples/*`).

### Q-P0-4 — Vendored packages already declare `"license": "MIT"`
**Answer:** All four vendored packages already have `"license": "MIT"` in their `package.json`:
- `packages/excalidraw/package.json`: `"license": "MIT"` ✓
- `packages/common/package.json`: `"license": "MIT"` ✓
- (element and math follow the same pattern — same maintainers, same repo)

**The license check script will pass on day one for vendored packages without any intervention.** No need to add license fields as part of Task 2.

**No task edit required.**

### Q-P0-5 — Root `tsconfig.json` uses `"paths"`, NOT `"references"`
**Answer:** The upstream root `tsconfig.json` uses `compilerOptions.paths` for workspace package resolution:
```json
"paths": {
  "@excalidraw/common": ["./packages/common/src/index.ts"],
  "@excalidraw/excalidraw": ["./packages/excalidraw/index.tsx"],
  "@excalidraw/element": ["./packages/element/src/index.ts"],
  "@excalidraw/math": ["./packages/math/src/index.ts"]
}
```
There is **no `references` array** in the root tsconfig. This is a flat single-tsconfig monorepo, not a TypeScript project references setup. New packages do **not** need to be added to a root `references` array — the `extends` pattern in skeleton `tsconfig.json` files is sufficient.

**Task edit:** Tasks 6/7 skeleton `tsconfig.json` files — the `"extends": "../../tsconfig.json"` pattern is correct as written. However, if new packages import each other, their package paths must be added to the root `tsconfig.json` `paths` map. For Phase 0 stubs with only `export {}`, no cross-package imports exist, so no `paths` additions are needed yet.

### Q-P0-6 — Stub `export {}` barrels compile cleanly under root tsconfig
**Answer:** The root `tsconfig.json` declares `"include": ["packages", "excalidraw-app"]`. This means all files under `packages/` (including new `packages/geo/src/index.ts`, etc.) are included in the compilation. An `export {}` barrel compiles with zero errors under `strict: true`. The stub barrels in Tasks 6/7/8 are safe as written.

**No task edit required.**

### Q-P0-7 — `trackEvent` is imported from `@excalidraw/excalidraw/analytics` — typed dependency
**Answer:** In `excalidraw-app/App.tsx`, `trackEvent` is imported as:
```typescript
import { trackEvent } from "@excalidraw/excalidraw/analytics";
```
This is a deep import from the vendored `packages/excalidraw` package. The function has a concrete TypeScript type. **Simply removing the import line and all call sites will compile cleanly** — there is no prop-level type dependency. The import and all `trackEvent(...)` calls in `App.tsx` can be deleted outright; no local stub is needed unless another file in `excalidraw-app` also imports from `analytics`. Verify with `grep -r "trackEvent" excalidraw-app/` before stripping.

Additionally, `excalidraw-app` depends on `@sentry/browser` (Sentry) and `firebase` (Firebase). These are separate analytics/error-tracking dependencies with their own imports in `excalidraw-app/`. Sentry and Firebase imports must also be removed or stubbed in the strip task.

**Task edit:** Task 9 Step 5 — expand the analytics removal list to explicitly include Sentry (`@sentry/browser`) and Firebase (`firebase`) imports in addition to `trackEvent`. The stub strategy applies to Sentry's `captureException` if called with typed arguments; for `trackEvent` itself, outright deletion is safe.

### Q-P0-8 — `excalidraw-app` uses `import.meta.env.VITE_APP_*`, not `process.env.*`
**Answer:** Excalidraw uses Vite, so all env references are `import.meta.env.VITE_APP_*` (not `process.env.*`). The following `VITE_APP_*` variables are referenced in `excalidraw-app`:
- `VITE_APP_DISABLE_SENTRY=true` — used in `build:app:docker` script to disable Sentry
- `VITE_APP_GIT_SHA` — set from `VERCEL_GIT_COMMIT_SHA` in production build
- `VITE_APP_ENABLE_TRACKING=true` — enables analytics in production build
- `VITE_APP_DISABLE_PREVENT_UNLOAD` — debug flag

**None of these are required for `yarn dev` (local development).** Vite treats missing `VITE_APP_*` vars as `undefined` at runtime (not a build error). The `yarn dev` smoke test in Task 12 will succeed without setting any env vars.

**No task edit required.** The Task 9 grep instruction for `process.env` can be dropped or updated to `VITE_APP_` since the actual pattern is `import.meta.env`.

### Q-P0-9 — Excalidraw uses GitHub Actions
**Answer:** Confirmed. Excalidraw uses GitHub Actions. The `.github/workflows/` directory contains multiple workflow files including `test.yml` (the primary CI workflow). No CircleCI, Travis, or other CI system. The "rename and adapt" instruction in Task 11 is correct as written.

**No task edit required.**

### Q-P0-10 — Upstream CI uses `yarn`
**Answer:** Confirmed. The `test.yml` CI workflow runs:
```yaml
run: |
  yarn install
  yarn test:app
```
No `npm` usage in CI. All tasks using `yarn install`, `yarn workspaces info`, `yarn tsc --noEmit`, etc. are consistent with upstream.

**No task edit required.**

---

## Task Edits from Resolved Answers

### Task 0 Step 2 — Remote rename correction (from Q-P0-1 finding)

The original Step 2 assumes `origin` points to `excalidraw/excalidraw` after `gh repo fork --clone`. This is **incorrect**: `gh repo fork --clone` sets `origin` to the **fork** (`atlasdraw/atlasdraw`) and adds the upstream as `upstream` automatically. The rename sequence must be adjusted.

**Replace Step 2 with:**

```bash
cd atlasdraw
# gh repo fork --clone already sets:
#   origin  → atlasdraw/atlasdraw  (the fork)
#   upstream → excalidraw/excalidraw  (the source)
# Verify:
git remote -v
# Rename default branch master → main
git branch -m master main
git push -u origin main
gh repo edit --default-branch main
```

Expected: `origin` → `atlasdraw/atlasdraw`; `upstream` → `excalidraw/excalidraw`; default branch is `main`.

### Task 0 Step 3 — Add corepack prep (from Q-P0-2)

**Insert before `yarn && yarn dev`:**

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install
yarn dev
```

Expected: Corepack activates yarn 1.22.22 exactly; `yarn install` resolves without version mismatch errors.

### Task 1 Step 1 — Explicit workspaces array (from Q-P0-3)

Upstream `workspaces` is `["excalidraw-app", "packages/*", "examples/*"]`. Change to:

```json
"workspaces": ["excalidraw-app", "packages/*", "apps/*"]
```

Drop `examples/*` (no examples will be maintained in Atlasdraw). Retain `excalidraw-app` named entry — it remains an active workspace member through Phase 0.

### Task 9 Step 5 — Expand analytics removal to include Sentry and Firebase (from Q-P0-7)

In addition to removing `trackEvent` imports and calls, also remove or stub:
- `@sentry/browser` import and all `Sentry.*` calls (e.g., `Sentry.captureException`)
- `firebase` imports used in `excalidraw-app/data/firebase.ts` — stub the file as `export const loadFilesFromFirebase = async () => ({});` with comment `// stripped in Phase 0 — see ADR-0006`

The `trackEvent` import from `@excalidraw/excalidraw/analytics` can be deleted outright (no local stub needed). Verify full scope first: `grep -r "trackEvent\|Sentry\|firebase" excalidraw-app/ --include="*.ts" --include="*.tsx" -l`.

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->

| File | Action | Marker |
|------|--------|--------|
| `package.json` | patch | `"name": "atlasdraw"` |
| `LICENSE-AGPL` | create | `GNU AFFERO GENERAL PUBLIC LICENSE` |
| `LICENSE-MIT` | create | `MIT License` |
| `LICENSE-MPL` | create | `Mozilla Public License Version 2.0` |
| `LICENSING.md` | create | `LICENSING-MARKER: license-split-worked-examples` |
| `packages/geo/package.json` | create | `"@atlasdraw/geo"` |
| `packages/geo/tsconfig.json` | create | `extends` |
| `packages/geo/src/index.ts` | create | `@atlasdraw/geo — Coordinate transforms` |
| `packages/basemap/package.json` | create | `"@atlasdraw/basemap"` |
| `packages/basemap/tsconfig.json` | create | `extends` |
| `packages/basemap/src/index.ts` | create | `@atlasdraw/basemap — MapLibre wrapper` |
| `packages/data/package.json` | create | `"@atlasdraw/data"` |
| `packages/data/tsconfig.json` | create | `extends` |
| `packages/data/src/index.ts` | create | `@atlasdraw/data — File format readers` |
| `packages/tools/package.json` | create | `"@atlasdraw/tools"` |
| `packages/tools/tsconfig.json` | create | `extends` |
| `packages/tools/src/index.ts` | create | `@atlasdraw/tools — Geo-aware drawing tools` |
| `packages/sdk/package.json` | create | `"@atlasdraw/sdk"` |
| `packages/sdk/tsconfig.json` | create | `extends` |
| `packages/sdk/src/index.ts` | create | `@atlasdraw/sdk — Embed widget` |
| `packages/cli/package.json` | create | `"@atlasdraw/cli"` |
| `packages/cli/tsconfig.json` | create | `extends` |
| `packages/cli/src/index.ts` | create | `@atlasdraw/cli — Headless tooling` |
| `apps/atlas-app/package.json` | create | `"@atlasdraw/atlas-app"` |
| `apps/atlas-app/tsconfig.json` | create | `extends` |
| `apps/atlas-app/src/index.ts` | create | `@atlasdraw/atlas-app — Editor SPA` |
| `apps/realtime/package.json` | create | `"@atlasdraw/realtime"` |
| `apps/realtime/tsconfig.json` | create | `extends` |
| `apps/realtime/src/index.ts` | create | `@atlasdraw/realtime — WebSocket relay` |
| `infra/README.md` | create | `Implementation begins in Phase 4` |
| `decisions/0001-fork-vs-package.md` | create | `ADR-0001-MARKER: fork-vs-package` |
| `decisions/0002-license-split.md` | create | `ADR-0002-MARKER: license-split` |
| `decisions/0003-coord-system.md` | create | `ADR-0003-MARKER: coord-system` |
| `decisions/0004-upstream-merge-policy.md` | create | `ADR-0004-MARKER: upstream-merge-policy` |
| `decisions/0005-sdk-postmessage-contract.md` | create | `ADR-0005-MARKER: sdk-postmessage-contract` |
| `decisions/0006-telemetry.md` | create | `ADR-0006-MARKER: telemetry` |
| `decisions/upstream-patches.md` | create | `UPSTREAM-PATCHES-MARKER: register-initialized` |
| `scripts/check-license.sh` | create | `All packages have license fields` |
| `scripts/check-upstream-patches.sh` | create | `Upstream patch guard: OK` |
| `.github/workflows/ci.yml` | patch | `Atlasdraw CI` |
| `excalidraw-app/index.html` | patch | `<!-- stripped PWA in Phase 0 -->` |
| `excalidraw-app/src/App.tsx` | patch | `// stripped in Phase 0 — see ADR-0006` |
| `excalidraw-app/public/manifest.json` | delete | n/a |
| `excalidraw-app/data/firebase.ts` | patch | `// stripped in Phase 0 — see ADR-0006` |
| `excalidraw-app/package.json` | patch | `@sentry/browser` and `firebase` removed from dependencies |

<!-- shape-incorporated 2026-05-03: added firebase.ts (stub) and excalidraw-app/package.json (dep removal) per Q-P0-7 findings -->
<!-- PLAN_MANIFEST_END -->

---

## Shape Changes Summary

*Applied 2026-05-03 by shape-incorporator agent. Each entry cites the source Q and section edited.*

### Structural edits made (5 total)

| # | Section edited | Change | Source Q |
|---|---------------|--------|----------|
| 1 | **File Structure → excalidraw-app strip** | Expanded from one vague row to 7 explicit rows enumerating each affected file with its action and responsibility | Q-P0-7 |
| 2 | **Task 9 → split into Task 9a + Task 9b** | Original Task 9 (7+ files, two distinct strategies: deletion vs. stub) split into 9a (PWA/branding/collab URL, 4 files) and 9b (telemetry: trackEvent/Sentry/Firebase, 3 files); each task is ≤5 files and within the phasing rule | Q-P0-7 |
| 3 | **Wave 4 ordering** | Updated from `9 → 10 → 11` to `[9a ∥ 9b ∥ 10] → 11`; Tasks 9a, 9b, and 10 have disjoint file sets and can run concurrently | Q-P0-7 |
| 4 | **Open Questions → Wave 4 label** | Updated "Task 9: Strip" label to "Tasks 9a/9b: Strip" for consistency with task split; added note that Task 9b carries the Sentry stub strategy | Q-P0-7 |
| 5 | **Artifact Manifest** | Added two new rows: `excalidraw-app/data/firebase.ts` (patch/stub) and `excalidraw-app/package.json` (patch/dep removal) | Q-P0-7 |

### No-change judgments (one sentence each)

- **Q-P0-1 (org existence):** In-task fix in Task 0 Step 1 note is correct and sufficient; no structural implication.
- **Q-P0-2 (corepack):** Two-command precondition added inline to Task 0 Step 3; a standalone setup task would be over-engineering a 2-line prerequisite.
- **Q-P0-3 (workspaces glob):** In-task edit to Task 1 Step 1 is sufficient; no structural dependency change.
- **Q-P0-4 (vendored license fields):** Finding is permissive (fields already present); no task expansion required.
- **Q-P0-5 (tsconfig paths vs. references):** Confirms existing skeleton pattern is correct; no restructuring needed.
- **Q-P0-6 (stub barrel compilation):** Confirms outright that `export {}` compiles cleanly; no skill annotation or task change required.
- **Q-P0-7 (trackEvent/Sentry/Firebase):** Drove all 5 structural edits above.
- **Q-P0-8 (VITE_APP_ env vars):** Confirmed pattern is `import.meta.env`, not `process.env`; in-task note update only; no structural change.
- **Q-P0-9 (GitHub Actions confirmed):** Confirms existing Task 11 approach; no change.
- **Q-P0-10 (yarn confirmed):** Confirms existing tooling; no change.
- **Q1–Q13 (project-level):** These constraints are downstream of Phase 0 (Q1–Q4, Q7–Q10, Q12, Q13 affect later phases); Q5 and Q6 are already wired into ADRs 0002/0004 and the license split; no Phase 0 structural changes follow from them.

### Escalated concerns (STILL OPEN)

- **Sentry error boundary scope (from Task 9b Step 4):** If Sentry is wired into React's error boundary via a typed prop (e.g., `onError={Sentry.captureException}`), force-stubbing it may require a typed shim that exceeds simple Phase 0 deletion. Q-P0-7 research flagged this as medium-confidence. If the executor hits this during Task 9b, surface as a STILL OPEN rather than expanding Phase 0 scope — a Phase 0.1 patch task is cheaper than mis-stubbing an error boundary.
