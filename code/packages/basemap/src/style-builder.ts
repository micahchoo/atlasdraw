// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 0 (T2428): style-builder.
// Loads a vendored MapLibre style JSON for a given BasemapConfig and (for
// pmtiles-backed basemaps) substitutes the `__PMTILES_PATH__` token with the
// caller-provided path. Stub for Maputnik integration in Phase 6.
//
// TODO(Phase 4 Task 5 Steps 1-3): vendor the actual style JSON files at
// packages/basemap/src/styles/{protomaps-light,protomaps-dark,openfreemap-bright}.json.
// Until then, buildStyle() falls back to a minimal valid StyleSpecification.

import type maplibregl from "maplibre-gl";

import type { BasemapConfig } from "./BasemapRegistry";

export interface BuildStyleOptions {
  /**
   * Resolved path/URL to the vendored PMTiles archive. Substituted into the
   * style JSON wherever `__PMTILES_PATH__` appears. Ignored when the basemap
   * config has `requiresRemote: true`.
   */
  pmtilesPath?: string;
}

const PMTILES_TOKEN = "__PMTILES_PATH__";

/**
 * Build a MapLibre style spec for the given basemap. Loads the vendored style
 * JSON via dynamic import; if the file does not exist (Wave 0 stub state),
 * returns a minimal valid placeholder so downstream consumers can compile.
 */
export async function buildStyle(
  config: BasemapConfig,
  opts: BuildStyleOptions = {},
): Promise<maplibregl.StyleSpecification> {
  let raw: unknown;
  try {
    // Dynamic import keeps the JSON out of the bundle until requested and
    // tolerates missing files at scaffold time.
    raw = (await import(`./styles/${config.styleFile}`)).default;
  } catch {
    // Phase 4 Task 5 Steps 1-3 will vendor real styles. Until then, return
    // a minimal valid spec so the pipeline can be exercised end-to-end.
    raw = placeholderStyle();
  }

  // Substitute pmtiles token only for self-hosted (non-remote) basemaps.
  if (!config.requiresRemote && opts.pmtilesPath) {
    const serialized = JSON.stringify(raw);
    const replaced = serialized.split(PMTILES_TOKEN).join(opts.pmtilesPath);
    raw = JSON.parse(replaced);
  }

  return raw as maplibregl.StyleSpecification;
}

function placeholderStyle(): maplibregl.StyleSpecification {
  // Valid empty-but-renderable style. The `__PMTILES_PATH__` token is included
  // in the source URL so substitution logic is exercised even in stub mode.
  return {
    version: 8,
    name: "atlasdraw-placeholder",
    sources: {
      "atlasdraw-pmtiles": {
        type: "vector",
        url: `pmtiles://${PMTILES_TOKEN}`,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#ffffff" },
      },
    ],
  } as unknown as maplibregl.StyleSpecification;
}
