// SPDX-License-Identifier: MPL-2.0
// Registers the `pmtiles://` scheme on maplibre-gl, idempotently, so style
// JSONs can reference vendored PMTiles files. Atlas-app's useBasemapStyle
// calls it before it resolves a style.

import * as maplibregl from "maplibre-gl";
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
