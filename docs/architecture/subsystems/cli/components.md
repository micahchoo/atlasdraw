# `packages/cli` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/cli`
**Binary name:** `atlasdraw`
**Phase:** Scaffold Phase 0; implementations Phase 6

---

## Overview

`packages/cli` provides headless tooling for the Atlasdraw file format. It is a Node.js CLI package with three commands: `lint` (validate `.atlasdraw` files), `convert` (format conversion between GeoJSON/KML/Shapefile/.atlasdraw), and `render` (server-side PNG rendering via Puppeteer). No React rendering in the lint/convert path. The render command uses Puppeteer to launch a headless Chromium with the Atlasdraw editor.

---

## Major Files and Responsibilities

### `bin/atlasdraw.ts` (or `bin/atlasdraw.js` compiled)
**Phase:** Phase 6
**Responsibility:** CLI entry point. Parses `process.argv` using a minimal argument parser (likely `commander` or `yargs`). Routes to the appropriate command handler. Prints usage on `--help`. Exits with code 0 on success, 1 on validation error, 2 on internal error.
**Dependencies:** `commands/lint.ts`, `commands/convert.ts`, `commands/render.ts`
**Complexity:** ~60 lines, cyclomatic ~5
[CONFIDENCE: med — per tech spec §4.6; exact arg parser library is engineering choice]

### `commands/lint.ts`
**Phase:** Phase 6
**Responsibility:** Implements `atlasdraw lint <file>`. Reads the `.atlasdraw` file, passes it through `packages/data/atlasdraw.parse()`, and validates the result against the versioned schema. Reports validation errors with file path, line (if applicable), and error message. Exits 0 if valid, 1 if errors found.
**Dependencies:** `packages/data` (`atlasdraw.parse`), `packages/geo` (`GeoAnchor` type for schema validation)
**Complexity:** ~80 lines, cyclomatic ~8
[CONFIDENCE: high — per tech spec §4.6]

### `commands/convert.ts`
**Phase:** Phase 6
**Responsibility:** Implements `atlasdraw convert <in> <out>`. Detects input format from extension, calls the appropriate `packages/data` parser, then calls the appropriate writer for the output format. Supported conversions:
- GeoJSON ↔ KML ↔ Shapefile ↔ .atlasdraw
- GeoTIFF → .atlasdraw (raster layer, no vector export path for raster)
**Dependencies:** `packages/data` (all format modules)
**Complexity:** ~100 lines, cyclomatic ~12 (format routing table)
[CONFIDENCE: high — per tech spec §4.6]

### `commands/render.ts`
**Phase:** Phase 6
**Responsibility:** Implements `atlasdraw render <file> --format png --width 1600`. Launches Puppeteer, loads the Atlasdraw editor in headless Chromium, opens the `.atlasdraw` file via the editor's file-open API, waits for the map tiles to load, then takes a screenshot. Outputs a PNG file. Intended for CI-generated map images in newsroom workflows.
**Dependencies:** `packages/data` (`atlasdraw.parse` for validation pre-Puppeteer); external: `puppeteer`
**Complexity:** ~150 lines, cyclomatic ~10
**Known risk:** Puppeteer requires a bundled Chromium (~170 MB). The CLI is a dev/CI tool — not installed in production. Puppeteer is an optional peer dep; `render` command fails gracefully if not installed.
[CONFIDENCE: med — per tech spec §4.6; Puppeteer optional-peer pattern is extrapolated]

### `index.ts`
**Phase:** Phase 0 (skeleton), Phase 6 (populated)
**Responsibility:** Package entry point for programmatic use (not CLI). Exports `lint`, `convert`, `render` as functions for use in other Node scripts.
**Complexity:** ~15 lines

---

## Cross-Subsystem Notes

- `packages/geo` is imported for projection utilities used in headless rendering (offscreen `projection.ts` path — no live MapLibre instance).
- `packages/data` provides all format I/O used by `lint` and `convert`.
- The `render` command is the only consumer of Puppeteer; all other commands are pure Node with no browser dependency.
- The CLI does not import from `apps/*`, `packages/basemap`, `packages/tools`, or `packages/sdk`.
