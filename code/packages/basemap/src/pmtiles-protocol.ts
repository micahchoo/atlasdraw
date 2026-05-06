// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 0 (T2428): pmtiles protocol registration.
// Idempotently registers the `pmtiles://` scheme on maplibre-gl so vendored
// PMTiles files can be referenced from style JSONs. Atlas-app's resolver
// (Phase 4 T7) calls this once at startup.

import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

let registered = false;

/**
 * Register the `pmtiles://` URL scheme with maplibregl. Idempotent: subsequent
 * calls are no-ops. Safe to call from multiple module entry points.
 */
export function registerPmtilesProtocol(): void {
  if (registered) {
    return;
  }
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  registered = true;
}

/**
 * Test-only: reset the guard so tests can verify registration behavior.
 * Not exported from the package barrel.
 */
export function __resetPmtilesProtocolForTests(): void {
  registered = false;
}
