# Atlasdraw Design System

**Status:** Established 2026-05-25. Governs new UI work in `code/apps/atlas-app/`.
Existing components migrate incrementally; new components use tokens from day one.

## Direction

A warm, instrumental **drafting-room feel**. The map and annotations are the
product — the chrome recedes. Surfaces share one base tone (vellum). Elevation
is whisper-quiet (borders, not dramatic shadows). The accent draws from
blueprint/cyanotype — precise, technical, not generic SaaS blue.

Think: a well-organized drafting table, not an analytics dashboard.

**Feeling words:** precise, warm, quiet, instrumental, grounded.

---

## Shell Direction — The Collar (chosen 2026-07-18)

The color/typography layer above is established, but the *structural shell*
(floating island toolbar, left properties island, hamburger) was inherited
wholesale from Excalidraw and is the main reason the product still reads as
Excalidraw. Direction exploration compared three silhouettes (Collar /
Instrument Rail / Plotting Desk); **the Collar won**.

**The concept:** chrome is a printed map-sheet frame, not floating islands.
Tools sit flush in the top collar; live coordinates and graticule ticks print
along the neatline; the bottom margin is true marginalia (scale bar, datum,
projection, zoom, attribution — grown from the existing StatusBar); element
properties unfold from the frame edge as a **legend**; layers appear as sheet
edges in the frame. Nothing floats over the map at rest.

**Signature:** the neatline + collar — live coordinates and scale printed in
the frame, like a USGS quad's margin. Could only be a map product.

**Status:** **v1 shipped to main 2026-07-19** (expression A "Full collar",
chosen via the throwaway prototype at
`code/apps/atlas-app/prototypes/collar-shell/`; the prototype stays as the
visual reference until the follow-ups below land, then gets deleted).
Vendored chrome was restructured at the source (sanctioned by ADR 0010) via
opt-in `collarToolbarTarget`/`collarMenuTarget` props; this **supersedes the
"slot first" rule for the shell only** — the interaction model (selection,
shortcuts, tool semantics) stays Excalidraw's.

Follow-ups (review-logged, not yet built): active-tool accent underline in
the strip (the prototype's flush-strip signature); LEGEND sublabel; open
sidebar is still the stock floating panel, not frame-integrated (plus a
pre-existing tab-header overlap glitch); zen-mode/Footer interactions
unhandled in collar mode; no responsive collapse of the collar (MobileMenu
path unchanged); sheet name needs a live document-title source.

---

## Color Primitives

Defined in `code/apps/atlas-app/src/styles/tokens.css` as `--ad-*` custom
properties. Import happens once in `main.tsx`.

### Surface stack

| Token | Value | Role |
|---|---|---|
| `--ad-surface` | `#f2e8d5` | Base page, sidebar — unmistakably paper-toned |
| `--ad-surface-raised` | `#faf6ee` | Dialogs, dropdowns — tracing paper over vellum |
| `--ad-surface-inset` | `#e8ddc8` | Input backgrounds — depression in paper |

6% off pure white with a warm cast. The eye registers "paper" immediately.
Stacked with raised and inset, the three levels produce perceptible
drafting-table depth without shadows.

### Ink (text)

| Token | Value | Role |
|---|---|---|
| `--ad-ink` | `#2d2218` | Primary text — unmistakably warm near-black |
| `--ad-ink-secondary` | `#544a3d` | Supporting text — warm dark gray |
| `--ad-ink-tertiary` | `#8a7e6e` | Metadata, placeholders — warm mid-gray |
| `--ad-ink-inverse` | `#faf6ee` | Text on accent — warm white |

### Accent

| Token | Value | Role |
|---|---|---|
| `--ad-accent` | `#1971c2` | Primary action, active state, focus |
| `--ad-accent-hover` | `#1864ab` | Hover on accent backgrounds |
| `--ad-accent-subtle` | `#e5eef6` | Accent tint — warm vellum undertone |

Blueprint/cyanotype blue — inherited from the existing atlas-app palette
(Excalidraw-aligned `$color-blue-8`). Framed through the drafting-room:
architectural blueprints, cyanotype reproduction, technical drawing annotations.

### Borders (hairlines)

| Token | Value | Role |
|---|---|---|
| `--ad-hairline` | `rgba(0,0,0,0.06)` | Section dividers inside panels |
| `--ad-rule` | `rgba(0,0,0,0.11)` | Card edges, input borders |
| `--ad-emphasis` | `rgba(0,0,0,0.2)` | Active input, panel boundary |
| `--ad-focus-ring` | `#1971c2` | Focus indicator (opaque solid for a11y) |

RGBA borders blend with whatever surface they sit on — no need to define
separate border colors per surface. The eye perceives the boundary without
the border demanding attention.

### Semantic

| Token | Value | Meaning |
|---|---|---|
| `--ad-danger` | `#d64045` | Destructive action — red pencil correction mark |
| `--ad-caution` | `#e67700` | Warning |
| `--ad-confirm` | `#2f9e44` | Success |

---

## Elevation Model

**Strategy: borders + subtle surface color shifts.** No box-shadows for
structural elevation; shadows are reserved for transient raised surfaces
(dropdowns, tooltips) where they signal "temporary above."

| Level | Surface token | Separation | Use |
|---|---|---|---|
| 0 Base | `--ad-surface` | — | Page, sidebar, map surround |
| 1 Raised | `--ad-surface-raised` | `--ad-shadow-tracing` | Cards, panels, non-modal dialogs |
| 2 Elevated | `--ad-surface-raised` | `--ad-shadow-raised` | Dropdowns, tooltips, context menus |
| 3 Modal | `--ad-surface-raised` | `--ad-shadow-raised` + scrim | Modal dialogs |

Sidebars share the base surface, separated from content by `--ad-hairline`
border — not a different background color. The UI doesn't fragment into
"sidebar world" and "content world."

---

## Typography

**System sans-serif for UI, monospace for data.** The sans stack is the
browser's native system font — zero latency, zero FOUT, correct look on every
platform. The mono stack is for coordinates, measurements, and data values.

| Role | Font | Size | Weight |
|---|---|---|---|
| Panel heading | `--ad-font-sans` | 12px | 600 |
| Body / label | `--ad-font-sans` | 12px | 400 |
| Button label | `--ad-font-sans` | 14px | 600 |
| Context menu item | `--ad-font-sans` | 13px | 400 |
| Metadata / hint | `--ad-font-sans` | 11px | 400 |
| Coordinate / data | `--ad-font-mono` | 11px | 400 |

Sizes match the existing atlasdraw-ui-conventions ladder — no change to
existing components, just formalized with font stack tokens.

---

## Spacing

Base unit: **4px**. Compact (6px) is accepted for inline padding and tight-fit
contexts where 4px is too tight and 8px is too loose. Structural spacing
(margins, section gaps) stays on the 4px grid.

| Token | px | Use |
|---|---|---|
| `--ad-space-1` | 4 | Icon gap, inline spacing |
| `--ad-space-compact` | 6 | Button padding, row padding, tight gaps |
| `--ad-space-2` | 8 | Component internal gap, toolbar button gap |
| `--ad-space-3` | 12 | Toolbar anchor offset, section padding |
| `--ad-space-4` | 16 | Card padding, panel inset |
| `--ad-space-6` | 24 | Section separation |
| `--ad-space-8` | 32 | Major layout separation |

---

## Border Radius

| Token | Value | Use |
|---|---|---|
| `--ad-radius-sm` | 4px | Buttons, inputs, badges |
| `--ad-radius-md` | 6px | Cards, context menus, toolbars |
| `--ad-radius-lg` | 10px | Modals, dialogs |

Matches the existing atlasdraw-ui-conventions button radius (4px). Technical
tools use tighter corners than consumer SaaS — they signal precision.

---

## Relationship to atlasdraw-ui-conventions

The conventions skill (`atlasdraw-ui-conventions`) is authoritative for
implementation rules: CSS Modules, z-index ladder, button types, icon
patterns, accessibility requirements, file placement. This system.md does
not override any of those — it adds the design primitives they operate within.

When the conventions skill specifies a hex literal (e.g., `#adb5bd` for
borders), existing code keeps that literal. New components use the
corresponding token (`--ad-rule`). If a value disagrees, the token wins
for new work — the conventions skill's hex table is a snapshot, not a
constraint on the token system.

---

## Dark Mode

Not yet implemented in tokens. When it lands:
- Surface stack inverts (base dark, raised slightly lighter)
- Ink stack inverts (white primary, gray secondary)
- Semantic colors desaturate ~15%
- Shadows disappear; borders carry all elevation
- `prefers-color-scheme: dark` + `[data-theme="dark"]` selector
