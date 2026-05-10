// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 1 (T7): basemap style resolver + remote gate.
//
// Owns:
//   - getPmtilesPath(): reads VITE_PMTILES_PATH (Vite injects via import.meta.env)
//     with a dev fallback.
//   - resolveStyle(id, opts): looks up the BasemapConfig, enforces the remote-tile
//     gate (allow_remote), and delegates token substitution to buildStyle.
//
// Boundary contract (per 2026-05-10 scrub note on plan §5 Task 7 Step 1):
//   - pmtiles-protocol.ts stays argument-less (registers the `pmtiles://` scheme).
//   - style-builder.ts is the substitution engine (consumes opts.pmtilesPath).
//   - This module is the only place that knows where the pmtiles archive LIVES.

import type maplibregl from "maplibre-gl";

import { getBasemap, type BasemapConfig } from "./BasemapRegistry";
import { buildStyle } from "./style-builder";

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
   * Override the resolved pmtiles archive path. Primarily a test-injection
   * seam; production callers should rely on `getPmtilesPath()`.
   */
  pmtilesPath?: string;
}

/**
 * Resolve the pmtiles archive path. Reads `VITE_PMTILES_PATH` at build/runtime
 * (Vite injects via `import.meta.env`); falls back to the dev default served
 * out of `apps/atlas-app/public/data/`.
 *
 * The `typeof import.meta` guard keeps this callable under Node-only test
 * harnesses (vitest jsdom environment exposes import.meta but stays defensive).
 */
export function getPmtilesPath(): string {
  const meta = import.meta as { env?: Record<string, string | undefined> };
  const envPath =
    typeof import.meta !== "undefined" ? meta.env?.VITE_PMTILES_PATH : undefined;
  return envPath || "/data/world-low-zoom.pmtiles";
}

/**
 * Resolve a basemap id to a MapLibre style spec.
 *
 *   - Throws if the basemap id is unknown.
 *   - Throws BasemapRemoteGatedError if the basemap requires remote tiles
 *     and the caller has not opted in.
 *   - Delegates `__PMTILES_PATH__` substitution to buildStyle (style-builder
 *     owns the substitution algorithm; this module just supplies the path).
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
  const pmtilesPath = opts.pmtilesPath ?? getPmtilesPath();
  return buildStyle(config, { pmtilesPath });
}
