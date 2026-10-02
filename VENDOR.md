# Vendored sources

## `code/` — Excalidraw fork (inlined)

Atlasdraw is built on a fork of [Excalidraw](https://github.com/excalidraw/excalidraw). The fork lives inlined under `code/` as plain files, with no embedded git repo and no submodule. The forked packages are `code/packages/{excalidraw,element,math,common,utils}`. The Atlasdraw packages (`apps/*`, `packages/{basemap,data,geo,tools,protocol,cli}`) sit beside them.

**Upstream pin (the one fork point):**

- Repo: `https://github.com/excalidraw/excalidraw.git`
- Commit: `2dfcc6f0ce4ce007e0360324e63f02ffc7b7fc1a` (master, 2026-05-02)
- Title: `chore: Remove startBoundElement from state (#11264)`

The packages still say `0.18.0`, but this commit is 14 months past the 0.18.0 tag. A security advisory against 0.18.x does not map onto this code line for line.

**The fork is owned, not tracked** (`code/decisions/0010-own-the-fork.md`). Nothing syncs upstream. Port a security fix by hand: read the upstream diff from the pin forward, apply it, and run the gates.

```bash
git clone https://github.com/excalidraw/excalidraw.git /tmp/excalidraw-upstream
cd /tmp/excalidraw-upstream
git log --oneline 2dfcc6f..HEAD -- packages/excalidraw packages/element packages/common packages/math packages/utils
```

**What Atlasdraw changed in the fork.** The comments in the fork mark each extension point (sidebar tabs, context-menu items, collar mode, toolbar extras, search sources, sidebar width, viewport export). The props marked "Atlasdraw addition" in `excalidraw/types.ts` are the seams the map needs: `stampNewElements` (every new element), `historyHost` (one undo history), `placementBlocked` (no paste or nudge on a turned map), `onSceneFileDrop` and `screenSizedStyles`. Atlasdraw also removed upstream features that mean nothing on a map: the frame, embeddable, laser and magic-frame tools, Mermaid and text-to-diagram, every locale except English, and the upstream image-export and `.excalidraw` save doors. Old documents still open. Their `iframe` and `embeddable` elements are dropped and counted, because they rendered live web pages. `git log -- code/packages` holds the full record.
