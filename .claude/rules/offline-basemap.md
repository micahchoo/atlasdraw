---
paths:
  - code/packages/basemap/**
  - code/apps/atlas-app/public/basemap/**
  - code/apps/atlas-app/scripts/vendor-basemap-assets.sh
  - code/apps/atlas-app/src/hooks/useBasemapStyle.ts
  - code/apps/atlas-app/src/lib/contentSecurityPolicy.ts
  - code/apps/atlas-app/src/lib/tileLayers.ts
  - code/apps/atlas-app/src/components/AddTileLayerForm.tsx
  - code/apps/atlas-app/nginx.conf
  - infra/docker-compose*.yml
  - infra/Makefile
tags: [basemap, offline, csp, self-host]
priority: high
source: hand-written
---

# An offline basemap fetches from this origin only

A basemap with `requiresRemote: false` must draw with every other host
unreachable: tiles, label glyphs and sprite. Before R8c (2026-10-01) the
Light and Dark styles loaded glyphs from `protomaps.github.io`. Offline, the
map drew roads and water and no name, and only the console said why.

- **The style holds tokens, not hosts.** `__PMTILES_PATH__` and
  `__BASEMAP_ASSETS__` (`style-builder.ts`). The caller passes
  `pmtilesPath` and `assetsPath` from `app-config.ts`; both are under the
  base path. `packages/basemap/src/__tests__/offline-basemaps.test.ts`
  fails on any URL with a host. `useBasemapStyle` resolves `assetsPath`
  against the page before it reaches the style: MapLibre 6 refuses a
  relative sprite URL ("must be absolute") and draws no icons. Only the
  production-build e2e sees this, because it fails on a console error.
- **Every font stack a style names is bundled, all 256 ranges.** MapLibre
  fails all labels of a tile when one range does not load. A stack can
  hide in `text-field`: the themes pick "Noto Sans Devanagari Regular v1"
  per script through a `format` expression's `text-font` option. A new stack
  (a theme change, a new `text-font`) goes into
  `scripts/vendor-basemap-assets.sh` and `public/basemap/` in the same
  change. `lib/__tests__/basemapAssets.test.ts` walks every `text-font` in
  a layout and checks the stacks and sprite sheets against the files.
- **Regenerate the styles with `node scripts/build-styles.mjs`**, never by
  hand. It refetches "Bright" verbatim; check its diff.
- **The CSP follows the styles.** `contentSecurityPolicy.ts#styleOrigins`
  reads the style files at build time; a token is no origin, so an
  offline basemap adds no host. A remote basemap adds its hosts.
- **A tile host the policy blocks is refused in the form**, with the host
  and `VITE_CSP_CONNECT_SRC` named (`tileLayers.ts#blockedTileOrigin`). A
  blocked tile is no MapLibre error; without the check the layer is blank.
- **Never commit or bundle an extract.** A self-hoster's streets come from
  `make -f infra/Makefile basemap-region` into `infra/data/` (git-ignored),
  mounted by `infra/docker-compose.basemap.yml`. The 43 MB world file is the
  only archive in git.
- **`/basemap/` has its own cache class**: 30 days in `nginx.conf` and
  `vercel.json` (`static-serving-cache-policy.md`). The files change only
  when the vendor script moves its pin.

Verify with `cd code && npx vitest run packages/basemap
apps/atlas-app/src/lib`, then
`E2E_PORT=5360 npx playwright test e2e/offline-basemap.spec.ts --project=chromium`
in `apps/atlas-app`. It refuses every other host and counts drawn labels.
`infra/smoke-minimal.sh` fetches a glyph range and a range of the archive.
