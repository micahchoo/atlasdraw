// SPDX-License-Identifier: AGPL-3.0-only
//
// featureAt: which feature a click opens. The map is FakeMapLibre with the
// document's overlays applied by the real reconciler, so "visible" and "on
// top" are the style state, not a test's say-so.

import { describe, expect, it } from "vitest";

import { createDocument } from "../state/document";

import { FakeMapLibre } from "./__tests__/fixtures/fakeMapLibre";
import { attributeRows, featureAt, type QueryTarget } from "./featureHit";
import {
  createMapOverlays,
  overlaySpec,
  type StyleTarget,
} from "./mapOverlays";

import type { FeatureCollection } from "geojson";

const point = (lng: number, lat: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    },
  ],
});

const STYLE = { fillColor: "#0aa", strokeColor: "#077", strokeWidth: 1 };

function twoLayers() {
  const d = createDocument();
  d.dispatch({
    type: "add-data-layer",
    id: "dl:low",
    fc: point(1, 1),
    label: "Wells",
    style: STYLE,
  });
  d.dispatch({
    type: "add-data-layer",
    id: "dl:high",
    fc: point(1, 1),
    label: "Schools",
    style: STYLE,
  });
  const map = new FakeMapLibre();
  const overlays = createMapOverlays(map as unknown as StyleTarget);
  const apply = () => overlays.apply(overlaySpec(d.snapshot()));
  apply();
  map.drawUnderPointer("dl:low", [{ properties: { name: "Well 4" } }]);
  map.drawUnderPointer("dl:high", [{ properties: { name: "School 9" } }]);
  const at = () =>
    featureAt(map as unknown as QueryTarget, d.snapshot().overlays, {
      x: 1,
      y: 1,
    });
  return { d, map, apply, at };
}

describe("featureAt", () => {
  it("opens the feature of the topmost data layer", () => {
    const { at } = twoLayers();
    expect(at()).toEqual({
      overlayId: "dl:high",
      label: "Schools",
      properties: { name: "School 9" },
    });
  });

  it("skips a hidden layer and opens the one under it", () => {
    const { d, apply, at } = twoLayers();
    d.dispatch({ type: "set-visibility", id: "dl:high", visible: false });
    apply();
    expect(at()?.overlayId).toBe("dl:low");
  });

  it("follows the document's order after a reorder", () => {
    const { d, apply, at } = twoLayers();
    d.dispatch({ type: "reorder", id: "dl:low", order: 1 });
    apply();
    expect(at()?.properties).toEqual({ name: "Well 4" });
  });

  it("a layer the map did not draw does not hide the others", () => {
    const { map, at } = twoLayers();
    map.removeLayer("dl:high");
    expect(at()?.overlayId).toBe("dl:low");
    expect(map.errors).toEqual([]);
  });

  it("returns null when no data layer draws under the point", () => {
    const { map, at } = twoLayers();
    map.drawUnderPointer("dl:low", []);
    map.drawUnderPointer("dl:high", []);
    expect(at()).toBeNull();
  });
});

describe("attributeRows", () => {
  it("lists every property as text, in the feature's order", () => {
    expect(
      attributeRows({
        name: "Well 4",
        depth: 12.5,
        dry: false,
        notes: null,
        tags: ["a", "b"],
        meta: { by: "Ana" },
      }),
    ).toEqual([
      { key: "name", value: "Well 4" },
      { key: "depth", value: "12.5" },
      { key: "dry", value: "false" },
      { key: "notes", value: "" },
      { key: "tags", value: '["a","b"]' },
      { key: "meta", value: '{"by":"Ana"}' },
    ]);
  });

  it("gives no rows for a feature without properties", () => {
    expect(attributeRows(null)).toEqual([]);
  });
});
