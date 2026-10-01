---
paths:
  - code/packages/geo/**
  - code/packages/basemap/src/CameraBridge.ts
  - code/packages/tools/src/convert.ts
  - code/packages/element/src/atlasStyleUnit.ts
  - code/packages/element/src/atlasStamp.ts
  - code/packages/excalidraw/atlasStyleScale.ts
  - code/packages/excalidraw/components/App.tsx
  - code/packages/excalidraw/actions/**
  - code/packages/excalidraw/clipboard.ts
  - code/apps/atlas-app/src/lib/placeDrawing.ts
  - code/apps/atlas-app/src/hooks/useCameraBridge.ts
  - code/apps/atlas-app/src/tools/**
  - code/apps/atlas-app/src/state/annotations.ts
  - code/apps/atlas-app/src/state/document.ts
  - code/apps/atlas-app/src/components/MapEditor.tsx
  - code/apps/atlas-app/src/components/CommentAnchorsOverlay.tsx
tags: [geo, camera, world-coordinates, adr-0015]
priority: high
source: hand-written
---

# World coordinates: a camera move writes no element

A drawn element is stored in Web Mercator pixels at zoom 22, minus the
document's origin (`DocumentState.world`, saved as `manifest.world`;
ADR-0015). The map owns the camera; `CameraBridge` writes Excalidraw's
scrollX / scrollY / zoom from each map `move`. Keep these true:

- **Nothing writes an element because the camera moved.** Undo, dirty
  tracking and collaboration all depend on it. A new feature that needs
  screen positions reads them through the viewport or `map.project`; it
  never stores them. `geo.known-red.test.tsx` and the e2e
  `phase-1-geo-foundation.spec.ts` check it.
- **Lng/lat comes from scene coordinates through the frame**:
  `toLngLat(currentDocument().snapshot().world, p)`, with `shapeOutline` /
  `shapeCenter` for an element's geometry (they apply its own `angle`). Do not
  store a geographic anchor on an element; it goes stale the moment the
  element moves. One converter, `tools/convert.ts`, serves export and
  convert-to-layer.
- **The frame is read when it is used**, not captured: opening a document
  replaces it. The bridge takes a getter for that reason.
- **Pixel-sized things are scene units at a zoom.** A size given in screen
  pixels (stroke, font, pin, default circle) is multiplied by
  `sceneUnitsPerPixel(frame, zoom)` at creation, and the element records that
  number as `customData.atlas.unit`. The fork draws arrowheads, dashes, rough
  jitter, the adaptive corner radius and cache padding in it
  (`element/src/atlasStyleUnit.ts`). A creation path that skips the unit
  gives arrows without heads and invisible dashes.
- **One creation seam.** Every fork path that puts a new element in the
  scene calls `App.stampNewElements(elements, how)`, which calls the
  `stampNewElements` prop. The atlas passes `atlasStampNewElements`
  (`element/src/atlasStamp.ts`). `how` decides the rule, never a missing
  unit: draw, text and insert-image record `1 / zoom`; paste (a clipboard
  marked `worldUnits`) and duplicate keep their size; import (another
  Excalidraw's clipboard, a .excalidraw file through `placeDrawing`, a
  chart) and library come in at their screen size. A new creation path calls
  the seam and gets a case in `excalidraw/tests/atlasSceneUnits.test.tsx`.
  App-side creators (pins, seeds, tools) write the unit themselves.
- **Every upstream distance in scene units takes a unit** (W4b, ADR-0015
  "Leftovers fixed"). Part of the drawing (a gap, a padding, a route
  spacing): the element's `styleUnit`. Part of the interaction (a reach, a
  nudge, an icon): `editorUnit(appState)`, which reads the
  `screenSizedStyles` prop mirrored into `AppState`. A value upstream
  already divides by the zoom is screen pixels and needs neither.
  `excalidraw/tests/atlasSceneUnits.test.tsx` compares the atlas editor at
  zoom 1/1024 with upstream at zoom 1; add a case for a new distance.
- **Excalidraw's own zoom never runs.** Zoom actions and fitting
  `scrollToContent` go to `onZoomAction`; wheel and trackpad pinch go to the
  map (`useMapWheelRouter`); a touch pinch goes through the bridge with its
  zoom unclamped (`App.tsx#pinchZoom`). Excalidraw clamps zoom to [0.1, 30]
  and steps by 0.1, which at zoom value 2^-10 jumps the map many levels.
  Ctrl+0 (Excalidraw's 100%, map zoom 22) frames the drawing instead.
- **Bearing is a CSS turn of the canvases only** (`--world-rotate`), and
  drawing stays blocked while turned. Hit tests that must work turned go
  through `map.unproject` and the frame, not Excalidraw's viewport math.

Scene numbers reach 2^31. Upstream had 1e6 limits (elbow arrows,
`newElement`); they are `MAX_SCENE_EXTENT` now. Chromium clamps canvas
and SVG fonts to 10000px; text above `MAX_CANVAS_FONT_SIZE` is measured,
drawn and exported scaled. Any new upstream code with a fixed scene-unit size or limit needs
the same treatment.

Verify with `cd code && npx vitest run packages/geo packages/basemap packages/data apps/atlas-app/src/hooks/__tests__/geo.known-red.test.tsx`,
then the chromium e2e geo specs.
