# Workspace Settings Panel — Design Spec

**Status:** Scoped, not yet implemented.

## Problem

Self-host config, basemap selection, storage backend, and team management
are currently scattered across 4+ separate surfaces:
- BasemapPickerDialog (modal)
- ShareDialog → mode picker (modal)
- WorkspaceSwitcher (dropdown, hosted-only)
- BillingPage (full page, hosted-only)
- App config from env vars (no UI)

## Solution

Single settings panel accessible from MainMenu → "Settings". Renders as a
modal dialog (Level 3 elevation, scrim, focus trap). Uses tabs for
categorization, not a single long scroll.

## Tabs

| Tab | Content | Visibility |
|---|---|---|
| Basemap | Active basemap picker (absorb BasemapPickerDialog) | Always |
| Storage | Backend selection (SQLite/Postgres/MinIO), connection status | Always |
| Collaboration | Share defaults, room settings, presence visibility | Always |
| Workspace | Workspace selector, plan info, billing link | Managed mode only |

## Token usage
- Surface: `--ad-surface-raised` (dialog)
- Spacing: `--ad-space-4` dialog padding, `--ad-space-3` tab padding
- Borders: `--ad-hairline` tab strip separator
- Accent: `--ad-accent` active tab indicator

## Migration
After building: remove standalone BasemapPickerDialog. ShareDialog stays
(share is a transient action, not a setting) but its defaults move here.

## Files to create
- `code/apps/atlas-app/src/components/SettingsDialog.tsx`
- `code/apps/atlas-app/src/styles/SettingsDialog.module.css`
