// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 Wave 0 prereq (atlasdraw-ad27) — useDataLayerFCStore unit tests.
//
// Drives the Zustand store directly (no React rendering). The store is a
// module-singleton, so each test resets via the store's own `clear()` action
// in `beforeEach` — this also exercises the action.

import { beforeEach, describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";

import { useDataLayerFCStore } from "../useDataLayerFCStore";

const makeFc = (count: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    properties: { i },
    geometry: { type: "Point", coordinates: [i, i] },
  })),
});

beforeEach(() => {
  useDataLayerFCStore.getState().clear();
});

describe("useDataLayerFCStore", () => {
  it("starts empty on init / after clear", () => {
    const store = useDataLayerFCStore.getState();
    expect(store.getAll()).toEqual({});
    expect(store.get("dl:anything")).toBeUndefined();
  });

  it("set then get round-trips the FeatureCollection by reference", () => {
    const store = useDataLayerFCStore.getState();
    const fc = makeFc(3);
    store.set("dl:abc", fc);
    expect(store.get("dl:abc")).toBe(fc);
  });

  it("set replaces an existing entry rather than throwing", () => {
    const store = useDataLayerFCStore.getState();
    const fc1 = makeFc(1);
    const fc2 = makeFc(7);
    store.set("dl:abc", fc1);
    store.set("dl:abc", fc2);
    expect(store.get("dl:abc")).toBe(fc2);
    expect(Object.keys(store.getAll())).toEqual(["dl:abc"]);
  });

  it("delete removes an existing id", () => {
    const store = useDataLayerFCStore.getState();
    store.set("dl:a", makeFc(1));
    store.set("dl:b", makeFc(2));
    store.delete("dl:a");
    expect(store.get("dl:a")).toBeUndefined();
    expect(store.get("dl:b")).toBeDefined();
  });

  it("delete on a missing id is a no-op (does not throw, no-op state)", () => {
    const store = useDataLayerFCStore.getState();
    store.set("dl:a", makeFc(1));
    const before = useDataLayerFCStore.getState().fcs;
    store.delete("dl:nope");
    // Same reference back — fast path skipped allocation.
    expect(useDataLayerFCStore.getState().fcs).toBe(before);
  });

  it("getAll returns a fresh shallow clone (caller mutations don't affect the store)", () => {
    const store = useDataLayerFCStore.getState();
    store.set("dl:a", makeFc(1));
    const snapshot = store.getAll();
    delete snapshot["dl:a"];
    expect(store.get("dl:a")).toBeDefined();
  });

  it("clear resets to empty", () => {
    const store = useDataLayerFCStore.getState();
    store.set("dl:a", makeFc(1));
    store.set("dl:b", makeFc(2));
    store.clear();
    expect(store.getAll()).toEqual({});
  });
});
