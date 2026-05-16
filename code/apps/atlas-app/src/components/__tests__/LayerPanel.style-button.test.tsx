// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 Wave 1b A5 — LayerPanel ↔ StylePanel wiring test.
//
// Verifies the per-row "Open style editor" button mounts StylePanel for the
// clicked layer (and only that layer).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FeatureCollection } from "geojson";

import { LayerPanel } from "../LayerPanel";
import { useLayerRegistryStore } from "../../state/layerRegistry";

const emptyFc = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "A" },
      geometry: { type: "Point", coordinates: [0, 0] },
    },
  ],
});

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
});

afterEach(() => {
  cleanup();
});

describe("LayerPanel — style button", () => {
  it("clicking the style button on a data row mounts StylePanel for that layer", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:row-a",
      fc: emptyFc(),
      label: "Layer A",
      style: { fillColor: "#000" },
    });
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:row-b",
      fc: emptyFc(),
      label: "Layer B",
      style: { fillColor: "#111" },
    });

    render(<LayerPanel />);

    // No StylePanel mounted initially.
    expect(screen.queryByTestId("style-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("layer-style-dl:row-b"));

    const panel = screen.getByTestId("style-panel");
    expect(panel).toBeTruthy();
    // The header should mention Layer B's label.
    expect(panel.textContent).toContain("Layer B");
  });

  it("closing the style panel via the × button unmounts it", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:row-c",
      fc: emptyFc(),
      label: "Layer C",
      style: {},
    });

    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-style-dl:row-c"));
    expect(screen.getByTestId("style-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("style-close"));
    expect(screen.queryByTestId("style-panel")).toBeNull();
  });
});
