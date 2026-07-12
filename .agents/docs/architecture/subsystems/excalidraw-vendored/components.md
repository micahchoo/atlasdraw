# `excalidraw-vendored` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (upstream Excalidraw license; see packages/excalidraw/LICENSE)
**Covers:** `packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`
**Phase:** Vendored at Phase 0 (git fork of `excalidraw/excalidraw`); patches applied incrementally per phase

---

## Overview

These four packages are vendored upstream from [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw). They are treated as a library, not as first-party code. Atlasdraw adds new packages (`packages/geo`, `packages/basemap`, etc.) rather than modifying vendored code. The only permitted modifications are in `packages/excalidraw` — the other three packages (`element`, `math`, `common`) are untouched.

**Patch policy:** Quarterly upstream review cycle (Q6, decisions/0004-upstream-merge-policy.md). Every modification to a vendored file must be logged in `decisions/upstream-patches.md` and passes CI guard (`scripts/check-upstream-patches.sh`).

This document describes the seam — what we patch, what we wrap, and what is off-limits — not the full upstream API surface.

---

## Package Summaries

### `packages/excalidraw`
**Upstream status:** Patched (only vendored package where patches are permitted)
**Responsibility:** The main Excalidraw React application package. Exports `<Excalidraw>` component, `ExcalidrawAPI`, tool registration (`customTools`/`setActiveTool`), and the canvas renderer.
**Our patches (expected at Phase 7):** [CONFIDENCE: med]
- `customData.geo` type augmentation — `ExcalidrawElement.customData` is typed as `unknown` upstream; we narrow it via TypeScript module augmentation in `packages/geo/types.ts` (no patch needed — module augmentation is additive).
- `viewBackgroundColor: "transparent"` default applied in `apps/atlas-app` via props — no patch.
- Any canvas hit-testing or pointer-event behavior that cannot be configured via props — logged in `decisions/upstream-patches.md` per Q6.
**Known needed patches:** pointer-event hijack for map pan (Phase 1), disabling Excalidraw's native scroll/pan when no draw tool is active — may require patching `packages/excalidraw/App.tsx` event handlers.
[CONFIDENCE: med — Phase 1 plan describes hijacking wheel/drag events; whether this requires a patch vs. prop configuration is TBD]

### `packages/element`
**Upstream status:** No patches (per Phase 0 architecture diagram)
**Responsibility:** Excalidraw element type definitions and element mutation utilities. `ExcalidrawElement`, `ExcalidrawLinearElement`, etc.
**Our use:** Type imports only. We add `customData.geo` via TypeScript module augmentation in `packages/geo/types.ts` — not by modifying this package.
**Complexity:** ~3000 lines upstream (estimated); we touch 0 lines.
[CONFIDENCE: high — per Phase 0 plan architecture diagram "no patches"]

### `packages/math`
**Upstream status:** No patches
**Responsibility:** Excalidraw's internal 2D geometry math: vector operations, rotation, hit-testing, bezier curves. Pure functions.
**Our use:** Not directly imported by Atlasdraw packages. Used internally by `packages/excalidraw`.
**Complexity:** ~1500 lines upstream; we touch 0 lines.
[CONFIDENCE: high — per Phase 0 plan]

### `packages/common`
**Upstream status:** No patches
**Responsibility:** Shared utilities, constants, type guards used across Excalidraw packages. `FONT_FAMILY`, `MIME_TYPES`, utility functions.
**Our use:** Occasional constant imports (`MIME_TYPES`, etc.) in `packages/data`.
**Complexity:** ~1000 lines upstream; we touch 0 lines.
[CONFIDENCE: high — per Phase 0 plan]

---

## Patch Register Protocol

Every patch to `packages/excalidraw` requires:
1. A new entry in `decisions/upstream-patches.md` with: file, line range, reason, date, author.
2. CI guard (`scripts/check-upstream-patches.sh`) validates that no vendored file is modified without a matching patch entry. PRs that modify `packages/excalidraw/**` without a patch entry fail CI.

**Hard exit threshold (Q6):** If the quarterly upstream merge produces conflicts in >20% of patched lines, or if upstream makes breaking changes to `ExcalidrawAPI` surface that require >3 new patches, an architectural review is triggered to evaluate extracting a narrower interface or abandoning the fork.
[CONFIDENCE: high — per Q6, decisions/0004-upstream-merge-policy.md]
