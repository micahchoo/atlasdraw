// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 0 (T2428): BasemapRegistry.
// Source-of-truth catalog of basemap configurations consumed by atlas-app
// (Phase 4 Task 5/6/7). Style JSON files are vendored separately at
// packages/basemap/src/styles/*.json (Phase 4 Task 5 Steps 1-3); this module
// only references them by relative filename.

export interface BasemapConfig {
  id: "protomaps-light" | "protomaps-dark" | "openfreemap-bright";
  /** Human-facing label (used in basemap picker UI). */
  label: string;
  /** Filename of the vendored style JSON in `./styles/`, NOT a URL. */
  styleFile: string;
  /** True if the style references remote tile endpoints (no pmtiles substitution). */
  requiresRemote: boolean;
}

export const BASEMAPS: ReadonlyArray<BasemapConfig> = [
  {
    id: "protomaps-light",
    label: "Light",
    styleFile: "protomaps-light.json",
    requiresRemote: false,
  },
  {
    id: "protomaps-dark",
    label: "Dark",
    styleFile: "protomaps-dark.json",
    requiresRemote: false,
  },
  {
    id: "openfreemap-bright",
    label: "Bright",
    styleFile: "openfreemap-bright.json",
    requiresRemote: true,
  },
] as const;

export function getBasemap(
  id: BasemapConfig["id"],
): BasemapConfig | undefined {
  return BASEMAPS.find((b) => b.id === id);
}
