// SPDX-License-Identifier: AGPL-3.0-only
// Sheet-panel step 4 + 6 — the data-layer card.
//
// Covers what the card added over the old row: expand-in-place with real
// disclosure semantics, provenance, attribute preview, the three actions that
// had store support but no UI (zoom / rename / delete), the accordion, and the
// >= 10 filter threshold.
//
// Design: PLANS/ATLASDRAW_SIDEBAR_DESIGN.md §2, §4

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { LayerPanel } from "../LayerPanel";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { useDataLayerFCStore } from "../../state/useDataLayerFCStore";
import { useMapInstanceStore } from "../../state/mapInstance";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/** Three parcels with properties, so the attribute preview has something real. */
const parcelsFc: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { parcel_id: "P-001", owner: "Smith, J.", area: 12450 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.4, 47.6],
            [-122.3, 47.6],
            [-122.3, 47.7],
            [-122.4, 47.6],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { parcel_id: "P-002", owner: "Chen, L.", area: 8920 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.2, 47.5],
            [-122.1, 47.5],
            [-122.1, 47.55],
            [-122.2, 47.5],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { parcel_id: "P-003", owner: "O'Brien, M.", area: 15300 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.6, 47.8],
            [-122.5, 47.8],
            [-122.5, 47.9],
            [-122.6, 47.8],
          ],
        ],
      },
    },
  ],
};

function seedParcels(id = "dl:parcels") {
  useLayerRegistryStore.getState().registerDataLayer({
    id,
    fc: parcelsFc,
    label: "parcels.geojson",
    style: { fillColor: "#0aa", opacity: 1 },
    provenance: { sourceFile: "parcels.geojson", droppedCount: 2 },
  });
  return id;
}

/** N minimal point layers, for the accordion and filter cases. */
function seedMany(n: number, prefix = "layer") {
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [1, 2] },
      },
    ],
  };
  for (let i = 0; i < n; i++) {
    useLayerRegistryStore.getState().registerDataLayer({
      id: `dl:${prefix}-${i}`,
      fc,
      label: `${prefix} ${i}`,
      style: {},
    });
  }
}

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
  useDataLayerFCStore.getState().clear();
  useMapInstanceStore.setState({ map: null });
});

afterEach(() => {
  cleanup();
});

describe("data layer card — disclosure", () => {
  it("starts collapsed with aria-expanded=false and no body", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    const caret = screen.getByTestId(`layer-disclosure-${id}`);
    expect(caret.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId(`layer-detail-${id}`)).toBeNull();
  });

  it("aria-controls names the element the disclosure actually reveals", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    const caret = screen.getByTestId(`layer-disclosure-${id}`);
    fireEvent.click(caret);

    expect(caret.getAttribute("aria-expanded")).toBe("true");
    const controlled = caret.getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    // The id must resolve — a dangling aria-controls is worse than none,
    // because a screen reader announces a relationship that goes nowhere.
    expect(document.getElementById(controlled!)).toBe(
      screen.getByTestId(`layer-detail-${id}`),
    );
  });

  it("toggling the eye does not expand the card", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId(`layer-visibility-${id}`));

    expect(screen.queryByTestId(`layer-detail-${id}`)).toBeNull();
    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === id)
        ?.visible,
    ).toBe(false);
  });
});

describe("data layer card — provenance", () => {
  it("shows geometry type, source filename and dropped count when expanded", () => {
    const id = seedParcels();
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-disclosure-${id}`));

    const prov = screen.getByTestId(`layer-provenance-${id}`);
    expect(prov.textContent).toContain("Polygon");
    expect(prov.textContent).toContain("parcels.geojson");
    expect(prov.textContent).toContain("Dropped");
    expect(prov.textContent).toContain("2");
  });

  it("says 'none' rather than '0' for a clean import", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:clean",
      fc: parcelsFc,
      label: "clean.geojson",
      style: {},
      provenance: { sourceFile: "clean.geojson", droppedCount: 0 },
    });
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:clean"));

    expect(
      screen.getByTestId("layer-provenance-dl:clean").textContent,
    ).toContain("none");
  });

  it("says 'unknown' rather than guessing for a layer with no import record", () => {
    // Converted annotations and collab-received layers arrive without one.
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:converted",
      fc: parcelsFc,
      label: "Converted shape",
      style: {},
    });
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:converted"));

    const prov = screen.getByTestId("layer-provenance-dl:converted");
    expect(prov.textContent).toContain("unknown");
    // Geometry still comes from the FC, which is always present.
    expect(prov.textContent).toContain("Polygon");
  });

  it("reports the geometry of the first feature that has one", () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:nullfirst",
      // `@types/geojson`'s bare `FeatureCollection` narrows geometry to
      // non-null, but RFC 7946 allows null and `parse()` lets it through — so
      // this shape does reach the panel at runtime. Cast at the fixture rather
      // than widening the store's type for a case only the reader handles.
      fc: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: null },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      } as unknown as FeatureCollection,
      label: "mixed",
      style: {},
    });
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:nullfirst"));

    expect(
      screen.getByTestId("layer-provenance-dl:nullfirst").textContent,
    ).toContain("LineString");
  });
});

describe("data layer card — attribute preview", () => {
  it("renders a header row per property and 'Showing N of M'", () => {
    const id = seedParcels();
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-disclosure-${id}`));

    const table = screen.getByTestId(`layer-attrs-${id}`);
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["parcel_id", "owner", "area"]);
    expect(within(table).getByText("P-001")).toBeTruthy();
    expect(table.textContent).toContain("Showing 3 of 3");
  });

  it("says so instead of rendering an empty table when features carry no properties", () => {
    seedMany(1, "bare");
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:bare-0"));

    const attrs = screen.getByTestId("layer-attrs-dl:bare-0");
    expect(attrs.textContent).toContain("no properties");
    expect(within(attrs).queryByRole("table")).toBeNull();
  });
});

describe("data layer card — the three missing actions", () => {
  it("zoom to layer fits the map to the layer's own bbox", () => {
    const id = seedParcels();
    const fitBounds = vi.fn();
    useMapInstanceStore.setState({
      map: { fitBounds } as unknown as maplibregl.Map,
    });

    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    fireEvent.click(screen.getByTestId(`layer-zoom-${id}`));

    expect(fitBounds).toHaveBeenCalledTimes(1);
    const [bounds] = fitBounds.mock.calls[0];
    // Union of the three polygons, not the first one's extent.
    expect(bounds).toEqual([
      [-122.6, 47.5],
      [-122.1, 47.9],
    ]);
  });

  it("zoom to layer is a no-op — not a crash — with no map yet", () => {
    const id = seedParcels();
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    expect(() =>
      fireEvent.click(screen.getByTestId(`layer-zoom-${id}`)),
    ).not.toThrow();
  });

  it("rename writes the new label to the store and the PDF-legend name follows", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    fireEvent.click(screen.getByTestId(`layer-rename-${id}`));

    const input = screen.getByTestId(`layer-rename-input-${id}`);
    fireEvent.change(input, { target: { value: "King County Parcels" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === id)?.label,
    ).toBe("King County Parcels");
    expect(screen.getByText("King County Parcels")).toBeTruthy();
  });

  it("rename keeps the original source filename in provenance", () => {
    const id = seedParcels();
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-disclosure-${id}`));
    fireEvent.click(screen.getByTestId(`layer-rename-inline-${id}`));

    const input = screen.getByTestId(`layer-rename-input-${id}`);
    fireEvent.change(input, { target: { value: "Parcels" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // This is the whole point of storing sourceFile separately from label.
    expect(screen.getByTestId(`layer-provenance-${id}`).textContent).toContain(
      "parcels.geojson",
    );
  });

  it("Escape abandons a rename", () => {
    const id = seedParcels();
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    fireEvent.click(screen.getByTestId(`layer-rename-${id}`));

    const input = screen.getByTestId(`layer-rename-input-${id}`);
    fireEvent.change(input, { target: { value: "oops" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      useLayerRegistryStore.getState().entries.find((e) => e.id === id)?.label,
    ).toBe("parcels.geojson");
  });

  it("delete takes two clicks and removes the layer plus its FeatureCollection", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    fireEvent.click(screen.getByTestId(`layer-delete-${id}`));

    // Still there after the first click — the confirm step is the point.
    expect(useLayerRegistryStore.getState().entries).toHaveLength(1);

    fireEvent.click(screen.getByTestId(`layer-delete-confirm-${id}`));

    expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    expect(useDataLayerFCStore.getState().fcs[id]).toBeUndefined();
  });

  it("cancelling the delete confirm leaves the layer alone", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId(`layer-menu-${id}`));
    fireEvent.click(screen.getByTestId(`layer-delete-${id}`));
    fireEvent.click(screen.getByTestId(`layer-delete-cancel-${id}`));

    expect(useLayerRegistryStore.getState().entries).toHaveLength(1);
    expect(screen.getByTestId(`layer-delete-${id}`)).toBeTruthy();
  });

  it("the ⋯ trigger and its menu carry accessible names", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    const trigger = screen.getByTestId(`layer-menu-${id}`);
    expect(trigger.getAttribute("aria-label")).toBe(
      "Actions for parcels.geojson",
    );
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(screen.getByRole("menu")).getAllByRole("menuitem"),
    ).toHaveLength(3);
  });

  it("Escape closes the ⋯ menu and returns focus to its trigger", () => {
    const id = seedParcels();
    render(<LayerPanel />);

    const trigger = screen.getByTestId(`layer-menu-${id}`);
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("deleting the expanded layer does not leave a neighbour expanded", () => {
    seedMany(2, "d");
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:d-0"));
    expect(screen.getByTestId("layer-detail-dl:d-0")).toBeTruthy();

    fireEvent.click(screen.getByTestId("layer-menu-dl:d-0"));
    fireEvent.click(screen.getByTestId("layer-delete-dl:d-0"));
    fireEvent.click(screen.getByTestId("layer-delete-confirm-dl:d-0"));

    expect(screen.queryByTestId("layer-detail-dl:d-1")).toBeNull();
  });
});

describe("scale (step 6)", () => {
  it("opening a second card closes the first — one at a time", () => {
    seedMany(3, "acc");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:acc-0"));
    expect(screen.getByTestId("layer-detail-dl:acc-0")).toBeTruthy();

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:acc-2"));

    expect(screen.queryByTestId("layer-detail-dl:acc-0")).toBeNull();
    expect(screen.getByTestId("layer-detail-dl:acc-2")).toBeTruthy();
    expect(screen.getAllByTestId(/^layer-detail-/)).toHaveLength(1);
  });

  it("hides the filter below 10 data layers and shows it at 10", () => {
    seedMany(9, "few");
    const { rerender } = render(<LayerPanel />);
    expect(screen.queryByTestId("layer-filter")).toBeNull();

    seedMany(1, "one-more");
    rerender(<LayerPanel />);
    expect(screen.getByTestId("layer-filter")).toBeTruthy();
  });

  it("the filter has a programmatic label, not just a placeholder", () => {
    seedMany(12, "many");
    render(<LayerPanel />);

    expect(screen.getByLabelText("Filter layers by name")).toBe(
      screen.getByTestId("layer-filter"),
    );
  });

  it("filtering narrows the list case-insensitively and says so when nothing matches", () => {
    seedMany(12, "Road");
    render(<LayerPanel />);

    fireEvent.change(screen.getByTestId("layer-filter"), {
      target: { value: "road 1" },
    });
    // "Road 1", "Road 10", "Road 11"
    expect(screen.getAllByTestId(/^layer-row-header-/)).toHaveLength(3);

    fireEvent.change(screen.getByTestId("layer-filter"), {
      target: { value: "zzz" },
    });
    expect(screen.getByTestId("layer-filter-no-match")).toBeTruthy();
  });

  it("annotations are unaffected by the data-layer filter", () => {
    seedMany(12, "Road");
    useLayerRegistryStore.getState().registerAnnotation("el-1", "A note");
    render(<LayerPanel />);

    fireEvent.change(screen.getByTestId("layer-filter"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("A note")).toBeTruthy();
  });

  it("reorder still addresses real stack positions while a filter hides rows", () => {
    seedMany(12, "Road");
    render(<LayerPanel />);
    fireEvent.change(screen.getByTestId("layer-filter"), {
      target: { value: "Road 5" },
    });

    // Road 5 is index 5 of 12 — neither first nor last, so both arrows are
    // live even though it is the only row on screen. Handing SortableRow the
    // filtered list would have made it look like a single-row section.
    expect(
      (screen.getByTestId("layer-up-dl:Road-5") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("layer-down-dl:Road-5") as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByTestId("layer-up-dl:Road-5"));
    const order = useLayerRegistryStore
      .getState()
      .entries.filter((e) => e.kind === "data")
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((e) => e.label);
    expect(order.slice(3, 7)).toEqual(["Road 3", "Road 5", "Road 4", "Road 6"]);
  });
});

// ---------------------------------------------------------------------------
// The list has to be reachable before anything else about scale matters.
//
// `.sidebar` is `overflow: hidden` and nothing between it and this panel used
// to scroll, so at 25 data layers the last 11 rows were CLIPPED — not awkward,
// unreachable. Measured in Chromium: `.body` scrollHeight 1309 in a 680px port
// with `anyScrollableAncestor: false`, and the open card's Apply button sitting
// 22px BELOW the sidebar's bottom edge.
//
// jsdom cannot answer this: no layout, and vitest injects no CSS modules, so
// `getComputedStyle(body).overflowY` is `""` whether or not the rule exists.
// The stylesheet is the only place the fix can regress, so the stylesheet is
// what gets asserted — same shape as StylePanel's "not a dialog" test.
// ---------------------------------------------------------------------------

describe("the panel is its own scroll port (step 6)", () => {
  const rule = (selector: string) => {
    const css = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "styles",
        "LayerPanel.module.css",
      ),
      "utf8",
    );
    const match = new RegExp(`^\\${selector}\\s*\\{([^}]*)\\}`, "m").exec(css);
    if (!match) {
      throw new Error(`${selector} rule not found in LayerPanel.module.css`);
    }
    return match[1];
  };
  const bodyRule = () => rule(".body");

  it("declares overflow-y and the min-height that makes it mean anything", () => {
    seedMany(25, "District");
    render(<LayerPanel />);
    // Ties the rule to the element actually rendered.
    expect(screen.getByTestId("layer-panel-body").className).toContain("body");

    const rule = bodyRule();
    expect(rule).toMatch(/overflow-y\s*:\s*auto/);
    // Without `min-height: 0` this flex child grows to its content and the
    // overflow-y has nothing to scroll — the two are one fix, not two.
    expect(rule).toMatch(/min-height\s*:\s*0/);
  });

  it("renders every layer rather than truncating the list", () => {
    // The clipping was invisible to the DOM, which is why it survived step 4:
    // all 25 rows were present and 11 of them were off the bottom.
    seedMany(25, "District");
    render(<LayerPanel />);
    expect(screen.getAllByTestId(/^layer-row-header-/)).toHaveLength(25);
  });

  it("scrolls the card it just opened into view", () => {
    // The ninth card of 25 opens below the fold. jsdom has no scrollIntoView,
    // so the component guards on it — that guard is why this asserts on a
    // stub rather than on a scroll position.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    seedMany(25, "District");
    render(<LayerPanel />);

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:District-8"));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("pins the open card's header, and only the open one", () => {
    // In a 240px panel at a 600px viewport the open card measures 688px in a
    // 380px port, so its own name scrolls off while you reach for Apply —
    // verified pinned at the port's top edge in Chromium. The marker is what
    // this can check; the CSS that consumes it is asserted below.
    seedMany(3, "District");
    render(<LayerPanel />);
    expect(document.querySelectorAll("[data-sticky]")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("layer-disclosure-dl:District-1"));

    const pinned = document.querySelectorAll("[data-sticky]");
    expect(pinned).toHaveLength(1);
    expect(
      within(pinned[0] as HTMLElement).getByText("District 1"),
    ).toBeTruthy();
  });

  it("the pinned header is actually sticky in the stylesheet", () => {
    const sticky = rule(".rowTopSticky");
    expect(sticky).toMatch(/position\s*:\s*sticky/);
    expect(sticky).toMatch(/top\s*:\s*0/);
    // Rows are transparent over the sidebar's background, so a pinned header
    // without one shows the card body sliding under its text.
    expect(sticky).toMatch(/background\s*:/);
    expect(sticky).toMatch(/z-index\s*:/);
  });

  it("does not leave the pin behind when the card closes", () => {
    seedMany(3, "District");
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:District-1"));
    fireEvent.click(screen.getByTestId("layer-disclosure-dl:District-1"));
    expect(document.querySelectorAll("[data-sticky]")).toHaveLength(0);
  });
});

describe("annotations are not data layers", () => {
  it("renders a plain row — no disclosure, no menu, no symbology", () => {
    useLayerRegistryStore.getState().registerAnnotation("el-1", "MyShape");
    render(<LayerPanel />);

    expect(screen.queryByTestId("layer-disclosure-el-1")).toBeNull();
    expect(screen.queryByTestId("layer-menu-el-1")).toBeNull();
    expect(screen.queryByTestId("style-panel")).toBeNull();
    expect(screen.getByText("MyShape")).toBeTruthy();
  });
});
