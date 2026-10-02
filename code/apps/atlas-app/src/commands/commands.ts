// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's commands: one list that the main menu, the ⌘K palette, the
// keys (useCommandKeys), the shortcuts panel and the right-click menus
// (contextMenus.ts) all read. A command that is in one of them is in this
// list, so they cannot disagree.
//
// A key here belongs to the editor shell, and useCommandKeys takes it before
// the drawing sees it. The keys the drawing keeps (its tools, undo, copy)
// are EDITOR_KEYS: the shortcuts panel lists them, and no command may take
// one (commands.test.ts).

import { CaptureUpdateAction, newElementWith } from "@atlasdraw/element";
import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  isDarwin,
} from "@atlasdraw/common";
import { PinTool } from "@atlasdraw/tools";

import type { AppState, ZoomAction } from "@atlasdraw/excalidraw/types";

import { zoomActionOnMap } from "../hooks/useCameraBridge";
import { buildToolContext } from "../hooks/useAtlasdrawTool";
import { featureAt, matchingFeature, type FeatureHit } from "../lib/featureHit";
import {
  computeFeatureCollectionBounds,
  fitMapToBox,
} from "../lib/fitMapToContent";
import { pickFile } from "../lib/pickFile";
import {
  convertibleSelection,
  convertSelection,
} from "../session/convertToLayer";
import { openMap, saveMap } from "../session/fileActions";
import { selectedPin } from "../state/pinDetails";

import { keyLabels, keyText, type KeyBinding } from "./keys";

import type { EditorSession } from "../session/EditorSession";

export type CommandGroup = "File" | "Edit" | "Tools" | "View" | "Help";

/**
 * A right-click menu, named by what the click landed on: empty canvas, a
 * shape, a pin, or a feature of a data layer (the canvas menu over one).
 */
export type MenuContext = "canvas" | "element" | "pin" | "feature";

/** The menu a command runs from, and where it opened, in viewport pixels. */
export interface MenuTarget {
  readonly context: MenuContext;
  readonly clientX: number;
  readonly clientY: number;
}

export interface Command {
  readonly id: string;
  /** What the user reads in the menu, the palette and the shortcuts panel. */
  readonly label: string;
  readonly group: CommandGroup;
  readonly keys?: readonly KeyBinding[];
  /** More words the palette search finds the command by. */
  readonly keywords?: readonly string[];
  /**
   * The right-click menus that list the command. The palette lists every
   * command, so each of these is in the palette too (contextMenus.test.ts).
   */
  readonly contexts?: readonly MenuContext[];
  /** The label in one menu, when the command acts at the click there. */
  readonly menuLabel?: Partial<Record<MenuContext, string>>;
  /** False hides the command and turns its key off. */
  available(s: EditorSession): boolean;
  /**
   * In a right-click menu: true when the command applies to what is under
   * the click. Without it, the menu asks `available`.
   */
  appliesAt?(s: EditorSession, at: MenuTarget): boolean;
  /** A setting the command turns on and off: true shows a check mark. */
  checked?(s: EditorSession): boolean;
  /**
   * `at` is set when a right-click menu runs the command: it acts at that
   * point or on what is under it. The palette, a key and the main menu give
   * none, and the command acts on the selection.
   */
  run(s: EditorSession, at?: MenuTarget): void;
}

const always = () => true;
const hasDrawing = (s: EditorSession) => s.view.getState().api !== null;
const hasMap = (s: EditorSession) => s.view.getState().map !== null;

function openTab(s: EditorSession, tab: string): void {
  s.view.getState().api?.toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab });
}

function zoom(s: EditorSession, action: ZoomAction): void {
  const { map, api } = s.view.getState();
  if (map) {
    zoomActionOnMap(map, action, () => api?.getSceneElements() ?? []);
  }
}

/** The selected shapes, or none. */
function selectedShapes(s: EditorSession) {
  const api = s.view.getState().api;
  if (!api) {
    return [];
  }
  const ids = api.getAppState().selectedElementIds ?? {};
  return api.getSceneElements().filter((e) => ids[e.id]);
}

/** The one selected layer, when it is a data layer. */
function selectedDataLayer(s: EditorSession): string | null {
  const ids = Object.keys(s.view.getState().selection);
  const overlays = s.store.getState().doc.snapshot().overlays;
  const entry =
    ids.length === 1 ? overlays.find((e) => e.id === ids[0]) : undefined;
  return entry?.kind === "data" ? entry.id : null;
}

/** The feature of the topmost data layer under a menu's point, or null. */
function featureUnder(s: EditorSession, at: MenuTarget): FeatureHit | null {
  const map = s.view.getState().map;
  if (!map) {
    return null;
  }
  const rect = map.getCanvas().getBoundingClientRect();
  const point: [number, number] = [
    at.clientX - rect.left,
    at.clientY - rect.top,
  ];
  return featureAt(map, s.store.getState().doc.snapshot().overlays, point);
}

/**
 * The bounds of the one feature under a menu's point. Null when the click
 * is on no feature, or its layer holds another feature that MapLibre reports
 * the same way, so the hit cannot name one feature (lib/featureHit.ts).
 */
function featureBoundsUnder(s: EditorSession, at: MenuTarget) {
  const hit = featureUnder(s, at);
  const fc = hit
    ? s.store.getState().doc.snapshot().featureCollections[hit.overlayId]
    : undefined;
  const feature = hit && fc ? matchingFeature(fc, hit) : null;
  return feature
    ? computeFeatureCollectionBounds({
        type: "FeatureCollection",
        features: [feature],
      })
    : null;
}

/** Flip one of the drawing's settings, outside its history. */
function setDrawing(
  s: EditorSession,
  next: (appState: AppState) => Partial<AppState>,
): void {
  const api = s.view.getState().api;
  if (api) {
    api.updateScene({
      appState: next(api.getAppState()) as AppState,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
}

const drawingState = (s: EditorSession): AppState | null =>
  s.view.getState().api?.getAppState() ?? null;

/** Every format the import pipeline reads, for the file picker. */
const IMPORT_ACCEPT =
  ".geojson,.json,.csv,.zip,.kml,.kmz,.gpx,.tif,.tiff,.geotiff";

async function importData(s: EditorSession): Promise<void> {
  const file = await pickFile(IMPORT_ACCEPT);
  if (file) {
    s.view.getState().importFile?.(file);
  }
}

/** Delete every shape, as one step that undo takes back. Layers stay. */
async function clearDrawing(s: EditorSession): Promise<void> {
  const yes = await s.view.getState().ask({
    title: "Clear the drawing?",
    body: "Every shape on the map is deleted. The layers stay. Undo brings the shapes back.",
    confirmLabel: "Clear the drawing",
  });
  const api = s.view.getState().api;
  if (!yes || !api) {
    return;
  }
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (e.isDeleted ? e : newElementWith(e, { isDeleted: true }))),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

export const COMMANDS: readonly Command[] = [
  // --- File ---
  {
    id: "file.open",
    label: "Open map…",
    group: "File",
    keys: [{ key: "o", mod: true, whileTyping: true }],
    keywords: ["load", "file", "atlasdraw", "excalidraw"],
    available: hasDrawing,
    run: (s) => void openMap(s),
  },
  {
    id: "file.save",
    label: "Save map",
    group: "File",
    keys: [{ key: "s", mod: true, whileTyping: true }],
    keywords: ["disk", "file", "atlasdraw", "download"],
    available: hasDrawing,
    run: (s) => void saveMap(s, s.notify),
  },
  {
    id: "file.my-maps",
    label: "My maps…",
    group: "File",
    keywords: ["list", "recent", "new", "delete", "documents"],
    available: hasDrawing,
    run: (s) => s.view.getState().openDialog({ kind: "my-maps" }),
  },
  {
    id: "file.server-versions",
    label: "Server versions…",
    group: "File",
    keywords: ["server", "backup", "restore", "history", "revision"],
    available: (s) => hasDrawing(s) && s.view.getState().backupAvailable,
    run: (s) => s.view.getState().openDialog({ kind: "server-versions" }),
  },
  {
    id: "file.import",
    label: "Import data…",
    group: "File",
    keywords: ["geojson", "csv", "shapefile", "kml", "gpx", "geotiff"],
    contexts: ["canvas"],
    available: always,
    run: (s) => void importData(s),
  },
  {
    id: "file.export",
    label: "Export…",
    group: "File",
    keywords: ["png", "image", "geojson", "download"],
    available: hasDrawing,
    run: (s) => s.view.getState().openDialog({ kind: "export", format: "png" }),
  },
  {
    id: "file.export-pdf",
    label: "Export PDF…",
    group: "File",
    keywords: ["print", "document"],
    available: hasDrawing,
    run: (s) => s.view.getState().openDialog({ kind: "export", format: "pdf" }),
  },
  {
    id: "file.share",
    label: "Share map…",
    group: "File",
    keywords: ["link", "collaborate", "invite", "embed"],
    available: hasDrawing,
    run: (s) => s.view.getState().openDialog({ kind: "share" }),
  },

  // --- Edit ---
  // Their keys (Ctrl+Z, Ctrl+Shift+Z) are the drawing's (EDITOR_KEYS); the
  // drawing sends them to the same history (MapEditor's historyHost).
  {
    id: "edit.undo",
    label: "Undo",
    group: "Edit",
    keywords: ["back", "revert"],
    available: hasDrawing,
    run: (s) => s.history.undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    group: "Edit",
    keywords: ["again", "forward"],
    available: hasDrawing,
    run: (s) => s.history.redo(),
  },
  {
    id: "edit.clear",
    label: "Clear the drawing…",
    group: "Edit",
    keywords: ["delete", "reset", "erase", "shapes"],
    available: hasDrawing,
    run: (s) => void clearDrawing(s),
  },
  {
    id: "edit.convert-to-layer",
    label: "Convert selection to data layer",
    group: "Edit",
    keywords: ["data", "layer", "feature", "geojson", "annotation"],
    contexts: ["element"],
    available: (s) => convertibleSelection(s) !== null,
    run: (s) => convertSelection(s),
  },
  // The drawing's own settings that work over a map, measured in a browser
  // (.claude/rules/menus.md). The drawing keeps their keys.
  {
    id: "edit.snap-objects",
    label: "Snap to objects",
    group: "Edit",
    keywords: ["align", "magnet", "guides"],
    contexts: ["canvas"],
    available: hasDrawing,
    checked: (s) => drawingState(s)?.objectsSnapModeEnabled === true,
    // As the drawing's own toggle: object snapping turns the grid off.
    run: (s) =>
      setDrawing(s, (a) => ({
        objectsSnapModeEnabled: !a.objectsSnapModeEnabled,
        gridModeEnabled: false,
      })),
  },
  {
    id: "edit.arrow-binding",
    label: "Arrow binding",
    group: "Edit",
    keywords: ["connect", "attach", "arrow", "bind"],
    contexts: ["canvas"],
    available: hasDrawing,
    checked: (s) => drawingState(s)?.bindingPreference === "enabled",
    run: (s) =>
      setDrawing(s, (a) => {
        const on = a.bindingPreference !== "enabled";
        return {
          bindingPreference: on ? "enabled" : "disabled",
          isBindingEnabled: on,
        };
      }),
  },
  {
    id: "edit.snap-midpoints",
    label: "Snap to midpoints",
    group: "Edit",
    keywords: ["arrow", "bind", "middle", "edge"],
    contexts: ["canvas"],
    available: hasDrawing,
    checked: (s) => drawingState(s)?.isMidpointSnappingEnabled === true,
    run: (s) =>
      setDrawing(s, (a) => ({
        isMidpointSnappingEnabled: !a.isMidpointSnappingEnabled,
      })),
  },

  // --- Tools ---
  {
    id: "tools.pin",
    label: "Pin to map",
    group: "Tools",
    keywords: ["marker", "point"],
    contexts: ["canvas"],
    // A pin is one click: the menu places it where the menu opened, as the
    // armed tool places it where the next click lands.
    menuLabel: { canvas: "Pin here" },
    available: hasMap,
    run: (s, at) => {
      const { atlasTool, setAtlasTool, map, api } = s.view.getState();
      if (at && map && api) {
        PinTool.onPointerDown(
          {
            clientX: at.clientX,
            clientY: at.clientY,
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
          },
          buildToolContext(
            map,
            api,
            () => s.store.getState().doc.snapshot().world,
          ),
        );
        return;
      }
      setAtlasTool(atlasTool?.id === PinTool.id ? null : PinTool);
    },
  },
  {
    id: "tools.pin-details",
    label: "Edit pin details…",
    group: "Tools",
    keywords: ["pin", "title", "description", "link", "photo", "note"],
    contexts: ["pin"],
    available: (s) => {
      const api = s.view.getState().api;
      return api !== null && selectedPin(api) !== null;
    },
    run: (s) => {
      const api = s.view.getState().api;
      const pin = api ? selectedPin(api) : null;
      if (pin) {
        s.view.getState().openDialog({ kind: "pin-details", pinId: pin.id });
      }
    },
  },
  {
    id: "tools.measure",
    label: "Measure distance",
    group: "Tools",
    keys: [{ key: "m" }],
    keywords: ["ruler", "length", "area", "distance"],
    // It arms the tool. The path lives in MeasureLayer, so a menu cannot
    // start it at the click.
    contexts: ["canvas"],
    available: always,
    run: (s) => s.view.getState().toggleMeasuring(),
  },
  {
    id: "tools.comment",
    label: "Comment mode",
    group: "Tools",
    keys: [{ key: "c" }],
    keywords: ["comment", "threads", "annotate", "review"],
    // It arms the mode; the next click on the shape anchors the thread.
    contexts: ["element"],
    available: always,
    run: (s) => s.view.getState().toggleCommentMode(),
  },

  // --- View ---
  {
    id: "view.layers",
    label: "Layers panel",
    group: "View",
    keywords: ["sidebar", "data", "basemap"],
    contexts: ["canvas"],
    available: hasDrawing,
    run: (s) => openTab(s, "layers"),
  },
  {
    id: "layer.table",
    label: "Show attribute table",
    group: "View",
    keywords: ["attributes", "properties", "rows", "data", "features"],
    contexts: ["feature"],
    available: (s) => selectedDataLayer(s) !== null,
    appliesAt: (s, at) => featureUnder(s, at) !== null,
    run: (s, at) => {
      const layerId = at
        ? featureUnder(s, at)?.overlayId
        : selectedDataLayer(s);
      if (layerId) {
        s.view.getState().openDialog({ kind: "attribute-table", layerId });
      }
    },
  },
  {
    id: "view.find",
    label: "Find on the drawing",
    group: "View",
    keywords: ["search", "text", "sidebar"],
    available: hasDrawing,
    run: (s) => openTab(s, CANVAS_SEARCH_TAB),
  },
  {
    id: "view.asset-library",
    label: "Asset library",
    group: "View",
    keywords: ["stamps", "symbols", "wildfire", "transit"],
    available: hasDrawing,
    run: (s) => s.view.getState().openDialog({ kind: "asset-library" }),
  },
  {
    id: "view.zoom-in",
    label: "Zoom in",
    group: "View",
    keys: [
      {
        key: "+",
        mod: true,
        codes: ["Equal", "NumpadAdd"],
        repeat: true,
      },
    ],
    contexts: ["canvas"],
    available: hasMap,
    run: (s) => zoom(s, { type: "zoomIn" }),
  },
  {
    id: "view.zoom-out",
    label: "Zoom out",
    group: "View",
    keys: [
      {
        key: "-",
        mod: true,
        codes: ["Minus", "NumpadSubtract"],
        repeat: true,
      },
    ],
    contexts: ["canvas"],
    available: hasMap,
    run: (s) => zoom(s, { type: "zoomOut" }),
  },
  {
    id: "view.zoom-drawing",
    label: "Zoom to the drawing",
    group: "View",
    keys: [{ key: "0", mod: true, codes: ["Digit0", "Numpad0"] }],
    keywords: ["fit", "reset", "content"],
    available: hasMap,
    run: (s) => zoom(s, { type: "resetZoom" }),
  },
  {
    id: "view.zoom-selection",
    label: "Zoom to selection",
    group: "View",
    keywords: ["fit", "shapes", "feature", "frame"],
    contexts: ["element", "feature"],
    // Over a feature, the feature is what the click selects.
    menuLabel: { feature: "Zoom to feature" },
    available: (s) => hasMap(s) && selectedShapes(s).length > 0,
    appliesAt: (s, at) =>
      at.context === "feature"
        ? featureBoundsUnder(s, at) !== null
        : hasMap(s) && selectedShapes(s).length > 0,
    run: (s, at) => {
      if (at?.context === "feature") {
        const box = featureBoundsUnder(s, at);
        if (box) {
          fitMapToBox(s.view.getState().map, box);
        }
        return;
      }
      zoom(s, {
        type: "zoomToFit",
        elements: selectedShapes(s),
        inViewport: false,
      });
    },
  },
  {
    id: "view.theme",
    label: "Dark or light theme",
    group: "View",
    keywords: ["dark", "light", "night", "colour", "color"],
    available: hasDrawing,
    run: (s) => {
      const api = s.view.getState().api;
      if (api) {
        api.updateScene({
          appState: {
            theme: api.getAppState().theme === "dark" ? "light" : "dark",
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    },
  },

  // --- Help and the shell ---
  {
    id: "app.palette",
    label: "Command palette",
    group: "Help",
    keys: [{ key: "k", mod: true, whileTyping: true }],
    available: always,
    run: (s) => s.view.getState().toggleDialog("palette"),
  },
  {
    id: "app.settings",
    label: "Settings…",
    group: "Help",
    keywords: ["storage", "server", "collaboration"],
    available: always,
    run: (s) => s.view.getState().openDialog({ kind: "settings" }),
  },
  {
    id: "help.shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    keys: [{ key: "?" }],
    keywords: ["keys", "hotkeys", "help"],
    available: always,
    run: (s) => s.view.getState().toggleDialog("shortcuts"),
  },
  {
    id: "help.about",
    label: "About Atlasdraw",
    group: "Help",
    keywords: ["version", "license"],
    available: always,
    run: (s) => s.view.getState().openDialog({ kind: "about" }),
  },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandById(id: string): Command | undefined {
  return BY_ID.get(id);
}

/** The main menu, top to bottom. "---" is a separator. */
export const MAIN_MENU: readonly string[] = [
  "file.open",
  "file.save",
  "file.my-maps",
  "file.server-versions",
  "file.import",
  "file.export",
  "file.share",
  "---",
  "edit.undo",
  "edit.redo",
  "edit.clear",
  "---",
  "app.settings",
  "help.shortcuts",
  "help.about",
  "view.theme",
];

/** The palette's key as this platform shows it: "Ctrl+K", or "⌘K" on macOS. */
export function paletteKeyText(mac?: boolean): string {
  const binding = commandById("app.palette")?.keys?.[0];
  return binding ? keyText(binding, mac) : "";
}

/** What the palette offers now: every available command but itself. */
export function paletteCommands(s: EditorSession): Command[] {
  return COMMANDS.filter((c) => c.id !== "app.palette" && c.available(s));
}

/** A key the drawing editor or the map keeps, listed for the user. */
export interface EditorKey {
  /** The keys or gestures to show, one label each. */
  keys: readonly string[];
  label: string;
  group: "Map" | "Drawing" | "Editing";
  /** The binding, when it is a key and not a gesture. */
  binding?: KeyBinding;
}

/** A key the drawing keeps, shown as this platform types it. */
const bound = (
  binding: KeyBinding,
  label: string,
  group: EditorKey["group"],
): EditorKey => ({ keys: keyLabels(binding), label, group, binding });

const digit = (n: string, label: string): EditorKey => ({
  keys: [n],
  label,
  group: "Drawing",
  binding: { key: n },
});

/**
 * The drawing editor's own keys (packages/excalidraw/components/shapes.tsx
 * and its actions) and the map's gestures.
 */
export const EDITOR_KEYS: readonly EditorKey[] = [
  { keys: ["Drag"], label: "Select shapes in a box", group: "Map" },
  { keys: ["Space", "Drag"], label: "Pan the map", group: "Map" },
  {
    keys: ["H"],
    label: "Hand tool: a drag pans the map",
    group: "Map",
    binding: { key: "h" },
  },
  { keys: ["Scroll"], label: "Zoom in or out", group: "Map" },
  { keys: ["Shift", "Drag"], label: "Box zoom (hand tool)", group: "Map" },
  digit("1", "Selection tool"),
  digit("2", "Rectangle"),
  digit("3", "Diamond"),
  digit("4", "Ellipse"),
  digit("5", "Arrow"),
  digit("6", "Line"),
  digit("7", "Free draw"),
  digit("8", "Text"),
  digit("9", "Insert image"),
  digit("0", "Eraser (or E)"),
  {
    keys: ["Delete"],
    label: "Delete the selection",
    group: "Editing",
    binding: { key: "Delete" },
  },
  bound({ key: "z", mod: true }, "Undo", "Editing"),
  bound({ key: "z", mod: true, shift: true }, "Redo", "Editing"),
  bound({ key: "c", mod: true }, "Copy", "Editing"),
  bound({ key: "v", mod: true }, "Paste", "Editing"),
  bound({ key: "d", mod: true }, "Duplicate the selection", "Editing"),
  bound({ key: "f", mod: true }, "Find on the drawing", "Editing"),
  {
    keys: ["Escape"],
    label: "Leave the active tool or mode",
    group: "Editing",
    binding: { key: "Escape" },
  },
];

/** One row of the shortcuts panel. */
export interface ShortcutRow {
  group: string;
  label: string;
  keys: readonly string[];
}

/** The order of the panel's groups. */
export const SHORTCUT_GROUPS: readonly string[] = [
  "Map",
  "Drawing",
  "Editing",
  "Edit",
  "Tools",
  "File",
  "View",
  "Help",
];

/**
 * Every key the editor answers: the drawing's own, then each command's. A
 * key is shown as the platform types it (`mac`: ⌘ for the modifier).
 */
export function shortcutRows(mac: boolean = isDarwin): ShortcutRow[] {
  return [
    ...EDITOR_KEYS.map((k) => ({
      group: k.group,
      label: k.label,
      keys: k.binding ? keyLabels(k.binding, mac) : k.keys,
    })),
    ...COMMANDS.flatMap((c) =>
      (c.keys ?? []).map((b) => ({
        group: c.group,
        label: c.label,
        keys: keyLabels(b, mac),
      })),
    ),
  ];
}
