---
paths:
  - code/apps/atlas-app/src/lib/importFormat.ts
  - code/apps/atlas-app/src/lib/importPipeline.ts
  - code/apps/atlas-app/src/lib/importClient.ts
  - code/apps/atlas-app/src/lib/maplibreWorker.ts
  - code/apps/atlas-app/src/hooks/useBasemapStyle.ts
  - code/apps/atlas-app/src/hooks/useDataFileImport.ts
  - code/apps/atlas-app/scripts/check-boot-size.ts
  - code/packages/data/package.json
tags: [bundle, boot-size, maplibre, import]
priority: high
source: hand-written
---

# What the editor and the viewer download before they paint

CI's `boot-size` job fails a route over its gzip budget
(`scripts/check-boot-size.ts`). Three things hold the number down or the map
up. Each failed silently before it was found (2026-10-01).

- **Never import a value from `lib/importPipeline.ts` outside the import
  worker.** It imports every parser (proj4, shpjs, xmldom, geotiff,
  papaparse, wkt-parser, togeojson). Rollup puts a whole module in one
  chunk, so one function from it put ~100 KB gzip in the editor's boot.
  Format and size questions go to `lib/importFormat.ts`. Types are free.
- **`packages/data` is `sideEffects: false`.** Without it a consumer of one
  adapter keeps them all (the viewer kept the parsers). A new module there
  must stay free of top-level effects.
- **MapLibre 6 needs `lib/maplibreWorker.ts`.** It looks for its worker
  beside its own module at run time; a bundle moves that module, the worker
  404s and the map paints no tiles. The only symptom is "Worker failed to
  load" in the console. Keep the import in `useBasemapStyle.ts` (or wherever
  the first map is made). The production e2e boot test catches its loss.

Verify with `vite build --manifest` and
`node --experimental-strip-types scripts/check-boot-size.ts` in
`code/apps/atlas-app`, and with
`npx playwright test --config=playwright.build.config.ts` (hosted, then
`E2E_TARGET=pages`).
