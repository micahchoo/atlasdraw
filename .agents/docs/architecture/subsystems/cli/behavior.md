# `packages/cli` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/cli`

---

## `lint` Command Flow

```
atlasdraw lint mymap.atlasdraw
  │
  ├── fs.readFile(filePath) → buffer
  │
  ├── packages/data.atlasdraw.parse(buffer)
  │     ├── success → AtlasdrawFile
  │     └── throws ParseError → exit 2 (internal/parse error)
  │
  ├── validate(AtlasdrawFile):
  │     ├── check version field exists and is known integer
  │     ├── for each element: check customData.geo is GeoAnchor discriminated union
  │     │     (kind:"point"|"bbox"|"polyline", correct fields, projection:"mercator")
  │     ├── check no element uses customData.geoAnchor (legacy field — flag as error)
  │     ├── check basemapStyleId is non-empty string
  │     └── check viewport.center is [number, number] in valid ranges
  │
  ├── errors.length === 0
  │     ├── true  → exit 0; print "✓ valid" (or silent if --quiet)
  │     └── false → print errors; exit 1
  │
  └── --json: print JSON.stringify(errors) to stdout regardless of exit code
```

[CONFIDENCE: high — per tech spec §4.6; validation rules extrapolated from GeoAnchor spec]

---

## `convert` Command Flow

```
atlasdraw convert input.kml output.atlasdraw
  │
  ├── detect inFormat from extension (.kml → kml, .geojson → geojson, etc.)
  ├── detect outFormat from extension (.atlasdraw → atlasdraw, etc.)
  │
  ├── lookup: conversionMatrix[inFormat][outFormat]
  │     └── not found → print "Unsupported: .kml → .csv" + matrix + exit 1
  │
  ├── packages/data[inFormat].parse(fs.readFileSync(inPath)) → intermediate
  │     intermediate is GeoJSON.FeatureCollection (for vector formats)
  │     or AtlasdrawFile (for .atlasdraw input)
  │
  ├── if outFormat === "atlasdraw":
  │     wrap FeatureCollection → AtlasdrawFile (default basemap, current date viewport)
  │
  ├── packages/data[outFormat].write(intermediate) → Blob/Buffer
  │
  └── fs.writeFileSync(outPath, buffer); exit 0
```

[CONFIDENCE: high — per tech spec §4.6]

---

## `render` Command Flow

```
atlasdraw render mymap.atlasdraw --width 1600 --out mymap.png
  │
  ├── require("puppeteer")
  │     └── throws → print "Install puppeteer: npm install puppeteer" + exit 1
  │
  ├── packages/data.atlasdraw.parse(filePath) → validate (same as lint)
  │     └── throws → exit 2
  │
  ├── puppeteer.launch({ headless: true })
  │     → page = await browser.newPage()
  │     → page.setViewport({ width, height })
  │
  ├── page.goto(ATLASDRAW_RENDER_URL + "?file=" + base64encode(fileContent))
  │     (ATLASDRAW_RENDER_URL defaults to localhost:3000 or a built-in static server)
  │
  ├── page.waitForSelector("[data-testid='map-loaded']", { timeout })
  │     └── timeout → exit 2 (tile load exceeded limit)
  │
  ├── page.screenshot({ path: outPath, type: format, fullPage: false })
  │
  └── browser.close(); exit 0
```

**Known limitation:** Puppeteer requires a running Atlasdraw server (or a locally-built static app) at the `ATLASDRAW_RENDER_URL`. For CI use, the render command documentation recommends running `npx serve apps/atlas-app/dist` before invoking render.
[CONFIDENCE: med — Puppeteer render mechanism is extrapolated from spec §4.6 description "server-side rendering using Puppeteer + the editor in headless mode"; exact URL/selector strategy is engineering extrapolation]

---

## Endorheic Basins

No module-level state. Each command is a stateless function call. Puppeteer instances are created and closed within the render function — they are not reused across calls. Repeat `render` calls each launch a fresh Puppeteer browser.

---

## Concurrency Model

All CLI commands are sequential — the binary processes one command invocation at a time. No parallelism within a single CLI run. If concurrent rendering is needed (e.g. batch map exports), callers should spawn multiple `atlasdraw render` processes in parallel at the shell level.

The `lint` and `convert` commands are fast (~100ms for typical files) and suitable for git hooks. The `render` command is slow (~3–10s including tile load) and intended for CI pipelines, not interactive use.
[CONFIDENCE: med — timing estimates extrapolated from typical Puppeteer startup overhead]
