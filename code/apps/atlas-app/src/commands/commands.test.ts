// SPDX-License-Identifier: AGPL-3.0-only
//
// The command registry: one list feeds the main menu, the ⌘K palette, the
// keys and the shortcuts panel. These cases hold the list together and
// check what each command does to a session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@atlasdraw/common";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { createSession, type EditorSession } from "../session/EditorSession";
import {
  createDocument,
  openDocument,
  useDocumentStore,
} from "../state/document";
import { editorScene } from "../state/scene";
import { followDocumentHistory } from "../state/documentUndo";
import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";

import {
  COMMANDS,
  EDITOR_KEYS,
  paletteKeyText,
  MAIN_MENU,
  commandById,
  paletteCommands,
  shortcutRows,
} from "./commands";
import { bindingId, keyLabels } from "./keys";

import type * as maplibregl from "maplibre-gl";

/** A map that counts its zoom steps. */
function fakeMap() {
  const map = {
    zoom: 10,
    zoomIn() {
      map.zoom += 1;
    },
    zoomOut() {
      map.zoom -= 1;
    },
    fitBounds: vi.fn(),
  };
  return map;
}

function session(): {
  s: EditorSession;
  api: ExcalidrawImperativeAPI & { toggleSidebar: ReturnType<typeof vi.fn> };
  map: ReturnType<typeof fakeMap>;
  all: () => ReadonlyArray<{ id: string; isDeleted?: boolean }>;
} {
  const s = createSession({
    store: useDocumentStore,
    scene: editorScene,
    transport: null,
    notify: { success: vi.fn(), error: vi.fn() },
  });
  const fx = makeFakeExcalidraw([
    { id: "a", type: "rectangle" },
    { id: "b", type: "ellipse" },
  ]);
  const api = Object.assign(fx.api, { toggleSidebar: vi.fn() });
  const map = fakeMap();
  s.view.getState().setApi(api);
  s.view.getState().setMap(map as unknown as maplibregl.Map);
  return { s, api, map, all: fx.all };
}

const run = (s: EditorSession, id: string) => commandById(id)!.run(s);

beforeEach(() => {
  openDocument(createDocument());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the registry", () => {
  it("every id is unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no two commands claim one key", () => {
    const owners = new Map<string, string>();
    for (const c of COMMANDS) {
      for (const b of c.keys ?? []) {
        const id = bindingId(b);
        expect(owners.get(id), `${id}: ${owners.get(id)} and ${c.id}`).toBe(
          undefined,
        );
        owners.set(id, c.id);
      }
    }
    expect(owners.size).toBeGreaterThan(0);
  });

  it("no command takes a key the drawing editor keeps", () => {
    const kept = new Set(
      EDITOR_KEYS.flatMap((k) => (k.binding ? [bindingId(k.binding)] : [])),
    );
    for (const c of COMMANDS) {
      for (const b of c.keys ?? []) {
        expect(kept.has(bindingId(b)), `${c.id} takes ${bindingId(b)}`).toBe(
          false,
        );
      }
    }
  });

  it("every main-menu entry is a registered command", () => {
    const entries = MAIN_MENU.filter((e) => e !== "---");
    expect(entries.length).toBeGreaterThan(5);
    for (const id of entries) {
      expect(commandById(id), id).toBeDefined();
    }
  });

  it("every bound key is listed in the shortcuts panel, with its command", () => {
    const rows = shortcutRows();
    for (const c of COMMANDS) {
      for (const b of c.keys ?? []) {
        expect(
          rows.some(
            (r) =>
              r.label === c.label &&
              r.keys.join("+") === keyLabels(b).join("+"),
          ),
          `${c.id} ${bindingId(b)}`,
        ).toBe(true);
      }
    }
  });

  it("the drawing's keys name the platform's modifier: Ctrl, or ⌘ on macOS", () => {
    const row = (mac: boolean, label: string) =>
      shortcutRows(mac)
        .find((r) => r.label === label)
        ?.keys.join(" ");
    expect(row(false, "Undo")).toBe("Ctrl Z");
    expect(row(true, "Undo")).toBe("⌘ Z");
    expect(row(true, "Redo")).toBe("⌘ Shift Z");
    expect(row(true, "Command palette")).toBe("⌘ K");
    for (const r of shortcutRows(true)) {
      expect(r.keys, r.label).not.toContain("Ctrl");
    }
  });

  it("the palette's key reads as the platform types it", () => {
    expect(paletteKeyText(false)).toBe("Ctrl+K");
    expect(paletteKeyText(true)).toBe("⌘K");
  });

  it("the palette offers every available command but itself", () => {
    const { s } = session();
    const ids = paletteCommands(s).map((c) => c.id);
    expect(ids).not.toContain("app.palette");
    for (const c of COMMANDS) {
      if (c.id !== "app.palette" && c.available(s)) {
        expect(ids, c.id).toContain(c.id);
      }
    }
  });
});

describe("what a command does", () => {
  it("the shortcuts and the palette open, and close again", () => {
    const { s } = session();
    run(s, "help.shortcuts");
    expect(s.view.getState().dialog).toEqual({ kind: "shortcuts" });
    run(s, "help.shortcuts");
    expect(s.view.getState().dialog).toBeNull();
    run(s, "app.palette");
    expect(s.view.getState().dialog).toEqual({ kind: "palette" });
  });

  it("comment mode and the Measure tool toggle", () => {
    const { s } = session();
    run(s, "tools.comment");
    expect(s.view.getState().commentMode).toBe(true);
    run(s, "tools.measure");
    expect(s.view.getState().measuring).toBe(true);
    run(s, "tools.comment");
    expect(s.view.getState().commentMode).toBe(false);
  });

  it("the Pin tool arms, and a second run disarms it", () => {
    const { s } = session();
    run(s, "tools.pin");
    expect(s.view.getState().atlasTool?.id).toBe("pin");
    run(s, "tools.pin");
    expect(s.view.getState().atlasTool).toBeNull();
  });

  it("the zoom commands move the map", () => {
    const { s, map } = session();
    run(s, "view.zoom-in");
    run(s, "view.zoom-in");
    run(s, "view.zoom-out");
    expect(map.zoom).toBe(11);
  });

  it("the Layers and Find commands open their sidebar tabs", () => {
    const { s, api } = session();
    run(s, "view.layers");
    run(s, "view.find");
    expect(api.toggleSidebar.mock.calls).toEqual([
      [{ name: DEFAULT_SIDEBAR.name, tab: "layers" }],
      [{ name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB }],
    ]);
  });

  it("Export opens the export dialog at PNG, Export PDF at PDF", () => {
    const { s } = session();
    run(s, "file.export");
    expect(s.view.getState().dialog).toEqual({ kind: "export", format: "png" });
    run(s, "file.export-pdf");
    expect(s.view.getState().dialog).toEqual({ kind: "export", format: "pdf" });
  });

  it("Server versions is offered only when the map has a server copy, and opens its dialog", () => {
    const { s } = session();
    const versions = commandById("file.server-versions")!;
    expect(versions.available(s)).toBe(false);
    s.view.setState({ backupAvailable: true });
    expect(versions.available(s)).toBe(true);
    run(s, "file.server-versions");
    expect(s.view.getState().dialog).toEqual({ kind: "server-versions" });
  });

  it("commands that work on the drawing wait for it to mount", () => {
    const { s } = session();
    s.view.getState().setApi(null);
    for (const id of ["file.save", "file.open", "edit.clear", "view.layers"]) {
      expect(commandById(id)!.available(s), id).toBe(false);
    }
  });

  it("Undo and Redo, from the menu and the palette, step the one history", () => {
    const { s } = session();
    const stop = followDocumentHistory(useDocumentStore, s.history);
    const doc = () => useDocumentStore.getState().doc;
    doc().dispatch({ type: "rename-document", title: "Rivers" });

    expect(MAIN_MENU).toEqual(
      expect.arrayContaining(["edit.undo", "edit.redo"]),
    );
    run(s, "edit.undo");
    expect(doc().snapshot().title).not.toBe("Rivers");
    run(s, "edit.redo");
    expect(doc().snapshot().title).toBe("Rivers");
    stop();
  });

  it("Clear the drawing asks first; No keeps every shape", async () => {
    const { s, all } = session();
    run(s, "edit.clear");
    const dialog = s.view.getState().dialog as {
      kind: string;
      answer(yes: boolean): void;
    };
    expect(dialog.kind).toBe("confirm");
    dialog.answer(false);
    await Promise.resolve();
    expect(all().filter((e) => !e.isDeleted)).toHaveLength(2);
  });

  it("Clear the drawing deletes every shape after a yes, and leaves the layers", async () => {
    const { s, all } = session();
    useDocumentStore.getState().doc.dispatch({
      type: "add-tile-layer",
      id: "tl:a",
      label: "A",
      url: "https://tiles.example/{z}/{x}/{y}.png",
    });
    run(s, "edit.clear");
    (s.view.getState().dialog as { answer(yes: boolean): void }).answer(true);
    await vi.waitFor(() =>
      expect(all().filter((e) => !e.isDeleted)).toHaveLength(0),
    );
    expect(useDocumentStore.getState().doc.snapshot().overlays).toHaveLength(1);
  });

  it("Import data opens a picker for every format the importer reads, and imports the pick", async () => {
    const { s } = session();
    const importFile = vi.fn();
    s.view.setState({ importFile });
    const clicked: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      clicked.push(this);
    });

    run(s, "file.import");

    expect(clicked).toHaveLength(1);
    const input = clicked[0];
    for (const ext of [".geojson", ".csv", ".zip", ".kml", ".gpx", ".tif"]) {
      expect(input.accept).toContain(ext);
    }
    const file = new File(["{}"], "roads.geojson");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(importFile).toHaveBeenCalledWith(file));
    expect(input.isConnected).toBe(false);
  });
});
