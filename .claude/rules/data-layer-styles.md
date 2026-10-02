---
paths:
  - code/packages/basemap/src/style.ts
  - code/packages/basemap/src/style-compiler.ts
  - code/apps/atlas-app/src/lib/layerStyle.ts
  - code/apps/atlas-app/src/lib/mapOverlays.ts
  - code/apps/atlas-app/src/components/StylePanel.tsx
tags: [style, overlays, validation]
priority: high
source: hand-written
---

# A data-layer style field: one check, and the source is part of the style

A `LayerStyle` arrives from the panel, a file, a share link and a room.
`lib/layerStyle.ts#styleProblem` is the one check, and the reducer, the
document gate and `roomValidation.ts` all call it through
`validateLayerStyle`. MapLibre's validator does not see every bad value
(a NaN, a `min` above `max`, a cluster on a line layer).

- **A new style field gets its own `*Problem` in `style-compiler.ts`**, and
  `styleProblem` calls it, with the geometry kind. `pointProblem` is the
  pattern. Without it, a room can store a value that throws or draws
  nothing.
- **A field that changes the GeoJSON source goes in
  `compileSourceOptions`**, never in a layer. Clusters live in the source,
  and in cluster mode the filter does too, so a cluster counts only the
  points that pass it.
- **A change to the source options replaces the source.** `setData` keeps
  the options a source was made with. `mapOverlays.ts` compares
  `OverlaySource.options` and replaces the source when they differ. Before
  this, a switch to clusters reached `setData` and drew no cluster.
  `mapOverlays.test.ts` "clusters in the source" gives the fake source a
  `setData` to keep this honest: `FakeMapLibre` has none.
- **The compiler is data-blind.** A graduated ramp and a size range get
  their numbers from the panel, which reads the layer. The compiler reads no
  feature.

Verify with `cd code && npx vitest run packages/basemap apps/atlas-app/src/lib apps/atlas-app/src/state apps/atlas-app/src/components/__tests__/StylePanel.points.test.tsx`.
