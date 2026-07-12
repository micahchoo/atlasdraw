# `excalidraw-vendored` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (upstream)
**Covers:** `packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`

---

## Package Relationship Graph

```
packages/excalidraw      ← main package; patches allowed; React component
       │
       ├── packages/element    ← element types; no patches; type imports only
       │
       ├── packages/math       ← 2D geometry math; no patches; internal to excalidraw
       │
       └── packages/common     ← shared utils/constants; no patches
```

Atlasdraw imports from `packages/excalidraw` only (the public API). Direct imports from `packages/element`, `packages/math`, or `packages/common` are done only when the symbol is not re-exported by `packages/excalidraw`.

---

## Import Topology (from Atlasdraw packages)

```
packages/geo            → packages/excalidraw (ExcalidrawElement types, ExcalidrawAPI)
packages/tools          → packages/excalidraw (ExcalidrawAPI, element types)
packages/data           → packages/excalidraw (ExcalidrawElement for atlasdraw.ts)
packages/sdk            → packages/excalidraw (SerializedElement type alignment)
apps/atlas-app          → packages/excalidraw (<Excalidraw> component, ExcalidrawAPI)
```

`packages/basemap`, `packages/cli` do NOT import from vendored packages.

---

## Layering Rules

1. **`packages/element`, `packages/math`, `packages/common` are read-only.** Zero patches, zero direct modifications. If a symbol needed from these packages is not re-exported by `packages/excalidraw`, it is copied (not re-exported) into a local Atlasdraw utility file — to be replaced at the next upstream merge.
2. **Patches to `packages/excalidraw` are the exception, not the rule.** Every patch must have a migration path (how we'll eliminate it at next upstream merge).
3. **The `decisions/upstream-patches.md` register is the canonical list of all active patches.** If a patch file is not listed there, CI fails.
4. **Module augmentation is preferred over patches.** TypeScript `declare module` augmentation in `packages/geo/types.ts` extends `ExcalidrawElement.customData` without touching vendored source. This is the canonical approach.

---

## Upstream Merge Process (Q6 — Quarterly)

```
git fetch upstream
git merge upstream/master
  │
  ├── Auto-merge succeeds → run CI
  │     └── fail → identify breaking change → new patch entry or API update
  │
  └── Conflict in packages/excalidraw/**
        ├── resolve manually
        ├── update decisions/upstream-patches.md (line ranges may shift)
        └── CI patch-guard validates new patch entries

Post-merge checklist (decisions/0004-upstream-merge-policy.md):
  □ AppState field names unchanged (activeTool, scrollX/Y, zoom.value)
  □ ExcalidrawAPI method signatures unchanged (updateScene, getSceneElements, setActiveTool)
  □ customTools prop behavior unchanged
  □ captureUpdate:"never" still accepted by updateScene
  □ No breaking changes to ExcalidrawElement core fields
```

**Hard exit threshold (Q6):** If merge conflicts affect >20% of patched lines or require >3 new patches, trigger architectural review: evaluate narrowing the integration to a stable plugin API rather than a full fork.

[CONFIDENCE: high — per Q6, decisions/0004-upstream-merge-policy.md]

---

## Knot Complement

| Package | Can refactor independently? | Notes |
|---------|------------------------------|-------|
| `packages/element` | N/A — no patches | Fully upstream; refactor = upstream PR |
| `packages/math` | N/A — no patches | Same |
| `packages/common` | N/A — no patches | Same |
| `packages/excalidraw` | Partially | Patches can be revised; upstream changes drive the refactor window |

---

## CI Guards

Two CI jobs protect the vendored packages:

1. **`patch-guard`** (`scripts/check-upstream-patches.sh`): Fails if any file under `packages/excalidraw/`, `packages/element/`, `packages/math/`, or `packages/common/` is modified (per `git diff upstream/master`) without a matching entry in `decisions/upstream-patches.md`.

2. **`license-check`** (`scripts/check-license.sh`): Verifies each vendored package.json retains its MIT license field. Fails if the upstream license field is removed or changed.

[CONFIDENCE: high — per Phase 0 plan CI setup]
