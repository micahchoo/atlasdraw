// SPDX-License-Identifier: AGPL-3.0-only
// T11 — LayerRegistry Zustand store tests.
//
// Drives the store directly (no React rendering) — fastest signal that
// invariants hold. LayerPanel/Drop/Convert (T12-T14) get their own
// component-level tests in their respective waves.

import { beforeEach, describe, expect, it } from "vitest";

import { useLayerRegistryStore } from "../layerRegistry";
import { useDataLayerFCStore } from "../useDataLayerFCStore";

import type { FeatureCollection } from "geojson";

const emptyFc = (count: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    properties: { i },
    geometry: { type: "Point", coordinates: [0, 0] },
  })),
});

/** Register a raster layer: the registry's second kind, beside data. */
function addRaster(id: string): void {
  useLayerRegistryStore.getState().registerRasterLayer({
    id,
    label: id,
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    imageKey: `${id}.png`,
  });
}

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
  // Phase 4 W0 (atlasdraw-ad27): registry actions now mirror into the FC
  // store. Reset the singleton between tests so FC bleed-over can't mask a
  // regression in the mirror logic.
  useDataLayerFCStore.getState().clear();
});

describe("layerRegistry", () => {
  describe("renameLayer", () => {
    it("renames a data layer without inventing a renamedByUser flag", () => {
      const store = useLayerRegistryStore.getState();
      store.registerDataLayer({
        id: "dl:abc-123",
        fc: emptyFc(1),
        label: "layer_1.geojson",
        style: { fillColor: "#f00" },
      });
      store.renameLayer("dl:abc-123", "Parcels");

      const entry = useLayerRegistryStore.getState().entries[0];
      // Nothing regenerates data layer labels, so the flag would be a field
      // with no reader — and it is not in DataLayerEntry.
      expect(entry).toMatchObject({ label: "Parcels" });
      expect(entry).not.toHaveProperty("renamedByUser");
    });

    it("is a no-op when the entry does not exist", () => {
      const store = useLayerRegistryStore.getState();
      expect(() => store.renameLayer("nonexistent", "X")).not.toThrow();
      expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    });
  });

  describe("registerDataLayer", () => {
    it("appends a DataLayerEntry with featureCount matching input", () => {
      const store = useLayerRegistryStore.getState();
      const fc = emptyFc(3);
      store.registerDataLayer({
        id: "dl:abc-123",
        fc,
        label: "Cities",
        style: { fillColor: "#f00", opacity: 0.5 },
      });

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: "data",
        id: "dl:abc-123",
        label: "Cities",
        visible: true,
        order: 0,
        featureCount: 3,
        style: { fillColor: "#f00", opacity: 0.5 },
      });
    });

    it("throws on a non-prefixed id", () => {
      const store = useLayerRegistryStore.getState();
      expect(() =>
        store.registerDataLayer({
          id: "no-prefix",
          fc: emptyFc(0),
          label: "Bad",
          style: {},
        }),
      ).toThrow(/dl:/);

      expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    });
  });

  // FU-1 — the third kind.
  describe("registerRasterLayer", () => {
    const CORNERS = [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ] as const;

    it("appends a RasterLayerEntry, opaque by default", () => {
      const store = useLayerRegistryStore.getState();
      store.registerRasterLayer({
        id: "rl:abc-123",
        label: "survey-sheet.tif",
        corners: [...CORNERS] as never,
        imageKey: "raster-abc-123.png",
        provenance: { sourceFile: "survey-sheet.tif", droppedCount: 0 },
      });

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: "raster",
        id: "rl:abc-123",
        label: "survey-sheet.tif",
        visible: true,
        order: 0,
        imageKey: "raster-abc-123.png",
        // Arrives at full strength. A raster that showed up pre-faded would
        // make dragging the slider back the first act of every import.
        opacity: 1,
      });
    });

    it("throws on a non-prefixed id", () => {
      const store = useLayerRegistryStore.getState();
      expect(() =>
        store.registerRasterLayer({
          id: "no-prefix",
          label: "Bad",
          corners: [...CORNERS] as never,
          imageKey: "x.png",
        }),
      ).toThrow(/rl:/);

      expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    });

    it("ignores a duplicate id rather than stacking two entries on it", () => {
      const store = useLayerRegistryStore.getState();
      const args = {
        id: "rl:dup",
        label: "first",
        corners: [...CORNERS] as never,
        imageKey: "a.png",
      };
      store.registerRasterLayer(args);
      store.registerRasterLayer({ ...args, label: "second" });

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0].label).toBe("first");
    });

    it("removes like any other entry", () => {
      const store = useLayerRegistryStore.getState();
      store.registerRasterLayer({
        id: "rl:gone",
        label: "plate",
        corners: [...CORNERS] as never,
        imageKey: "a.png",
      });
      useLayerRegistryStore.getState().remove("rl:gone");
      expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    });
  });

  describe("setVisibility", () => {
    it("toggles visible on an entry by id", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");

      store.setVisibility("rl:el-1", false);
      expect(useLayerRegistryStore.getState().entries[0].visible).toBe(false);

      store.setVisibility("rl:el-1", true);
      expect(useLayerRegistryStore.getState().entries[0].visible).toBe(true);
    });
  });

  describe("updateStyle", () => {
    it("merges patch on a data layer", () => {
      const store = useLayerRegistryStore.getState();
      store.registerDataLayer({
        id: "dl:1",
        fc: emptyFc(0),
        label: "L",
        style: { fillColor: "#000", strokeWidth: 1, opacity: 1 },
      });

      store.updateStyle("dl:1", { fillColor: "#fff", opacity: 0.25 });

      const e = useLayerRegistryStore
        .getState()
        .entries.find((x) => x.id === "dl:1");
      expect(e?.kind).toBe("data");
      if (e?.kind === "data") {
        expect(e.style).toEqual({
          fillColor: "#fff",
          strokeWidth: 1, // preserved
          opacity: 0.25,
        });
      }
    });
  });

  describe("remove", () => {
    it("filters the entry by id", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");
      addRaster("rl:el-2");
      addRaster("rl:el-3");

      store.remove("rl:el-2");

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id)).toEqual(["rl:el-1", "rl:el-3"]);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 4 W0 (atlasdraw-ad27): FC-store mirror side effects.
  // The LayerRegistry's data-layer actions push the FC into useDataLayerFCStore
  // so selectDocument can populate AtlasdrawDocument.layers without re-reading
  // the MapLibre source. We assert the side effect at the action boundary —
  // in production both stores are wired through registry actions only.
  // -------------------------------------------------------------------------
  describe("FC store mirror (atlasdraw-ad27)", () => {
    it("registerDataLayer mirrors the FC into the FC store under the same id", () => {
      const store = useLayerRegistryStore.getState();
      const fc = emptyFc(4);
      store.registerDataLayer({
        id: "dl:mirror-1",
        fc,
        label: "Mirror",
        style: {},
      });

      expect(useDataLayerFCStore.getState().get("dl:mirror-1")).toBe(fc);
    });

    it("remove drops the FC from the FC store", () => {
      const store = useLayerRegistryStore.getState();
      store.registerDataLayer({
        id: "dl:gone",
        fc: emptyFc(1),
        label: "Bye",
        style: {},
      });
      expect(useDataLayerFCStore.getState().get("dl:gone")).toBeDefined();

      store.remove("dl:gone");
      expect(useDataLayerFCStore.getState().get("dl:gone")).toBeUndefined();
    });
  });

  describe("reorder", () => {
    it("moves entry to target position and auto-shifts intermediate entries", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");
      addRaster("rl:el-2");
      addRaster("rl:el-3");

      // Move el-1 from index 0 to index 2 (last position).
      store.reorder("rl:el-1", 2);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("rl:el-2");
      expect(entries[0].order).toBe(0);
      expect(entries[1].id).toBe("rl:el-3");
      expect(entries[1].order).toBe(1);
      expect(entries[2].id).toBe("rl:el-1");
      expect(entries[2].order).toBe(2);
    });

    it("clamps newOrder below 0 to 0", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");
      addRaster("rl:el-2");

      store.reorder("rl:el-2", -5);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("rl:el-2");
      expect(entries[0].order).toBe(0);
    });

    it("clamps newOrder past length-1 to last position", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");
      addRaster("rl:el-2");

      store.reorder("rl:el-1", 999);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[1].id).toBe("rl:el-1");
      expect(entries[1].order).toBe(1);
    });

    it("no-ops when id is not found", () => {
      const store = useLayerRegistryStore.getState();
      addRaster("rl:el-1");

      store.reorder("nonexistent", 0);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("rl:el-1");
    });
  });

  // -------------------------------------------------------------------------
  // P3 — reorder is kind-scoped. `order` is the index within the entry's own
  // stack, and an entry can never cross into the other stack.
  // -------------------------------------------------------------------------
  describe("mixed-kind reorder", () => {
    const seedMixed = () => {
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
      addRaster("rl:a1");
      addRaster("rl:a2");
      addRaster("rl:a3");
    };
    const ids = () => useLayerRegistryStore.getState().entries.map((e) => e.id);
    const orderOf = (id: string) =>
      useLayerRegistryStore.getState().entries.find((e) => e.id === id)?.order;

    it("numbers order per kind, not globally", () => {
      seedMixed();
      expect(orderOf("dl:d1")).toBe(0);
      expect(orderOf("dl:d2")).toBe(1);
      expect(orderOf("rl:a1")).toBe(0);
      expect(orderOf("rl:a3")).toBe(2);
    });

    it("moves the first raster to the last raster slot", () => {
      seedMixed();
      useLayerRegistryStore.getState().reorder("rl:a1", 2);

      expect(ids()).toEqual(["dl:d1", "dl:d2", "rl:a2", "rl:a3", "rl:a1"]);
      expect(orderOf("rl:a1")).toBe(2);
      expect(orderOf("rl:a2")).toBe(0);
      // Data layers untouched.
      expect(orderOf("dl:d1")).toBe(0);
      expect(orderOf("dl:d2")).toBe(1);
    });

    it("cannot splice a raster into the data-layer stack", () => {
      seedMixed();
      // Index 0 of the raster stack is where a1 already is → no-op.
      useLayerRegistryStore.getState().reorder("rl:a1", 0);
      expect(ids()).toEqual(["dl:d1", "dl:d2", "rl:a1", "rl:a2", "rl:a3"]);

      // Even a wildly out-of-range index only clamps inside the group.
      useLayerRegistryStore.getState().reorder("rl:a1", 99);
      expect(ids()).toEqual(["dl:d1", "dl:d2", "rl:a2", "rl:a3", "rl:a1"]);
      expect(
        useLayerRegistryStore
          .getState()
          .entries.filter((e) => e.kind === "data")
          .map((e) => e.id),
      ).toEqual(["dl:d1", "dl:d2"]);
    });

    it("reordering data layers leaves raster order alone", () => {
      seedMixed();
      useLayerRegistryStore.getState().reorder("dl:d1", 1);

      expect(ids()).toEqual(["dl:d2", "dl:d1", "rl:a1", "rl:a2", "rl:a3"]);
      expect(orderOf("dl:d1")).toBe(1);
      expect(orderOf("rl:a1")).toBe(0);
      expect(orderOf("rl:a2")).toBe(1);
      expect(orderOf("rl:a3")).toBe(2);
    });

    it("keeps order contiguous per kind after a mid-stack remove", () => {
      seedMixed();
      useLayerRegistryStore.getState().remove("rl:a2");

      expect(orderOf("rl:a1")).toBe(0);
      expect(orderOf("rl:a3")).toBe(1);
      expect(orderOf("dl:d1")).toBe(0);
    });
  });
});
