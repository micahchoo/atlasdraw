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

    // Pre: visible=true → button label is "Hide <label>". The label carries the
    // layer name now: at 25 layers, 25 buttons all called "Hide layer" is not
    // an accessible name, it's a coin flip.
    const hideBtn = screen.getByLabelText("Hide Buildings");
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

    // Symbology lives in the card body now, so it has to be opened first.
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:test-3"));

    const fillInput = screen.getByLabelText("Fill") as HTMLInputElement;
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

    // FU-4. The grip is the only drag source. `draggable` on the row made every
    // control inside an expanded card a drag source too, because the browser
    // looks UP the tree for a draggable ancestor: reaching for the colour input
    // reordered the layer instead. Assert both halves — the grip has it, the
    // row does not — or a future revert only fails one of them.
    it("puts draggable on the grip and not on the row", () => {
      seedTwo();
      render(<LayerPanel />);

      expect(
        screen.getByTestId("layer-drag-el-1").getAttribute("draggable"),
      ).toBe("true");
      expect(
        screen.getByTestId("layer-row-el-1").hasAttribute("draggable"),
      ).toBe(false);
    });

    // The drop target stays the row: you aim a drop at a row, not at its grip.
    it("still reorders when a drop lands on the row body", () => {
      seedTwo();
      render(<LayerPanel />);

      const target = screen.getByTestId("layer-row-el-2");
      const data = new Map<string, string>();
      const dataTransfer = {
        effectAllowed: "",
        dropEffect: "",
        setData: (k: string, v: string) => data.set(k, v),
        getData: (k: string) => data.get(k) ?? "",
        setDragImage: () => {},
      };

      fireEvent.dragStart(screen.getByTestId("layer-drag-el-1"), {
        dataTransfer,
      });
      fireEvent.dragOver(target, { dataTransfer, clientY: 1000 });
      fireEvent.drop(target, { dataTransfer });

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("el-2");
      expect(entries[1].id).toBe("el-1");
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

// ---------------------------------------------------------------------------
// Step 5 — the demoted comments list
//
// CommentsPanel used to be its own sidebar tab. Comments are a mode now, and
// the "read every thread" pass (Marcus's JTBD) survives one level down, as a
// section of the Sheet scope alongside Basemap / Data Layers / Annotations.
// These cases pin that it is REACHABLE and that it is not the default — an
// always-open chronological list is exactly the 90%-empty column the tab was.
// ---------------------------------------------------------------------------

describe("LayerPanel — Threads section (Step 5)", () => {
  it("offers Threads in the Sheet scope, alongside the other sections", () => {
    render(<LayerPanel />);
    expect(screen.getByLabelText("Threads")).toBeTruthy();
    expect(screen.getByLabelText("Data Layers")).toBeTruthy();
    expect(screen.getByLabelText("Annotations")).toBeTruthy();
    expect(screen.getByLabelText("Basemap")).toBeTruthy();
  });

  it("is collapsed by default and discloses the list on demand", () => {
    render(<LayerPanel />);
    const disclosure = screen.getByTestId("threads-disclosure");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("comments-panel")).toBe(null);

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    // the SAME CommentsPanel body, "show resolved" and all — demoted, not
    // rewritten
    expect(screen.getByTestId("comments-panel")).toBeTruthy();
    expect(screen.getByTestId("comments-filter-show-resolved")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Renaming a layer by clicking its name
// ---------------------------------------------------------------------------
//
// Data layers already had two doors into the rename editor (the ⋯ menu and the
// expanded card's button) — those are covered in LayerPanel.card.test.tsx. What
// is new here is that the name itself is the third door, and that annotations
// have any door at all.

describe("LayerPanel — rename by clicking the name", () => {
  it("opens an editor on an annotation's name and commits on Enter", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "Rectangle");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-name-el-1"));
    const input = screen.getByTestId("layer-rename-input-el-1");
    fireEvent.change(input, { target: { value: "Ward 3" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === "el-1"),
    ).toMatchObject({ label: "Ward 3", renamedByUser: true });
    expect(screen.getByText("Ward 3")).toBeTruthy();
  });

  it("commits an annotation rename on blur", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "Rectangle");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-name-el-1"));
    const input = screen.getByTestId("layer-rename-input-el-1");
    fireEvent.change(input, { target: { value: "Ward 3" } });
    fireEvent.blur(input);

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === "el-1")
        ?.label,
    ).toBe("Ward 3");
  });

  it("Escape abandons an annotation rename and leaves no flag behind", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "Rectangle");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-name-el-1"));
    const input = screen.getByTestId("layer-rename-input-el-1");
    fireEvent.change(input, { target: { value: "oops" } });
    fireEvent.keyDown(input, { key: "Escape" });

    const entry = useLayerRegistryStore
      .getState()
      .entries.find((e) => e.id === "el-1");
    expect(entry?.label).toBe("Rectangle");
    // An abandoned rename must not retire automatic naming for the shape.
    expect(entry).not.toHaveProperty("renamedByUser", true);
    expect(screen.getByTestId("layer-name-el-1")).toBeTruthy();
  });

  it("treats a cleared box as a cancel, not as a blank name", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "Rectangle");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-name-el-1"));
    const input = screen.getByTestId("layer-rename-input-el-1");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === "el-1")
        ?.label,
    ).toBe("Rectangle");
  });

  it("opens the same editor from a data layer's name", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:test-1",
      fc: emptyFc(1),
      label: "parcels.geojson",
      style: { fillColor: "#ff0000", opacity: 1 },
    });
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-name-dl:test-1"));
    const input = screen.getByTestId("layer-rename-input-dl:test-1");
    fireEvent.change(input, { target: { value: "Parcels" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === "dl:test-1")
        ?.label,
    ).toBe("Parcels");
  });

  it("leaves the open rename box with no draggable ancestor", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "Rectangle");
    render(<LayerPanel />);

    // A draggable ancestor turns a press-and-sweep over the input's text into a
    // row drag, so the name you meant to replace can't be selected. This used
    // to be handled by dropping `draggable` off the row while renaming; since
    // FU-4 moved `draggable` onto the grip there is no ancestor to drop, and
    // the suspension mechanism is gone. Walk the real chain rather than
    // asserting the absence of a prop that no longer exists.
    fireEvent.click(screen.getByTestId("layer-name-el-1"));
    let node: HTMLElement | null = screen.getByTestId(
      "layer-rename-input-el-1",
    ) as HTMLElement;
    while (node) {
      expect(node.getAttribute("draggable")).not.toBe("true");
      node = node.parentElement;
    }
  });
});

// ---------------------------------------------------------------------------
// FU-1 — the Images section.
// ---------------------------------------------------------------------------

describe("LayerPanel — raster layers", () => {
  const CORNERS = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ] as never;

  function seedRaster(id = "rl:plate-1", label = "survey-sheet.tif") {
    useLayerRegistryStore.getState().registerRasterLayer({
      id,
      label,
      corners: CORNERS,
      imageKey: `${id}.png`,
    });
    return id;
  }

  it("hides the section entirely when there is no imagery", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1");
    render(<LayerPanel />);

    // Most documents have no raster. An empty section in a 294px column is a
    // row of nothing, and the panel already carries three headings.
    expect(screen.queryByRole("region", { name: "Images" })).toBeNull();
  });

  it("lists a raster with a visibility toggle and a name", () => {
    const id = seedRaster();
    render(<LayerPanel />);

    expect(screen.getByRole("region", { name: "Images" })).toBeTruthy();
    expect(screen.getByTestId(`layer-name-${id}`).textContent).toBe(
      "survey-sheet.tif",
    );
    const eye = screen.getByTestId(`layer-visibility-${id}`);
    expect(eye.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(eye);
    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === id)
        ?.visible,
    ).toBe(false);
  });

  it("removes a raster from the registry", () => {
    const id = seedRaster();
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId(`layer-remove-${id}`));

    expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
  });

  it("renders the Images section below Data Layers, matching the map", () => {
    // The panel's top-to-bottom order has to agree with the map's stacking or
    // it becomes something you have to think about: rasters draw under the
    // vector band, so they are listed under it.
    seedRaster();
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:parcels",
      fc: { type: "FeatureCollection", features: [] },
      label: "parcels",
      style: {},
    });
    render(<LayerPanel />);

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings.indexOf("Images")).toBeGreaterThan(
      headings.indexOf("Data Layers"),
    );
  });

  it("gives each raster its own reorder bounds, not the annotations'", () => {
    // reindexByKind numbers per kind, so the first raster is "first" even with
    // annotations above it. If the two shared a counter this up button would
    // be enabled and moving it would address the wrong stack.
    useLayerRegistryStore.getState().registerAnnotation("el-1");
    const id = seedRaster();
    render(<LayerPanel />);

    expect(
      (screen.getByTestId(`layer-up-${id}`) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
