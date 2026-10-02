---
paths:
  - code/apps/atlas-app/src/**
tags: [ui, tokens, invariant]
priority: high
source: hand-written
---

# atlas-app UI: one Button, one icon source, tokens for every scale

**A new button is `components/Button.tsx`.** Pick a `variant` — `primary`
for the one action a surface is for, `secondary` (the default),
`destructive` for an action that destroys, `ghost-icon` for an icon or a
glyph such as ×. Pick a `size`: `md` in a dialog, `sm` in a panel, a popover
or a row. A toggle takes `pressed`, which sets `aria-pressed`. A ghost-icon
button needs an `aria-label`; the type refuses one without it. `className`
places a button (width, margin, flex) and never restyles it. Before
2026-10-02 the app had about 25 button classes with their own padding,
radius and font size.

Some controls are not Buttons, on purpose: the atlas tool toggles in
Excalidraw's tool strip (`PinToolButton`, `MeasureToolButton`,
`CommentModeButton`, the place-search trigger) copy the fork's `ToolIcon`
from its variables, and tabs, menu items, listbox options, disclosure carets,
the layer row's reorder stepper, map markers and choice tiles are other
widgets. Do not force those onto Button, and do not copy their CSS for a new
button.

**An icon is a component from `lib/icons.tsx`.** It draws in
`currentColor` on a 24×24 viewBox, takes its size from CSS through
`className`, and is `aria-hidden`. Where the app sits beside Excalidraw's
chrome, the icon is Excalidraw's own, re-exported there, so the two match.
`lib/__tests__/icons.test.tsx` refuses an inline `<svg>` anywhere else,
except three drawings: the remote cursors (`CursorOverlay`), the measured
path (`MeasureLayer`) and the compass dial that turns with the map
(`MapCompass`). Map geometry is a drawing, not an icon.

**Colours, font sizes, radii and z-index come from `styles/tokens.css`.**
`styles/__tests__/tokens.test.ts` refuses a literal in a CSS module, and a
token name that tokens.css does not define (a misspelt z-index token
computes to `auto`, with no error). Allowed literals: `0`, `50%` and
keywords. A z-index inside a component's own stacking context uses
`--ad-z-raised` / `--ad-z-pinned`, with `calc()` for "one over that". A new
band on the ladder is a new token between two others, with a comment that
says what paints above and below it.

Verify with `cd code && npx vitest run apps/atlas-app/src/styles
apps/atlas-app/src/lib/__tests__/icons.test.tsx
apps/atlas-app/src/components/__tests__/Button.test.tsx`.
