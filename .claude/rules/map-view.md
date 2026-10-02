---
paths:
  - code/apps/atlas-app/src/lib/mapView.ts
  - code/apps/atlas-app/src/lib/export.ts
  - code/apps/atlas-app/src/lib/print-pdf.ts
  - code/apps/atlas-app/src/lib/legend.ts
  - code/apps/atlas-app/src/lib/embed.ts
  - code/apps/atlas-app/src/components/ExportDialog.tsx
  - code/apps/atlas-app/src/components/EditorDialogs.tsx
  - code/apps/atlas-app/src/components/EmbedView.tsx
  - code/apps/atlas-app/src/components/StatusBar.tsx
  - code/apps/atlas-app/src/hooks/useExportPNG.ts
tags: [export, pdf, embed, credits, bearing]
priority: high
source: hand-written
---

# MapView: every surface off the live screen reads one value

Two facts live in the editor's DOM only: the bearing (a CSS turn of the
drawing canvases) and the credit line (the status bar). Until R5 the PNG and
the PDF drew the map turned and the drawing north-up, so a box over Shigatse
printed over Dhaka (361 px off at 90 degrees), and the viewer printed only
"MapLibre".

- **Capture once, then read only the value.** `captureView(map, doc)` gives
  `{center, zoom, bearing, size, frame, credits}`. The PNG, the PDF image,
  its scale bar (`groundResolution`), north arrow (`-bearing`) and credit
  (`printViewOf`) all take the same MapView. Do not read `map.getBearing()`
  or the camera again inside an export.
- **The drawing turns as the live layer turns.** `renderDrawing` renders the
  box around the turned view (`drawingCover`) and turns it by -bearing about
  the centre. A new renderer of the drawing calls it, never `exportToCanvas`
  with the live viewport.
- **One credit rule.** `mapCredits` (basemap first, then visible tile layers,
  top first, each once). `documentCredits` resolves the basemap's credit from
  its definition. `lib/__tests__/creditSurfaces.test.ts` lists the surfaces
  and fails when other code reads `.attribution` to print it. A new surface
  that shows the map is added to that list.
- **The legend tests the turned frame** (`visibleAnnotationIds(..., bearing)`).

Verify with `cd code && npx vitest run apps/atlas-app/src/lib`, then
`E2E_PORT=5319 npx playwright test e2e/export-rotation.spec.ts e2e/embed.spec.ts --project=chromium`
in `apps/atlas-app`. The export spec compares magenta pixels on the screen
with the PNG and the PDF image at bearings 0, 30 and 90.
