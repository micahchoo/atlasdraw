# `packages/cli` — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5)
**Package name:** `@atlasdraw/cli`

---

## CLI Command Surface (binary: `atlasdraw`)

### `atlasdraw lint <file>` — **stable**
[CONFIDENCE: high — per tech spec §4.6]

```
USAGE
  atlasdraw lint <file>

ARGS
  file  Path to a .atlasdraw file

OPTIONS
  --json   Output errors as JSON array to stdout (default: human-readable)
  --quiet  Suppress all output; use exit code only

EXIT CODES
  0  File is valid
  1  Validation errors found (details printed to stdout)
  2  Internal error (file not found, parse exception)
```

---

### `atlasdraw convert <in> <out>` — **stable**
[CONFIDENCE: high — per tech spec §4.6]

```
USAGE
  atlasdraw convert <in> <out>

ARGS
  in   Input file path (.geojson, .kml, .gpx, .zip, .tif, .atlasdraw)
  out  Output file path (.geojson, .kml, .atlasdraw)

SUPPORTED CONVERSION MATRIX
  .geojson  → .kml, .atlasdraw
  .kml      → .geojson, .atlasdraw
  .gpx      → .geojson, .atlasdraw
  .zip      → .geojson, .atlasdraw   (Shapefile zip)
  .tif      → .atlasdraw             (raster layer; no vector export)
  .atlasdraw→ .geojson, .kml

EXIT CODES
  0  Conversion succeeded
  1  Unsupported conversion pair (prints supported matrix)
  2  Internal error
```

---

### `atlasdraw render <file> --format png --width N` — **experimental**
[CONFIDENCE: med — per tech spec §4.6; Puppeteer dependency and exact flags are extrapolated]

```
USAGE
  atlasdraw render <file> [options]

ARGS
  file  Path to a .atlasdraw file

OPTIONS
  --format   Output format: png (default), jpeg
  --width    Viewport width in pixels (default: 1600)
  --height   Viewport height in pixels (default: auto — inferred from viewport aspect)
  --out      Output file path (default: <input>.png)
  --timeout  Max wait time for tile load in ms (default: 10000)

REQUIREMENTS
  puppeteer must be installed: npm install puppeteer

EXIT CODES
  0  Render succeeded; output file written
  1  Puppeteer not installed
  2  Render timed out (tile load exceeded --timeout)
  3  Internal error
```

---

## Programmatic API (Node.js import)

```ts
import { lint, convert, render } from "@atlasdraw/cli";

// Lint
export async function lint(
  filePath: string,
  opts?: { json?: boolean }
): Promise<{ valid: boolean; errors: LintError[] }>;

export interface LintError {
  message: string;
  path?: string;  // JSON path to offending field, if applicable
}

// Convert
export async function convert(
  inPath: string,
  outPath: string
): Promise<void>;

// Render
export async function render(
  filePath: string,
  opts?: { format?: "png" | "jpeg"; width?: number; height?: number; out?: string; timeout?: number }
): Promise<string>;  // returns output file path
```

[CONFIDENCE: med — programmatic API shape extrapolated from the CLI surface; not explicitly specified in tech spec]

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `atlasdraw lint` CLI | stable | Phase 6 |
| `atlasdraw convert` CLI | stable | Phase 6 |
| `atlasdraw render` CLI | experimental | Phase 6 |
| `lint()` programmatic | stable | Phase 6 |
| `convert()` programmatic | stable | Phase 6 |
| `render()` programmatic | experimental | Phase 6 |

---

## License Notes

`packages/cli` is MIT-licensed. This is the tool journalists and data engineers install globally (`npm install -g @atlasdraw/cli`). MIT ensures no license complications for commercial newsroom use. The CLI imports only from MIT packages (`packages/data`, `packages/geo`) — it does not import from AGPL `apps/*` or MPL `packages/basemap`/`packages/tools`.

---

## Backward-Compatibility Policy

Stable CLI flags: no removal without a major version. `--json` output format for `lint` is frozen — third-party CI scripts depend on it. The conversion matrix may expand (new formats added) but existing pairs are not removed.
