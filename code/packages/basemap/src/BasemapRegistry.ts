// SPDX-License-Identifier: MPL-2.0
// The catalog of basemap configurations atlas-app offers. Style JSON files
// live in packages/basemap/src/styles/*.json; this module references them
// by filename only.
//
// A register/get/list map, seeded with the built-in entries at module load
// through registerBasemap(). BASEMAPS and getBasemap read the same entries.
// This is a registration API only, not a plugin loader: it does no
// sandboxing and no manifest or integrity check.
//
// The generic registry factory is duplicated, not shared through
// @atlasdraw/common, on purpose: the root tsconfig.json's composite project
// graph excludes @atlasdraw/common from the atlas-owned packages (see that
// file's own comment). packages/tools carries an identical copy for the
// same reason.

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
  /** Any string, so registerBasemap() can accept caller-provided ids. The
   * registry enforces uniqueness at runtime (it throws on a duplicate id);
   * the type system does not. */
  id: string;
  /** Human-facing label (used in basemap picker UI). */
  label: string;
  /** Filename of the vendored style JSON in `./styles/`, NOT a URL. */
  styleFile: string;
  /** True if the style references remote tile endpoints (no pmtiles substitution). */
  requiresRemote: boolean;
  /**
   * Data credit for this basemap, shown in the map marginalia (StatusBar).
   * Matches the actual tiles/data each style loads — the Protomaps styles
   * render Protomaps vector tiles built from OpenStreetMap, so crediting only
   * OSM (or worse, a raster-OSM string) would be wrong. Keep in sync with the
   * source declared in `./styles/<styleFile>`.
   */
  attribution: string;
}

const registry = createRegistry<BasemapConfig>();

/** Register a basemap. Throws if `config.id` is already registered. */
export function registerBasemap(config: BasemapConfig): void {
  registry.register(config.id, config);
}

/** All registered basemaps, in registration order. */
export function listBasemaps(): readonly BasemapConfig[] {
  return registry.list();
}

export const BASEMAPS: ReadonlyArray<BasemapConfig> = [
  {
    id: "protomaps-light",
    label: "Light",
    styleFile: "protomaps-light.json",
    requiresRemote: false,
    attribution: "© Protomaps © OpenStreetMap",
  },
  {
    id: "protomaps-dark",
    label: "Dark",
    styleFile: "protomaps-dark.json",
    requiresRemote: false,
    attribution: "© Protomaps © OpenStreetMap",
  },
  {
    id: "openfreemap-bright",
    label: "Bright",
    styleFile: "openfreemap-bright.json",
    requiresRemote: true,
    attribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
  },
  {
    id: "osm-standard",
    label: "OSM",
    styleFile: "osm-standard.json",
    requiresRemote: true,
    attribution: "© OpenStreetMap contributors",
  },
] as const;

for (const config of BASEMAPS) {
  registerBasemap(config);
}

export function getBasemap(id: BasemapConfig["id"]): BasemapConfig | undefined {
  return registry.get(id);
}
