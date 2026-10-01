// SPDX-License-Identifier: AGPL-3.0-only
// The embed's legend: the layers in view, as the PDF's legend lists them
// (lib/legend.ts), kept up to date as the reader moves the map.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { currentDocument } from "../state/document";

import { EmbedLegend, type LegendMap } from "./EmbedLegend";

afterEach(cleanup);

/** A map that paints the data layers in `painted`, and fires `idle` on demand. */
function fakeMap(painted: Set<string>) {
  const idle = new Set<() => void>();
  const map = {
    getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
    getBearing: () => 0,
    project: () => ({ x: -1000, y: -1000 }),
    queryRenderedFeatures: (q: { layers: string[] }) =>
      painted.has(q.layers[0]) ? [{}] : [],
    on: (_: "idle", fn: () => void) => idle.add(fn),
    off: (_: "idle", fn: () => void) => idle.delete(fn),
    settle: () => idle.forEach((fn) => fn()),
  };
  return map;
}

const api = {
  getSceneElements: () => [],
  getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
} as unknown as ExcalidrawImperativeAPI;

function addLayer(id: string, label: string, color: string) {
  currentDocument().dispatch({
    type: "add-data-layer",
    id,
    fc: { type: "FeatureCollection", features: [] },
    label,
    style: { fillColor: color },
  });
}

describe("EmbedLegend", () => {
  it("lists the data layers painted in view, with their colours", () => {
    addLayer("dl:wells", "Wells", "#1971c2");
    addLayer("dl:roads", "Roads", "#e03131");
    const painted = new Set(["dl:wells"]);
    const map = fakeMap(painted);
    render(<EmbedLegend map={map as unknown as LegendMap} api={api} />);

    const legend = screen.getByTestId("embed-legend");
    expect(legend.textContent).toContain("Legend");
    expect(screen.getByText("Wells")).toBeTruthy();
    expect(screen.queryByText("Roads")).toBeNull();

    // The reader pans; the next idle reads the view again.
    painted.add("dl:roads");
    act(() => map.settle());
    expect(screen.getByText("Roads")).toBeTruthy();
  });

  it("shows nothing when no layer is in view", () => {
    const map = fakeMap(new Set());
    render(<EmbedLegend map={map as unknown as LegendMap} api={api} />);
    expect(screen.queryByTestId("embed-legend")).toBeNull();
  });
});
