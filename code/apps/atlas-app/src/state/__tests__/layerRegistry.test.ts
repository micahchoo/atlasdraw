// SPDX-License-Identifier: AGPL-3.0-only
// T11 — LayerRegistry Zustand store tests.
//
// Drives the store directly (no React rendering) — fastest signal that
// invariants hold. LayerPanel/Drop/Convert (T12-T14) get their own
// component-level tests in their respective waves.

import { beforeEach, describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";

import { useLayerRegistryStore } from "../layerRegistry";

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

  describe("reorder", () => {
    it("sets the order field on the targeted entry without auto-shifting others", () => {
      const store = useLayerRegistryStore.getState();
      store.registerAnnotation("el-1");
      store.registerAnnotation("el-2");

      store.reorder("el-1", 99);

      const entries = useLayerRegistryStore.getState().entries;
      expect(entries.find((e) => e.id === "el-1")?.order).toBe(99);
      expect(entries.find((e) => e.id === "el-2")?.order).toBe(1); // untouched
    });
  });
});
