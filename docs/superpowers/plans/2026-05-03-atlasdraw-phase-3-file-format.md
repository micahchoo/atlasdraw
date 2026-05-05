# Atlasdraw Phase 3 — File Format & Local Persistence
**Plan date:** 2026-05-03
**Target week:** Week 9 (shifted +1 from spec's "Week 8" per Q7 chain — Phase 1 expanded 3→4 weeks, all downstream phases shift +1)
**Status:** Ready to execute

---

## Goal

Atlasdraw becomes a real local-first app with a portable, human-readable, diff-friendly file format. A user can open a map, edit it, close the browser, reopen it, and find everything intact — without a server. The `.atlasdraw` zip bundle is the canonical artifact; it is importable into Excalidraw and QGIS as fallback. CSV files with lat/lng columns land as data layers in one drag-and-drop.

---

## Tech Stack Additions

| Library | Version | Purpose |
|---|---|---|
| `jszip` | ^3.10 | Zip read/write for `.atlasdraw` bundle |
| `zod` | ^3.22 | Manifest schema validation + type inference |
| `papaparse` | ^5.4 | CSV streaming parse, typed columns |
| `@mapbox/togeojson` | ^0.16.2 | KML/GPX → GeoJSON (stretch goal) — `togeojson` is deprecated; this is the official successor |
| `shpjs` | ^6.2 | Shapefile zip → GeoJSON | <!-- shape-incorporated 2026-05-03: version pin bumped from ^4.0 to ^6.2 per resolver library health check (current stable is 6.2.0) -->
| `idb` | ^8.0 | IndexedDB typed wrapper (auto-save fallback) |
| `ulid` | ^2.3 | ULID generation for `manifest.id` |

---

## Phase Boundary Contracts

### Consumes from Phase 2

| Type | Source | Shape |
|---|---|---|
| `ExcalidrawElement[]` | Excalidraw scene | `element.customData.geo: GeoAnchor` present on pinned elements <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-3): field name is `geo` not `geoAnchor`; shape is GeoAnchor discriminated union, not flat {lng,lat,zoom} --> |
| `LayerRegistry` | `apps/atlas-app/state/store.ts` (Zustand slice); type definition at `packages/data/layer-registry.ts` <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-2): source was wrong `packages/geo`; Phase 2 produces Zustand slice in app package, type in packages/data --> | `{ id: string, type: 'data'\|'annotations', geojson?: GeoJSON.FeatureCollection }` |
| `GeoAnchor` | `packages/geo/geo-anchor.ts` | discriminated union: `{ kind: "point"; lng: number; lat: number; zRef: number }` \| `{ kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }` \| `{ kind: "polyline"; coordinates: Array<[number, number]>; zRef: number }` <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-1, per E-03): was flat `{lng,lat,zoom,projection:'EPSG:4326'}`; correct shape is Phase 1 discriminated union from packages/geo/types.ts --> |
| `BasemapRef` | `packages/basemap` | `{ type: 'registry', id: string }` — already resolved from Phase 1/2 |

### Produces for downstream phases

| Artifact | Consumer | Contract |
|---|---|---|
| `AtlasdrawDocument` type | Phase 4 share-via-URL, Phase 6 importers | `{ manifest: Manifest, scene: ExcalidrawElement[], layers: LayerRegistry, styleRef: StyleRef, files: Map<string, Blob> }` |
| `read(blob): Promise<AtlasdrawDocument>` | Phase 4 share (decompress before URL encode) | Pure function, no side effects, throws `AtlasdrawFormatError` |
| `write(doc): Promise<Blob>` | Phase 4 export, Phase 6 CLI convert | Returns zip Blob; `.atlasdraw.json` variant returns JSON Blob |
| `PersistenceStore` interface | Phase 5 real-time (replace IndexedDB slot) | `{ save(doc): Promise<void>, load(): Promise<AtlasdrawDocument\|null>, onDirty(cb): void }` |
| `parseCSV(blob): Promise<GeoJSON.FeatureCollection>` | Phase 6 importers | Throws `CSVParseError` if no coord columns detected |

---

## File Structure

```
packages/data/
├── src/
│   ├── manifest-schema.ts      # Zod schema + inferred Manifest type; single source of truth for manifest.json shape
│   ├── atlasdraw.ts            # read(blob) + write(doc): the .atlasdraw zip reader/writer; imports jszip + zod
│   ├── atlasdraw-json.ts       # Pure-JSON variant (.atlasdraw.json): serialize/deserialize for small maps without binary attachments
│   ├── thumbnail.ts            # generateThumbnail(canvas: HTMLCanvasElement): Promise<Blob> — 1024×768 PNG; browser-only
│   ├── csv.ts                  # parseCSV: PapaParse + column detector; writeCSV: FeatureCollection → CSV
│   ├── geojson.ts              # (exists) read/write pivot format — no changes needed in Phase 3
│   ├── kml.ts                  # [STRETCH] KML → GeoJSON via togeojson; punt to Phase 6 if time-pressured
│   ├── gpx.ts                  # [STRETCH] GPX → GeoJSON via togeojson; punt to Phase 6 if time-pressured
│   └── shapefile.ts            # Shapefile zip → GeoJSON via shpjs; needed for CLI convert
├── src/__tests__/
│   ├── manifest-schema.test.ts # Zod parse/reject cases; ULID format; timestamp ordering
│   ├── atlasdraw.test.ts       # Round-trip: write(doc) → read(blob) → assert equality
│   ├── atlasdraw-json.test.ts  # JSON variant round-trip; assert no Blob entries
│   └── csv.test.ts             # Column detection cases; heuristic edge cases; FeatureCollection output shape
└── package.json                # Add: jszip, zod, papaparse, shpjs ^6.2, @mapbox/togeojson ^0.16.2, idb, ulid <!-- shape-incorporated 2026-05-03: added @mapbox/togeojson (replaces deprecated togeojson) and pinned shpjs ^6.2 to match Tech Stack table -->

apps/atlas-app/state/
├── persistence.ts              # PersistenceStore implementation: IndexedDB via idb + FSA save/load; auto-save pump
└── persistence.test.ts         # Auto-save debounce; dirty-flag; FSA fallback path

packages/cli/
├── src/
│   ├── atlasdraw.ts            # CLI entry: commander-based; lint + convert subcommands
│   ├── commands/
│   │   ├── lint.ts             # lint <file>: read → validate manifest schema → report errors
│   │   └── convert.ts          # convert <in> <out>: dispatch by extension pair; GeoJSON ↔ KML ↔ Shapefile ↔ .atlasdraw
└── src/__tests__/
    └── lint.test.ts            # Valid .atlasdraw passes; mutated manifest fails with line-level message
```

---

## Flow Map

```
[Phase 2 outputs]
  ExcalidrawElement[] + LayerRegistry + GeoAnchor types
        │
        ▼
[W0] manifest-schema.ts   ←── Zod schema, Manifest type, AtlasdrawDocument type
        │
        ├────────────────────────────────┐
        ▼                                ▼
[W1a] atlasdraw.ts              [W1b] csv.ts
  read(blob)/write(doc)           parseCSV column detection
  + thumbnail.ts                  + heuristic + GeoJSON output
  + atlasdraw-json.ts
        │                                │
        ├────────────────────────────────┘
        │
        ├─────────────────────────────────┐
        ▼                                 ▼
[W2a] persistence.ts             [W2b] cli/lint.ts
  IndexedDB auto-save              lint <file> command
  FSA save/load                    validate manifest
  dirty flag                       report errors
        │                                │
        └──────────────┬─────────────────┘
                       ▼
              [W3] round-trip tests
                atlasdraw.test.ts
                persistence integration
                [STRETCH] KML/GPX kml.ts + gpx.ts
                cli convert.ts
        │
        ▼
[Phase 4 inputs]
  AtlasdrawDocument, PersistenceStore, parseCSV
```

---

## Tasks

### Task 1: Schema Definition — `manifest-schema.ts` [CHANGE SITE]

**Orient:** Define the canonical Zod schema for `manifest.json` — this is the type contract everything downstream reads; without it Wave 1 workers have nothing to validate against.
**Flow position:** Step 1 of 1 in Schema Definition flow (Phase 2 types → **manifest-schema** → atlasdraw.ts + CLI lint)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/manifest-schema.ts`
- Create: `packages/data/src/__tests__/manifest-schema.test.ts`

<contracts>
**Upstream:** Receives `BasemapRef`, `GeoAnchor` (discriminated union — `point | bbox | polyline` per `packages/geo/types.ts`; stored under `element.customData.geo`), `LayerRegistry` layer descriptors from Phase 2 type definitions. <!-- audit-incorporated 2026-05-03 (cross-phase-audit#MISMATCH-1,MISMATCH-3): removed "camera shape" phrase; GeoAnchor is a geo-anchor discriminated union, not a camera-shape; field name is `customData.geo` -->
**Downstream:** Exports `Manifest` (inferred Zod type), `ManifestSchema` (Zod object), `AtlasdrawDocument` interface — consumed by `atlasdraw.ts`, `lint.ts`, `persistence.ts`.
- Behavioral invariant: `id` is always a 26-char ULID string; `version` is always `1` for Phase 3; `updatedAt >= createdAt`.
- Behavioral invariant: `layers` array is ordered (first = bottom of stack).
</contracts>

- [ ] **Step 1: Write failing tests**

  Cover: valid manifest parses; missing `id` rejects; non-ULID `id` rejects; `updatedAt < createdAt` rejects (custom refinement); `version` not `1` rejects; empty `layers` array is valid; `basemap.type = 'registry'` is valid; `permissions.publicView` defaults to `false`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern manifest-schema`
  Expected: FAIL — module not found

- [ ] **Step 2: Implement `manifest-schema.ts`**

  Define `CameraSchema`, `BasemapRefSchema`, `LayerEntrySchema`, `PermissionsSchema`, `ManifestSchema` as Zod objects. Add `.refine()` that asserts `updatedAt >= createdAt`. Export `Manifest = z.infer<typeof ManifestSchema>` and `AtlasdrawDocument` interface importing `Manifest`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern manifest-schema`
  Expected: PASS all cases — no TypeScript errors in `tsc --noEmit`

- [ ] **Step 3: Export from package index**

  Modify: `packages/data/src/index.ts` — add named export for `ManifestSchema`, `Manifest`, `AtlasdrawDocument`.

  Run: `yarn workspace @atlasdraw/data build`
  Expected: Build succeeds, `.d.ts` emits `ManifestSchema` and `AtlasdrawDocument`.

---

### Task 2: File Format Writer — `atlasdraw.ts` write path [CHANGE SITE]

**Orient:** Implement `write(doc: AtlasdrawDocument): Promise<Blob>` — the encoder that packages scene + layers + manifest + files into a zip bundle; Phase 4's export button and CLI convert both call this.
**Flow position:** Step 1 of 2 in Format I/O flow (manifest-schema → **write** → read, persistence.ts, CLI convert)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/atlasdraw.ts`
- Modify: `packages/data/package.json` (add `jszip`, `ulid` deps)
- Test: `packages/data/src/__tests__/atlasdraw.test.ts`

<contracts>
**Upstream:** Receives `AtlasdrawDocument` — validated by caller; scene is `ExcalidrawElement[]`; layers is `LayerRegistry`; files is `Map<string, Blob>`.
**Downstream:** Returns `Promise<Blob>` of mime type `application/vnd.atlasdraw+zip`; zip layout matches §6 exactly: `manifest.json`, `scene.excalidraw.json`, `data/*.geojson`, `style.json`, `files/*`, `meta/thumbnail.png` (if provided). Already-compressed assets (JPEG, PNG) use `STORE`; text files use `DEFLATE`.
</contracts>

- [ ] **Step 1: Write failing tests for write path**

  Cover: output is a valid zip (jszip can re-parse it); `manifest.json` is valid JSON matching `ManifestSchema`; `scene.excalidraw.json` present; one `data/` entry per layer in registry; `files/` entries match input map; zip does NOT contain `meta/thumbnail.png` when no thumbnail passed.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: FAIL — `atlasdraw.ts` not found

- [ ] **Step 2: Implement `write()`**

  Create JSZip instance. Serialize `manifest.json` with `DEFLATE`. Serialize `scene.excalidraw.json` with `DEFLATE`. For each layer in `LayerRegistry`, serialize `data/layer-<id>.geojson` with `DEFLATE`. Add `style.json`. For each entry in `files` map, add `files/<name>` with `STORE` (already compressed). If thumbnail blob provided, add `meta/thumbnail.png` with `STORE`. Generate zip as `Blob` with `type: 'application/vnd.atlasdraw+zip'`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: Write-path tests PASS

- [ ] **Step 3: Verify zip compression modes**

  Add assertion: re-open zip, check that `.geojson` entries have `options.compression === 'DEFLATE'`; check that `.jpg`/`.png` file entries have `options.compression === 'STORE'`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: PASS

---

### Task 3: File Format Reader — `atlasdraw.ts` read path [CHANGE SITE]

**Orient:** Implement `read(blob: Blob): Promise<AtlasdrawDocument>` — the decoder that extracts and validates a zip bundle back to the canonical in-memory document; the round-trip test in Wave 3 closes the loop.
**Flow position:** Step 2 of 2 in Format I/O flow (write → **read** → AtlasdrawDocument for consumers)
**Skill:** `test-driven-development`
**Files:**
- Modify: `packages/data/src/atlasdraw.ts`
- Test: `packages/data/src/__tests__/atlasdraw.test.ts`

<contracts>
**Upstream:** Receives a `Blob` (from FSA file picker, IndexedDB, or network fetch). May be malformed.
**Downstream:** Returns `Promise<AtlasdrawDocument>` or throws `AtlasdrawFormatError` (subclass of `Error`) with a `code` field: `'BAD_ZIP' | 'MISSING_MANIFEST' | 'INVALID_MANIFEST' | 'MISSING_SCENE'`.
- Behavioral invariant: if `read(await write(doc))` returns, result equals `doc` structurally (used in round-trip test).
</contracts>

- [ ] **Step 1: Add failing read tests**

  Cover: valid zip from `write()` round-trips cleanly; zip missing `manifest.json` throws `AtlasdrawFormatError { code: 'MISSING_MANIFEST' }`; zip with invalid manifest JSON throws `INVALID_MANIFEST`; zip missing `scene.excalidraw.json` throws `MISSING_SCENE`; non-zip Blob throws `BAD_ZIP`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: New read tests FAIL

- [ ] **Step 2: Implement `read()`**

  Load zip with `JSZip.loadAsync(blob)`, catch error → `BAD_ZIP`. Extract `manifest.json`, parse JSON, validate with `ManifestSchema.safeParse()` → `INVALID_MANIFEST` on failure. Extract `scene.excalidraw.json` → `MISSING_SCENE` if absent. For each `data/*.geojson` entry, parse and add to `LayerRegistry`. For each `files/*` entry, add to `Map<string, Blob>`. Return assembled `AtlasdrawDocument`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: All read + write tests PASS

- [ ] **Step 3: Export `read`, `write`, `AtlasdrawFormatError` from index**

  Run: `yarn workspace @atlasdraw/data build && tsc --noEmit`
  Expected: Build clean; no implicit `any`

---

### Task 4: Pure-JSON Variant — `atlasdraw-json.ts` [CHANGE SITE]

**Orient:** Implement the `.atlasdraw.json` serialization for small maps with no binary attachments — useful for inline embedding, copy-paste, and the `--json` flag in CLI convert; this is a serialization branch off the same `AtlasdrawDocument` type, not a new format.
**Flow position:** Step 1 of 1 in JSON-variant flow (AtlasdrawDocument → **JSON serializer** → CLI convert --json, share-via-URL Phase 4)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/atlasdraw-json.ts`
- Create: `packages/data/src/__tests__/atlasdraw-json.test.ts`

<contracts>
**Upstream:** Receives `AtlasdrawDocument`. Precondition: `doc.files.size === 0` (caller validates; if violated, function throws `AtlasdrawFormatError { code: 'HAS_BINARY_ATTACHMENTS' }`).
**Downstream:** `writeJSON(doc): string` returns UTF-8 JSON string. `readJSON(json: string): AtlasdrawDocument` parses and validates, same error codes as zip `read()`.
</contracts>

- [ ] **Step 1: Write failing tests**

  Cover: writeJSON produces valid JSON; readJSON(writeJSON(doc)) round-trips; doc with `files.size > 0` throws `HAS_BINARY_ATTACHMENTS`; malformed JSON throws `BAD_ZIP` (reuse code for consistency); manifest validation runs identically.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw-json`
  Expected: FAIL

- [ ] **Step 2: Implement**

  `writeJSON`: JSON.stringify with `replacer` that converts `Map` to plain object. `readJSON`: JSON.parse, reconstruct Map for files, run same `ManifestSchema.safeParse()`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw-json`
  Expected: PASS

---

### Task 5: Thumbnail Generator — `thumbnail.ts` [CHANGE SITE]

**Orient:** Implement `generateThumbnail(canvas: HTMLCanvasElement): Promise<Blob>` producing a 1024×768 PNG — called by the write path before saving; browser-only (CLI and test stubs get `null`).
**Flow position:** Step 1 of 1 in Thumbnail flow (Excalidraw canvas → **thumbnail generator** → write() meta/thumbnail.png)
**Skill:** `none`
**Files:**
- Create: `packages/data/src/thumbnail.ts`

<contracts>
**Upstream:** Receives any `HTMLCanvasElement` (the Excalidraw canvas DOM node, obtained via `ExcalidrawAPI.getSceneElements` + off-screen canvas redraw, or passed directly from the app).
**Downstream:** Returns `Promise<Blob>` PNG at exactly 1024×768 (letterboxed if aspect ratio differs). Returns `Promise<null>` in non-browser environments (Node.js, Bun — detected via `typeof document === 'undefined'`).
</contracts>

- [ ] **Step 1: Implement `generateThumbnail`**

  Create off-screen `OffscreenCanvas(1024, 768)`. Draw source canvas into it with `drawImage`, preserving aspect ratio (letterbox with white background). Call `offscreen.convertToBlob({ type: 'image/png' })`. Guard with `typeof document === 'undefined'` check.

  Run: `yarn workspace @atlasdraw/data build`
  Expected: Build succeeds; `generateThumbnail` exported; no TypeScript errors.

- [ ] **Step 2: Wire into `write()`**

  Modify `packages/data/src/atlasdraw.ts`: `write()` accepts optional `thumbnail?: Blob` param. Callers (persistence.ts in Wave 2) pass the result of `generateThumbnail()`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern atlasdraw`
  Expected: Existing write tests still PASS; thumbnail entry appears in zip when param is provided.

- [ ] **Step 3: Verify non-browser safety**

  Run: `node -e "const { generateThumbnail } = require('./dist/thumbnail'); generateThumbnail(null).then(console.log)"`
  Expected: Prints `null` without throwing.

---

### Task 6: CSV Parser — `csv.ts` [CHANGE SITE]

**Orient:** Implement `parseCSV(blob: Blob): Promise<GeoJSON.FeatureCollection>` with column detection — lat/lng by name and by heuristic range check — so users can drag in any CSV and have points appear on the map without configuration.
**Flow position:** Step 1 of 1 in CSV import flow (file picker / drag-drop → **csv.ts** → LayerRegistry in ImportDialog)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/csv.ts`
- Modify: `packages/data/package.json` (add `papaparse`)
- Test: `packages/data/src/__tests__/csv.test.ts`

<contracts>
**Upstream:** Receives raw `Blob` from file picker or drop event.
**Downstream:** Returns `Promise<GeoJSON.FeatureCollection>` (Point geometry) or throws `CSVParseError` with `code: 'NO_COORD_COLUMNS' | 'PARSE_ERROR'`.
- Behavioral invariant: all feature properties are preserved as-is from CSV columns.
- Behavioral invariant: address columns (`address`, `street`, `location`, case-insensitive) are included in feature properties with key `_addressColumn_v1: string` but NOT geocoded (stubbed — deferred to Phase 6). The `_v1` suffix is a public versioned API; Phase 6 may add `_addressColumn_v2` with geocoding semantics without breaking existing files. (Resolved Q7.)
- Behavioral invariant: rows where detected coord columns are non-numeric are silently dropped and counted in `metadata.droppedRows`.
</contracts>

- [ ] **Step 1: Write failing tests**

  Cover: CSV with `lat,lng` headers → FeatureCollection with correct Point coordinates; CSV with `latitude,longitude` headers (case-insensitive) → same; CSV with no named coord columns but two numeric columns with values in [-90,90] and [-180,180] → detected by heuristic; CSV with address column → property preserved, `_addressColumn_v1` set, no geocoding call; CSV with zero valid coord columns → `CSVParseError { code: 'NO_COORD_COLUMNS' }`; malformed CSV → `CSVParseError { code: 'PARSE_ERROR' }`; rows with non-numeric lat → dropped, `metadata.droppedRows = 1`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern csv`
  Expected: FAIL — csv.ts not found

- [ ] **Step 2: Implement column name detection**

  PapaParse `parse(text, { header: true })`. Scan headers case-insensitively: lat candidates = `['lat', 'latitude', 'y']`; lng candidates = `['lng', 'lon', 'longitude', 'x']`. If both found by name, use them. Otherwise fall through to heuristic.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern csv -- --testNamePattern named`
  Expected: Named-header tests PASS

- [ ] **Step 3: Implement column statistics heuristic**

  For each numeric-looking column (all values parseable as float), compute min/max. If a column has min/max within [-90, 90] and another within [-180, 180], they are lat/lng candidates (pick the tighter-range one as lat). Score by: fraction of non-empty rows that are valid floats (must be > 0.8) and range fits.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern csv`
  Expected: All CSV tests PASS

- [ ] **Step 4: Build + type-check**

  Run: `yarn workspace @atlasdraw/data build`
  Expected: Clean build; `parseCSV` and `CSVParseError` exported from index.

---

### Task 7: Shapefile Parser — `shapefile.ts` [CHANGE SITE]

**Orient:** Implement `parseShapefile(blob: Blob): Promise<GeoJSON.FeatureCollection>` wrapping `shpjs` — needed by CLI `convert` in Wave 2; any geometry type (points, lines, polygons) from a `.zip` containing `.shp/.dbf/.prj`.
**Flow position:** Step 1 of 1 in Shapefile import flow (zip file → **shapefile.ts** → GeoJSON pivot → write())
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/shapefile.ts`
- Modify: `packages/data/package.json` (add `shpjs ^6.2` — current stable; plan originally cited `^4.0` but latest is `6.2.0`)
- Test: `packages/data/src/__tests__/shapefile.test.ts`

<contracts>
**Upstream:** Receives a `Blob` expected to be a zip containing `.shp`, `.dbf`, optional `.prj`.
**Downstream:** Returns `Promise<GeoJSON.FeatureCollection>` or throws `ShapefileParseError { code: 'BAD_ZIP' | 'MISSING_SHP' | 'PARSE_ERROR' }`.
- Behavioral invariant: CRS re-projection not applied in Phase 3 — `.prj` content recorded in `featureCollection.crs` if present; caller handles re-projection.
</contracts>

- [ ] **Step 1: Write failing tests**

  Use a minimal hand-crafted shapefile zip fixture. Cover: valid zip parses to FeatureCollection; zip without `.shp` throws `MISSING_SHP`; non-zip throws `BAD_ZIP`.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern shapefile`
  Expected: FAIL

- [ ] **Step 2: Implement**

  `shpjs(arrayBuffer)` returns a GeoJSON FeatureCollection or throws. Wrap in try/catch and rethrow as `ShapefileParseError`. Convert Blob to ArrayBuffer first.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern shapefile`
  Expected: PASS

---

### Task 8: Persistence Layer — `apps/atlas-app/state/persistence.ts` [CHANGE SITE]

<!-- shape-incorporated 2026-05-03: reframed FSA as Chrome/Edge enhancement, not co-equal path — Q1 resolution confirms Firefox/Safari have no FSA support; IndexedDB is the universal primary; FSA is an opt-in disk-save enhancement for Chromium users only -->
**Orient:** Implement the `PersistenceStore` that auto-saves the current document to **IndexedDB (primary — all browsers)** every 5 seconds and, on Chromium browsers only, exposes explicit "Save to disk" / "Open file" via the File System Access API — this is what makes the editor local-first; without it, a refresh loses all work. Firefox and Safari users are fully served by IndexedDB + download/input paths; FSA is a Chromium enhancement, not a fallback.
**Flow position:** Step 1 of 2 in Persistence flow (editor state → **persistence.ts** → IndexedDB / disk file)
**Skill:** `test-driven-development`
**Codebooks:** `optimistic-ui-vs-data-consistency`
**Files:**
- Create: `apps/atlas-app/state/persistence.ts`
- Modify: `apps/atlas-app/package.json` (add `idb`)
- Test: `apps/atlas-app/state/persistence.test.ts`

<contracts>
**Upstream:** Receives `AtlasdrawDocument` from Zustand store snapshot (triggered by store subscription).
**Downstream:** Exports `PersistenceStore` interface + `createPersistenceStore(options)` factory.
- `save(doc: AtlasdrawDocument): Promise<void>` — writes to IndexedDB; marks dirty flag false.
- `load(): Promise<AtlasdrawDocument | null>` — reads from IndexedDB; returns null on first run.
- `saveToDisk(doc: AtlasdrawDocument): Promise<void>` — FSA `showSaveFilePicker`, writes zip Blob; stores `FileSystemFileHandle` in IndexedDB for re-use.
- `openFromDisk(): Promise<AtlasdrawDocument | null>` — FSA `showOpenFilePicker` with `.atlasdraw` filter; returns null on user cancel.
- `onDirty(cb: () => void): () => void` — registers a callback invoked when in-memory state diverges from last persisted state; returns unsubscribe fn.
- Behavioral invariant: auto-save fires no more than once per 5-second window (debounced, NOT throttled — trailing edge so the final state wins).
- Behavioral invariant: if auto-save is in-flight and the user triggers "Save to disk", disk save waits for auto-save to complete (serialize via promise chain, not parallel writes).
</contracts>

> **Codebook note — `optimistic-ui-vs-data-consistency`:**
> Auto-save uses *optimistic* persistence: the in-memory state is the truth, and IndexedDB is a mirror. The conflict is: (a) user edits → dirty; (b) 5s timer fires → save begins; (c) user edits again mid-save; (d) save completes, dirty flag clears — but the new edits weren't in this save. Resolution: dirty flag must be set from an immutable snapshot taken at save-start, not from the live state. Use `const snapshot = doc` at timer-fire time; only clear dirty if no further edits arrived during the write. Implement via a `pendingSave: Promise<void> | null` guard.

- [ ] **Step 1: Write failing tests (non-FSA paths only — FSA is browser-only)**

  Cover: `save()` writes to IndexedDB (mock `idb`); `load()` returns null on empty DB; `load()` returns saved doc after `save()`; `onDirty` fires after a call to `markDirty()`; auto-save debounce: three rapid `markDirty()` calls within 100ms result in one `save()` call (use fake timers); dirty flag remains true if edits arrive during in-flight save.

  Run: `yarn workspace atlas-app test --testPathPattern persistence`
  Expected: FAIL — module not found

- [ ] **Step 2: Implement IndexedDB persistence**

  Use `idb` `openDB('atlasdraw-autosave', 1, { upgrade })`. IDB stores binary Blobs natively — use the zip `write()` from `@atlasdraw/data` (not `writeJSON`) so binary attachments (photos from pin elements) round-trip without data loss. Store the resulting `Blob` under a single key `'current'`; a second key `'fileHandle'` holds the optional `FileSystemFileHandle`. `load()` reads the Blob and calls `read(blob)` from `@atlasdraw/data`.

  **Why not `writeJSON()`?** `writeJSON()` throws `HAS_BINARY_ATTACHMENTS` when `doc.files.size > 0`. Phase 2 ships pin-with-photo; auto-save would throw on first user photo. IDB supports Blob values natively (no base64 overhead); the zip Blob is the correct storage unit here.

  Run: `yarn workspace atlas-app test --testPathPattern persistence -- --testNamePattern "IndexedDB"`
  Expected: PASS

- [ ] **Step 3: Implement auto-save pump with debounce and snapshot guard**

  Export `startAutoSave(store: PersistenceStore, getDoc: () => AtlasdrawDocument, intervalMs = 5000, maxFlushMs = 30000): () => void`. Timer strategy (resolved Q3): trailing-edge debounce resets on each `markDirty()`, fires `intervalMs` after last edit; a ceiling timer fires unconditionally `maxFlushMs` after the first `markDirty()` since the last flush — whichever fires first triggers `save()`. On each save-triggering event, snapshot `doc = getDoc()`, set `pendingSave = save(snapshot)`, await, then clear dirty only if `getDoc() === snapshot` (by identity check on `manifest.updatedAt`).

  Run: `yarn workspace atlas-app test --testPathPattern persistence`
  Expected: All persistence tests PASS

- [ ] **Step 4: Implement download/input paths for Firefox/Safari (primary path for those browsers)**

  <!-- shape-incorporated 2026-05-03: renamed "stub FSA fallback" to "download/input primary path" — Q1 resolution: Firefox/Safari have NO FSA support; these are not fallbacks, they are the complete implementation for ~30-40% of users. Log level changed from WARN to INFO. -->
  `saveToDisk` and `openFromDisk` check `typeof window.showSaveFilePicker !== 'undefined'`; if absent, execute the download/input path as the intended implementation for that browser: `<a download>` blob URL trigger for save, `<input type="file" accept=".atlasdraw">` for open. Log `[INFO] File System Access API unavailable (Firefox/Safari); using download/input path` — not a warning, this is the correct behavior for those browsers.

  Run: `yarn workspace atlas-app build`
  Expected: Build succeeds; no `window is not defined` errors in SSR/Node paths.

---

### Task 9: Persistence Wiring — `apps/atlas-app/state/store.ts` integration [CHANGE SITE]

**Orient:** Wire `PersistenceStore` into the Zustand store so the editor auto-saves on state change and the "Save" / "Open" toolbar buttons call the FSA paths — this is the last step that makes persistence visible to the user.
**Flow position:** Step 2 of 2 in Persistence flow (persistence.ts → **store.ts wiring** → toolbar buttons)
**Skill:** `atlasdraw-ui-conventions` — invoke before adding Save/Open buttons and the isDirty indicator to `Toolbar.tsx`. Buttons slot into the existing toolbar surface (not a new panel). Check button pattern, text size, aria labels, data-testid.
**Codebooks:** `optimistic-ui-vs-data-consistency`
**Files:**
- Modify: `apps/atlas-app/state/store.ts`
- Modify: `apps/atlas-app/components/Toolbar.tsx`

> **Codebook note:** The wiring task makes optimistic persistence visible in the UI. The dirty flag must gate the "unsaved changes" indicator in the toolbar — a user who sees no indicator and refreshes must not lose work. Wire `onDirty` to a Zustand `isDirty` boolean. Do not debounce the UI indicator (show immediately); only debounce the actual write.

- [ ] **Step 1: Add persistence slice to Zustand store**

  Add to `store.ts`: `isDirty: boolean`, `markDirty()`, `persistenceStore: PersistenceStore | null`, `setPersistenceStore(s)`. Subscribe to all scene state changes with `subscribe()` → call `markDirty()`. Initialize `persistenceStore` in `App.tsx` `useEffect` on mount; call `load()` and hydrate store; start auto-save pump.

  Run: `yarn workspace atlas-app build`
  Expected: Build succeeds; TypeScript finds no errors in `store.ts`; `isDirty` and `markDirty` are exported from the store type.

- [ ] **Step 2: Wire toolbar buttons**

  In `Toolbar.tsx`: "Save" button calls `store.persistenceStore?.saveToDisk(getDoc())`. "Open" button calls `store.persistenceStore?.openFromDisk()` then hydrates store. Show `isDirty` indicator (bullet or asterisk in title) when `store.isDirty`.

  Run: `yarn workspace atlas-app build`
  Expected: Build succeeds; no TypeScript errors in `Toolbar.tsx`; `isDirty` prop flows from store to indicator element.

- [ ] **Step 3: Verify end-to-end in browser**

  Run: `yarn workspace atlas-app dev`
  Expected: Opening the app loads from IndexedDB. Editing marks the title with `*`. Clicking Save opens FSA picker on Chrome/Edge. Refreshing restores state. Console shows no errors.

---

### Task 10: CLI Lint Command — `packages/cli/commands/lint.ts` [CHANGE SITE]

**Orient:** Implement `atlasdraw lint <file>` — validate a `.atlasdraw` file's manifest against the Zod schema and report field-level errors — so newsroom engineers and CI pipelines can verify files without opening the browser.
**Flow position:** Step 1 of 2 in CLI flow (file → **lint** → exit code + human-readable report)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/cli/src/commands/lint.ts`
- Modify: `packages/cli/src/atlasdraw.ts` (register subcommand)
- Test: `packages/cli/src/__tests__/lint.test.ts`

<contracts>
**Upstream:** File path string from Commander. File must be readable on disk.
**Downstream:** Exits 0 on valid; exits 1 on invalid with stderr lines `"manifest.json: <fieldPath>: <zodMessage>"`. Stdout on success: `"OK: manifest version 1, id <ulid>, title '<title>'"`.
</contracts>

- [ ] **Step 1: Write failing tests**

  Cover: valid `.atlasdraw` fixture exits 0 with OK message; fixture with `id` removed exits 1 with `manifest.json: id: Required` on stderr; fixture with `version: 2` exits 1 with version error; non-existent path exits 1 with `"File not found: <path>"`.

  Run: `yarn workspace @atlasdraw/cli test --testPathPattern lint`
  Expected: FAIL

- [ ] **Step 2: Implement lint command**

  Read file with `fs.readFile`, pass to `read()` from `@atlasdraw/data`. Catch `AtlasdrawFormatError` → stderr + exit 1. On success, print OK line. For `INVALID_MANIFEST`, re-parse with `ManifestSchema.safeParse()` to get field-level `error.errors` array and format each as `"manifest.json: <path.join('.')>: <message>"`.

  Run: `yarn workspace @atlasdraw/cli test --testPathPattern lint`
  Expected: PASS

- [ ] **Step 3: Register in CLI entry**

  `atlasdraw.ts`: `program.addCommand(lintCommand)`. Test `--help` output includes `lint <file>`.

  Run: `node packages/cli/dist/atlasdraw.js --help`
  Expected: `lint <file>  validate a .atlasdraw file against schema` visible in output.

---

### Task 11: CLI Convert Command — `packages/cli/commands/convert.ts` [CHANGE SITE]

**Orient:** Implement `atlasdraw convert <in> <out>` dispatching by file extension pair (GeoJSON ↔ Shapefile ↔ `.atlasdraw` ↔ `.atlasdraw.json`) — the format interchange bridge that lets QGIS users extract their data and CI pipelines batch-convert.
**Flow position:** Step 2 of 2 in CLI flow (lint → **convert** → output file on disk)
**Skill:** `none`
**Files:**
- Create: `packages/cli/src/commands/convert.ts`
- Modify: `packages/cli/src/atlasdraw.ts`

<contracts>
**Upstream:** Two file-path strings. Extension pairs determine dispatch: `.geojson → .atlasdraw`, `.atlasdraw → .geojson`, `.zip → .geojson` (shapefile), `.geojson → .atlasdraw.json`, `.atlasdraw.json → .geojson`.
**Downstream:** Writes output file; exits 0 on success with `"Written: <outpath>"`; exits 1 with stderr on any parse/write error; exits 1 with `"Unsupported conversion: <ext> → <ext>"` on unknown pair.
</contracts>

- [ ] **Step 1: Implement dispatch table**

  Build a `Map<string, ConvertFn>` keyed by `'<inExt>→<outExt>'`. Populate with available pairs. `.atlasdraw → .geojson`: `read(blob)` → serialize all layers as a FeatureCollection. `.geojson → .atlasdraw`: build minimal `AtlasdrawDocument` with empty scene, single layer. `.zip → .geojson`: `parseShapefile(blob)`. `.geojson → .atlasdraw.json`: same as zip path but using JSON variant writer.

  Run: `yarn workspace @atlasdraw/cli build`
  Expected: Build succeeds; `convert` subcommand registered; `--help` lists `convert <in> <out>`.

- [ ] **Step 2: Wire and test smoke case**

  Run: `node packages/cli/dist/atlasdraw.js convert fixtures/sample.geojson /tmp/out.atlasdraw`
  Expected: Exit 0; file `/tmp/out.atlasdraw` exists and passes lint.

  Run: `node packages/cli/dist/atlasdraw.js convert /tmp/out.atlasdraw /tmp/back.geojson`
  Expected: Exit 0; `/tmp/back.geojson` is valid GeoJSON with same feature count as input.

---

### Task 12: Round-Trip Tests [CHANGE SITE]

**Orient:** Write the integration test that opens a synthetic `AtlasdrawDocument`, writes it to zip, reads it back, and asserts structural equality of scene + manifest + all layer feature counts — this is the acceptance test for the entire Phase 3 deliverable.
**Flow position:** Terminal node in Format I/O flow (write → read → **round-trip assertion**)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/__tests__/round-trip.test.ts`
- Create: `packages/data/src/__tests__/fixtures/sample-document.ts` (test fixture factory)

<contracts>
**Upstream:** Uses `write()` and `read()` from `atlasdraw.ts`; uses `ManifestSchema` from `manifest-schema.ts`.
**Downstream:** No consumers — this is a terminal verification node.
- Behavioral invariant: structural equality means same `manifest.id`, same `manifest.layers.length`, same feature count per layer, same scene element IDs (not positions — float precision may differ).
</contracts>

- [ ] **Step 1: Write round-trip test — minimal document**

  Fixture: one layer (3 features), 2 scene elements, no binary files, no thumbnail.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern round-trip`
  Expected: PASS (if write + read already work) — this validates the integration

- [ ] **Step 2: Round-trip with binary files**

  Fixture: same document + 1 JPEG `Blob` in `files` map. Assert file count preserved after round-trip.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern round-trip`
  Expected: PASS

- [ ] **Step 3: Round-trip manifest equality**

  Assert `readBack.manifest` equals `original.manifest` field-by-field (id, title, camera, basemap, layers array length, permissions).

  Run: `yarn workspace @atlasdraw/data test`
  Expected: All 4 test files PASS; `yarn workspace @atlasdraw/cli test` PASS; zero TypeScript errors from `tsc --noEmit` in both packages.

---

### Task 13: KML/GPX Parsers — `kml.ts`, `gpx.ts` [STRETCH]

**Orient:** Wrap `@mapbox/togeojson` to implement `parseKML` and `parseGPX` — stretch goal for Phase 3; deprioritize if Wave 3 round-trip tests are not green; fully punted to Phase 6 if any Wave 0–2 task slips. (`togeojson` on npm is deprecated; `@mapbox/togeojson` is the official successor with identical API — `toGeoJSON.kml(doc)` / `toGeoJSON.gpx(doc)` — only the package name changes.)
**Flow position:** Step 1 of 1 in KML/GPX import flow (file picker → **kml.ts / gpx.ts** → GeoJSON pivot)
**Skill:** `test-driven-development`
**Files:**
- Create: `packages/data/src/kml.ts`
- Create: `packages/data/src/gpx.ts`
- Modify: `packages/data/package.json` (add `@mapbox/togeojson ^0.16.2` — `togeojson` is deprecated on npm; `@mapbox/togeojson` is the official successor with identical API)

<contracts>
**Upstream:** Receives `Blob` (KML or GPX XML file).
**Downstream:** Returns `Promise<GeoJSON.FeatureCollection>`. Throws `KMLParseError | GPXParseError` on malformed input.
</contracts>

- [ ] **Step 1: Implement `parseKML`**

  `toGeoJSON.kml(doc)` where `doc = new DOMParser().parseFromString(text, 'text/xml')` (import from `@mapbox/togeojson`). Wrap in error handling.

  Run: `yarn workspace @atlasdraw/data test --testPathPattern kml`
  Expected: PASS with minimal KML fixture producing at least one GeoJSON feature.

- [ ] **Step 2: Implement `parseGPX`**

  Same pattern with `toGeoJSON.gpx(doc)` (import from `@mapbox/togeojson`).

  Run: `yarn workspace @atlasdraw/data test --testPathPattern gpx`
  Expected: PASS with minimal GPX track fixture producing LineString features.

- [ ] **Step 3: Basic smoke tests with minimal KML/GPX fixtures**

  Run: `yarn workspace @atlasdraw/data test --testPathPattern kml`
  Expected: PASS. Same for gpx.

---

## Execution Waves

### Wave 0 — Schema Foundation (serial, ~1 day)

| Task | Description | Dependency |
|---|---|---|
| Task 1 | `manifest-schema.ts` Zod schema + tests | None — pure type work |

**Exit gate:** `ManifestSchema`, `Manifest`, `AtlasdrawDocument` exported from `@atlasdraw/data` with passing tests. All Wave 1 workers can import these types.

---

### Wave 1 — Core Format I/O + CSV (parallel, ~2 days)

| Task | Worker | Depends on |
|---|---|---|
| Task 2 | `atlasdraw.ts` write path | Wave 0 |
| Task 3 | `atlasdraw.ts` read path | Task 2 (same file) |
| Task 4 | `atlasdraw-json.ts` JSON variant | Wave 0 |
| Task 5 | `thumbnail.ts` | Task 2 (write wires it) |
| Task 6 | `csv.ts` + tests | Wave 0 (needs `AtlasdrawDocument` type only) |
| Task 7 | `shapefile.ts` + tests | Wave 0 |

**Parallel within Wave 1:** Tasks 4, 5, 6, 7 can run concurrently. Tasks 2 and 3 are sequential (same file).

**Exit gate:** `read`, `write`, `writeJSON`, `readJSON`, `parseCSV`, `parseShapefile` all exported and tested green.

---

### Wave 2 — Persistence + CLI (parallel, ~2 days)

| Task | Worker | Depends on |
|---|---|---|
| Task 8 | `persistence.ts` IndexedDB + FSA | Wave 1 (`read`, `write`, `writeJSON`) |
| Task 9 | Store wiring + Toolbar | Task 8 |
| Task 10 | CLI `lint` command | Wave 1 (`read`, `ManifestSchema`) |
| Task 11 | CLI `convert` command | Wave 1 + Task 10 |

**Parallel within Wave 2:** Tasks 8/9 and Tasks 10/11 are two independent streams. Tasks 9 and 11 each depend on the preceding task in their stream.

**Exit gate:** `atlasdraw lint` exits 0 on valid file; `atlasdraw convert` writes output file; persistence auto-saves to IndexedDB; FSA save/open work in Chromium (Chrome/Edge); download/input path works in Firefox/Safari. <!-- shape-incorporated 2026-05-03: exit gate now explicitly names both persistence paths per Q1 resolution — download/input is not optional, it is the primary path for Firefox/Safari -->

---

### Wave 3 — Round-Trip Tests + Stretch (serial gate + optional parallel, ~1 day)

| Task | Worker | Depends on |
|---|---|---|
| Task 12 | Round-trip integration tests | All Wave 1 + Wave 2 |
| Task 13 | KML/GPX parsers [STRETCH] | Wave 0 only — can run any time after W0 if capacity exists |

**Exit gate (Wave 3 required):** `packages/data` full test suite green; `packages/cli` full test suite green; `tsc --noEmit` clean in both packages; round-trip test passes for both zip and JSON variants.

---

## Open Questions

1. **FSA permission lifecycle across browser sessions:** When a user grants permission to a `.atlasdraw` file via `showSaveFilePicker`, the `FileSystemFileHandle` is stored in IndexedDB. On next session, calling `handle.queryPermission({ mode: 'readwrite' })` may return `'prompt'` — the browser revokes persistent permission on close. What UX should we show? Options: (a) silently fall back to "Download" on next save; (b) show a "Re-authorize file" button; (c) store the handle but always use `showSaveFilePicker` on first save per session. **Recommend (c) for MVP** — simplest, zero permission UX needed. Revisit in Phase 4.

   **RESOLVED (2026-05-03):** Option (c) confirmed. MDN `FileSystemHandle.queryPermission()` states explicitly: "a handle retrieved from IndexedDB is also likely to resolve with 'prompt'" — Chrome does NOT persist `readwrite` permission across sessions by design. `requestPermission()` requires transient user activation (button click), which the "Save" button provides — so on session reload, the first "Save" click calls `requestPermission()` automatically; no separate "Re-authorize" UI is needed. Firefox and Safari do not support FSA (`queryPermission`/`requestPermission` are "not Baseline" per MDN); the download/`<input type=file>` fallback in Task 8 Step 4 covers those browsers. Sources: [MDN queryPermission](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission), [MDN requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission).

2. **`style.json`: snapshot vs registry reference:** The spec's `manifest.json` shows `basemap: { type: 'registry', id: 'protomaps-light' }` — a registry reference. But `style.json` could be either a full MapLibre style snapshot (portable, self-contained) or a registry ID (small, but requires the registry to exist on open). Snapshots make the file truly portable; registry IDs make it smaller but fragile on self-hosted instances with different basemap configs. **Recommend: snapshot in `style.json` + registry reference in `manifest.json`** — belt-and-suspenders for Phase 3; Phase 5 can add a "resnap" command.

   **RESOLVED (2026-05-03):** Belt-and-suspenders confirmed. A MapLibre style is a self-contained JSON document (`version`, `sources`, `layers`, `sprite`, `glyphs` — [MapLibre Style Spec §root](https://maplibre.org/maplibre-style-spec/root/)). Snapshotting it inside the zip makes the `.atlasdraw` file renderable without a live registry. The app on open prefers `manifest.basemap.id` (registry lookup, fast, gets latest style version); falls back to `style.json` snapshot if the registry ID is unknown (self-hosted instance with different basemap config). Design decision — no external authority. No task changes needed.

3. **Auto-save debounce window:** Spec says "every 5s." Should this be a fixed 5s interval (setInterval) or a 5s trailing-edge debounce triggered by state changes? Interval wastes writes when idle; debounce may defer saves for minutes on fast typists. **Recommend: trailing-edge debounce with 5s wait AND a 30s maximum flush** — at most 30s of work lost if crash.

   **RESOLVED (2026-05-03):** Trailing-edge debounce + 30s ceiling confirmed. Implementation: use two timers — a debounce timer (reset on each `markDirty()`, fires 5s after last edit) and a ceiling timer (set once on first `markDirty()` after a flush, fires unconditionally at 30s). Whichever fires first triggers `save()`. Design decision; no external authority. Task 8 Step 3 already specifies the debounce shape — add ceiling timer to the contract note there.

4. **Thumbnail render trigger:** Should `generateThumbnail()` be called on every auto-save (expensive), only on explicit "Save to disk", or on a separate 60s timer? Re-rendering the Excalidraw canvas off-screen is ~50–200ms. **Recommend: only on explicit disk save** — auto-save to IndexedDB skips thumbnail; disk save includes it. Revisit in Phase 4 (thumbnail for share link preview).

   **RESOLVED (2026-05-03):** Explicit disk save only, confirmed. 50–200ms off-screen render per auto-save at 5s intervals = up to 4% of user time spent generating thumbnails — unacceptable on a hot path. IDB auto-save is a crash-recovery store; thumbnail is a presentation artifact. Design decision; no external authority. No task changes needed.

5. **`.atlasdraw.json` vs zip in IndexedDB:** Task 8 resolves this: IndexedDB always stores the zip Blob (via `write()`), not JSON. `writeJSON()` is reserved for explicit user export of binary-free maps and for the CLI `--json` flag. The formats are not interchangeable at the persistence layer. **Settled — do not revisit in Phase 3.** Phase 4 may add a "copy as JSON" action for share-via-URL if the doc has no binary attachments.

   **RESOLVED (2026-05-03):** Settled as stated. IDB natively handles Blob values; the zip Blob avoids base64 overhead and correctly stores binary attachments (pin photos). `writeJSON()` throws `HAS_BINARY_ATTACHMENTS` on docs with `files.size > 0`, making it wrong for the auto-save path. No further research needed.

6. **CSV heuristic threshold:** The column-statistics approach considers a column a lat/lng candidate if >80% of values parse as floats in the valid range. What handles edge cases — Antarctica (lat close to -90), dateline-crossing (lng near ±180), or small datasets (<10 rows)? Propose: for <10 rows, require 100% numeric; for ≥10 rows, 80%. Document the threshold as a named constant `CSV_HEURISTIC_THRESHOLD = 0.8` in `csv.ts`.

   **RESOLVED (2026-05-03):** Thresholds confirmed: `CSV_HEURISTIC_THRESHOLD = 0.8` for ≥10 rows; 1.0 (100%) for <10 rows — export as `CSV_HEURISTIC_THRESHOLD_SMALL_DATASET = 1.0`. Edge cases are handled correctly by the range bounds (Antarctica lat ~ -90 is within [-90, 90]; dateline lng ~ ±180 is within [-180, 180]). Design decision; no external authority. Task 6 Step 3 should add the small-dataset branch explicitly.

7. **`parseCSV` and the address-column stub:** Phase 3 imports address columns into properties but does not geocode. Phase 6 adds geocoding. Should the `_addressColumn` property be a public API (visible to Phase 6 importers) or internal? If Phase 6 changes the field name, all Phase 3 files need migration. **Recommend: make it public and version it** — `_addressColumn_v1: string` — so Phase 6 can add `_addressColumn_v2` without breaking existing files.

   **RESOLVED (2026-05-03):** Public + versioned confirmed. Field name `_addressColumn_v1` is a Phase 3 Phase Boundary Contract — once GeoJSON features with this property are persisted to `.atlasdraw` files on disk, the name is load-bearing for Phase 6 migration. Design decision; no external authority. Task 6 contracts section should be updated to reflect `_addressColumn_v1` (not `_addressColumn`).

---

## Artifact Manifest

```
<!-- ARTIFACT MANIFEST -->
| Artifact | Type | Status | Path |
|---|---|---|---|
| `manifest-schema.ts` | Create | Planned | `packages/data/src/manifest-schema.ts` |
| `manifest-schema.test.ts` | Create | Planned | `packages/data/src/__tests__/manifest-schema.test.ts` |
| `atlasdraw.ts` | Create | Planned | `packages/data/src/atlasdraw.ts` |
| `atlasdraw.test.ts` | Create | Planned | `packages/data/src/__tests__/atlasdraw.test.ts` |
| `atlasdraw-json.ts` | Create | Planned | `packages/data/src/atlasdraw-json.ts` |
| `atlasdraw-json.test.ts` | Create | Planned | `packages/data/src/__tests__/atlasdraw-json.test.ts` |
| `thumbnail.ts` | Create | Planned | `packages/data/src/thumbnail.ts` |
| `csv.ts` | Create | Planned | `packages/data/src/csv.ts` |
| `csv.test.ts` | Create | Planned | `packages/data/src/__tests__/csv.test.ts` |
| `shapefile.ts` | Create | Planned | `packages/data/src/shapefile.ts` |
| `shapefile.test.ts` | Create | Planned | `packages/data/src/__tests__/shapefile.test.ts` |
| `round-trip.test.ts` | Create | Planned | `packages/data/src/__tests__/round-trip.test.ts` |
| `sample-document.ts` | Create | Planned | `packages/data/src/__tests__/fixtures/sample-document.ts` |
| `persistence.ts` | Create | Planned | `apps/atlas-app/state/persistence.ts` |
| `persistence.test.ts` | Create | Planned | `apps/atlas-app/state/persistence.test.ts` |
| `store.ts` (modified) | Modify | Planned | `apps/atlas-app/state/store.ts` |
| `Toolbar.tsx` (modified) | Modify | Planned | `apps/atlas-app/components/Toolbar.tsx` |
| `cli/lint.ts` | Create | Planned | `packages/cli/src/commands/lint.ts` |
| `lint.test.ts` | Create | Planned | `packages/cli/src/__tests__/lint.test.ts` |
| `cli/convert.ts` | Create | Planned | `packages/cli/src/commands/convert.ts` |
| `cli/atlasdraw.ts` (modified) | Modify | Planned | `packages/cli/src/atlasdraw.ts` |
| `kml.ts` [STRETCH] | Create | Deferred | `packages/data/src/kml.ts` |
| `gpx.ts` [STRETCH] | Create | Deferred | `packages/data/src/gpx.ts` |
<!-- END ARTIFACT MANIFEST -->
```

---

## Execution Notes for Implementing Agent

- **Do not implement KML/GPX (Task 13) until Tasks 1–12 are green.** It is a stretch goal and time-box enforcer.
- **Wave 0 is a hard gate.** Do not start any Wave 1 task until `ManifestSchema` and `AtlasdrawDocument` are exported and tests pass. All downstream tasks type-check against these exports.
- **`persistence.ts` uses zip Blob for IndexedDB** (not `writeJSON`) — `writeJSON()` throws `HAS_BINARY_ATTACHMENTS` when `doc.files.size > 0`, making it wrong for the auto-save path once Phase 2 pin-with-photo lands. IDB handles Blob values natively with no base64 overhead; the zip Blob is the correct storage unit. `writeJSON()` is reserved for explicit user export of binary-free maps and the CLI `--json` flag only. (Resolved Q5; earlier note in this section was incorrect.)
- **CLI tests use Node.js `fs` module** — no browser APIs. Keep `packages/cli` free of `window`, `document`, and FSA references. The CLI calls `read()` / `write()` from `@atlasdraw/data` which are pure; thumbnail generation is skipped in CLI context (returns null).
- **Test fixtures are immutable.** Per project rules in `.claude/rules/test-fixtures.md`: never modify a fixture to fix a test; create a new fixture instead.
- **Phase boundary reminder:** This plan's output (`AtlasdrawDocument`, `PersistenceStore`, `parseCSV`) feeds Phase 4's share-via-URL feature directly. Keep the exported interfaces minimal and stable — adding fields is safe; renaming or removing breaks Phase 4.
- **`saveToDisk` / `openFromDisk` are Chromium-only enhancements.** Firefox and Safari users use the download/`<input type="file">` path as their complete (not degraded) implementation. Do not log WARN on those browsers; log INFO. (Resolved Q1 follow-up.)

---

## Shape Changes Summary

**Shape-incorporation date:** 2026-05-03
**Resolver inputs applied:** Q1 FSA lifecycle + Q1 Firefox/Safari finding; shpjs version bump; `@mapbox/togeojson` deprecation switch (already in plan at time of shape review).

| # | Section edited | Change | Cited Q |
|---|---|---|---|
| 1 | Tech Stack Additions table | `shpjs ^4.0` → `^6.2` | Resolver library health check |
| 2 | File Structure — `package.json` comment | Added `@mapbox/togeojson ^0.16.2`, pinned `shpjs ^6.2` | Resolver library health check |
| 3 | Task 8 Orient | Reframed: IndexedDB = primary (all browsers); FSA = Chromium enhancement only (not co-equal path) | Q1 follow-up: Firefox/Safari have no FSA |
| 4 | Task 8 Step 4 | Renamed "Stub FSA paths for non-Chrome" → "Implement download/input paths for Firefox/Safari (primary path for those browsers)"; changed log level WARN → INFO; clarified this is correct behavior, not degradation | Q1 follow-up |
| 5 | Wave 2 exit gate | Added explicit gate criterion: download/input path works in Firefox/Safari | Q1 follow-up |
| 6 | Execution Notes | Added note: `saveToDisk`/`openFromDisk` are Chromium enhancements; Firefox/Safari path is complete, log INFO not WARN | Q1 follow-up |

**Escalations — STILL OPEN at project level:** None. All Q1–Q13 resolutions are consistent with plan structure. No new open questions surfaced.

---

### Audit Incorporation 2026-05-03

*Applied by audit-incorporator agent. Each entry cites the finding ID from `docs/decisions/cross-phase-audit.md`.*

| # | Section edited | Change | Finding ID |
|---|---|---|---|
| 1 | Consumes from Phase 2 table — `ExcalidrawElement[]` row | Fixed field name: `customData.geoAnchor` → `customData.geo: GeoAnchor` | MISMATCH-3 (MED), per E-03 |
| 2 | Consumes from Phase 2 table — `LayerRegistry` row | Fixed source: `packages/geo` → `apps/atlas-app/state/store.ts` (Zustand slice); type at `packages/data/layer-registry.ts` | MISMATCH-2 (MED) |
| 3 | Consumes from Phase 2 table — `GeoAnchor` row | Fixed shape: flat `{lng,lat,zoom,projection:'EPSG:4326'}` → discriminated union `{kind:"point"\|"bbox"\|"polyline", ..., zRef}` per Phase 1 `packages/geo/types.ts` | MISMATCH-1 (HIGH), per E-03 |
| 4 | Task 1 `<contracts>` Upstream section | Removed "camera shape" description; replaced with explicit discriminated union reference and `customData.geo` field name | MISMATCH-1, MISMATCH-3, per E-03 |

**Items confirmed as no-change-needed:**
- Q1 Option (c) `requestPermission()` on Save click: already correct in Task 8 Step 4 contract — the Save button click satisfies transient user activation. No task edit needed.
- Q2 style.json belt-and-suspenders: no task changes, already correctly specified.
- Q3 debounce ceiling timer: already specified in Task 8 Step 3 contract note. No edit needed.
- Q4 thumbnail on explicit save only: already correct in Task 5 / Task 8. No edit needed.
- Q5–Q7: already incorporated correctly in the plan prior to this review.
- Wave order: no dependency shifts from any resolved Q.
- Phase boundary contracts: stable; `AtlasdrawDocument`, `PersistenceStore`, `parseCSV` shapes unchanged.
- Skill annotations: no task grew complex enough to warrant a skill change.
- KML/GPX Task 13: `@mapbox/togeojson` already in Tech Stack table and Task 13 body prior to this review.
