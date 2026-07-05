# Upstream Patches Register

> **CLOSED 2026-07-04 per ADR 0010.** The fork is permanent and fully owned; vendored-package changes no longer require register entries, and the `check-patches.sh` CI guard is retired. Kept for historical reference.

This file tracks every modification to vendored Excalidraw packages (`packages/excalidraw`, `packages/element`, `packages/math`, `packages/common`). Every patch has an entry. CI fails any PR that modifies a vendored file without adding to this register (see `scripts/check-patches.sh`).

The register exists because we re-merge `upstream/master` monthly per ADR 0004. Without it, conflicts during merge become archaeology. With it, conflicts become a checklist.

## Conventions

- Add a new entry whenever a PR modifies any file under the vendored packages
- Each entry is dated, attributed, and linked to a PR
- Mark entries OBSOLETE rather than deleting when an upstream change makes the patch unnecessary
- Quarterly review: re-evaluate each non-OBSOLETE entry; can it be upstreamed instead?

## Entry format

```
### YYYY-MM-DD — <patch-slug> (#PR)
- **Files**: <list>
- **Reason**: <why this patch exists — load-bearing, in one sentence>
- **Contributor**: @handle
- **Upstream proposal**: <link to upstream issue/PR if applicable, "none" otherwise>
- **Re-evaluate**: <next quarterly review date>
- **Status**: ACTIVE | OBSOLETE | UPSTREAMED
```

## Active patches

(none yet — Phase 0 is bootstrap; first real patches expected in Phase 1)

## Obsolete patches

(none)

## Notes

- The CI guard (`scripts/check-patches.sh`) inspects `git diff --name-only origin/main...HEAD` against vendored package paths
- If a patch fundamentally cannot be expressed as a small diff (e.g., needs to swap a renderer wholesale), consider whether to fork the file into `packages/<our-fork-name>` instead and import the new path from app code
- Per ADR 0004 exit threshold: if more than 50% of patches are breaking on monthly merges, the team escalates to abandon-merge discussion
