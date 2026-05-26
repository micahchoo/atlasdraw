// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 1 (T7): basemap style resolver + remote gate.
//
// Boundary contract (per 2026-05-10 scrub note on plan §5 Task 7 Step 1):
//   - pmtiles-protocol.ts stays argument-less (registers the `pmtiles://` scheme).
//   - style-builder.ts is the substitution engine (consumes opts.pmtilesPath).
//   - This module enforces the remote-tile gate and delegates substitution.
//
// Boundary contract (per 2026-05-10 smoke-test fix atlasdraw-bff1):
//   - This package does NOT read environment variables. Vite's textual
//     `import.meta.env.X` replacement only fires on the literal pattern, and
//     cross-package source files can't rely on its semantics. The caller
//     (atlas-app) reads VITE_PMTILES_PATH and passes the resolved path in.

import { getBasemap, type BasemapConfig } from "./BasemapRegistry";
import { buildStyle } from "./style-builder";

import type maplibregl from "maplibre-gl";

/**
 * Thrown by resolveStyle when a basemap config has `requiresRemote: true` and
 * the caller did not pass `allowRemote: true`. Atlas-app's Q3 default is
 * `allow_remote = false`; callers should warn-and-bail when they see this.
 */
export class BasemapRemoteGatedError extends Error {
  constructor(public readonly basemapId: string) {
    super(`Basemap '${basemapId}' requires allow_remote=true`);
    this.name = "BasemapRemoteGatedError";
  }
}

export interface ResolveStyleOptions {
  /**
   * Whether the caller's app config permits fetching tiles from third-party
   * hosts (e.g. tiles.openfreemap.org). When false, resolving a basemap whose
   * config has `requiresRemote: true` throws BasemapRemoteGatedError.
   */
  allowRemote: boolean;
  /**
   * Path/URL to the local PMTiles archive. Substituted into self-hosted
   * style JSONs wherever the `__PMTILES_PATH__` token appears. Ignored
   * when the basemap is `requiresRemote: true`.
   *
   * The caller is responsible for reading this from its environment
   * (e.g. `import.meta.env.VITE_PMTILES_PATH` in a Vite-built app).
   */
  pmtilesPath: string;
}

/**
 * Resolve a basemap id to a MapLibre style spec.
 *
 *   - Throws if the basemap id is unknown.
 *   - Throws BasemapRemoteGatedError if the basemap requires remote tiles
 *     and the caller has not opted in.
 *   - Delegates `__PMTILES_PATH__` substitution to buildStyle.
 */
export async function resolveStyle(
  id: BasemapConfig["id"],
  opts: ResolveStyleOptions,
): Promise<maplibregl.StyleSpecification> {
  const config = getBasemap(id);
  if (!config) {
    throw new Error(`Unknown basemap id: ${id}`);
  }
  if (config.requiresRemote && !opts.allowRemote) {
    throw new BasemapRemoteGatedError(id);
  }
  return buildStyle(config, { pmtilesPath: opts.pmtilesPath });
}
