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
- `src/styles/tokens.css` — the atlas-app design tokens (`--ad-*`)
- `src/components/Modal.tsx` — the one way a dialog is modal
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
| Toggle an atlas tool on/off | The drawing's tool strip in the collar: `renderToolbarExtras` in `MapEditor.tsx`, beside `PinToolButton`, `MeasureToolButton` and `CommentModeButton` |
| Layer / data-layer management | `<Sidebar>` tab → `LayerPanel.tsx` |
| Per-layer contextual action | The layer row's actions menu in `LayerPanel.tsx` (`role="menu"`, `menuitem`s, arrow keys) |
| App-wide action (export, share, settings) | A `Command` in `commands/commands.ts`. Put its id in `MAIN_MENU` and the main menu (`EditorMenu.tsx`), the palette and the shortcuts panel all show it |
| Transient feedback | `session.notify` (the toasts), or `useAnnounce()` for words only a screen reader needs — no new DOM |
| Truly standalone multi-step workflow | A dialog in the slot (`view.openDialog`, shown by `EditorDialogs.tsx`), rendered through `Modal` — **only** if none of the above fits (Export and Share are correct; a new "layer opacity" slider is not) |

**Failure mode to avoid:** adding a free-floating `<div>` on the canvas for
something that belongs in `LayerPanel` or the context menu. If it's a control
that appears outside the normal flow of interaction, it almost certainly belongs
in an existing surface instead.

---

## Z-Index Ladder

The ladder is the `--ad-z-*` tokens in `src/styles/tokens.css`, named by
role: map, drawing, cursor, legend, tool overlay, neatline, overlay (hints,
banners, popups, presence, compass, handles), toast, popover and dialog.
`styles/__tests__/tokens.test.ts` refuses a literal z-index in a module.

- New atlas-side chrome over the plate is `var(--ad-z-overlay)`.
- Inside a component's own stacking context, use `--ad-z-raised` and
  `--ad-z-pinned`, and `calc()` for "one over that".
- A new band is a new token between two others, with a comment in
  tokens.css that says what paints above and below it.
- `.excalidrawLayer` is a stacking context: Excalidraw's own z-indices (the
  sidebar's 120, the collar legend's 4) stay inside it.

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
  className={[styles.toolButton, isActive ? styles.toolButtonActive : ""]
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

**New UI uses the `--ad-*` custom properties in `src/styles/tokens.css`**
(surfaces, ink, accent, rules, focus ring, danger/caution/confirm, the
spacing and radius scales, fonts). `high-contrast.css` redefines them, so a
literal hex skips the high-contrast theme.

Some CSS Modules and the older inline-styled dialogs (About, Share, the
asset library) still carry the literals below. Replace one with its token
when you touch the file for another reason.

### Legacy literals and their tokens

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
| Row separator (panel) | `var(--default-border-color)` inside `.excalidraw` scope | — |
| Secondary metadata text | `var(--text-primary-color)` at 0.6 opacity inside `.excalidraw` scope; `#868e96` outside | `$color-gray-6` = `#868e96` |
| Data layer kind badge — bg | `#dbeafe` | — (Tailwind blue-100; new role) |
| Data layer kind badge — text | `#1e3a8a` | — (Tailwind blue-900; new role) |
| Annotation kind badge — bg | `#fef3c7` | — (Tailwind amber-100; new role) |
| Annotation kind badge — text | `#92400e` | — (Tailwind amber-900; new role) |

**Do not invent new hex values.** If the role has no token, add one to
`tokens.css` (and to `high-contrast.css`) rather than a literal.

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

**Use `components/Button.tsx`.** Do not write a button class.

```tsx
<Button variant="primary" onClick={save} data-testid="my-save">Save</Button>
<Button size="sm" pressed={on} onClick={toggle}>Show resolved</Button>
<Button variant="ghost-icon" size="sm" aria-label="Close" onClick={close}>×</Button>
```

| Prop | Values |
|---|---|
| `variant` | `secondary` (default), `primary` (the one action of a surface), `destructive` (destroys), `ghost-icon` (icon or glyph only; needs `aria-label`) |
| `size` | `md` (default, 32px) in a dialog; `sm` (24px) in a panel, popover or row |
| `pressed` | makes a toggle; sets `aria-pressed`, and the look follows it |
| `className` | placement only (width, margin, flex) |

`type` is `"button"` unless you set it. The focus ring is
`--ad-focus-ring`; disabled is `disabled`.

Not Buttons, on purpose: the atlas tool toggles in Excalidraw's tool strip
(`PinToolButton`, `MeasureToolButton`, `CommentModeButton`, the place-search
trigger) match the fork's `ToolIcon` through Excalidraw's variables. Tabs,
menu items, listbox options, disclosure carets and map markers are other
widgets.

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

Font sizes are the `--ad-text-*` tokens in `tokens.css`: `2xs` 10px
(marginalia, counts, key caps), `xs` 11px (metadata, hints, status bar),
`sm` 12px (panel body), `md` 13px (menu items, banners, dialog body), `lg`
14px, `xl` 16px (dialog titles), `2xl` 20px. A literal font size in a module
fails `tokens.test.ts`.

### Text in context menus

`var(--ad-text-md)` (13px) — matches the scrim banner. Do not use
`--ad-text-lg` in menus; it reads as a button, not a menu item.

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
| Border radius — buttons | `--ad-radius-sm` |
| Border radius — banners / popups | `--ad-radius-md` |

---

## Accessibility — Non-Negotiable

| Element | Requirement |
|---|---|
| All `<button>` | `type="button"` (prevents form submit) |
| Toggle buttons | `aria-pressed={boolean}` |
| Icon-only buttons | `aria-label="..."` OR visually-hidden `<span>` child |
| Disabled actions | `disabled` attr + `aria-disabled="true"` + `title` explaining why |
| Menus | `role="menu"` on the container, `role="menuitem"` on items, arrow keys move, Escape and an outside press close, focus goes back to the trigger. Never dismiss on `onMouseLeave`: a keyboard user has no mouse to leave with |
| Dialogs | Render through `components/Modal.tsx`, a question inside a dialog too. It gives the role, `aria-modal`, the name, focus in and Tab kept inside, Escape, the scrim, the inert page and focus back. Never write a dialog's own Escape `keydown` or focus trap |
| Keys | A tool that takes keys pushes a `tool` scope (`commands/keyScopes.ts#useKeyScope`) while it is on. A new key for the user is a `Command`. No component adds its own `window` `keydown` |
| Key labels | From the binding: `keyText` / `keyLabels` (`commands/keys.ts`), so Linux and Windows read "Ctrl" and macOS "⌘". Never type "⌘K" or "Ctrl" into a string |
| Live regions | In the page before they speak (the toast regions, `PresenceList`'s connection line). A region added together with its text is often not read out. An error is `role="alert"`; the rest `role="status"`. Mark a region outside a dialog `data-live-region` so `Modal` leaves it out of the inert page |
| Every interactive element | `data-testid="..."` — Playwright reads these |
| SVG decorative | `aria-hidden="true"` on the `<svg>` |

Toggle button template:

```tsx
<button
  type="button"
  className={[styles.toolButton, isActive ? styles.toolButtonActive : ""]
    .filter(Boolean)
    .join(" ")}
  onClick={() => setActive(!isActive)}
  aria-pressed={isActive}
  data-testid="my-tool-button"
>
  My tool
</button>
```

---

## Dialog Pattern

```tsx
// A dialog in the slot: a command opens it, EditorDialogs shows it.
run: (s) => s.view.getState().openDialog({ kind: "my-dialog" }),

// The dialog itself.
<Modal
  labelledBy={titleId}          // or label="…" when nothing visible names it
  onClose={onClose}             // Escape, a press on the scrim
  scrimClassName={styles.scrim}
  className={styles.dialog}
  testId="my-dialog"
>
  <h2 id={titleId}>…</h2>
  …
  {asking && <ConfirmDialog … />}  {/* a question inside: a Modal too */}
</Modal>
```

A yes/no question is `await view.ask({...})`; it answers false when the user
cancels or another dialog takes the slot.

---

## Menu Pattern

The layer row's actions menu (`LayerPanel.tsx`) is the model; the sketch
below is its shape, not a component to copy.

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
    // Close on an outside pointerdown and on Escape (both in an effect),
    // and give focus back to the trigger. Never on onMouseLeave.
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
<div className={styles.root}>                       ← relative, overflow:hidden
  <div className={styles.mapLayer}>                 ← --ad-z-map — MapLibre GL
    <MapCanvas />
  </div>
  <div className={styles.excalidrawLayer [+ Active]}> ← --ad-z-drawing — Excalidraw + its UI
    <Excalidraw ... />
  </div>
  {activeAtlasTool && (
    <div className={styles.atlasToolOverlay} />     ← --ad-z-tool-overlay — events only
  )}
  {commentMode && <div className={styles.commentModeHint}/>} ← --ad-z-overlay — hints
  <EditorDialogs />                                  ← --ad-z-dialog — the one dialog (Modal)
</div>
```

Atlas tool toggles are not in this stack: they render into the drawing's
tool strip in the collar (`renderToolbarExtras`). New atlas-side controls
land at `--ad-z-overlay` as a CSS-module class, or in an existing surface.
A new band is a new `--ad-z-*` token in `tokens.css`, with a comment that
says what paints above and below it.

---

## File Placement

| What | Where |
|---|---|
| New component | `code/apps/atlas-app/src/components/MyComponent.tsx` |
| New CSS module | `code/apps/atlas-app/src/styles/MyComponent.module.css` |
| New hook | `code/apps/atlas-app/src/hooks/useMyHook.ts` |
| Sidebar tab body | A function component returning **body markup only** — no `<Sidebar>` wrapper. Mount via `excalidrawAPI.registerSidebarTab({ name, label, content: <Body/> })` from inside a `useEffect` keyed on `excalidrawAPI`; return the unsubscribe. Open via `excalidrawAPI.toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab: <name> })`. **Never** render `<Sidebar name="...">` directly — that creates a parallel sidebar with no public trigger button. |
| SVG icon | Inline in component; no separate icon file |

---

## Testing a UI claim

**A claim about layout gets a Playwright probe. A source-text assertion is a
documentation aid, not a gate.**

vitest injects no CSS modules, so in jsdom `getComputedStyle(el).position`
returns `""` whether the rule exists or not. Every CSS assertion written against
the DOM therefore passes whatever the truth is. The workaround — reading the
`.module.css` file and asserting on its text — catches a deleted literal line
and nothing else. It does not catch a `flex-shrink: 0` added above the panel, a
cascade reorder from an upstream merge, or a new wheel handler that eats the
gesture. Those are what actually broke the layer panel, and the probes that
caught them were the browser ones in `apps/atlas-app/e2e/`.

The same holds for anything the browser, not React, decides: keyboard routing,
focus order, pointer capture, scroll ports, drag sources. `commentMode.test.tsx`
modelled the `h` key with a direct `setActiveTool("hand")` call, which is a fair
model of a programmatic re-assert and a wrong model of a keystroke — the real
`h` is a toggle that moves the tool *away* from `hand`. That gap did not merely
miss a bug; it caused a ticket (FU-5) to be filed against behaviour the app
never had, and it would have had someone rewrite a working mode.

So:

| Claim | Where it belongs |
|---|---|
| "this state produces this markup" | vitest, `expect` on the DOM |
| "this store update reaches that component" | vitest |
| "this element is visible / scrollable / positioned" | Playwright, `apps/atlas-app/e2e/` |
| "this key does that" | Playwright — the real action manager, not a fake API |
| "focus lands here" | either, but assert `document.activeElement`, never `tabIndex` alone |
| "this CSS rule exists" | nothing. Assert the behaviour the rule is for |

Two rules for the vitest half, both enforced by
`yarn test:falsifiable` (`scripts/find-unfalsifiable-tests.mjs`, part of
`test:all`):

- **Every test case asserts.** A case whose body is only actions can fail only
  by throwing, so it passes for every behaviour that does not crash.
- **No test's assertions all sit inside an `if`.** Narrowing a union with `if`
  also skips: when the narrowing goes false — which is what a regression looks
  like — zero assertions run and the case reports green. Assert the narrowing
  condition, then project: `expect(entry?.kind).toBe("data")` before you use
  `entry.style`.

Neither check can see a weak assertion that does run. That one is on you.

---

## Pre-Ship Checklist

- [ ] **Surface decision:** checked the decision tree; documented why a new surface was needed if one was created
- [ ] **CSS Module:** all persistent styles in `src/styles/*.module.css`, not inline
- [ ] **Colors:** `--ad-*` tokens; no new hex values
- [ ] **Scales:** colours, font sizes, radii and z-index are `--ad-*` tokens (`tokens.test.ts` enforces it)
- [ ] **Buttons:** `components/Button.tsx`, no new button class
- [ ] **Icons:** inline SVG, `currentColor`, `aria-hidden="true"`, `width`/`height` from CSS
- [ ] **Text:** correct size/weight for the role
- [ ] **`type="button"`** on every `<button>`
- [ ] **`aria-pressed`** on toggles
- [ ] **`aria-disabled` + `title`** on disabled actions
- [ ] **`data-testid`** on every interactive element
- [ ] **Menu:** `role="menu"` + `menuitem`s, arrow keys, Escape and outside press close, focus back to the trigger
- [ ] **Dialog:** rendered through `Modal`; opened through the slot (`view.openDialog` / `view.ask`)
- [ ] **Keys:** a `Command` or a `tool` key scope; labels from `keyText`
- [ ] **Live regions:** mounted before they speak
- [ ] **Conditional class:** uses `.filter(Boolean).join(" ")` pattern
- [ ] **Layout / keyboard / focus claims:** proved by a Playwright probe in
      `apps/atlas-app/e2e/`, not by a jsdom CSS read
- [ ] **`yarn test:falsifiable`** passes — every new test case asserts, and no
      case hides all its assertions inside an `if`
