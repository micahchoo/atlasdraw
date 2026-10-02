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

Options on a viewer URL, in the query string before the hash (`src/lib/embed.ts`):

| Option | Effect |
| --- | --- |
| `lock=1` | The camera does not move, and a click shows no feature popup. |
| `legend=1` | Shows a legend of the layers in view. |
| `view=fit` | Fits the camera to the map's content. This is the default on `/embed`. |
| `view=saved` | Opens at the camera saved in the share. This is the default on `/m`. |

An unlocked embed zooms only with Ctrl (⌘ on a Mac) and the wheel, and pans with two fingers on a touch screen, so the page around it keeps its scroll.

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

Share links for large maps and "Server versions…" always use `VITE_STORAGE_BASE_URL` (empty: the same origin).

`.env.example` lists every variable with its default.

## Where things are

- `src/components/MapEditor.tsx` — the editor. `EmbedView.tsx` — the viewer.
- `src/state/` — the document (`document.ts`), saving (`persistence.ts`, `remoteMapIdCache.ts`), rooms (`room.ts`, `roomScene.ts`, `roomValidation.ts`) and comments.
- `src/hooks/` — React wiring: the camera bridge, map overlays, import, share links, rooms.
- `src/lib/` — import pipeline, export (PNG, PDF, data layers), tile layers.
- `e2e/` — Playwright specs.
