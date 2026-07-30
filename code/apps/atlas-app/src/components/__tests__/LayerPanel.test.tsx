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

  // -------------------------------------------------------------------------
  // P3 — reorder with BOTH layer kinds present.
  // -------------------------------------------------------------------------
  describe("reorder with mixed layer kinds", () => {
    /** 2 data layers + 3 annotations, registered data-first. */
    function seedMixed() {
      const store = useLayerRegistryStore.getState();
      store.registerDataLayer({
        id: "dl:d1",
        fc: emptyFc(1),
        label: "D1",
        style: {},
      });
      store.registerDataLayer({
        id: "dl:d2",
        fc: emptyFc(1),
        label: "D2",
        style: {},
      });
      store.registerAnnotation("a1", "A1");
      store.registerAnnotation("a2", "A2");
      store.registerAnnotation("a3", "A3");
    }

    const ids = () => useLayerRegistryStore.getState().entries.map((e) => e.id);
    const annotationIds = () =>
      useLayerRegistryStore
        .getState()
        .entries.filter((e) => e.kind === "annotation")
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((e) => e.id);

    /**
     * jsdom implements no DragEvent, so RTL falls back to a bare Event and
     * drops `clientY` — which the above/below midpoint test needs. Dispatch a
     * MouseEvent under the drag event's name instead (React dispatches on the
     * name) and hang a dataTransfer stub off it by hand.
     */
    function fireDragEvent(
      el: HTMLElement,
      type: string,
      dataTransfer: Record<string, unknown>,
      clientY = 0,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY,
      });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      fireEvent(el, event);
    }

    /** HTML5 drag/drop of `draggedId` onto `targetId`, above or below its midpoint. */
    function dragOnto(
      draggedId: string,
      targetId: string,
      where: "above" | "below",
    ) {
      const row = screen.getByTestId(`layer-row-${targetId}`);
      // jsdom reports a zero-size rect; give the row a real box so the
      // midpoint comparison means something.
      row.getBoundingClientRect = () =>
        ({ top: 0, height: 20, bottom: 20 } as DOMRect);
      fireDragEvent(screen.getByTestId(`layer-row-${draggedId}`), "dragstart", {
        setData: () => {},
        setDragImage: () => {},
      });
      fireDragEvent(row, "dragover", {}, where === "above" ? 2 : 18);
      fireDragEvent(row, "drop", { getData: () => draggedId });
    }

    const dataIds = () =>
      useLayerRegistryStore
        .getState()
        .entries.filter((e) => e.kind === "data")
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((e) => e.id);

    it("clamps arrow buttons to each section's own bounds", () => {
      seedMixed();
      render(<LayerPanel />);

      // Top of the annotation section — even though it is not entry 0 of the
      // registry, it cannot move above the section.
      expect(
        (screen.getByTestId("layer-up-a1") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId("layer-down-a1") as HTMLButtonElement).disabled,
      ).toBe(false);
      // Bottom of the annotation section.
      expect(
        (screen.getByTestId("layer-down-a3") as HTMLButtonElement).disabled,
      ).toBe(true);
      // Data section has its own first/last.
      expect(
        (screen.getByTestId("layer-up-dl:d1") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId("layer-down-dl:d2") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("arrow 'down' moves an annotation past its neighbour and nothing else", () => {
      seedMixed();
      render(<LayerPanel />);

      fireEvent.click(screen.getByTestId("layer-down-a1"));

      expect(annotationIds()).toEqual(["a2", "a1", "a3"]);
      expect(dataIds()).toEqual(["dl:d1", "dl:d2"]);
    });

    it("dragging the first annotation below the last one moves it to the bottom", () => {
      seedMixed();
      render(<LayerPanel />);

      dragOnto("a1", "a3", "below");

      expect(annotationIds()).toEqual(["a2", "a3", "a1"]);
      expect(dataIds()).toEqual(["dl:d1", "dl:d2"]);
    });

    it("dragging the last annotation above the middle one lands it between", () => {
      seedMixed();
      render(<LayerPanel />);

      dragOnto("a3", "a2", "above");

      expect(annotationIds()).toEqual(["a1", "a3", "a2"]);
    });

    it("dragging a data layer never touches the annotation stack", () => {
      seedMixed();
      render(<LayerPanel />);

      dragOnto("dl:d1", "dl:d2", "below");

      expect(dataIds()).toEqual(["dl:d2", "dl:d1"]);
      expect(annotationIds()).toEqual(["a1", "a2", "a3"]);
    });

    it("a drop from the other section is ignored", () => {
      seedMixed();
      render(<LayerPanel />);

      // dl:d1 is not in the annotation section's id list.
      dragOnto("dl:d1", "a2", "above");

      expect(dataIds()).toEqual(["dl:d1", "dl:d2"]);
      expect(annotationIds()).toEqual(["a1", "a2", "a3"]);
    });

    it("arrow 'down' and the equivalent drag agree", () => {
      seedMixed();
      render(<LayerPanel />);
      dragOnto("a2", "a3", "below");
      const viaDrag = annotationIds();

      cleanup();
      useLayerRegistryStore.setState({ entries: [] });
      seedMixed();
      render(<LayerPanel />);
      fireEvent.click(screen.getByTestId("layer-down-a2"));

      expect(viaDrag).toEqual(annotationIds());
      expect(viaDrag).toEqual(["a1", "a3", "a2"]);
    });

    it("works on a data-only registry", () => {
      const store = useLayerRegistryStore.getState();
      store.registerDataLayer({
        id: "dl:only-1",
        fc: emptyFc(1),
        label: "One",
        style: {},
      });
      store.registerDataLayer({
        id: "dl:only-2",
        fc: emptyFc(1),
        label: "Two",
        style: {},
      });
      render(<LayerPanel />);

      dragOnto("dl:only-2", "dl:only-1", "above");
      expect(dataIds()).toEqual(["dl:only-2", "dl:only-1"]);
      expect(ids()).toEqual(["dl:only-2", "dl:only-1"]);
    });

    it("works on an annotation-only registry", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("s1", "S1");
      store.registerAnnotation("s2", "S2");
      store.registerAnnotation("s3", "S3");
      render(<LayerPanel />);

      dragOnto("s1", "s3", "below");
      expect(annotationIds()).toEqual(["s2", "s3", "s1"]);

      fireEvent.click(screen.getByTestId("layer-up-s1"));
      expect(annotationIds()).toEqual(["s2", "s1", "s3"]);
    });

    it("a single-row section has both arrows disabled", () => {
      useLayerRegistryStore.getState().registerAnnotation("solo", "Solo");
      render(<LayerPanel />);

      expect(
        (screen.getByTestId("layer-up-solo") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId("layer-down-solo") as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });
});
