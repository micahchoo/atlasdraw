// SPDX-License-Identifier: AGPL-3.0-only
//
// Map overlays: the one writer of the overlay part of the MapLibre style.
//
//   overlaySpec(state, options)  the sources and layers the document asks
//                                for, bottom first, each layer checked with
//                                the MapLibre style validator. Pure.
//   createMapOverlays(map)       a reconciler for one map. `apply(spec)`
//                                changes the map until it holds the spec and
//                                reports, per overlay, "landed" or
//                                "rejected" with MapLibre's reason.
//
// The reconciler compares the spec with what it last put on the map, by
// layer id, and does the smallest change: setPaintProperty and
// setLayoutProperty for a changed property, setData for a changed
// FeatureCollection, remove and add only for what is new or changed in kind,
// and one moveLayer pass when the order is wrong. It is level-triggered: a
// layer that the map lost (a new basemap style drops every custom layer) is
// added again on the next apply.
//
// MapLibre 4.7 does not throw for an invalid layer or paint value. It fires
// an "error" event and returns. So the reconciler listens to "error" while it
// writes, and reads `getLayer` after each add, to know what landed.
//
// Overlays draw beneath the basemap's first symbol layer, so place names stay
// readable over a filled area. The one exception is a data layer's labels
// (a symbol layer): they go on top of everything, above the basemap's own
// labels, because MapLibre gives the upper label the place when two collide,
// and a label the user asked for must not lose to a street name. Tile layers
// (XYZ map tiles) are the bottom
// band, rasters (georeferenced pictures) are above them, and data layers
// above those.

import { compileLayers } from "@atlasdraw/basemap";

import { rasterUrl } from "../state/rasterUrls";

import { styleProblem, validateLayers } from "./layerStyle";
import { validateTileTemplate } from "./tileLayers";

import type {
  DocumentState,
  OverlayEntry,
  RasterCorners,
} from "../state/document";

import type {
  LayerSpecification,
  SourceSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

/** One source the overlays need. `version` changes when the payload does. */
export type OverlaySource =
  | {
      id: string;
      type: "geojson";
      data: FeatureCollection;
      version: number;
    }
  | {
      id: string;
      type: "image";
      url: string;
      coordinates: RasterCorners;
      version: string;
    }
  | {
      id: string;
      type: "raster";
      /** One XYZ template. */
      tiles: [string];
      tileSize: number;
      attribution?: string;
      version: string;
    };

/** One MapLibre layer, and the overlay (document layer) it draws. */
export interface OverlayLayer {
  overlayId: string;
  spec: LayerSpecification;
}

export interface OverlaySpec {
  sources: readonly OverlaySource[];
  /** Bottom first. */
  layers: readonly OverlayLayer[];
  /** Overlays that cannot be drawn, with the reason. They have no layers. */
  rejected: ReadonlyArray<{ overlayId: string; reason: string }>;
}

export interface OverlaySpecOptions {
  /** An object URL for a raster's image. */
  imageUrl?: (id: string, image: Blob) => string;
  /**
   * A font the basemap's glyphs serve (labelFontOf). Without one the
   * basemap has no glyphs, and data layers draw without their labels.
   */
  labelFont?: string[] | null;
}

const payloadVersions = new WeakMap<object, number>();
let nextPayloadVersion = 1;

/**
 * A number for a payload object. The document replaces a FeatureCollection,
 * it never edits one, so a new object is a new version.
 */
function versionOf(payload: object): number {
  let version = payloadVersions.get(payload);
  if (version === undefined) {
    version = nextPayloadVersion++;
    payloadVersions.set(payload, version);
  }
  return version;
}

/** The part of a map labelFontOf reads. */
export interface FontSource {
  getGlyphs(): string | null;
  getLayersOrder(): string[];
  getLayer(id: string): unknown;
  getLayoutProperty(id: string, name: string): unknown;
}

/**
 * A font for data-layer labels: one the basemap's own labels use, so its
 * glyph server has it. A "Regular" face is preferred over italic or bold.
 * Null when the basemap has no glyphs (no text can be drawn) or no label
 * layer to learn a font from.
 */
export function labelFontOf(map: FontSource): string[] | null {
  if (!map.getGlyphs()) {
    return null;
  }
  const fonts: string[][] = [];
  for (const id of map.getLayersOrder()) {
    if (
      (map.getLayer(id) as { type?: string } | undefined)?.type !== "symbol"
    ) {
      continue;
    }
    const font = map.getLayoutProperty(id, "text-font");
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((f) => typeof f === "string")
    ) {
      fonts.push(font as string[]);
    }
  }
  return fonts.find((f) => /regular/i.test(f[0])) ?? fonts[0] ?? null;
}

/** Add the visibility to a compiled layer, so it can be diffed like paint. */
function withVisibility(
  layer: LayerSpecification,
  visible: boolean,
): LayerSpecification {
  return {
    ...layer,
    layout: {
      ...("layout" in layer ? layer.layout : {}),
      visibility: visible ? "visible" : "none",
    },
  } as LayerSpecification;
}

/** XYZ tiles are 256 px squares: the OSM convention most servers follow. */
const TILE_SIZE = 256;

/**
 * The overlays the document asks for. Tile layers first, then rasters, then
 * data layers, each band in the document's order (0 at the bottom). An
 * overlay whose layers MapLibre would reject, or whose payload is missing, is
 * in `rejected` and has no layers.
 */
export function overlaySpec(
  state: Pick<DocumentState, "overlays" | "featureCollections" | "images">,
  options: OverlaySpecOptions = {},
): OverlaySpec {
  const imageUrl = options.imageUrl ?? rasterUrl;
  const sources: OverlaySource[] = [];
  const layers: OverlayLayer[] = [];
  const rejected: Array<{ overlayId: string; reason: string }> = [];

  const add = (
    overlayId: string,
    source: OverlaySource,
    specs: LayerSpecification[],
  ): void => {
    const errors = validateLayers(specs, source.type);
    if (errors.length > 0) {
      rejected.push({ overlayId, reason: errors[0] });
      return;
    }
    sources.push(source);
    for (const spec of specs) {
      layers.push({ overlayId, spec });
    }
  };

  const band = (kind: OverlayEntry["kind"]) =>
    state.overlays
      .filter((e) => e.kind === kind)
      .slice()
      .sort((a, b) => a.order - b.order);

  for (const entry of band("tile")) {
    if (entry.kind !== "tile") {
      continue;
    }
    const check = validateTileTemplate(entry.url);
    if (!check.ok) {
      rejected.push({ overlayId: entry.id, reason: check.reason });
      continue;
    }
    add(
      entry.id,
      {
        id: entry.id,
        type: "raster",
        tiles: [check.url],
        tileSize: TILE_SIZE,
        ...(entry.attribution ? { attribution: entry.attribution } : {}),
        version: `${check.url} ${entry.attribution ?? ""}`,
      },
      [
        withVisibility(
          {
            id: entry.id,
            type: "raster",
            source: entry.id,
            paint: { "raster-opacity": entry.opacity },
          },
          entry.visible,
        ),
      ],
    );
  }

  for (const entry of band("raster")) {
    if (entry.kind !== "raster") {
      continue;
    }
    const image = state.images[entry.id];
    if (!image) {
      rejected.push({ overlayId: entry.id, reason: "The image is missing." });
      continue;
    }
    const url = imageUrl(entry.id, image);
    add(
      entry.id,
      {
        id: entry.id,
        type: "image",
        url,
        coordinates: entry.corners,
        version: `${url} ${JSON.stringify(entry.corners)}`,
      },
      [
        withVisibility(
          {
            id: entry.id,
            type: "raster",
            source: entry.id,
            paint: { "raster-opacity": entry.opacity },
          },
          entry.visible,
        ),
      ],
    );
  }

  for (const entry of band("data")) {
    if (entry.kind !== "data") {
      continue;
    }
    const fc = state.featureCollections[entry.id];
    if (!fc) {
      rejected.push({
        overlayId: entry.id,
        reason: "The GeoJSON is missing.",
      });
      continue;
    }
    const problem = styleProblem(entry.style);
    if (problem) {
      rejected.push({ overlayId: entry.id, reason: problem });
      continue;
    }
    // A style stored before every path checked it can still throw while it
    // compiles. It stops its own overlay, never the others.
    let specs: LayerSpecification[];
    try {
      specs = compileLayers(entry.id, entry.style, entry.geometryKind, {
        labelFont: options.labelFont ?? undefined,
      }).map((l) => withVisibility(l, entry.visible));
    } catch (err) {
      rejected.push({
        overlayId: entry.id,
        reason: `The style cannot be drawn: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }
    add(
      entry.id,
      { id: entry.id, type: "geojson", data: fc, version: versionOf(fc) },
      specs,
    );
  }

  return { sources, layers, rejected };
}

// ---------------------------------------------------------------------------
// The reconciler
// ---------------------------------------------------------------------------

type ErrorListener = (event: { error?: { message?: string } }) => void;

/**
 * The part of a MapLibre map the reconciler writes. A maplibregl.Map is one;
 * a test passes a fake that keeps the same style state and fires the same
 * "error" events.
 */
export interface StyleTarget {
  addSource(id: string, spec: SourceSpecification): void;
  getSource(id: string): unknown;
  removeSource(id: string): void;
  addLayer(spec: LayerSpecification, beforeId?: string): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  moveLayer(id: string, beforeId?: string): void;
  getLayersOrder(): string[];
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setFilter(layerId: string, filter: unknown): void;
  on(type: "error", listener: ErrorListener): unknown;
  off(type: "error", listener: ErrorListener): unknown;
}

export type LayerOutcome =
  | { status: "landed" }
  | { status: "rejected"; reason: string };

/** Overlay id → what happened to it. */
export type ApplyReport = ReadonlyMap<string, LayerOutcome>;

export interface MapOverlays {
  apply(spec: OverlaySpec): ApplyReport;
}

function sourceSpecOf(source: OverlaySource): SourceSpecification {
  switch (source.type) {
    case "geojson":
      return { type: "geojson", data: source.data };
    case "image":
      return {
        type: "image",
        url: source.url,
        coordinates: source.coordinates,
      };
    case "raster":
      return {
        type: "raster",
        tiles: source.tiles,
        tileSize: source.tileSize,
        ...(source.attribution ? { attribution: source.attribution } : {}),
      };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function propertiesOf(
  layer: LayerSpecification,
  bucket: "paint" | "layout",
): Record<string, unknown> {
  return ((layer as Record<string, unknown>)[bucket] ?? {}) as Record<
    string,
    unknown
  >;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** A reconciler for one map. See the module header. */
export function createMapOverlays(map: StyleTarget): MapOverlays {
  /** What this reconciler put on the map and the map still holds. */
  const sources = new Map<string, OverlaySource>();
  const layers = new Map<string, OverlayLayer>();
  let applying = false;
  let lastReport: ApplyReport = new Map();

  return {
    apply(spec) {
      // A write can make MapLibre fire an event that asks for another apply.
      if (applying) {
        return lastReport;
      }
      applying = true;
      const report = new Map<string, LayerOutcome>();
      const reject = (overlayId: string, reason: string): void => {
        if (report.get(overlayId)?.status !== "rejected") {
          report.set(overlayId, { status: "rejected", reason });
        }
      };
      for (const r of spec.rejected) {
        reject(r.overlayId, r.reason);
      }

      const errors: string[] = [];
      const onError: ErrorListener = (event) => {
        errors.push(messageOf(event?.error ?? event));
      };
      /** Run one map write; return MapLibre's objection, or null. */
      const write = (fn: () => void): string | null => {
        errors.length = 0;
        try {
          fn();
        } catch (err) {
          return messageOf(err);
        }
        return errors.length > 0 ? errors[0] : null;
      };

      map.on("error", onError);
      try {
        // Forget what the map lost: a new basemap style drops every overlay.
        for (const id of Array.from(layers.keys())) {
          if (!map.getLayer(id)) {
            layers.delete(id);
          }
        }
        for (const id of Array.from(sources.keys())) {
          if (!map.getSource(id)) {
            sources.delete(id);
          }
        }

        const wantedSources = new Map(spec.sources.map((s) => [s.id, s]));
        const wantedLayers = new Map(spec.layers.map((l) => [l.spec.id, l]));

        // How each wanted source changes.
        const replaced = new Set<string>();
        const refreshed = new Set<string>();
        for (const [id, wanted] of wantedSources) {
          const held = sources.get(id);
          if (!held || held.version === wanted.version) {
            continue;
          }
          const live = map.getSource(id) as {
            setData?: (data: FeatureCollection) => void;
          };
          if (
            held.type === "geojson" &&
            wanted.type === "geojson" &&
            typeof live?.setData === "function"
          ) {
            refreshed.add(id);
          } else {
            replaced.add(id);
          }
        }

        // 1. Remove the layers that go, change kind, or lose their source.
        for (const [id, held] of Array.from(layers)) {
          const wanted = wantedLayers.get(id);
          const source = (held.spec as { source?: string }).source ?? "";
          if (
            !wanted ||
            wanted.spec.type !== held.spec.type ||
            (wanted.spec as { source?: string }).source !== source ||
            replaced.has(source) ||
            !wantedSources.has(source)
          ) {
            write(() => map.removeLayer(id));
            layers.delete(id);
          }
        }

        // 2. Sources: remove, refresh, add.
        for (const id of Array.from(sources.keys())) {
          if (!wantedSources.has(id) || replaced.has(id)) {
            write(() => map.removeSource(id));
            sources.delete(id);
          }
        }
        for (const [id, wanted] of wantedSources) {
          if (refreshed.has(id)) {
            const live = map.getSource(id) as {
              setData: (data: FeatureCollection) => void;
            };
            const failure = write(() =>
              live.setData((wanted as { data: FeatureCollection }).data),
            );
            if (failure) {
              for (const l of spec.layers) {
                if ((l.spec as { source?: string }).source === id) {
                  reject(l.overlayId, failure);
                }
              }
            } else {
              sources.set(id, wanted);
            }
            continue;
          }
          if (sources.has(id)) {
            continue;
          }
          // A source this reconciler did not add: take it over.
          if (map.getSource(id)) {
            for (const l of spec.layers) {
              if (
                (l.spec as { source?: string }).source === id &&
                map.getLayer(l.spec.id)
              ) {
                write(() => map.removeLayer(l.spec.id));
              }
            }
            write(() => map.removeSource(id));
          }
          const failure = write(() => map.addSource(id, sourceSpecOf(wanted)));
          if (failure || !map.getSource(id)) {
            for (const l of spec.layers) {
              if ((l.spec as { source?: string }).source === id) {
                reject(
                  l.overlayId,
                  failure ?? "MapLibre did not add the source.",
                );
              }
            }
            continue;
          }
          sources.set(id, wanted);
        }

        // 3. Layers, bottom first: add the new ones, restyle the others.
        const anchor = labelAnchor(map, wantedLayers);
        for (const wanted of spec.layers) {
          const id = wanted.spec.id;
          if (report.get(wanted.overlayId)?.status === "rejected") {
            continue;
          }
          const held = layers.get(id);
          if (!held) {
            if (map.getLayer(id)) {
              write(() => map.removeLayer(id));
            }
            const failure = write(() =>
              map.addLayer(wanted.spec, onTop(wanted) ? undefined : anchor),
            );
            if (failure || !map.getLayer(id)) {
              reject(
                wanted.overlayId,
                failure ?? "MapLibre did not add the layer.",
              );
              continue;
            }
            layers.set(id, wanted);
            continue;
          }
          let failure: string | null = null;
          const filterBefore = (held.spec as { filter?: unknown }).filter;
          const filterAfter = (wanted.spec as { filter?: unknown }).filter;
          if (!sameValue(filterBefore, filterAfter)) {
            failure =
              write(() => map.setFilter(id, filterAfter ?? null)) ?? failure;
          }
          for (const bucket of ["paint", "layout"] as const) {
            const before = propertiesOf(held.spec, bucket);
            const after = propertiesOf(wanted.spec, bucket);
            const names = new Set([
              ...Object.keys(before),
              ...Object.keys(after),
            ]);
            for (const name of names) {
              if (sameValue(before[name], after[name])) {
                continue;
              }
              failure =
                write(() =>
                  bucket === "paint"
                    ? map.setPaintProperty(id, name, after[name])
                    : map.setLayoutProperty(id, name, after[name]),
                ) ?? failure;
            }
          }
          if (failure) {
            // The map keeps the old value; the next apply tries again.
            reject(wanted.overlayId, failure);
          } else {
            layers.set(id, wanted);
          }
        }

        // 4. Order: the spec's layers, bottom first, under the anchor; the
        // labels, bottom first, on top of everything.
        const placed = spec.layers.filter((l) => layers.has(l.spec.id));
        const labels = placed.filter(onTop).map((l) => l.spec.id);
        restack(
          map,
          placed.filter((l) => !onTop(l)).map((l) => l.spec.id),
          // A basemap without labels: the overlays still go under ours.
          anchor ?? labels[0],
          write,
        );
        restackOnTop(map, labels, write);

        for (const l of spec.layers) {
          if (!report.has(l.overlayId)) {
            report.set(l.overlayId, { status: "landed" });
          }
        }
      } finally {
        map.off("error", onError);
        applying = false;
      }
      lastReport = report;
      return report;
    },
  };
}

/** A data layer's labels go on top of the basemap's (see the header). */
function onTop(layer: OverlayLayer): boolean {
  return layer.spec.type === "symbol";
}

/**
 * The basemap's first symbol layer: overlays go beneath it. Undefined when
 * the basemap has no labels; overlays then go on top.
 */
function labelAnchor(
  map: StyleTarget,
  ours: ReadonlyMap<string, unknown>,
): string | undefined {
  for (const id of map.getLayersOrder()) {
    if (ours.has(id)) {
      continue;
    }
    const layer = map.getLayer(id) as { type?: string } | undefined;
    if (layer?.type === "symbol") {
      return id;
    }
  }
  return undefined;
}

/**
 * Put `wanted` (bottom first) at the very top of the style, in order.
 * Issues no moveLayer when they already are.
 */
function restackOnTop(
  map: StyleTarget,
  wanted: readonly string[],
  write: (fn: () => void) => string | null,
): void {
  if (wanted.length === 0) {
    return;
  }
  if (sameSequence(map.getLayersOrder().slice(-wanted.length), wanted)) {
    return;
  }
  for (const id of wanted) {
    write(() => map.moveLayer(id));
  }
}

/**
 * Put `wanted` (bottom first) in order, directly or indirectly under
 * `anchor`. Issues no moveLayer when the order is already right.
 */
function restack(
  map: StyleTarget,
  wanted: readonly string[],
  anchor: string | undefined,
  write: (fn: () => void) => string | null,
): void {
  if (wanted.length === 0) {
    return;
  }
  const expected = anchor ? [...wanted, anchor] : [...wanted];
  const members = new Set(expected);
  const current = map.getLayersOrder().filter((id) => members.has(id));
  if (sameSequence(current, expected)) {
    return;
  }
  // moveLayer(id, before) puts `id` directly under `before`. Top down, each
  // layer goes under the one already fixed above it.
  const top = wanted[wanted.length - 1];
  write(() => map.moveLayer(top, anchor));
  for (let i = wanted.length - 2; i >= 0; i--) {
    write(() => map.moveLayer(wanted[i], wanted[i + 1]));
  }
}
