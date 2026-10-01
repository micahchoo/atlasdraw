<!-- ADR-0015-MARKER: world-coordinates-gate -->

# ADR-0015: World Coordinates — Decided by a Measured Spike

- **Status:** Accepted (the gate). The go or no-go outcome is recorded below.
- **Date:** 2026-10-01
- **Relates to:** `code/decisions/0003-coordinate-system.md`

## Context

`code/decisions/0003-coordinate-system.md` says MapLibre owns the camera and
Excalidraw's scroll and zoom are derived from it. The code does the opposite.
It holds Excalidraw at scroll 0,0 and zoom 1, so scene coordinates are screen
pixels. On every camera event, `CoordinateSync` rewrites every geo-anchored
element from its anchor, and `useGeoAnchor` guesses the anchor back from the
pixels after every edit, through a `_lastSync` cache.

The architecture audit of 2026-10-01 measured the cost:

- 14 of 19 traced geo bug classes came from this design, 3 from event timing.
- Undo after a pan moves a shape to a different place (reproduced).
- Every pan marks the document dirty, starts an autosave and defeats
  Excalidraw's shape caches.
- Saved files and collab snapshots carry one viewer's pixels, which blocks live
  element sync (ADR-0014).

The proposed fix stores Web Mercator pixels at a reference zoom, measured from
a floating origin, and drives Excalidraw's scroll and zoom from the map camera.
A camera move then rewrites no element. The fork audit found this needs no
renderer patch: Excalidraw already renders any pan and zoom, and bearing can be
a CSS rotation because the drawing layer takes no input while the map is
rotated.

The change also changes the file format, so it is not started on argument
alone.

## Decision

Run a spike with zero edits to the vendored fork. Commit to the change only if
the spike meets every criterion below, measured in a real browser against
`main` at 1,000 and 5,000 shapes:

1. A pan or zoom writes no element (element versions unchanged).
2. Pan p95 frame time is at or below `main`'s, and under 16 ms at 1,000 shapes.
3. Undo after a pan restores the original geography (the roadmap W1 red test
   passes).
4. The camera bridge settles: one map move produces a bounded number of
   map-to-scene and scene-to-map updates, with no loop.
5. Every map zoom from 0 to 22 renders inside Excalidraw's zoom clamp, by
   re-basing the reference zoom or by widening the clamp in one constant.
6. Existing v1 documents migrate to the new coordinates with every element
   within 1e-6 px of where v1 draws it under random cameras.

**On go:** bump the file format once, together with the document-identity
changes of roadmap W3, and delete `CoordinateSync`, `useGeoAnchor`,
`useCoordinateSync`, the scroll lock, the drift check, `_lastSync` and the
screen and hybrid scale modes.

**On no-go:** keep the scroll lock. Skip writes for elements whose projection
did not change, base the dirty flag on element versions, and raise element
versions on re-anchor so undo sees them.

## Outcome

Not yet run. Record the measurements and the go or no-go here.
