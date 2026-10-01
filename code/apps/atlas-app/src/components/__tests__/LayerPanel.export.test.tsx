// SPDX-License-Identifier: AGPL-3.0-only
//
// W9e — the ⋯ menu of a data layer exports it as GeoJSON or CSV. The test
// catches the Blob the browser would save and reads its bytes. A raster or
// tile layer has no vector data, so its menu offers no export.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LayerPanel } from "../LayerPanel";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

import { unbindPanelScene } from "./fixtures/panelScene";

import type { FeatureCollection } from "geojson";

const stations: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
      properties: { name: "Châtelet", lines: 5 },
    },
  ],
};

const rivers: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [2.2, 48.8],
          [2.4, 48.9],
        ],
      },
      properties: { name: "Seine" },
    },
  ],
};

/** jsdom's Blob has no text(); FileReader reads the same bytes. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** What the browser was asked to save. */
let saved: Array<{ fileName: string; blob: Blob }>;

beforeEach(() => {
  openDocument(createDocument());
  saved = [];
  const blobs = new Map<string, Blob>();
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:test/${next++}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ fileName: this.download, blob: blobs.get(this.href)! });
  });
});

afterEach(() => {
  cleanup();
  unbindPanelScene();
  vi.restoreAllMocks();
});

function addDataLayer(id: string, fc: FeatureCollection, label: string) {
  currentDocument().dispatch({
    type: "add-data-layer",
    id,
    fc,
    label,
    style: {},
  });
}

function openMenu(id: string) {
  render(<LayerPanel />);
  fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
}

describe("data layer ⋯ menu — export", () => {
  it("Export as GeoJSON saves the layer's features under the layer's name", async () => {
    addDataLayer("dl:stations", stations, "Metro stations");
    openMenu("dl:stations");
    fireEvent.click(screen.getByText("Export as GeoJSON"));

    expect(saved.map((s) => s.fileName)).toEqual(["Metro stations.geojson"]);
    expect(JSON.parse(await readText(saved[0].blob))).toEqual({
      type: "FeatureCollection",
      name: "Metro stations",
      features: stations.features,
    });
    // The menu closes after the export.
    expect(screen.queryByTestId("layer-menu-list-dl:stations")).toBeNull();
  });

  it("Export as CSV saves longitude, latitude and the properties", async () => {
    addDataLayer("dl:stations", stations, "Metro stations");
    openMenu("dl:stations");
    fireEvent.click(screen.getByText("Export as CSV"));

    expect(saved.map((s) => s.fileName)).toEqual(["Metro stations.csv"]);
    expect(await readText(saved[0].blob)).toBe(
      "longitude,latitude,name,lines\r\n2.3522,48.8566,Châtelet,5\r\n",
    );
  });

  it("a line layer's CSV item says the geometry goes out as WKT", async () => {
    addDataLayer("dl:rivers", rivers, "Rivers");
    openMenu("dl:rivers");
    expect(screen.queryByText("Export as CSV")).toBeNull();
    fireEvent.click(screen.getByText("Export as CSV (geometry as WKT)"));

    expect(await readText(saved[0].blob)).toBe(
      'geometry,name\r\n"LINESTRING (2.2 48.8, 2.4 48.9)",Seine\r\n',
    );
  });

  it("a tile layer's menu offers no export", () => {
    currentDocument().dispatch({
      type: "add-tile-layer",
      id: "tl:osm",
      label: "OSM",
      url: "https://tile.example.org/{z}/{x}/{y}.png",
    });
    openMenu("tl:osm");
    expect(
      screen.getByTestId("layer-menu-list-tl:osm").textContent,
    ).not.toMatch(/Export/);
  });

  it("a raster layer's menu offers no export", () => {
    currentDocument().dispatch({
      type: "add-raster-layer",
      id: "rl:scan",
      label: "Scan",
      corners: [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      imageKey: "scan.png",
      image: new Blob([]),
    });
    openMenu("rl:scan");
    expect(
      screen.getByTestId("layer-menu-list-rl:scan").textContent,
    ).not.toMatch(/Export/);
  });
});
