// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";

import { MEASURE_UNITS_KEY, loadUnitSystem } from "../measure";

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
