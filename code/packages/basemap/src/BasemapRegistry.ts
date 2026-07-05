// SPDX-License-Identifier: MPL-2.0
// @atlasdraw/basemap — Phase 4 Wave 0 (T2428): BasemapRegistry.
// Source-of-truth catalog of basemap configurations consumed by atlas-app
// (Phase 4 Task 5/6/7). Style JSON files are vendored separately at
// packages/basemap/src/styles/*.json (Phase 4 Task 5 Steps 1-3); this module
// only references them by relative filename.
//
// ISSUES.md Direction 4 (headroom audit, verdict: pursue): this used to be
// a frozen 4-entry array with a read-only getBasemap(id) lookup and no way
// to add a 5th basemap without editing this file — "registry" in name only.
// Now backed by a minimal register/get/list map, seeded with the same 4
// entries at module load via registerBasemap(). Zero breaking changes:
// BASEMAPS/getBasemap keep their exact prior shape and behavior for
// existing consumers; registerBasemap()/listBasemaps() are new. This is the
// registration API shape only — NOT the Phase 7 (v1.5) plugin loader (Web
// Worker sandbox, PluginManifest/SPDX validation, PluginRegistry's SHA-256
// integrity all remain future work sitting on top of this primitive).
//
// The generic registry factory is duplicated (not shared via
// @atlasdraw/common) deliberately: the root tsconfig.json's composite
// project graph explicitly excludes @atlasdraw/common from the atlas-owned
// package graph basemap belongs to ("Vendored Excalidraw packages...
// prevent composite... path-resolved via tsconfig.base.json paths" — see
// that file's own comment). Crossing that boundary for ~15 lines of
// trivial Map wrapping isn't worth it; packages/tools carries its own
// identical copy for the same reason.

interface Registry<T> {
  register(id: string, item: T): void;
  get(id: string): T | undefined;
  list(): readonly T[];
}

function createRegistry<T>(): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(id, item) {
      if (items.has(id)) {
        throw new Error(`Registry: "${id}" is already registered`);
      }
      items.set(id, item);
    },
    get: (id) => items.get(id),
    list: () => Array.from(items.values()),
  };
}

export interface BasemapConfig {
  /** Widened from a closed 4-value union to `string` so registerBasemap()
   * can accept caller-provided ids — uniqueness is enforced at runtime by
   * the registry (throws on a duplicate id), not by the type system. */
  id: string;
  /** Human-facing label (used in basemap picker UI). */
  label: string;
  /** Filename of the vendored style JSON in `./styles/`, NOT a URL. */
  styleFile: string;
  /** True if the style references remote tile endpoints (no pmtiles substitution). */
  requiresRemote: boolean;
}

const registry = createRegistry<BasemapConfig>();

/** Register a basemap. Throws if `config.id` is already registered. */
export function registerBasemap(config: BasemapConfig): void {
  registry.register(config.id, config);
}

/** All registered basemaps, in registration order. Replaces the
 * `getBasemap("__all__")` sentinel-string hack some callers used before
 * this function existed. */
export function listBasemaps(): readonly BasemapConfig[] {
  return registry.list();
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
  {
    id: "osm-standard",
    label: "OSM",
    styleFile: "osm-standard.json",
    requiresRemote: true,
  },
] as const;

for (const config of BASEMAPS) {
  registerBasemap(config);
}

export function getBasemap(id: BasemapConfig["id"]): BasemapConfig | undefined {
  return registry.get(id);
}
