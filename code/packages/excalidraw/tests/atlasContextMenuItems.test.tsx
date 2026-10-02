import React from "react";
import { vi } from "vitest";

import { reseed, resolvablePromise } from "@atlasdraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { fireEvent, GlobalTestState, render } from "./test-utils";

import type { ExcalidrawImperativeAPI, ProjectContextMenuItem } from "../types";

// Atlasdraw addition (code/decisions/0010-own-the-fork.md). The host builds
// its right-click items from its command list and registers them here. An
// item names the menus that list it: the canvas menu (a right-click on no
// shape) or the element menu. A canvas item gets the point where the menu
// opened, so "Pin here" can act at that point. An item without `contexts` is
// in the element menu only, as before. `canvasMenuToggles={false}` takes the
// upstream toggles out of the canvas menu; the host keeps the ones that work
// over a map as items of its own.

const { h } = window;

async function editor(
  canvasMenuToggles?: boolean,
): Promise<ExcalidrawImperativeAPI> {
  localStorage.clear();
  reseed(7);
  const api = resolvablePromise<ExcalidrawImperativeAPI>();
  await render(
    <Excalidraw
      handleKeyboardGlobally
      canvasMenuToggles={canvasMenuToggles}
      onExcalidrawAPI={(a) => a && api.resolve(a)}
    />,
  );
  return api;
}

const item = (
  name: string,
  extra: Partial<ProjectContextMenuItem> = {},
): ProjectContextMenuItem => ({
  name,
  label: name,
  predicate: () => true,
  perform: () => false,
  ...extra,
});

function rightClickCanvas(clientX = 40, clientY = 50) {
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX,
    clientY,
  });
}

function rightClickElement() {
  const rectangle = API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  API.setElements([rectangle]);
  API.setSelectedElements([rectangle]);
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX: 50,
    clientY: 50,
  });
}

const listed = (name: string) =>
  UI.queryContextMenu()?.querySelector(`li[data-testid="${name}"]`) ?? null;

describe("registered context-menu items", () => {
  it("an item with the canvas context is in the canvas menu, and runs at the menu's point", async () => {
    const api = await editor();
    const perform = vi.fn(() => false as const);
    const predicate = vi.fn(() => true);
    api.registerContextMenuItem(
      item("pinHere", { contexts: ["canvas"], perform, predicate }),
    );

    rightClickCanvas(40, 50);
    expect(listed("pinHere")).not.toBe(null);
    expect(predicate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { clientX: 40, clientY: 50 },
    );

    fireEvent.click(listed("pinHere")!);
    expect(perform).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      clientX: 40,
      clientY: 50,
    });
  });

  it("an item without contexts is in the element menu only", async () => {
    const api = await editor();
    api.registerContextMenuItem(item("convert"));

    rightClickCanvas();
    expect(UI.queryContextMenu()).not.toBe(null);
    expect(listed("convert")).toBe(null);

    rightClickElement();
    expect(listed("convert")).not.toBe(null);
  });

  it("an item with both contexts is in both menus", async () => {
    const api = await editor();
    api.registerContextMenuItem(
      item("both", { contexts: ["canvas", "element"] }),
    );

    rightClickCanvas();
    expect(listed("both")).not.toBe(null);
    rightClickElement();
    expect(listed("both")).not.toBe(null);
  });

  it("a toggle draws its check mark from `checked`", async () => {
    const api = await editor();
    api.registerContextMenuItem(
      item("on", { contexts: ["canvas"], checked: () => true }),
    );
    api.registerContextMenuItem(
      item("off", { contexts: ["canvas"], checked: () => false }),
    );

    rightClickCanvas();
    expect(listed("on")?.querySelector(".checkmark")).not.toBe(null);
    expect(listed("off")?.querySelector(".checkmark")).toBe(null);
  });

  it("a menu whose host items are all hidden ends on an item, not a separator", async () => {
    const api = await editor(false);
    api.registerContextMenuItem(
      item("hidden", { contexts: ["canvas"], predicate: () => false }),
    );
    rightClickCanvas();
    const last = UI.queryContextMenu()?.lastElementChild;
    expect(last?.tagName).toBe("LI");
  });

  it("with canvasMenuToggles={false}, the canvas menu lists none of the upstream toggles", async () => {
    await editor(false);
    rightClickCanvas();
    expect(h.state.contextMenu).not.toBe(null);
    for (const name of [
      "gridMode",
      "objectsSnapMode",
      "arrowBinding",
      "midpointSnapping",
      "zenMode",
      "viewMode",
      "stats",
    ]) {
      expect(listed(name)).toBe(null);
    }
  });
});
