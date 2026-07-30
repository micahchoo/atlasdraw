// SPDX-License-Identifier: AGPL-3.0-only
// Sheet-panel step 4 — LayerPanel ↔ StylePanel wiring.
//
// Was: "clicking the per-row style button mounts the floating StylePanel."
// There is no style button and no floating panel any more — symbology is a
// section of the expanded card. What still needs pinning is the same
// invariant, restated for the new host: exactly one layer's symbology is on
// screen, and it is the one the user opened.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LayerPanel } from "../LayerPanel";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { useDataLayerFCStore } from "../../state/useDataLayerFCStore";

import type { FeatureCollection } from "geojson";

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
  useDataLayerFCStore.getState().clear();
});

afterEach(() => {
  cleanup();
});

describe("LayerPanel — symbology inside the card", () => {
  it("expanding a card mounts StylePanel for that layer and no other", () => {
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

    // Collapsed: no symbology anywhere.
    expect(screen.queryByTestId("style-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:row-b"));

    expect(screen.getAllByTestId("style-panel")).toHaveLength(1);
    expect(screen.getByTestId("layer-symbology-dl:row-b")).toBeTruthy();
    expect(screen.queryByTestId("layer-symbology-dl:row-a")).toBeNull();
  });

  it("collapsing the card unmounts the symbology section", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:row-c",
      fc: emptyFc(),
      label: "Layer C",
      style: {},
    });

    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:row-c"));
    expect(screen.getByTestId("style-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:row-c"));
    expect(screen.queryByTestId("style-panel")).toBeNull();
  });

  it("StylePanel's own tabs still work from inside the card", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:row-d",
      fc: emptyFc(),
      label: "Layer D",
      style: {},
    });

    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:row-d"));

    fireEvent.click(screen.getByTestId("style-tab-categorical"));
    expect(
      screen.getByTestId("style-tab-categorical").getAttribute("aria-selected"),
    ).toBe("true");
    // The categorical tab introspects the FC — proof the fold-in kept the
    // component's data wiring, not just its markup.
    expect(
      (screen.getByTestId("cat-property") as HTMLSelectElement).value,
    ).toBe("name");
  });
});
