// SPDX-License-Identifier: AGPL-3.0-only
//
// The session's view state: the sheet-panel width (clamping and keeping it
// in this browser), and one store per session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

import { createDocumentStore } from "../state/document";

import { sceneOf } from "../state/scene";

import { MEASURE_UNITS_KEY } from "../state/measure";

import { createSession } from "./EditorSession";
import { createViewStore } from "./view";

import type * as maplibregl from "maplibre-gl";

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
    notify: { success: () => {}, error: () => {} },
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

describe("comment mode", () => {
  it("starts off; set and toggle move it", () => {
    const view = createViewStore();
    expect(view.getState().commentMode).toBe(false);
    view.getState().toggleCommentMode();
    expect(view.getState().commentMode).toBe(true);
    view.getState().setCommentMode(false);
    expect(view.getState().commentMode).toBe(false);
  });

  it("setting the mode it has tells no one", () => {
    const view = createViewStore();
    let heard = 0;
    view.subscribe(() => {
      heard += 1;
    });
    view.getState().setCommentMode(false);
    expect(heard).toBe(0);
  });
});

describe("measuring", () => {
  beforeEach(() => localStorage.clear());

  it("turns the tool on and off", () => {
    const view = createViewStore();
    view.getState().toggleMeasuring();
    expect(view.getState().measuring).toBe(true);
    view.getState().setMeasuring(false);
    expect(view.getState().measuring).toBe(false);
  });

  it("remembers a unit switch in this browser", () => {
    localStorage.setItem(MEASURE_UNITS_KEY, "metric");
    const view = createViewStore();
    view.getState().toggleUnits();
    expect(view.getState().units).toBe("imperial");
    expect(localStorage.getItem(MEASURE_UNITS_KEY)).toBe("imperial");
    expect(createViewStore().getState().units).toBe("imperial");
  });

  it("keeps the switch for the session when storage throws", () => {
    localStorage.setItem(MEASURE_UNITS_KEY, "metric");
    const view = createViewStore();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    try {
      view.getState().toggleUnits();
      expect(view.getState().units).toBe("imperial");
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("selection", () => {
  it("select replaces the selection with one id; clear empties it", () => {
    const view = createViewStore();
    view.getState().setSelection({ a: true, b: true });
    view.getState().select("dl:roads");
    expect(view.getState().selection).toEqual({ "dl:roads": true });
    view.getState().clearSelection();
    expect(view.getState().selection).toEqual({});
  });
});

describe("dialogs", () => {
  it("one dialog is open at a time; opening another replaces it", () => {
    const view = createViewStore();
    view.getState().openDialog({ kind: "about" });
    view.getState().openDialog({ kind: "export", format: "pdf" });
    expect(view.getState().dialog).toEqual({ kind: "export", format: "pdf" });
    view.getState().closeDialog();
    expect(view.getState().dialog).toBeNull();
  });

  it("toggleDialog opens a closed dialog and closes an open one", () => {
    const view = createViewStore();
    view.getState().toggleDialog("shortcuts");
    expect(view.getState().dialog).toEqual({ kind: "shortcuts" });
    view.getState().toggleDialog("shortcuts");
    expect(view.getState().dialog).toBeNull();
  });

  it("ask shows a question and resolves with the answer, then closes it", async () => {
    const view = createViewStore();
    const answer = view.getState().ask({
      title: "Open another map?",
      body: "…",
      confirmLabel: "Open anyway",
    });
    const dialog = view.getState().dialog;
    expect(dialog?.kind).toBe("confirm");
    (dialog as { answer(yes: boolean): void }).answer(true);
    await expect(answer).resolves.toBe(true);
    expect(view.getState().dialog).toBeNull();
  });
});

describe("a question that loses the slot is answered", () => {
  const question = {
    title: "Clear the drawing?",
    body: "…",
    confirmLabel: "Clear",
  };

  it("another dialog opening over it answers no", async () => {
    const view = createViewStore();
    const answer = view.getState().ask(question);
    view.getState().openDialog({ kind: "about" });
    await expect(answer).resolves.toBe(false);
    expect(view.getState().dialog).toEqual({ kind: "about" });
  });

  it("a second question answers the first no and stays open", async () => {
    const view = createViewStore();
    const first = view.getState().ask(question);
    const second = view.getState().ask({ ...question, title: "Open?" });
    await expect(first).resolves.toBe(false);
    const open = view.getState().dialog;
    expect(open?.kind === "confirm" && open.title).toBe("Open?");
    (open as { answer(yes: boolean): void }).answer(true);
    await expect(second).resolves.toBe(true);
  });

  it("a toggle over it answers no", async () => {
    const view = createViewStore();
    const answer = view.getState().ask(question);
    view.getState().toggleDialog("palette");
    await expect(answer).resolves.toBe(false);
    expect(view.getState().dialog).toEqual({ kind: "palette" });
  });

  it("closing the slot answers no", async () => {
    const view = createViewStore();
    const answer = view.getState().ask(question);
    view.getState().closeDialog();
    await expect(answer).resolves.toBe(false);
  });

  it("a late answer from a replaced question does not close the new dialog", () => {
    const view = createViewStore();
    void view.getState().ask(question);
    const stale = view.getState().dialog as { answer(yes: boolean): void };
    view.getState().openDialog({ kind: "settings" });
    stale.answer(true);
    expect(view.getState().dialog).toEqual({ kind: "settings" });
  });
});

describe("where focus goes back to", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function button(name: string, parent: HTMLElement = document.body) {
    const b = document.createElement("button");
    b.textContent = name;
    parent.appendChild(b);
    return b;
  }

  it("the element that had focus when the dialog opened", () => {
    const view = createViewStore();
    const opener = button("Pin");
    opener.focus();
    view.getState().openDialog({ kind: "about" });
    expect(view.getState().returnFocus).toBe(opener);
  });

  it("the menu's trigger, when a menu item opened it: the item goes with the menu", () => {
    const view = createViewStore();
    const trigger = button("Menu");
    trigger.id = "menu-trigger";
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-labelledby", "menu-trigger");
    document.body.appendChild(menu);
    const item = button("Settings…", menu);
    item.focus();
    view.getState().openDialog({ kind: "settings" });
    expect(view.getState().returnFocus).toBe(trigger);
  });

  it("the first opener, when a dialog opens from inside another (the palette)", () => {
    const view = createViewStore();
    const opener = button("Pin");
    opener.focus();
    view.getState().openDialog({ kind: "palette" });
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    button("Settings…", modal).focus();
    view.getState().closeDialog();
    view.getState().openDialog({ kind: "settings" });
    expect(view.getState().returnFocus).toBe(opener);
  });

  it("nothing, when nothing had focus", () => {
    const view = createViewStore();
    (document.activeElement as HTMLElement | null)?.blur();
    view.getState().openDialog({ kind: "about" });
    expect(view.getState().returnFocus).toBeNull();
  });
});
