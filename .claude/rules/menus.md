---
paths:
  - code/apps/atlas-app/src/commands/**
  - code/apps/atlas-app/src/components/MapEditor.tsx
  - code/apps/atlas-app/src/components/LayerPanel.tsx
  - code/apps/atlas-app/src/components/Menu.tsx
  - code/packages/excalidraw/components/ContextMenu.tsx
tags: [commands, menus, context-menu]
priority: high
source: hand-written
---

# Menus: one command list, and the right-click menus are built from it

The palette and the right-click menus once listed different things. Edit pin
details was in the palette only; Convert selection to data layer was in the
right-click menu only. Now one list holds both.

## The contract

- **A right-click item of the drawing is a `Command`** in
  `commands/commands.ts`. The command names its menus in `contexts`:
  `canvas` (no shape), `element` (shapes), `pin` (one pin selected),
  `feature` (the canvas menu over a data feature).
- **`commands/contextMenus.ts` is the one caller of
  `registerContextMenuItem`.** It registers one fork item per context. Do not
  register an item anywhere else. Then the menu cannot hold a thing that the
  palette does not have.
- `contextMenus.test.ts` fails when an item is not a command, when a command
  that names a menu is not registered, or when the palette does not list it.
- A menu gives the command a `MenuTarget` (the context and the point). With
  it, the command acts at the click: "Pin here" places the pin there, and
  "Zoom to feature" (`view.zoom-selection` over a feature) fits that feature.
  The palette gives no target, and the command acts on the selection.
- Give a command a menu form only if it can act at the click honestly.
  Measure cannot: its path lives in `MeasureLayer`. So the menu arms it.
- The fork's own items stay: Paste and Select all on the canvas; cut, copy,
  z-order, group, lock and delete on a shape. They act on the one thing
  clicked and are not commands.

## The upstream canvas toggles, measured over a map (2026-10-01)

`MapEditor` passes `canvasMenuToggles={false}`, so the fork's canvas menu has
none of them. Each was tested in Chromium over the map.

| Toggle            | Verdict                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Snap to objects   | Kept, `edit.snap-objects`. A dragged box snapped its edge to another box.                       |
| Arrow binding     | Kept, `edit.arrow-binding`. A bound arrow followed its box; off, it did not bind.               |
| Snap to midpoints | Kept, `edit.snap-midpoints`. The arrow end snapped to the edge midpoint (0, 0.5).               |
| Grid              | Gone. A 20-unit grid is far below one pixel in world coordinates; nothing draws.                |
| Zen mode          | Gone, and `zenModeEnabled={false}`. It threw the shape panel onto the map and gave no way back. |
| View mode         | Gone. `viewModeEnabled={readOnly}` owns it; a toggle would fight the map's read-only state.     |
| Stats             | Gone. It shows Mercator pixels at zoom 22 (X 430784147). The measure chip shows real sizes.     |

The kept three set `AppState` as the upstream actions do. If an upstream
action changes, change its command too. Their keys (Alt+S) stay the
drawing's. Ctrl+' still sets `gridModeEnabled` although the prop is false.

## Where a fork item is shown

The fork appends host items behind one separator, after its own items, and
not in view mode. `ContextMenu.tsx` draws no separator at either end, because
the predicates can hide every host item.

Verify with `cd code && npx vitest run apps/atlas-app/src/commands
packages/excalidraw/tests/atlasContextMenuItems.test.tsx`, then in
`apps/atlas-app`: `E2E_PORT=5350 npx playwright test e2e/context-menus.spec.ts
--project=chromium`.
