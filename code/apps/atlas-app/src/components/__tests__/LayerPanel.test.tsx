// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 2b T12 — LayerPanel tests.
//
// LayerPanel now renders body-only — no Sidebar wrapper. The parent
// surface (DefaultSidebar via excalidrawAPI.registerSidebarTab) provides
// the dockable shell; LayerPanel just renders sections. So we no longer
// need to mock @atlasdraw/excalidraw — the component imports nothing
// from there.
//
// Store seeding follows the same pattern as state/__tests__/layerRegistry.test.ts —
// `setState({ entries: [] })` in beforeEach, then call action methods.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { LayerPanel } from "../LayerPanel";
import { useLayerRegistryStore } from "../../state/layerRegistry";

import type { FeatureCollection } from "geojson";

const emptyFc = (count: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, () => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [0, 0] },
  })),
});

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
});

// vitest config sets `globals: false`, so RTL's automatic cleanup hook
// doesn't fire. Without explicit cleanup, render() leaks DOM across tests
// and getByLabelText collides with stale rows.
afterEach(() => {
  cleanup();
});

/** Seed two annotation layers so we can test reorder interactions. */
function seedTwo() {
  useLayerRegistryStore.getState().registerAnnotation("el-1", "First");
  useLayerRegistryStore.getState().registerAnnotation("el-2", "Second");
}

describe("LayerPanel", () => {
  it("renders both Data Layers and Annotations sections", () => {
    render(<LayerPanel />);
    expect(screen.getByLabelText("Data Layers")).toBeTruthy();
    expect(screen.getByLabelText("Annotations")).toBeTruthy();
  });

  it("renders a DataLayerRow with the 'Data layer' badge", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:test-1",
      fc: emptyFc(3),
      label: "Roads",
      style: { fillColor: "#ff0000", strokeColor: "#000000", opacity: 1 },
    });

    render(<LayerPanel />);

    expect(screen.getByLabelText("Data layer")).toBeTruthy();
    expect(screen.getByText("Roads")).toBeTruthy();
  });

  it("renders an AnnotationLayerRow with the 'Annotation' badge", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "MyShape");

    render(<LayerPanel />);

    expect(screen.getByLabelText("Annotation")).toBeTruthy();
    expect(screen.getByText("MyShape")).toBeTruthy();
  });

  it("clicking the eye toggle on a data row flips visible in the store", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:test-2",
      fc: emptyFc(1),
      label: "Buildings",
      style: { opacity: 1 },
    });

    render(<LayerPanel />);

    // Pre: visible=true → button label is "Hide layer"
    const hideBtn = screen.getByLabelText("Hide layer");
    fireEvent.click(hideBtn);

    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "dl:test-2");
    expect(entry?.visible).toBe(false);
  });

  it("changing the fill color input calls updateStyle and the patch lands in entry.style", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:test-3",
      fc: emptyFc(0),
      label: "Parks",
      style: { fillColor: "#000000", opacity: 1 },
    });

    render(<LayerPanel />);

    const fillInput = screen.getByLabelText("fill") as HTMLInputElement;
    fireEvent.change(fillInput, { target: { value: "#ff8800" } });

    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "dl:test-3");
    expect(entry?.kind).toBe("data");
    if (entry?.kind === "data") {
      expect(entry.style.fillColor).toBe("#ff8800");
    }
  });

  describe("drag-and-drop reorder", () => {
    it("renders a drag handle per annotation row with accessible label", () => {
      seedTwo();
      render(<LayerPanel />);

      const handle = screen.getByTestId("layer-drag-el-1");
      expect(handle).toBeTruthy();
      expect(handle.getAttribute("aria-label")).toContain("Drag to reorder");
    });

    it("renders up/down chevron buttons with disabled state at bounds", () => {
      seedTwo();
      render(<LayerPanel />);

      // First entry: up should be disabled, down enabled.
      const upBtn = screen.getByTestId("layer-up-el-1") as HTMLButtonElement;
      expect(upBtn.disabled).toBe(true);
      const downBtn = screen.getByTestId(
        "layer-down-el-1",
      ) as HTMLButtonElement;
      expect(downBtn.disabled).toBe(false);

      // Last entry: up enabled, down disabled.
      const lastDownBtn = screen.getByTestId(
        "layer-down-el-2",
      ) as HTMLButtonElement;
      expect(lastDownBtn.disabled).toBe(true);
    });

    it("clicking the down button on the first entry reorders via splice", () => {
      seedTwo();
      render(<LayerPanel />);

      const downBtn = screen.getByTestId("layer-down-el-1");
      fireEvent.click(downBtn);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("el-2");
      expect(entries[0].order).toBe(0);
      expect(entries[1].id).toBe("el-1");
      expect(entries[1].order).toBe(1);
    });

    it("sets draggable attribute on row containers", () => {
      seedTwo();
      render(<LayerPanel />);

      const row = screen.getByTestId("layer-row-el-1");
      expect(row.getAttribute("draggable")).toBe("true");
    });
  });
});
