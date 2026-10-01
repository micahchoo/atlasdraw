// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";

import { MEASURE_UNITS_KEY, loadUnitSystem, useMeasureStore } from "../measure";

describe("loadUnitSystem", () => {
  beforeEach(() => localStorage.clear());

  it("follows the locale when nothing is stored", () => {
    expect(loadUnitSystem("en-US")).toBe("imperial");
    expect(loadUnitSystem("fr-FR")).toBe("metric");
  });

  it("prefers what the user chose over the locale", () => {
    localStorage.setItem(MEASURE_UNITS_KEY, "metric");
    expect(loadUnitSystem("en-US")).toBe("metric");
  });

  it("ignores a stored value that is not a unit system", () => {
    localStorage.setItem(MEASURE_UNITS_KEY, "furlongs");
    expect(loadUnitSystem("en-GB")).toBe("metric");
  });

  it("falls back to the locale when storage throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(loadUnitSystem("en-US")).toBe("imperial");
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("useMeasureStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useMeasureStore.setState({ active: false, units: "metric" });
  });

  it("remembers a unit switch", () => {
    useMeasureStore.getState().toggleUnits();
    expect(useMeasureStore.getState().units).toBe("imperial");
    expect(localStorage.getItem(MEASURE_UNITS_KEY)).toBe("imperial");
  });

  it("keeps the switch for the session when storage throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      useMeasureStore.getState().toggleUnits();
      expect(useMeasureStore.getState().units).toBe("imperial");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("turns the tool on and off", () => {
    useMeasureStore.getState().toggleActive();
    expect(useMeasureStore.getState().active).toBe(true);
    useMeasureStore.getState().setActive(false);
    expect(useMeasureStore.getState().active).toBe(false);
  });
});
