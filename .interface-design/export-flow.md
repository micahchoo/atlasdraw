# Export Flow Redesign — Design Spec

**Status:** Scoped, not yet implemented.

## Problem

Export is currently 3 separate paths with different UX:
- Export composite PNG → MainMenu item → direct download (no dialog)
- Export PDF → MainMenu item → PrintDialog (modal with settings)
- Export GeoJSON → MainMenu item → direct download (no dialog)
- Export .atlasdraw → MainMenu item → Excalidraw's JSON export dialog
  with `renderCustomUI` cards

The user can't compare formats, preview output, or adjust settings
consistently. Each format has a different interaction model.

## Solution

Single Export dialog accessible from MainMenu → "Export". Shows all
formats as selectable cards with format-specific settings below.
Preview thumbnail updates when settings change.

## Layout

```
┌──────────────────────────────────────────┐
│  Export                              [×] │
├──────────────────────────────────────────┤
│                                          │
│  Format:  [PNG]  [PDF]  [GeoJSON]  [.atlasdraw]

│                                          │
│  ── PDF settings ─────────────────────   │
│  Page size:  [A4 ▾]                      │
│  Orientation:  ○ Portrait  ● Landscape   │
│  Include legend:  [✓]                    │
│  Include basemap:  [✓]                   │
│                                          │
│  ┌──────────────────────────────┐        │
│  │       (preview thumbnail)    │        │
│  └──────────────────────────────┘        │
│                                          │
│              [Cancel]  [Export PDF]      │
└──────────────────────────────────────────┘
```

## Token usage
- Surface: `--ad-surface-raised` (dialog)
- Format cards: `--ad-surface-inset` default, `--ad-accent` border on selected
- Spacing: `--ad-space-4` dialog padding
- Typography: `--ad-font-sans` throughout

## Migration
After building: remove standalone PNG menu item, replace PrintDialog with
this, remove GeoJSON menu item, remove `renderCustomUI` export cards from
MainMenu. All export goes through one surface.

## Files to create
- `code/apps/atlas-app/src/components/ExportDialog.tsx`
- `code/apps/atlas-app/src/styles/ExportDialog.module.css`
- Modify `MapEditor.tsx` — replace individual export handlers with single
  `setShowExportDialog(true)`
