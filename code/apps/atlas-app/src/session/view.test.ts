// SPDX-License-Identifier: AGPL-3.0-only
//
// The session's view state: the sheet-panel width (clamping and keeping it
// in this browser), and one store per session.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

import { createDocumentStore } from "../state/document";

import { sceneOf } from "../state/scene";

import { createSession } from "./EditorSession";
import { createViewStore } from "./view";

import type maplibregl from "maplibre-gl";

const STORAGE_KEY = "atlasdraw:sheet-panel:width";

/** A new view store reads the width from the current localStorage. */
async function freshView() {
  return { view: createViewStore() };
}

beforeEach(() => {
  localStorage.clear();
});

describe("sheet-panel width — clamping", () => {
  it("clamps a too-narrow width up to the minimum", async () => {
    const { view } = await freshView();
    view.getState().setSheetPanelWidth(10);
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_MIN_WIDTH);
  });

  it("clamps a too-wide width down to the maximum", async () => {
    const { view } = await freshView();
    view.getState().setSheetPanelWidth(99999);
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_MAX_WIDTH);
  });

  it("rounds to whole pixels — a pointer position is fractional", async () => {
    const { view } = await freshView();
    view.getState().setSheetPanelWidth(380.6);
    expect(view.getState().sheetPanelWidth).toBe(381);
  });

  it("resets to the 302px default", async () => {
    const { view } = await freshView();
    view.getState().setSheetPanelWidth(RIGHT_SIDEBAR_MAX_WIDTH);
    view.getState().resetSheetPanelWidth();
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("sheet-panel width — persistence", () => {
  it("starts at the default when nothing is stored", async () => {
    const { view } = await freshView();
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  });

  it("survives a reload — a set width is read back by a fresh store", async () => {
    const first = await freshView();
    first.view.getState().setSheetPanelWidth(444);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("444");

    const second = await freshView();
    expect(second.view.getState().sheetPanelWidth).toBe(444);
  });

  it("persists the reset too, so the default is a choice and not a gap", async () => {
    const first = await freshView();
    first.view.getState().setSheetPanelWidth(444);
    first.view.getState().resetSheetPanelWidth();

    const second = await freshView();
    expect(second.view.getState().sheetPanelWidth).toBe(
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("re-clamps a stored value from an older MIN/MAX", async () => {
    // A width persisted before the bounds changed is exactly as untrustworthy
    // as a pointer event, so it goes through the same gate.
    localStorage.setItem(STORAGE_KEY, "9000");
    const { view } = await freshView();
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_MAX_WIDTH);
  });

  it("falls back to the default on a corrupt stored value", async () => {
    localStorage.setItem(STORAGE_KEY, "not-a-number");
    const { view } = await freshView();
    expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_DEFAULT_WIDTH);
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
      const { view } = await freshView();
      expect(view.getState().sheetPanelWidth).toBe(RIGHT_SIDEBAR_DEFAULT_WIDTH);
      // Still applies for the session — just not across reloads.
      expect(() => view.getState().setSheetPanelWidth(400)).not.toThrow();
      expect(view.getState().sheetPanelWidth).toBe(400);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("one view per session", () => {
  const deps = () => ({
    store: createDocumentStore(),
    scene: sceneOf({ getSceneElements: () => [], getFiles: () => ({}) }),
    transport: null,
  });

  it("hands every module the instance it was given", () => {
    const d = deps();
    const session = createSession(d);
    expect(session.store).toBe(d.store);
    expect(session.scene).toBe(d.scene);
    expect(session.transport).toBeNull();
  });

  it("two sessions never share a map or a width", () => {
    const a = createSession(deps());
    const b = createSession(deps());
    a.view.getState().setMap({} as maplibregl.Map);
    a.view.getState().setSheetPanelWidth(444);

    expect(b.view.getState().map).toBeNull();
    expect(a.view.getState().sheetPanelWidth).toBe(444);
    expect(b.view.getState().sheetPanelWidth).not.toBe(444);
  });
});
