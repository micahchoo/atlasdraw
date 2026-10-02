// SPDX-License-Identifier: AGPL-3.0-only
//
// The right-click menus come from the command list. These cases hold the
// contract: every item the drawing's menus show is a command, every command
// that names a menu is in it, and each one is in the palette too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExcalidrawImperativeAPI,
  ProjectContextMenuItem,
} from "@atlasdraw/excalidraw/types";

import { createSession, type EditorSession } from "../session/EditorSession";
import {
  createDocument,
  openDocument,
  useDocumentStore,
} from "../state/document";
import { editorScene } from "../state/scene";
import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";

import { COMMANDS, commandById, paletteCommands } from "./commands";
import { registerCommandMenus } from "./contextMenus";

import type * as maplibregl from "maplibre-gl";

function editor(elements: Array<Record<string, unknown>> = []) {
  const s = createSession({
    store: useDocumentStore,
    scene: editorScene,
    transport: null,
    notify: { success: vi.fn(), error: vi.fn() },
  });
  const fx = makeFakeExcalidraw(elements as never);
  const items: ProjectContextMenuItem[] = [];
  const unregister = vi.fn();
  const api = Object.assign(fx.api, {
    registerContextMenuItem: vi.fn((item: ProjectContextMenuItem) => {
      items.push(item);
      return unregister;
    }),
  });
  s.view.getState().setApi(api as ExcalidrawImperativeAPI);
  s.view.getState().setMap({
    getCanvas: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }),
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
  } as unknown as maplibregl.Map);
  const stop = registerCommandMenus(s, api as ExcalidrawImperativeAPI);
  return { s, api, items, unregister, stop };
}

/** What the fork's menu shows for `items` in one of its menus. */
function shown(
  items: readonly ProjectContextMenuItem[],
  menu: "canvas" | "element",
) {
  const at = { clientX: 5, clientY: 5 };
  return items
    .filter((i) => (i.contexts ?? ["element"]).includes(menu))
    .filter((i) => i.predicate([], {} as never, at))
    .map((i) => i.label);
}

const commandOf = (item: ProjectContextMenuItem) =>
  commandById(item.name.slice(item.name.indexOf(":") + 1));

const rect = {
  id: "r",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};

beforeEach(() => {
  openDocument(createDocument());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("one registry: the right-click menus are built from the commands", () => {
  it("every registered item is a command that names that menu, and the palette lists it", () => {
    const { s, items } = editor([rect]);
    expect(items.length).toBeGreaterThan(0);
    const palette = (x: EditorSession) => paletteCommands(x).map((c) => c.id);
    for (const item of items) {
      const command = commandOf(item);
      expect(command, item.name).toBeDefined();
      expect(command!.contexts, item.name).toContain(item.name.split(":")[0]);
      if (command!.available(s)) {
        expect(palette(s), item.name).toContain(command!.id);
      }
    }
  });

  it("every command that names a menu is registered for it", () => {
    const { items } = editor();
    const names = new Set(items.map((i) => i.name));
    for (const c of COMMANDS) {
      for (const context of c.contexts ?? []) {
        expect(names, `${context}:${c.id}`).toContain(`${context}:${c.id}`);
      }
    }
  });

  it("no command is in both the canvas menu and the feature menu, which is the canvas menu over a feature", () => {
    for (const c of COMMANDS) {
      const contexts = c.contexts ?? [];
      expect(
        contexts.includes("canvas") && contexts.includes("feature"),
        c.id,
      ).toBe(false);
    }
  });

  it("each item is in the fork menu its context lives in", () => {
    const { items } = editor();
    const menuOf = (name: string) =>
      items.find((i) => i.name === name)?.contexts;
    expect(menuOf("canvas:tools.pin")).toEqual(["canvas"]);
    expect(menuOf("feature:layer.table")).toEqual(["canvas"]);
    expect(menuOf("element:edit.convert-to-layer")).toEqual(["element"]);
    expect(menuOf("pin:tools.pin-details")).toEqual(["element"]);
  });
});

describe("what each menu shows", () => {
  it("the canvas menu, on no feature: Pin here, Measure, Import, zoom, Layers and the drawing's settings", () => {
    const { items } = editor();
    expect(shown(items, "canvas")).toEqual([
      "Pin here",
      "Measure distance",
      "Import data…",
      "Layers panel",
      "Zoom in",
      "Zoom out",
      "Snap to objects",
      "Arrow binding",
      "Snap to midpoints",
    ]);
  });

  it("a shape's menu: Convert, Comment mode and Zoom to selection", () => {
    const { api, items } = editor([rect]);
    api.updateScene({ appState: { selectedElementIds: { r: true } } });
    expect(shown(items, "element")).toEqual([
      "Comment mode",
      "Zoom to selection",
      "Convert selection to data layer",
    ]);
  });

  it("a pin's menu adds Edit pin details", () => {
    const { api, items } = editor([
      { ...rect, id: "p", type: "ellipse", customData: { tool: "pin" } },
    ]);
    api.updateScene({ appState: { selectedElementIds: { p: true } } });
    expect(shown(items, "element")).toContain("Edit pin details…");
  });

  it("a toggle reads its check mark from the command", () => {
    const { api, items } = editor();
    api.updateScene({ appState: { objectsSnapModeEnabled: true } });
    const snap = items.find((i) => i.name === "canvas:edit.snap-objects")!;
    expect(snap.checked?.({} as never)).toBe(true);
  });
});

describe("an item runs its command", () => {
  it("with the menu, and the point where it opened", () => {
    const { items } = editor();
    const run = vi
      .spyOn(commandById("tools.pin")!, "run")
      .mockImplementation(() => {});
    const result = items
      .find((i) => i.name === "canvas:tools.pin")!
      .perform([], {} as never, { clientX: 30, clientY: 40 });
    expect(result).toBe(false);
    expect(run).toHaveBeenCalledWith(expect.anything(), {
      context: "canvas",
      clientX: 30,
      clientY: 40,
    });
  });

  it("and the items go when the editor does", () => {
    const { unregister, stop, items } = editor();
    stop();
    expect(unregister).toHaveBeenCalledTimes(items.length);
  });
});
