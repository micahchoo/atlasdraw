// SPDX-License-Identifier: AGPL-3.0-only
//
// Sheet-panel width store — clamping and persistence.
//
// The store is a module singleton reading localStorage at creation time, so the
// load path can only be exercised by re-importing the module with storage
// pre-seeded (`vi.resetModules` + dynamic import). The setter path is testable
// on the live singleton.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

const STORAGE_KEY = "atlasdraw:sheet-panel:width";

/** Fresh module instance, so `width` is read from the current localStorage. */
async function freshStore() {
  vi.resetModules();
  return await import("../sheetPanel");
}

beforeEach(() => {
  localStorage.clear();
});

describe("sheet-panel width — clamping", () => {
  it("clamps a too-narrow width up to the minimum", async () => {
    const { useSheetPanelStore } = await freshStore();
    useSheetPanelStore.getState().setWidth(10);
    expect(useSheetPanelStore.getState().width).toBe(RIGHT_SIDEBAR_MIN_WIDTH);
  });

  it("clamps a too-wide width down to the maximum", async () => {
    const { useSheetPanelStore } = await freshStore();
    useSheetPanelStore.getState().setWidth(99999);
    expect(useSheetPanelStore.getState().width).toBe(RIGHT_SIDEBAR_MAX_WIDTH);
  });

  it("rounds to whole pixels — a pointer position is fractional", async () => {
    const { useSheetPanelStore } = await freshStore();
    useSheetPanelStore.getState().setWidth(380.6);
    expect(useSheetPanelStore.getState().width).toBe(381);
  });

  it("resets to the 302px default", async () => {
    const { useSheetPanelStore } = await freshStore();
    useSheetPanelStore.getState().setWidth(RIGHT_SIDEBAR_MAX_WIDTH);
    useSheetPanelStore.getState().resetWidth();
    expect(useSheetPanelStore.getState().width).toBe(
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
    );
  });
});

describe("sheet-panel width — persistence", () => {
  it("starts at the default when nothing is stored", async () => {
    const { useSheetPanelStore } = await freshStore();
    expect(useSheetPanelStore.getState().width).toBe(
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("survives a reload — a set width is read back by a fresh store", async () => {
    const first = await freshStore();
    first.useSheetPanelStore.getState().setWidth(444);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("444");

    const second = await freshStore();
    expect(second.useSheetPanelStore.getState().width).toBe(444);
  });

  it("persists the reset too, so the default is a choice and not a gap", async () => {
    const first = await freshStore();
    first.useSheetPanelStore.getState().setWidth(444);
    first.useSheetPanelStore.getState().resetWidth();

    const second = await freshStore();
    expect(second.useSheetPanelStore.getState().width).toBe(
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("re-clamps a stored value from an older MIN/MAX", async () => {
    // A width persisted before the bounds changed is exactly as untrustworthy
    // as a pointer event, so it goes through the same gate.
    localStorage.setItem(STORAGE_KEY, "9000");
    const { useSheetPanelStore } = await freshStore();
    expect(useSheetPanelStore.getState().width).toBe(RIGHT_SIDEBAR_MAX_WIDTH);
  });

  it("falls back to the default on a corrupt stored value", async () => {
    localStorage.setItem(STORAGE_KEY, "not-a-number");
    const { useSheetPanelStore } = await freshStore();
    expect(useSheetPanelStore.getState().width).toBe(
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("survives a throwing Storage instead of taking the editor down", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError: storage disabled");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      const { useSheetPanelStore } = await freshStore();
      expect(useSheetPanelStore.getState().width).toBe(
        RIGHT_SIDEBAR_DEFAULT_WIDTH,
      );
      // Still applies for the session — just not across reloads.
      expect(() => useSheetPanelStore.getState().setWidth(400)).not.toThrow();
      expect(useSheetPanelStore.getState().width).toBe(400);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
