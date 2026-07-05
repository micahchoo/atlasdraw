---
scope:
  - code/packages/excalidraw/components/**
  - code/packages/excalidraw/css/**
  - code/apps/atlas-app/src/styles/excalidraw-theme.css
tags: [design-system, migration]
priority: high
source: hand-written
---

# Vendored chrome: incremental ownership (ADR 0010)

The forked Excalidraw packages are fully owned — there is no upstream merge
to protect (ADR 0010). The `!important` override layer in
`apps/atlas-app/src/styles/excalidraw-theme.css` predates that decision and
is now a legacy mechanism, not a rule to follow.

**When you touch a vendored component for any reason:**

1. Migrate its styles to `--ad-*` design tokens at the source — edit the
   component's own CSS/SCSS in `packages/excalidraw` directly.
2. Delete the corresponding `!important` override from
   `excalidraw-theme.css` in the same change.
3. Never ADD a new override to `excalidraw-theme.css`. If a vendored
   component looks wrong, fix its source.

The theme file shrinks monotonically. When it's empty, delete it and this
rule's third scope entry.

Migration state: new vendored-component styling uses `--ad-*` tokens
directly (pattern B); the override layer is pattern A — don't extend it.
