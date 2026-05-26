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

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
  // Phase 4 W0 (atlasdraw-ad27): registry actions now mirror into the FC
  // store. Reset the singleton between tests so FC bleed-over can't mask a
  // regression in the mirror logic.
  useDataLayerFCStore.getState().clear();
});

describe("layerRegistry", () => {
  describe("registerAnnotation", () => {
    it("adds an AnnotationLayerEntry with visible:true and monotonic order", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2", "Custom Label");

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(2);

      expect(entries[0]).toMatchObject({
        kind: "annotation",
        id: "el-1",
        label: "el-1",
        visible: true,
        order: 0,
      });
      expect(entries[1]).toMatchObject({
        kind: "annotation",
        id: "el-2",
        label: "Custom Label",
        visible: true,
        order: 1,
      });
    });

    it("is idempotent — second call with same id is a no-op", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1", "Original");
      store.registerAnnotation("el-1", "Duplicate");

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "el-1", label: "Original" });
    });
  });

  describe("updateAnnotationLabel", () => {
    it("updates the label of an existing annotation entry", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1", "Initial");
      store.updateAnnotationLabel("el-1", "Updated Label");

      const { entries } = useLayerRegistryStore.getState();
      expect(entries[0]).toMatchObject({ id: "el-1", label: "Updated Label" });
    });

    it("is a no-op when the annotation does not exist", () => {
      const store = useLayerRegistryStore.getState();
      expect(() =>
        store.updateAnnotationLabel("nonexistent", "X"),
      ).not.toThrow();
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

  describe("setVisibility", () => {
    it("toggles visible on an entry by id", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");

      store.setVisibility("el-1", false);
      expect(useLayerRegistryStore.getState().entries[0].visible).toBe(false);

      store.setVisibility("el-1", true);
      expect(useLayerRegistryStore.getState().entries[0].visible).toBe(true);
    });
  });

  describe("convertAnnotationToDataLayer", () => {
    it("removes the annotation entry and adds a dl:-prefixed data layer with the same label", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1", "My Polygon");
      store.registerAnnotation("el-2", "Other");

      store.convertAnnotationToDataLayer("el-1", emptyFc(2));

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(2);

      // Annotation for el-1 is gone.
      expect(entries.find((e) => e.id === "el-1")).toBeUndefined();

      // New data layer with same label.
      const dataLayer = entries.find((e) => e.kind === "data");
      expect(dataLayer).toBeDefined();
      expect(dataLayer!.id).toMatch(/^dl:/);
      expect(dataLayer!.label).toBe("My Polygon");
      expect(dataLayer!.kind).toBe("data");
      if (dataLayer!.kind === "data") {
        expect(dataLayer!.featureCount).toBe(2);
      }

      // Other annotation untouched.
      expect(entries.find((e) => e.id === "el-2")).toMatchObject({
        kind: "annotation",
        label: "Other",
      });
    });

    it("is a no-op when the annotation does not exist", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      const before = useLayerRegistryStore.getState().entries;

      store.convertAnnotationToDataLayer("nonexistent", emptyFc(0));

      expect(useLayerRegistryStore.getState().entries).toEqual(before);
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

    it("is a no-op on an annotation", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1", "A");
      const before = useLayerRegistryStore.getState().entries;

      store.updateStyle("el-1", { fillColor: "#fff" });

      expect(useLayerRegistryStore.getState().entries).toEqual(before);
    });
  });

  describe("remove", () => {
    it("filters the entry by id", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2");
      store.registerAnnotation("el-3");

      store.remove("el-2");

      const { entries } = useLayerRegistryStore.getState();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id)).toEqual(["el-1", "el-3"]);
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

    it("remove on an annotation id does not throw (FC store delete is a no-op)", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-only");
      expect(() => store.remove("el-only")).not.toThrow();
      expect(useDataLayerFCStore.getState().getAll()).toEqual({});
    });

    it("convertAnnotationToDataLayer mirrors the FC under the new dl: id", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1", "Polygon");
      const fc = emptyFc(2);
      store.convertAnnotationToDataLayer("el-1", fc);

      const dataEntry = useLayerRegistryStore
        .getState()
        .entries.find((e) => e.kind === "data");
      expect(dataEntry).toBeDefined();
      expect(useDataLayerFCStore.getState().get(dataEntry!.id)).toBe(fc);
      // Old annotation id never had an FC entry — confirm.
      expect(useDataLayerFCStore.getState().get("el-1")).toBeUndefined();
    });
  });

  describe("reorder", () => {
    it("moves entry to target position and auto-shifts intermediate entries", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2");
      store.registerAnnotation("el-3");

      // Move el-1 from index 0 to index 2 (last position).
      store.reorder("el-1", 2);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("el-2");
      expect(entries[0].order).toBe(0);
      expect(entries[1].id).toBe("el-3");
      expect(entries[1].order).toBe(1);
      expect(entries[2].id).toBe("el-1");
      expect(entries[2].order).toBe(2);
    });

    it("clamps newOrder below 0 to 0", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2");

      store.reorder("el-2", -5);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[0].id).toBe("el-2");
      expect(entries[0].order).toBe(0);
    });

    it("clamps newOrder past length-1 to last position", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2");

      store.reorder("el-1", 999);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries[1].id).toBe("el-1");
      expect(entries[1].order).toBe(1);
    });

    it("no-ops when id is not found", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");

      store.reorder("nonexistent", 0);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("el-1");
    });
  });
});
