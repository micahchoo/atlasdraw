import { describe, expect, it } from "vitest";

import { formatArea, formatLength, unitSystemForLocale } from "./units.js";

describe("formatLength", () => {
  it("gives metres below a kilometre and kilometres above", () => {
    expect(formatLength(0, "metric")).toBe("0 m");
    expect(formatLength(4.567, "metric")).toBe("4.57 m");
    expect(formatLength(45.67, "metric")).toBe("45.7 m");
    expect(formatLength(456.7, "metric")).toBe("457 m");
    expect(formatLength(1234, "metric")).toBe("1.23 km");
    expect(formatLength(343_939, "metric")).toBe("344 km");
    expect(formatLength(1_234_567, "metric")).toBe("1,235 km");
  });

  it("takes the larger unit when the smaller one would round up to it", () => {
    expect(formatLength(999.6, "metric")).toBe("1 km");
    expect(formatLength(304.7, "imperial")).toBe("0.189 mi");
    expect(formatArea(9_999.7, "metric")).toBe("1 ha");
    expect(formatArea(999_600, "metric")).toBe("1 km²");
  });

  it("gives feet below 1,000 ft and miles above", () => {
    expect(formatLength(100, "imperial")).toBe("328 ft");
    expect(formatLength(304.8, "imperial")).toBe("0.189 mi");
    expect(formatLength(1609.344, "imperial")).toBe("1 mi");
    expect(formatLength(343_939, "imperial")).toBe("214 mi");
  });
});

describe("formatArea", () => {
  it("gives m², then hectares from 1 ha, then km² from 1 km²", () => {
    expect(formatArea(500, "metric")).toBe("500 m²");
    expect(formatArea(12_345, "metric")).toBe("1.23 ha");
    expect(formatArea(999_000, "metric")).toBe("99.9 ha");
    expect(formatArea(12_308_463_894, "metric")).toBe("12,308 km²");
  });

  it("gives ft² below a tenth of an acre, then acres, then mi² from 640 ac", () => {
    expect(formatArea(100, "imperial")).toBe("1,076 ft²");
    expect(formatArea(4046.856_422_4, "imperial")).toBe("1 ac");
    expect(formatArea(2_589_988.110_336, "imperial")).toBe("1 mi²");
  });
});

describe("unitSystemForLocale", () => {
  it("gives imperial for a United States locale and metric for the rest", () => {
    expect(unitSystemForLocale("en-US")).toBe("imperial");
    expect(unitSystemForLocale("es-US")).toBe("imperial");
    expect(unitSystemForLocale("en-GB")).toBe("metric");
    expect(unitSystemForLocale("en")).toBe("metric");
    expect(unitSystemForLocale("not a locale")).toBe("metric");
  });
});
