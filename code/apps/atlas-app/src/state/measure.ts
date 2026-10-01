// SPDX-License-Identifier: AGPL-3.0-only
//
// Measuring (W9): whether the Measure tool is on, and the units every
// measurement is shown in.
//
// A store, not component state: the toolbar button, the ⌘K palette, the `m`
// key and MeasureLayer all read the same two values, and none of them is an
// ancestor of the others. The units are a per-user preference, kept in
// localStorage as `state/sheetPanel.ts` keeps its width: read once, written
// in the setter, and a throwing Storage only loses the memory, never the
// switch.

import { create } from "zustand";

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

function saveUnitSystem(units: UnitSystem): void {
  try {
    localStorage.setItem(MEASURE_UNITS_KEY, units);
  } catch {
    // Storage unavailable: the choice applies for this session only.
  }
}

export type MeasureStoreState = {
  /** True while the Measure tool is on. */
  active: boolean;
  units: UnitSystem;
  setActive: (active: boolean) => void;
  toggleActive: () => void;
  toggleUnits: () => void;
};

export const useMeasureStore = create<MeasureStoreState>((set, get) => ({
  active: false,
  units: loadUnitSystem(),
  setActive: (active) => {
    if (get().active !== active) {
      set({ active });
    }
  },
  toggleActive: () => set({ active: !get().active }),
  toggleUnits: () => {
    const units = get().units === "metric" ? "imperial" : "metric";
    set({ units });
    saveUnitSystem(units);
  },
}));
