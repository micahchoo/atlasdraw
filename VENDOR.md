# Vendored sources

## `code/` — Excalidraw fork (inlined)

Atlasdraw is built on a fork of [Excalidraw](https://github.com/excalidraw/excalidraw). The fork lives inlined under `code/` as plain files (no embedded git repo, no submodule). Atlasdraw-specific packages (`apps/atlas-app/`, `packages/{atlasdraw-*,basemap,data,geo,tools,sdk,cli}`) sit alongside the original Excalidraw monorepo packages.

**Upstream pin (initial fork point):**
- Repo: `https://github.com/excalidraw/excalidraw.git`
- Commit: `2dfcc6f0ce4ce007e0360324e63f02ffc7b7fc1a`
- Title: `chore: Remove startBoundElement from state (#11264)`

**Syncing upstream changes** (manual, since there's no embedded git):
```bash
git clone https://github.com/excalidraw/excalidraw.git /tmp/excalidraw-upstream
cd /tmp/excalidraw-upstream
git log --oneline 2dfcc6f..HEAD -- packages/excalidraw packages/element packages/common
# review diffs, copy relevant changes into atlasdraw's code/ tree, run gates
```

**Atlasdraw additions on top of the fork** are documented in:
- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md` (Phase 1)
- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` (Phase 2)

If a future maintainer wants to re-establish a clean upstream-tracking workflow, the recommended migration is to convert `code/` to a git submodule pointing at a long-lived `excalidraw-atlasdraw-fork` repo. See [git submodule docs](https://git-scm.com/book/en/v2/Git-Tools-Submodules).
