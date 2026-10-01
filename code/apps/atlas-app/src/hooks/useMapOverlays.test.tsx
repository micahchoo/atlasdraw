// SPDX-License-Identifier: AGPL-3.0-only
//
// useMapOverlays: the open document's overlays reach the map, come back after
// a basemap swap, and their outcome reaches the panel.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../state/document";
import { FakeMapLibre } from "../lib/__tests__/fixtures/fakeMapLibre";
import { COLLAB_OVERLAY_ID } from "../lib/mapOverlays";

import { useMapOverlays, useOverlayReport } from "./useMapOverlays";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/** A fake map that also fires "styledata", and can load a new basemap. */
class StyledMap extends FakeMapLibre {
  private readonly styleListeners = new Set<() => void>();

  override on(type: string, fn: never): this {
    if (type === "styledata") {
      this.styleListeners.add(fn);
      return this;
    }
    return super.on(type, fn);
  }

  override off(type: string, fn: never): this {
    if (type === "styledata") {
      this.styleListeners.delete(fn);
      return this;
    }
    return super.off(type, fn);
  }

  /** What setStyle does: drop everything, load the basemap, fire styledata. */
  loadBasemap(): void {
    for (const id of this.getLayersOrder()) {
      this.removeLayer(id);
    }
    for (const id of Array.from(this.sources.keys())) {
      this.removeSource(id);
    }
    this.addSource("osm", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.addLayer({ id: "land", type: "fill", source: "osm" });
    this.addLayer({
      id: "places",
      type: "symbol",
      source: "osm",
      layout: { "icon-image": "dot" },
    });
    for (const fn of Array.from(this.styleListeners)) {
      fn();
    }
  }
}

const asMap = (m: FakeMapLibre) => m as unknown as maplibregl.Map;

const POINTS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [77.5, 17.9] },
    },
  ],
};

function addPoints(id: string): void {
  currentDocument().dispatch({
    type: "add-data-layer",
    id,
    fc: POINTS,
    label: id,
    style: { fillColor: "#0aa", opacity: 1 },
  });
}

beforeEach(() => openDocument(createDocument()));
afterEach(() => {
  cleanup();
  openDocument(createDocument());
});

describe("useMapOverlays", () => {
  it("puts the overlays back beneath the labels after a basemap swap", () => {
    const map = new StyledMap();
    map.loadBasemap();
    addPoints("dl:a");
    renderHook(() => useMapOverlays(asMap(map), POINTS));
    expect(map.getLayersOrder()).toEqual([
      "land",
      "dl:a",
      COLLAB_OVERLAY_ID,
      "places",
    ]);

    act(() => map.loadBasemap());

    expect(map.getLayersOrder()).toEqual([
      "land",
      "dl:a",
      COLLAB_OVERLAY_ID,
      "places",
    ]);
    expect(map.errors).toEqual([]);
  });

  it("publishes each overlay's outcome", () => {
    const map = new StyledMap();
    renderHook(() => useMapOverlays(asMap(map)));

    act(() => addPoints("dl:a"));

    expect(useOverlayReport.getState().report.get("dl:a")).toEqual({
      status: "landed",
    });
  });
});
