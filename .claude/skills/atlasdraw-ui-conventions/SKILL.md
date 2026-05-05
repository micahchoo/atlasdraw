---
name: atlasdraw-ui-conventions
description: >
  Atlasdraw atlas-app UI design conventions. Invoke before implementing any
  new button, panel, overlay, toolbar item, or visual feature in
  apps/atlas-app. Covers surface selection, CSS approach, color tokens,
  z-index ladder, button/icon/text styling, accessibility requirements, and
  the "slot first" rule.
triggers:
  - labels: [visible-ux, ux]
  - paths: [code/apps/atlas-app/src/components/*, code/apps/atlas-app/src/styles/*]
  - keywords: [button, panel, overlay, toolbar, sidebar, modal, popup, dialog, context menu, css, style, icon]
---

# Atlasdraw UI Conventions

Read this before writing any atlas-app UI. Source of truth:
- `MapEditor.tsx` + `MapEditor.module.css` — existing atlas-app patterns
- `packages/excalidraw/css/variables.module.scss` — Excalidraw design tokens
- `packages/excalidraw/css/theme.scss` — Excalidraw CSS custom properties
- `packages/excalidraw/components/FilledButton.scss` — button size/weight reference

---

## Rule 0 — Slot First, Create Never

**Before creating any new surface, exhaust every existing one. New panels and
floating elements are the last resort.**

"I need a button for X" is not sufficient justification for a new surface.
"I need a place to show X" is not either. Ask: which existing surface already
owns this category?

Decision tree — work top-to-bottom, stop at the first match:

| Need | Correct slot |
|---|---|
| Toggle an atlas tool on/off | Top-left button group (`top:12px, left:12px`, z-index 10) — extend horizontally alongside `pinButton` |
| Layer / data-layer management | `<Sidebar>` tab → `LayerPanel.tsx` (Phase 2 surface) |
| Per-element contextual action | Right-click context menu (`role="menu"`, position:fixed, z-index 100) |
| App-wide action (export, share, settings) | Excalidraw `<MainMenu>` replacement → `Toolbar.tsx` |
| Transient status / one-liner feedback | `ui.setStatusBarMessage()` — no new DOM |
| Truly standalone multi-step workflow | New modal/dialog — **only** if none of the above fits (ImportDialog, ShareDialog are correct; a new "layer opacity" slider is not) |

**Failure mode to avoid:** adding a free-floating `<div>` on the canvas for
something that belongs in `LayerPanel` or the context menu. If it's a control
that appears outside the normal flow of interaction, it almost certainly belongs
in an existing surface instead.

---

## Z-Index Ladder

Do not invent new z-index values. Extend by inserting between existing bands
only, with an explicit comment in `MapEditor.module.css` explaining why.

| Surface | z-index | CSS class / element |
|---|---|---|
| Map (MapLibre GL) | 0 | `.mapLayer` |
| Excalidraw canvas | 1 | `.excalidrawLayer` — Excalidraw's own toolbar/sidebar float internally above this |
| Atlas tool overlay | 5 | `.atlasToolOverlay` — transparent, interaction capture only, no visual chrome |
| Toolbar buttons / banners | 10 | `.pinButton` and siblings, demo banners |
| Context menus | 100 | `position:fixed`, dismiss on `onMouseLeave` |

---

## CSS Approach

**CSS Modules for all persistent styles. Inline `style={}` only for values
computed at runtime.**

```
src/styles/ComponentName.module.css   ← one file per component
```

```tsx
import styles from "../styles/ComponentName.module.css";

// static
<div className={styles.root}>

// conditional — match this pattern exactly
<button
  className={[styles.pinButton, isActive ? styles.pinButtonActive : ""]
    .filter(Boolean)
    .join(" ")}
/>
```

**Inline `style={}` is only correct for:**
- `cursor` set from `tool.cursor` (runtime value from the tool definition)
- `left` / `top` from a pointer event (`contextMenu.x`, `contextMenu.y`)
- Throwaway demo banners that will be removed before feature ships

**Never:**
- Global CSS class names from other files
- Tailwind (not installed)
- CSS-in-JS libraries
- Inline `style={}` for anything that could be a `.module.css` class

---

## Color Tokens

Atlas-app uses literal hex values. These are Bootstrap 5's scale, the same
values as Excalidraw's SCSS variables — they are deliberately aligned.

### Atlas-side palette (atlas-app only, no CSS vars yet)

| Role | Hex | Excalidraw SCSS equivalent |
|---|---|---|
| Background white | `#ffffff` | `$color-gray-1` bg / `--island-bg-color` |
| Background hover | `#f8f9fa` | `$color-gray-1` = `#f1f3f5` (close) |
| Border default | `#adb5bd` | `$color-gray-5` = `#adb5bd` (exact match) |
| Text default | `#212529` | `$color-gray-8` = `#343a40` (close) |
| Primary active | `#1971c2` | `$color-blue-8` = `#1971c2` (exact match) |
| Primary active hover | `#1864ab` | `$color-blue-7` = `#1c7ed6` (close) |
| Scrim (dark overlay bg) | `rgba(0,0,0,0.65)` | — |
| Context menu border | `#ccc` | `$color-gray-4` = `#ced4da` (close) |

**Do not invent new hex values.** If the role doesn't exist in this table, check
`packages/excalidraw/css/variables.module.scss` for the nearest grey or blue.
Use that value, and add it to this table when you do.

### Excalidraw CSS variables (available inside `.excalidraw` scope)

When new UI renders inside the Excalidraw tree (e.g. a Sidebar tab panel):

```
--color-primary: #6965db        /* Excalidraw brand purple — for Excalidraw-native buttons */
--default-button-size: 2rem     /* 32px — square icon buttons */
--lg-button-size: 2.25rem       /* 36px */
--default-icon-size: 1rem       /* 16px — SVG inside icon buttons */
--lg-icon-size: 1rem            /* same for large variant */
--island-bg-color: #ffffff      /* panel / island background */
--default-border-color: var(--color-surface-high)
--button-hover-bg: var(--color-surface-high)
--border-radius-lg: (varies)    /* use for outline buttons inside Excalidraw */
```

Atlas-side UI outside the Excalidraw tree (overlay buttons, toolbar) uses the
hex literals above, not Excalidraw CSS vars — those are only defined inside the
`.excalidraw` class scope.

---

## Buttons

### Three button types in the codebase

#### 1. Atlas toolbar button (text label, absolute-positioned)

The current pattern — `pinButton` in `MapEditor.module.css`.
Use for: atlas tool toggles in the top-left button group.

```css
/* default */
position: absolute;
top: 12px;
left: 12px;       /* or offset for next button: left: calc(12px + prev-width + gap) */
z-index: 10;
padding: 6px 12px;
border: 1px solid #adb5bd;
border-radius: 4px;
background: #ffffff;
color: #212529;
font-size: 14px;
cursor: pointer;
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);

/* hover */
background: #f8f9fa;

/* active/engaged (aria-pressed=true) */
background: #1971c2;
color: #ffffff;
border-color: #1971c2;

/* active hover */
background: #1864ab;
```

#### 2. Icon-only button (square, 32px)

Use for: toolbar icon buttons, layer panel actions.
Follows Excalidraw's `outlineButtonIconStyles` mixin when inside Excalidraw scope.

```css
display: flex;
justify-content: center;
align-items: center;
width: 2rem;      /* 32px — --default-button-size */
height: 2rem;
padding: 0;
border: 1px solid #adb5bd;
border-radius: 4px;
background: #ffffff;
color: #212529;
cursor: pointer;

/* hover */
background: #f8f9fa;

/* active/engaged */
background: #1971c2;
color: #ffffff;
border-color: #1971c2;
```

#### 3. Context menu action button

Borderless, text-only, full-width inside the menu container.

```css
display: block;
width: 100%;
padding: 4px 8px;
border: none;
background: transparent;
color: #212529;
font-size: 13px;
text-align: left;
cursor: pointer;

/* hover */
background: #f8f9fa;

/* disabled */
color: #adb5bd;
cursor: not-allowed;
```

---

## Icons

**Atlas-app has no icon library.** Excalidraw uses inline SVG with `currentColor`.
Follow the same pattern for any new atlas-side icons.

### Rules

- **Inline SVG only** — no `<img>`, no CSS `background-image`, no icon font, no emoji in buttons
- **Use `currentColor`** — stroke and fill should inherit from the parent's `color`, so hover/active state color changes propagate automatically
- **Size via CSS** — set `width` and `height` on the `svg` element from the parent's class, not as SVG attributes
- **No hardcoded fill colors** — `fill="currentColor"` or `fill="none" stroke="currentColor"`
- **16px default, 20px large** — matches Excalidraw's `--default-icon-size: 1rem` / `--lg-icon-size: 1rem`

### SVG template

```tsx
/* in ComponentName.module.css */
.icon {
  width: 1rem;   /* 16px */
  height: 1rem;
  flex-shrink: 0;
}
```

```tsx
<button type="button" className={styles.iconButton}>
  <svg
    className={styles.icon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="..." />
  </svg>
  <span className={styles.srOnly}>Accessible label</span>
</button>
```

```css
/* visually hidden but screen-reader visible */
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

For icon buttons that also have a visible text label, omit `srOnly` — the text
is the accessible label. Don't double-label with both visible text and `aria-label`.

---

## Text & Typography

### Font stack

```css
font-family: "system-ui, sans-serif";  /* atlas-side overlays, toolbar, banners */
```

Inside Excalidraw scope: `font-family: var(--ui-font)` — let the theme provide it.

### Size ladder

| Role | Size | Weight | Notes |
|---|---|---|---|
| Button label | `14px` (`0.875rem`) | 600 | Atlas toolbar buttons |
| Secondary label / banner | `13px` | 400 | Demo banners, context menu items |
| Panel body text | `12px` (`0.75rem`) | 400 | Layer panel rows, status text |
| Metadata / keybinding hint | `11px` | 400 | Below primary labels |

Excalidraw's own large button size: `font-size: 0.875rem; font-weight: 600`
Excalidraw's medium button: `font-size: 0.75rem; font-weight: 600`

### Text in context menus

`font-size: 13px` — matches the scrim banner. Do not use `14px` in menus;
it reads as a button, not a menu item.

### Don't use bold for body text

Bold (`font-weight: 600+`) is only for button labels and headings inside panels.
Layer names, attribute values, and status messages are `font-weight: 400`.

---

## Shadows & Elevation

| Surface | Shadow |
|---|---|
| Atlas toolbar button | `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12)` |
| Island / panel | `--shadow-island` (Excalidraw var, inside `.excalidraw` scope) |
| Modal / dialog | `--modal-shadow` (Excalidraw var) |
| Sidebar | `--sidebar-shadow` (Excalidraw var) |
| Context menu | None — the `border: 1px solid #ccc` provides the boundary |

---

## Spacing

| Role | Value |
|---|---|
| Toolbar button padding | `6px 12px` |
| Toolbar anchor (top-left) | `top: 12px; left: 12px` |
| Gap between adjacent toolbar buttons | `8px` |
| Context menu container padding | `4px` |
| Context menu item padding | `4px 8px` |
| Border radius — buttons | `4px` |
| Border radius — banners / popups | `6px` |

---

## Accessibility — Non-Negotiable

| Element | Requirement |
|---|---|
| All `<button>` | `type="button"` (prevents form submit) |
| Toggle buttons | `aria-pressed={boolean}` |
| Icon-only buttons | `aria-label="..."` OR visually-hidden `<span>` child |
| Disabled actions | `disabled` attr + `aria-disabled="true"` + `title` explaining why |
| Context menus | `role="menu"` on container |
| Every interactive element | `data-testid="..."` — Playwright reads these |
| SVG decorative | `aria-hidden="true"` on the `<svg>` |

Toggle button template:

```tsx
<button
  type="button"
  className={[styles.pinButton, isActive ? styles.pinButtonActive : ""]
    .filter(Boolean)
    .join(" ")}
  onClick={() => setActive(!isActive)}
  aria-pressed={isActive}
  data-testid="pin-tool-button"
>
  Pin
</button>
```

---

## Context Menu Pattern

```tsx
{contextMenu && (
  <div
    role="menu"
    data-testid="my-context-menu"
    style={{
      position: "fixed",
      left: contextMenu.x,
      top: contextMenu.y,
      zIndex: 100,
      background: "#fff",
      border: "1px solid #ccc",
      padding: 4,
    }}
    onMouseLeave={() => setContextMenu(null)}
  >
    {canDoAction ? (
      <button type="button" onClick={handleAction} data-testid="action-button">
        Action label
      </button>
    ) : (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Why this is unavailable"
        data-testid="action-button-disabled"
      >
        Action label (unavailable)
      </button>
    )}
  </div>
)}
```

Position and z-index are the **only** justified uses of inline `style` here.
Everything else goes in a CSS module.

---

## Layer Surfaces — Quick Reference

```
<div className={styles.root}>                       ← z:relative, overflow:hidden
  <div className={styles.mapLayer}>                 ← z:0 — MapLibre GL
    <MapCanvas />
  </div>
  <div className={styles.excalidrawLayer [+ Active]}> ← z:1 — Excalidraw + its UI
    <Excalidraw ... />
  </div>
  {activeAtlasTool && (
    <div className={styles.atlasToolOverlay} />     ← z:5 — transparent, events only
  )}
  <button className={styles.pinButton [+ Active]}/> ← z:10 — top-left button group
  {contextMenu && <div role="menu" style={{zIndex:100}}/>}  ← context menu
</div>
```

New atlas-side controls land at **z:10** in the toolbar group or as a new
CSS-module class at the appropriate band. They do **not** create new z-index
bands without updating this table and adding a comment in `MapEditor.module.css`.

---

## File Placement

| What | Where |
|---|---|
| New component | `code/apps/atlas-app/src/components/MyComponent.tsx` |
| New CSS module | `code/apps/atlas-app/src/styles/MyComponent.module.css` |
| New hook | `code/apps/atlas-app/src/hooks/useMyHook.ts` |
| Sidebar tab | Render inside `<Excalidraw>` via `renderSidebar` prop |
| SVG icon | Inline in component; no separate icon file |

---

## Pre-Ship Checklist

- [ ] **Surface decision:** checked the decision tree; documented why a new surface was needed if one was created
- [ ] **CSS Module:** all persistent styles in `src/styles/*.module.css`, not inline
- [ ] **Colors:** match the hex token table; no new values invented
- [ ] **Z-index:** correct band; comment added in `MapEditor.module.css` if a new band
- [ ] **Icons:** inline SVG, `currentColor`, `aria-hidden="true"`, `width`/`height` from CSS
- [ ] **Text:** correct size/weight for the role
- [ ] **`type="button"`** on every `<button>`
- [ ] **`aria-pressed`** on toggles
- [ ] **`aria-disabled` + `title`** on disabled actions
- [ ] **`data-testid`** on every interactive element
- [ ] **Context menu:** `role="menu"`, `onMouseLeave` dismiss, `position:fixed`
- [ ] **Conditional class:** uses `.filter(Boolean).join(" ")` pattern
