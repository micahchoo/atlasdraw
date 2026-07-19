# PROTOTYPE — Collar shell (throwaway)

**Question:** does the "Collar" shell concept — a map-sheet frame (neatline + collar marginalia) replacing Excalidraw's floating-island layout — feel right at real screen proportions, over a real map?

Background: design-direction exploration 2026-07-18. Three shell concepts were compared (Collar / Instrument Rail / Plotting Desk); **Collar won** — the most domain-true silhouette (could only be a map product), grows out of the existing StatusBar, keeps the map fully unobstructed. This prototype tests three structural _expressions_ of the Collar.

**Run:** open `index.html` in a browser (network needed: OSM tiles + MapLibre CDN). Switch with `?variant=` or `←`/`→` or the bottom pill.

| Key | Name | Structure |
| --- | --- | --- |
| `a` | Full collar | Frame on all four sides; graticule left+top; layer sheet-edges in the frame; legend folds out |
| `b` | Broadside | Collar top+bottom only; map bleeds to the sides; corner coordinate chips; floating sheet-tabs |
| `c` | Field sheet | Vellum margin all around; boxed title block; double-rule neatline; legend printed on the plate |

**Verdict (2026-07-18):** **A — Full collar.** Frame on all four sides, graticule left+top, layer sheet-edges in the frame, legend fold-out. Chosen by maintainer after flipping the live prototype. Implementation proceeds on a branch (Collar shell v1); this directory stays until the shell ships, as the visual reference spec, then gets deleted.
