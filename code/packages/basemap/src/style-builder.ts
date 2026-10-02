/// <reference types="vite/client" />
// SPDX-License-Identifier: MPL-2.0
// Loads a vendored MapLibre style JSON for a given BasemapConfig and (for
// pmtiles-backed basemaps) substitutes two tokens with caller-provided paths:
// `__PMTILES_PATH__` (the tile archive) and `__BASEMAP_ASSETS__` (the folder
// that holds the bundled `fonts/` and `sprites/`). A config whose styleFile
// is not in ./styles/ gets a minimal valid placeholder style.

import type maplibregl from "maplibre-gl";

import type { BasemapConfig } from "./BasemapRegistry";

export interface BuildStyleOptions {
  /**
   * Resolved path/URL to the vendored PMTiles archive. Substituted into the
   * style JSON wherever `__PMTILES_PATH__` appears. Ignored when the basemap
   * config has `requiresRemote: true`.
   */
  pmtilesPath?: string;
  /**
   * Path/URL of the folder that holds the bundled label glyphs (`fonts/`) and
   * sprites (`sprites/`). Substituted wherever `__BASEMAP_ASSETS__` appears.
   * Ignored when the basemap config has `requiresRemote: true`.
   */
  assetsPath?: string;
}

const PMTILES_TOKEN = "__PMTILES_PATH__";
const ASSETS_TOKEN = "__BASEMAP_ASSETS__";

/**
 * Build a MapLibre style spec for the given basemap. Loads the vendored style
 * JSON via dynamic import; if the file does not exist, returns a minimal valid
 * placeholder so downstream consumers can compile.
 */
// A static glob, so Vite emits every JSON in ./styles/ as a real chunk. Do not
// use a template-literal `import(`./styles/${file}`)`: Vite cannot analyse it,
// emits no style JSON, and the production build then 404s on every style
// fetch with no error at build time. `eager: false` (the default) keeps one
// lazy chunk per basemap.
const STYLE_MODULES = import.meta.glob<{ default: unknown }>("./styles/*.json");

export async function buildStyle(
  config: BasemapConfig,
  opts: BuildStyleOptions = {},
): Promise<maplibregl.StyleSpecification> {
  let raw: unknown;
  const loader = STYLE_MODULES[`./styles/${config.styleFile}`];
  if (loader) {
    raw = (await loader()).default;
  } else {
    // No vendored style for this config: a minimal valid spec keeps the
    // pipeline working.
    raw = placeholderStyle();
  }

  // Substitute the tokens only for self-hosted (non-remote) basemaps.
  if (!config.requiresRemote) {
    let serialized = JSON.stringify(raw);
    if (opts.pmtilesPath) {
      serialized = serialized.split(PMTILES_TOKEN).join(opts.pmtilesPath);
    }
    if (opts.assetsPath !== undefined) {
      const folder = opts.assetsPath.replace(/\/+$/, "");
      serialized = serialized.split(ASSETS_TOKEN).join(folder);
    }
    raw = JSON.parse(serialized);
  }

  return raw as maplibregl.StyleSpecification;
}

function placeholderStyle(): maplibregl.StyleSpecification {
  // Valid empty-but-renderable style. The `__PMTILES_PATH__` token is included
  // in the source URL so the placeholder exercises substitution too.
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
