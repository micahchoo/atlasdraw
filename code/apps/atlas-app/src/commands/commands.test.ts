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

import type { MenuTarget } from "./commands";

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

/** A map that answers a point query and turns pixels into degrees, 1:1. */
function pointingMap(hits: Record<string, Record<string, unknown>> = {}) {
  const rect = { left: 10, top: 20, width: 800, height: 600 };
  return {
    zoom: 6,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: () => 6,
    project: ([lng, lat]: [number, number]) => ({ x: lng, y: -lat }),
    unproject: ([x, y]: [number, number]) => ({ lng: x, lat: -y }),
    getContainer: () => ({ getBoundingClientRect: () => rect }),
    getCanvas: () => ({ getBoundingClientRect: () => rect }),
    getBounds: () => ({
      getNorth: () => 1,
      getSouth: () => -1,
      getEast: () => 1,
      getWest: () => -1,
    }),
    getLayer: (id: string) => (id in hits ? {} : undefined),
    queryRenderedFeatures: vi.fn(
      (_p: unknown, { layers }: { layers: string[] }) =>
        layers.filter((l) => l in hits).map((l) => ({ properties: hits[l] })),
    ),
  };
}

/** A data layer of two parcels, each one feature. */
function addParcels(id = "dl:parcels") {
  useDocumentStore.getState().doc.dispatch({
    type: "add-data-layer",
    id,
    label: "Parcels",
    style: {
      fillColor: "#336699",
      strokeColor: "#224466",
      strokeWidth: 1,
      opacity: 0.5,
    } as never,
    fc: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "north" },
          geometry: { type: "Point", coordinates: [10, 50] },
        },
        {
          type: "Feature",
          properties: { name: "south" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [1, 1],
                [3, 1],
                [3, 2],
                [1, 2],
                [1, 1],
              ],
            ],
          },
        },
      ],
    },
  });
}

const at = (context: MenuTarget["context"], x = 110, y = 70): MenuTarget => ({
  context,
  clientX: x,
  clientY: y,
});

describe("what a command does from a right-click menu", () => {
  it("Pin to map, from the canvas menu, places a pin at the menu's point and arms nothing", () => {
    const { s, all } = session();
    s.view.getState().setMap(pointingMap() as unknown as maplibregl.Map);

    commandById("tools.pin")!.run(s, at("canvas", 110, 70));

    expect(s.view.getState().atlasTool).toBeNull();
    const pins = all().filter((e) => e.id !== "a" && e.id !== "b");
    expect(pins).toHaveLength(1);
    expect(commandById("tools.pin")!.menuLabel?.canvas).toBe("Pin here");
  });

  it("Zoom to selection is offered with shapes selected, and fits the map to them", () => {
    const { s, api, map } = session();
    const zoomTo = commandById("view.zoom-selection")!;
    expect(zoomTo.available(s)).toBe(false);

    api.updateScene({
      elements: [
        { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
      ] as never,
      appState: { selectedElementIds: { a: true } },
    });
    expect(zoomTo.available(s)).toBe(true);
    zoomTo.run(s);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("Convert selection to data layer is offered for one shape with a place on the map", () => {
    const { s, api } = session();
    const convert = commandById("edit.convert-to-layer")!;
    expect(convert.contexts).toContain("element");
    expect(convert.available(s)).toBe(false);
    api.updateScene({
      elements: [
        { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
      ] as never,
      appState: { selectedElementIds: { r: true } },
    });
    expect(convert.available(s)).toBe(true);
  });

  it("Edit pin details is in the pin's menu", () => {
    expect(commandById("tools.pin-details")!.contexts).toEqual(["pin"]);
  });

  it("the snap and binding toggles flip the drawing's setting and read as checked", () => {
    const { s, api } = session();
    const state = () => api.getAppState() as unknown as Record<string, unknown>;
    api.updateScene({
      appState: {
        objectsSnapModeEnabled: false,
        gridModeEnabled: true,
        bindingPreference: "enabled",
        isBindingEnabled: true,
        isMidpointSnappingEnabled: true,
      },
    });

    const snap = commandById("edit.snap-objects")!;
    snap.run(s);
    expect(state()).toMatchObject({
      objectsSnapModeEnabled: true,
      gridModeEnabled: false,
    });
    expect(snap.checked?.(s)).toBe(true);

    const binding = commandById("edit.arrow-binding")!;
    expect(binding.checked?.(s)).toBe(true);
    binding.run(s);
    expect(state()).toMatchObject({
      bindingPreference: "disabled",
      isBindingEnabled: false,
    });
    expect(binding.checked?.(s)).toBe(false);

    const midpoints = commandById("edit.snap-midpoints")!;
    midpoints.run(s);
    expect(state()).toMatchObject({ isMidpointSnappingEnabled: false });
    expect(midpoints.checked?.(s)).toBe(false);
  });

  it("Show attribute table opens the selected data layer's table, or from the feature menu the layer under the pointer", () => {
    const { s } = session();
    addParcels("dl:a");
    addParcels("dl:b");
    s.view
      .getState()
      .setMap(
        pointingMap({ "dl:b": { name: "south" } }) as unknown as maplibregl.Map,
      );
    const table = commandById("layer.table")!;
    expect(table.available(s)).toBe(false);

    s.view.getState().select("dl:a");
    expect(table.available(s)).toBe(true);
    table.run(s);
    expect(s.view.getState().dialog).toEqual({
      kind: "attribute-table",
      layerId: "dl:a",
    });

    expect(table.appliesAt?.(s, at("feature"))).toBe(true);
    table.run(s, at("feature"));
    expect(s.view.getState().dialog).toEqual({
      kind: "attribute-table",
      layerId: "dl:b",
    });
  });

  it("from the feature menu, Zoom to selection is Zoom to feature: it fits the map to the one feature under the pointer", () => {
    const { s } = session();
    addParcels();
    const map = pointingMap({ "dl:parcels": { name: "south" } });
    s.view.getState().setMap(map as unknown as maplibregl.Map);
    const zoomTo = commandById("view.zoom-selection")!;
    expect(zoomTo.menuLabel?.feature).toBe("Zoom to feature");

    expect(zoomTo.appliesAt?.(s, at("feature"))).toBe(true);
    zoomTo.run(s, at("feature"));
    expect(map.fitBounds.mock.calls[0][0]).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });

  it("Zoom to feature is not offered when two features carry the same properties", () => {
    const { s } = session();
    addParcels();
    s.view
      .getState()
      .setMap(pointingMap({ "dl:parcels": {} }) as unknown as maplibregl.Map);
    useDocumentStore.getState().doc.dispatch({
      type: "add-data-layer",
      id: "dl:blank",
      label: "Blank",
      style: { fillColor: "#336699" } as never,
      fc: {
        type: "FeatureCollection",
        features: [0, 1].map((i) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [i, i] },
        })),
      },
    });
    s.view
      .getState()
      .setMap(pointingMap({ "dl:blank": {} }) as unknown as maplibregl.Map);
    expect(
      commandById("view.zoom-selection")!.appliesAt?.(s, at("feature")),
    ).toBe(false);
  });
});
