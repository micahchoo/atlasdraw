# Capability-reach diff — ISSUES.md Direction 1

CSV/Shapefile/geocoding reachability from `apps/atlas-app`'s UI. Ledger:
operation | defined at | user path | gate | intent | class (reachable /
gated / orphaned) | verdict | commissioned as.

**Verification note (before acting on ISSUES.md's premise):** the original
write-up claimed CSV import and geocoding were as unreachable as Shapefile —
"the only import entry point ... checking `file.name.endsWith('.geojson')`."
That's now stale. `useGeoJsonDrop.ts` (rewritten during this session's
ISSUES.md Issue 3 journey-walk) already handles `.csv` drops, calling
`parseCSV(file, { geocoder })` and constructing a `PhotonGeocoder` when
`VITE_GEOCODER_ENDPOINT` is configured. Only Shapefile import genuinely has
zero UI path — confirmed via `grep -rn 'parseShapefile|\.shp\b'
apps/atlas-app/src` (zero hits, not even a comment) and `grep -rn '<input'
apps/atlas-app/src` (no `type="file"` anywhere — drag-drop is the only
mechanism for any format).

| operation | defined at | user path | gate | intent | class | verdict | commissioned as |
|---|---|---|---|---|---|---|---|
| `parseCSV` / CSV geocoding | `packages/data/src/csv.ts`, `geocode.ts` | drag-drop `.csv` onto the map canvas (`useGeoJsonDrop.ts:44-56`); geocoding activates automatically when `config.geocoder` is set | none (drop) / flag-off (geocoder, `VITE_GEOCODER_ENDPOINT` empty by default — ADR-0006 zero call-home) | working as designed | **reachable** | — (no decision needed; corrected the record) | — |
| `parseShapefile` | `packages/data/src/shapefile.ts` | **built 2026-07-05**: "Import…" `MainMenu` item (native file picker, `.geojson,.csv,.zip`) + drag-drop `.zip` support, both via renamed `useDataFileImport.ts` | none | was forgotten-latent — fully built + tested with no "not wired yet" marker | **reachable** (was orphaned) | **pursue** (scoped: Shapefile + file-picker discoverability, not CSV — CSV was already reachable) | built, not just specced |

## Commissioned spec interview (Direction 1, scoped) — run via `/grill-with-docs`

```
Design a file-picker UI for atlas-app that covers Shapefile import
(packages/data/src/shapefile.ts's parseShapefile, fully built + tested,
currently zero UI path) and gives every import format (GeoJSON, CSV,
Shapefile) a discoverable entry point beyond "drag a file onto the canvas
and hope the extension matches" — today there's no <input type="file">
anywhere in apps/atlas-app/src, confirmed by grep. CSV + address geocoding
are already wired (useGeoJsonDrop.ts, Issue 3's journey-walk fix) and are
NOT part of this ask — scope is Shapefile reachability + a real picker
(likely a MainMenu "Import..." item opening a native file dialog, dispatching
by extension the same way useGeoJsonDrop's drop handler already does).
Interview: where should the picker live (MainMenu item? toolbar button?),
should it share useGeoJsonDrop's parseDroppedFile dispatch logic or need its
own, and what's the .shp/.zip/.dbf multi-file reality for shapefiles (a
single .shp is rarely sufficient — does parseShapefile expect a zipped
bundle, and does the picker need multi-file selection?). Bring back a brief,
not code.
```

### Interview outcome (built as designed)

No modal — a plain "Import…" `MainMenu.Item` opens a native file picker
directly (reusing `state/persistence.ts`'s `fallbackOpen` hidden-`<input
type="file">` pattern), dispatching through the same pipeline drag-drop
uses. `useGeoJsonDrop` renamed to `useDataFileImport`, which now exposes
both the drag-wiring effect and an imperative `importFile(file)` the picker
calls. `parseShapefile` expects a single zipped `Blob` (shpjs handles zip
extraction internally) — no multi-file picker needed. A deliberate pick of
an unsupported file type gets an explicit toast (unlike drag-drop's silent
no-op). Also closed `shapefile.test.ts`'s long-standing no-happy-path-test
gap with a real fixture (`__fixtures__/point.zip`, built via Python's
`pyshp` since `ogr2ogr` wasn't available in this environment).

## Done

Both rows resolved and built: CSV/geocoding reclassified as reachable
(record corrected, no action needed); Shapefile pursued, specced via
`/grill-with-docs`, and implemented — `useDataFileImport.test.ts` (22
tests), `MapEditor.import.test.tsx` (3 tests, new),
`shapefile.test.ts` (4 tests, up from 3). atlas-app 63 files/525 tests,
packages/data 13 files/144 tests, both green.
