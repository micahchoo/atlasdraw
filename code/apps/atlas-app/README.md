# @atlasdraw/atlas-app

The Atlasdraw web app: the editor, the read-only viewer and the embed. It stacks the Excalidraw fork on a MapLibre map.

**Licence:** AGPL-3.0-only (see [`../../LICENSING.md`](../../LICENSING.md)).

## What a URL opens

`src/routes.ts` decides, and builds every link the app makes, so links work under the build's base path.

| URL | Opens |
| --- | --- |
| `/` | The editor, with the map saved last in this browser |
| `/#room:<id>,<secret>` | The editor, in a live room |
| `/m#v2:<bytes>` or `/m/<token>` | The read-only viewer: the map in the link, or on the server |
| `/embed#v2:<bytes>` or `/embed/<token>` | The same viewer without its title bar, for an `<iframe>` |

`?lock=1` on a viewer URL fixes the camera.

## Run it

From `code/`:

```bash
yarn start                                  # dev server on http://localhost:5174
yarn workspace @atlasdraw/atlas-app build   # production build in dist/
npx vitest run apps/atlas-app               # unit tests
yarn workspace @atlasdraw/atlas-app e2e     # Playwright, chromium
```

The e2e run starts its own dev servers on free ports, and a relay for the room tests.

## Configuration

Every `VITE_*` variable is read once, through the schema in `src/config/app-config.ts`. A bad value stops the app at start and names the variable. The build target decides what the app may do:

| `VITE_BUILD_TARGET` | Autosave backs up to the server | Live rooms |
| --- | --- | --- |
| `local-only` (default) | No | No |
| `pages` | No; shows a demo badge | No |
| `hosted` | Yes, to `VITE_STORAGE_BASE_URL` | If `VITE_REALTIME_ENABLED=true` |

Share links for large maps and "Restore from server backup" always use `VITE_STORAGE_BASE_URL` (empty: the same origin).

The other variables are listed in `docs/self-host/README.md` at the repository root.

## Where things are

- `src/components/MapEditor.tsx` — the editor. `EmbedView.tsx` — the viewer.
- `src/state/` — the document (`document.ts`), saving (`persistence.ts`, `remoteMapIdCache.ts`), rooms (`room.ts`, `roomScene.ts`, `roomValidation.ts`) and comments.
- `src/hooks/` — React wiring: the camera bridge, map overlays, import, share links, rooms.
- `src/lib/` — import pipeline, export (PNG, PDF, data layers), tile layers.
- `e2e/` — Playwright specs.
