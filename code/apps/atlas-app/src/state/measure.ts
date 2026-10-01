// SPDX-License-Identifier: AGPL-3.0-only
//
// The units every measurement is shown in: a per-user preference, kept in
// this browser. A throwing Storage only loses the memory, never the switch.
// Whether the Measure tool is on is session view state (session/view.ts).

import { unitSystemForLocale } from "@atlasdraw/tools";

import type { UnitSystem } from "@atlasdraw/tools";

export const MEASURE_UNITS_KEY = "atlasdraw:measure:units";

/** The stored choice, else the system of `locale`. */
export function loadUnitSystem(
  locale: string = typeof navigator === "undefined" ? "en" : navigator.language,
): UnitSystem {
  try {
    const raw = localStorage.getItem(MEASURE_UNITS_KEY);
    if (raw === "metric" || raw === "imperial") {
      return raw;
    }
  } catch {
    // Storage unavailable: use the locale.
  }
  return unitSystemForLocale(locale);
}

export function saveUnitSystem(units: UnitSystem): void {
  try {
    localStorage.setItem(MEASURE_UNITS_KEY, units);
  } catch {
    // Storage unavailable: the choice applies for this session only.
  }
}
