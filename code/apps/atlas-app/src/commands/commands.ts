// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's commands: one list that the main menu, the ⌘K palette, the
// keys (useCommandKeys) and the shortcuts panel all read. A command that is
// in one of them is in this list, so the four cannot disagree.
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

import type { ZoomAction } from "@atlasdraw/excalidraw/types";

import { zoomActionOnMap } from "../hooks/useCameraBridge";
import { pickFile } from "../lib/pickFile";
import { openMap, restoreBackup, saveMap } from "../session/fileActions";
import { selectedPin } from "../state/pinDetails";

import { keyLabels, keyText, type KeyBinding } from "./keys";

import type { EditorSession } from "../session/EditorSession";

export type CommandGroup = "File" | "Edit" | "Tools" | "View" | "Help";

export interface Command {
  readonly id: string;
  /** What the user reads in the menu, the palette and the shortcuts panel. */
  readonly label: string;
  readonly group: CommandGroup;
  readonly keys?: readonly KeyBinding[];
  /** More words the palette search finds the command by. */
  readonly keywords?: readonly string[];
  /** False hides the command and turns its key off. */
  available(s: EditorSession): boolean;
  run(s: EditorSession): void;
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
    id: "file.restore-backup",
    label: "Restore from server backup",
    group: "File",
    keywords: ["server", "backup", "restore"],
    available: (s) => hasDrawing(s) && s.view.getState().backupAvailable,
    run: (s) => void restoreBackup(s),
  },
  {
    id: "file.import",
    label: "Import data…",
    group: "File",
    keywords: ["geojson", "csv", "shapefile", "kml", "gpx", "geotiff"],
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

  // --- Tools ---
  {
    id: "tools.pin",
    label: "Pin to map",
    group: "Tools",
    keywords: ["marker", "point"],
    available: hasMap,
    run: (s) => {
      const { atlasTool, setAtlasTool } = s.view.getState();
      setAtlasTool(atlasTool?.id === PinTool.id ? null : PinTool);
    },
  },
  {
    id: "tools.pin-details",
    label: "Edit pin details…",
    group: "Tools",
    keywords: ["pin", "title", "description", "link", "photo", "note"],
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
    available: always,
    run: (s) => s.view.getState().toggleMeasuring(),
  },
  {
    id: "tools.comment",
    label: "Comment mode",
    group: "Tools",
    keys: [{ key: "c" }],
    keywords: ["comment", "threads", "annotate", "review"],
    available: always,
    run: (s) => s.view.getState().toggleCommentMode(),
  },

  // --- View ---
  {
    id: "view.layers",
    label: "Layers panel",
    group: "View",
    keywords: ["sidebar", "data", "basemap"],
    available: hasDrawing,
    run: (s) => openTab(s, "layers"),
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
  "file.restore-backup",
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
