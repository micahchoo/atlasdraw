// SPDX-License-Identifier: AGPL-3.0-only
//
// FakeMapLibre: a stand-in map for tests of code that writes the MapLibre
// style. It is not a call recorder. It keeps the style state MapLibre 6.11
// keeps (sources, layers, paint, layout, order) and follows its error
// contract, read from maplibre-gl 6.11.2 src/style/style.ts:
//   - addLayer / setPaintProperty / setLayoutProperty / moveLayer /
//     removeLayer on an invalid spec or a missing layer FIRE an "error" event
//     and return. They do not throw.
//   - addSource on a duplicate id and removeSource on a missing id THROW.
//   - removeSource while a layer uses the source fires "error" and returns.
// Validation uses the real @maplibre/maplibre-gl-style-spec validator, so a
// spec this fake accepts is one MapLibre accepts. A test asserts on the
// resulting style state, not on the calls.

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

type LayerState = {
  spec: Record<string, unknown>;
  /** The live filter (setFilter changes it), or undefined. */
  filter?: unknown;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
};

type ErrorListener = (e: { error: Error }) => void;

/** What queryRenderedFeatures returns for one feature. */
export type RenderedFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  layer: { id: string };
};

export class FakeMapLibre {
  readonly sources = new Map<string, Record<string, unknown>>();
  readonly layers = new Map<string, LayerState>();
  /** Bottom-first, like Style#_order. */
  readonly order: string[] = [];
  readonly errors: string[] = [];
  /**
   * The style's glyphs URL. A symbol layer with text needs it: MapLibre's
   * validator refuses `text-field` in a style without `glyphs`.
   */
  glyphs: string | null = null;

  getGlyphs(): string | null {
    return this.glyphs;
  }
  private readonly errorListeners = new Set<ErrorListener>();

  on(type: string, fn: ErrorListener): this {
    if (type === "error") {
      this.errorListeners.add(fn);
    }
    return this;
  }

  off(type: string, fn: ErrorListener): this {
    if (type === "error") {
      this.errorListeners.delete(fn);
    }
    return this;
  }

  private fire(message: string): void {
    this.errors.push(message);
    for (const fn of this.errorListeners) {
      fn({ error: new Error(message) });
    }
  }

  private validateLayer(spec: Record<string, unknown>): string[] {
    const style = {
      version: 8,
      ...(this.glyphs ? { glyphs: this.glyphs } : {}),
      sources: Object.fromEntries(this.sources),
      layers: [spec],
    } as unknown as StyleSpecification;
    return validateStyleMin(style).map((e) => e.message);
  }

  addSource(id: string, spec: Record<string, unknown>): void {
    if (this.sources.has(id)) {
      throw new Error(`Source "${id}" already exists.`);
    }
    const errs = validateStyleMin({
      version: 8,
      sources: { [id]: spec },
      layers: [],
    } as unknown as StyleSpecification).map((e) => e.message);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    this.sources.set(id, spec);
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): void {
    if (!this.sources.has(id)) {
      throw new Error("There is no source with this ID");
    }
    for (const [layerId, layer] of this.layers) {
      if (layer.spec.source === id) {
        this.fire(
          `Source "${id}" cannot be removed while layer "${layerId}" is using it.`,
        );
        return;
      }
    }
    this.sources.delete(id);
  }

  addLayer(spec: Record<string, unknown>, before?: string): void {
    const id = spec.id as string;
    if (this.layers.has(id)) {
      this.fire(`Layer "${id}" already exists on this map.`);
      return;
    }
    const errs = this.validateLayer(spec);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    const index = before ? this.order.indexOf(before) : this.order.length;
    if (before && index === -1) {
      this.fire(
        `Cannot add layer "${id}" before non-existing layer "${before}".`,
      );
      return;
    }
    this.order.splice(index, 0, id);
    this.layers.set(id, {
      spec,
      filter: spec.filter,
      paint: { ...((spec.paint as Record<string, unknown>) ?? {}) },
      layout: { ...((spec.layout as Record<string, unknown>) ?? {}) },
    });
  }

  getLayer(id: string): unknown {
    return this.layers.get(id)?.spec;
  }

  removeLayer(id: string): void {
    if (!this.layers.has(id)) {
      this.fire(`Cannot remove non-existing layer "${id}".`);
      return;
    }
    this.layers.delete(id);
    this.order.splice(this.order.indexOf(id), 1);
  }

  moveLayer(id: string, before?: string): void {
    if (!this.layers.has(id)) {
      this.fire(
        `The layer '${id}' does not exist in the map's style and cannot be moved.`,
      );
      return;
    }
    if (id === before) {
      return;
    }
    this.order.splice(this.order.indexOf(id), 1);
    const index = before ? this.order.indexOf(before) : this.order.length;
    if (before && index === -1) {
      this.fire(
        `Cannot move layer "${id}" before non-existing layer "${before}".`,
      );
      return;
    }
    this.order.splice(index, 0, id);
  }

  getLayersOrder(): string[] {
    return [...this.order];
  }

  private setProperty(
    bucket: "paint" | "layout",
    layerId: string,
    name: string,
    value: unknown,
  ): void {
    const layer = this.layers.get(layerId);
    if (!layer) {
      this.fire(`Cannot style non-existing layer "${layerId}".`);
      return;
    }
    const candidate = {
      ...layer.spec,
      paint: layer.paint,
      layout: layer.layout,
      [bucket]: { ...layer[bucket], [name]: value },
    };
    const errs = this.validateLayer(candidate);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    layer[bucket][name] = value;
  }

  setFilter(layerId: string, filter: unknown): void {
    const layer = this.layers.get(layerId);
    if (!layer) {
      this.fire(`Cannot filter non-existing layer "${layerId}".`);
      return;
    }
    const candidate: Record<string, unknown> = {
      ...layer.spec,
      paint: layer.paint,
      layout: layer.layout,
    };
    if (filter === null || filter === undefined) {
      delete candidate.filter;
    } else {
      candidate.filter = filter;
    }
    const errs = this.validateLayer(candidate);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    layer.filter = filter ?? undefined;
  }

  getFilter(layerId: string): unknown {
    return this.layers.get(layerId)?.filter;
  }

  setPaintProperty(layerId: string, name: string, value: unknown): void {
    this.setProperty("paint", layerId, name, value);
  }

  setLayoutProperty(layerId: string, name: string, value: unknown): void {
    this.setProperty("layout", layerId, name, value);
  }

  getLayoutProperty(layerId: string, name: string): unknown {
    return this.layers.get(layerId)?.layout[name];
  }

  // -------------------------------------------------------------------------
  // Queries. The fake has no geometry and no renderer, so a test says what a
  // layer draws under the pointer (`drawUnderPointer`). The answer follows
  // the style state like MapLibre's: a layer that is not in the style, or
  // whose visibility is "none", draws nothing. A query that names a layer
  // missing from the style fires "error" and returns [] (Style#
  // queryRenderedFeatures, 6.11.2).
  // -------------------------------------------------------------------------

  private readonly underPointer = new Map<
    string,
    Array<{ properties: Record<string, unknown> }>
  >();

  /** Say which features `layerId` draws at every point. */
  drawUnderPointer(
    layerId: string,
    features: Array<{ properties: Record<string, unknown> }>,
  ): void {
    this.underPointer.set(layerId, features);
  }

  queryRenderedFeatures(
    _point: unknown,
    options: { layers?: string[] } = {},
  ): RenderedFeature[] {
    const ids = options.layers ?? [...this.order].reverse();
    for (const id of ids) {
      if (!this.layers.has(id)) {
        this.fire(
          `The layer '${id}' does not exist in the map's style and cannot be queried for features.`,
        );
        return [];
      }
    }
    const out: RenderedFeature[] = [];
    for (const id of ids) {
      if (this.layers.get(id)?.layout.visibility === "none") {
        continue;
      }
      for (const f of this.underPointer.get(id) ?? []) {
        out.push({ type: "Feature", properties: f.properties, layer: { id } });
      }
    }
    return out;
  }

  /** A flat projection: one pixel per degree, y down. */
  project(lngLat: [number, number] | { lng: number; lat: number }): {
    x: number;
    y: number;
  } {
    const [lng, lat] = Array.isArray(lngLat)
      ? lngLat
      : [lngLat.lng, lngLat.lat];
    return { x: lng, y: -lat };
  }

  /** True when a layer AND its source are in the style. */
  draws(id: string): boolean {
    return this.layers.has(id) && this.sources.has(id);
  }

  /** Same-named overlay ids, top of the stack first. */
  topFirst(ids: readonly string[]): string[] {
    const wanted = new Set(ids);
    return this.order.filter((id) => wanted.has(id)).reverse();
  }
}
