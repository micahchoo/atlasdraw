// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 Wave 1b A5 — StylePanel tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FeatureCollection } from "geojson";

import { StylePanel } from "../StylePanel";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { useDataLayerFCStore } from "../../state/useDataLayerFCStore";

// Sample FC with both string and numeric properties for property-introspection.
const sampleFc: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { kind: "park", population: 100 },
      geometry: { type: "Point", coordinates: [0, 0] },
    },
    {
      type: "Feature",
      properties: { kind: "water", population: 500 },
      geometry: { type: "Point", coordinates: [1, 1] },
    },
    {
      type: "Feature",
      properties: { kind: "built", population: 900 },
      geometry: { type: "Point", coordinates: [2, 2] },
    },
  ],
};

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
  useDataLayerFCStore.getState().clear();
  useLayerRegistryStore.getState().registerDataLayer({
    id: "dl:t1",
    fc: sampleFc,
    label: "Test layer",
    style: { fillColor: "#0aa", opacity: 1 },
  });
});

afterEach(() => {
  cleanup();
});

describe("StylePanel", () => {
  it("opens on the single-color tab by default and switches between tabs", () => {
    render(<StylePanel layerId="dl:t1" onClose={() => {}} />);

    const singleTab = screen.getByTestId("style-tab-single");
    const catTab = screen.getByTestId("style-tab-categorical");
    const gradTab = screen.getByTestId("style-tab-graduated");

    expect(singleTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(catTab);
    expect(catTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(gradTab);
    expect(gradTab.getAttribute("aria-selected")).toBe("true");
  });

  it("single-color tab Apply writes fillColor and clears expression", () => {
    render(<StylePanel layerId="dl:t1" onClose={() => {}} />);

    const colorInput = screen.getByTestId(
      "style-single-color",
    ) as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#ff8800" } });
    fireEvent.click(screen.getByTestId("style-single-apply"));

    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "dl:t1");
    expect(entry?.kind).toBe("data");
    if (entry?.kind === "data") {
      expect(entry.style.fillColor).toBe("#ff8800");
      expect(entry.style.expression).toBeUndefined();
    }
  });

  it("categorical tab: adding a stop and applying writes an expression of kind 'categorical'", () => {
    render(<StylePanel layerId="dl:t1" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("style-tab-categorical"));

    // The tab seeds itself with one stop. Fill it.
    const stopValue = screen.getByTestId("cat-stop-value-0") as HTMLInputElement;
    fireEvent.change(stopValue, { target: { value: "park" } });

    // Add a second stop.
    fireEvent.click(screen.getByTestId("cat-add-stop"));
    const stopValue1 = screen.getByTestId("cat-stop-value-1") as HTMLInputElement;
    fireEvent.change(stopValue1, { target: { value: "water" } });

    fireEvent.click(screen.getByTestId("cat-apply"));

    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "dl:t1");
    if (entry?.kind === "data") {
      expect(entry.style.expression?.kind).toBe("categorical");
      if (entry.style.expression?.kind === "categorical") {
        expect(entry.style.expression.property).toBe("kind");
        expect(entry.style.expression.stops).toHaveLength(2);
        expect(entry.style.expression.stops[0].value).toBe("park");
      }
    }
  });

  it("graduated tab: compute-stops with linear method produces evenly-spaced stops", () => {
    render(<StylePanel layerId="dl:t1" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("style-tab-graduated"));

    // Property defaults to "population" (the only numeric one).
    const methodSelect = screen.getByTestId("grad-method") as HTMLSelectElement;
    fireEvent.change(methodSelect, { target: { value: "linear" } });

    const stopCount = screen.getByTestId("grad-stop-count") as HTMLInputElement;
    fireEvent.change(stopCount, { target: { value: "5" } });

    fireEvent.click(screen.getByTestId("grad-compute"));

    // After compute, the preview row should be visible with 5 swatches.
    const preview = screen.getByTestId("grad-preview");
    expect(preview.children.length).toBe(5);

    // Apply and verify the stops are evenly spaced from min..max.
    fireEvent.click(screen.getByTestId("grad-apply"));
    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "dl:t1");
    if (entry?.kind === "data" && entry.style.expression?.kind === "graduated") {
      const stops = entry.style.expression.stops.map((s) => s.stop);
      expect(stops).toHaveLength(5);
      expect(stops[0]).toBe(100);
      expect(stops[4]).toBe(900);
      // Linear spacing: (900-100)/4 = 200 step.
      expect(stops[1]).toBe(300);
      expect(stops[2]).toBe(500);
      expect(stops[3]).toBe(700);
      expect(entry.style.expression.method).toBe("linear");
    } else {
      throw new Error("expected graduated expression");
    }
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<StylePanel layerId="dl:t1" onClose={onClose} />);

    fireEvent.click(screen.getByTestId("style-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<StylePanel layerId="dl:t1" onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
