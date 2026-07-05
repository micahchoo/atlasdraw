# Journey walk — Issue 3: import CSV → draw → save `.atlasdraw` → reopen

Walked 2026-07-04 against a local dev server (`vite`, port 5199), driving a real
Chromium via playwright-cli. Persona: first-time user with `places.csv` (name +
address columns) who wants to map it, draw on top, save the map as `.atlasdraw`,
and reopen it later. Fixing nothing during the walk; fixes come afterward,
worst-first, one commit each, re-walking the journey after each fix.

Friction scale: 0 = smooth · 1 = hesitation · 2 = had to guess / workaround · 3 = dead end.

| # | Step | Expected | Actual | Friction | Fix commit | Re-walk |
|---|------|----------|--------|----------|-----------|---------|
| 1 | Open app first time | Editor loads, orientation offered | 5-step tour appears; map + canvas load cleanly | 0 | — | — |
| 2 | Learn how to import my CSV | Tour or UI mentions CSV/data import | Tour step 5/5 says only "Import GeoJSON by dragging files onto the map"; MainMenu has Open/Save/Export/Share but **no Import item** — CSV/Shapefile never mentioned anywhere in the UI despite README listing them as shipped | 1 | | |
| 3 | Drag `places.csv` onto the map | Points appear, or a message saying how to import CSV | Nothing at first (looked silent); ~2s later a generic Excalidraw modal "Error — Couldn't load invalid file". No mention of CSV, no hint that only `.geojson` works. The tested CSV parser in `@atlasdraw/data` is unreachable | 3 | | |
| 4 | Dismiss the error dialog | Close button or Escape | Dialog renders **no close button** and Escape does nothing; only discoverable dismissal is clicking the backdrop margin around the modal | 2 | | |
| 5 | Workaround: convert CSV→GeoJSON in another tool, drag that in | (shouldn't be needed) | Works — `places.geojson` layer appears in Layers panel with visibility/reorder controls | 2 (workaround itself) | | |

| 6 | Draw on top (rectangle + text) | Shapes land on map | Text tool worked; rectangle drag produced no element (single sample, possibly driver artifact — not scored as product friction) | 1 | | |
| 7 | Export as `.atlasdraw` via Export dialog | File downloads | **Fake dialog option**: selected the `.atlasdraw` card, clicked "Export .atlasdraw" → `window.alert` says "Use Export from the MainMenu → Export → .atlasdraw card" — i.e. the exact place I was standing. Circular dead end, shipped in v1.0 | 3 | pending | re-walked: card downloads real bundle, no alert |
| 8 | Fall back to MainMenu → Save | File saves, or a picker | Chrome path: OS picker → (picker aborted by test harness) → save failed **silently** — only `console.warn("[atlasdraw] saveToDisk failed")`, status bar still shows "Saved" from autosave. Also observed: a failure while persisting the file handle to IndexedDB (DataCloneError in test shim) aborts the entire save, same silent disposal | 3 (silent failure) | | |
| 9 | Save without File System Access API (Firefox/Safari path) | Download fallback | Works — logs "[persistence] FS API unavailable; using download/input path", downloads `atlasdraw.atlasdraw`: valid ZIP with manifest.json, scene.excalidraw.json (drawing present), data/…geojson (3 features), style.json | 0 | | |

| 10 | Reopen: MainMenu → Open… (input-fallback path) | Scene + layers restored | Works — "document opened + hydrated, layerCount 2, sceneLength 1"; `places.geojson` back in Layers panel, drawing restored | 0 | | |
| 11 | Reopen a corrupt `.atlasdraw` | Error message telling me the file is bad | **Nothing.** Picker closes, no dialog, no toast — only `console.warn("[atlasdraw] openFromDisk failed", AtlasdrawFormatError…)`. User assumes the app ignored their click | 3 | | |

## Severity ranking (fix order, worst first)

1. **Fake `.atlasdraw` export card** (row 7) — a shipped UI control whose only behavior is an alert pointing at itself. The real save logic exists and works (rows 9–10); the dialog just never calls it.
2. **Silent save/open failures** (rows 8, 11) — `saveToDisk failed` / `openFromDisk failed` go to console.warn only, while the status bar keeps saying "Saved". Includes the sub-finding that a failure persisting the file handle to IndexedDB aborts the whole save.
3. **CSV drop dead end** (rows 2–3) — README-advertised, fully-built-and-tested CSV parser unreachable; dropping a `.csv` yields a delayed, generic "Couldn't load invalid file" from Excalidraw's scene loader.
4. **Error modal not dismissible** (row 4) — vendored Dialog renders no close button and ignores Escape; only backdrop-margin click closes it.
5. **Import affordance copy** (row 2) — tour and menu never mention what formats are importable; no Import menu item.

Non-journey observations (not scored, for other ledgers): dev-only font 404 (`Excalifont…woff2` via esm.sh); hamburger menu button has no accessible name; rectangle drag produced no element once (unreproduced).
