# Data Layer Detail Panel — Design Spec

**Status:** Scoped, not yet implemented.

## Problem

Clicking a data layer row in LayerPanel currently does nothing. To see
feature count, attribute table preview, or change style, the user must
open StylePanel separately. There is no way to preview the actual data
without exporting.

## Solution

A detail panel that opens when a data layer row is clicked in LayerPanel.
Renders inline below the row (accordion) or as a side panel within the
sidebar tab. Shows attribute preview, geometry type, feature count, and
inline style controls.

## Layout (accordion mode)

```
[▼] Imported Parcels  ─── 342 features  [eye] [style]
    Geometry: Polygon
    Attributes: parcel_id | owner | area_sqft | zone
    ┌──────────┬───────────────┬──────────┬──────┐
    │ parcel_id │ owner         │ area_sqft│ zone │
    │ P-001     │ Smith, J.     │ 12,450   │ R-1  │
    │ P-002     │ Chen, L.      │  8,920   │ R-2  │
    │ P-003     │ O'Brien, M.   │ 15,300   │ C-1  │
    └──────────┴───────────────┴──────────┴──────┘
    Showing 3 of 342 features
```

## Token usage
- Surface: `--ad-surface` (expands within sidebar, same base tone)
- Borders: `--ad-hairline` row separators
- Typography: `--ad-font-mono` for attribute values, `--ad-font-sans` for labels
- Accent: `--ad-accent-subtle` for header row background

## Interaction
- Click layer row → accordion expands, pushing rows below
- Click again → collapses
- "Style" button → opens StylePanel (existing, no change)
- "Eye" button → toggles visibility (existing, no change)

## Files to create/modify
- Modify `LayerPanel.tsx` — add accordion state + detail section
- Modify `LayerPanel.module.css` — add detail panel styles
- Optional: `DataTable.tsx` if the attribute table is extracted
