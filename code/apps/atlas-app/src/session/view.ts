// SPDX-License-Identifier: AGPL-3.0-only
//
// The view state of one editor: what the editor shows and holds open, as
// opposed to the document it shows. One store per session, so two editors
// (or two tests) never share it.
//
// `map` and `api` are the two handles the editor's views mount: null until
// they mount, null again after. Code that is not a React component reads them
// here, at the moment it needs them, instead of from a module store.
//
// The rest is what several views must agree about: the comment mode (the
// toolbar, the keys, the anchor overlay, the plate's hint), the Measure tool
// (the toolbar, the palette, the `m` key, the measure layer), the atlas tool
// (the Pin button, the palette, the tool overlay), the layer selection (the
// Layers panel and the drawing) and the one dialog that is open (the menu,
// the palette and the keys open them; EditorDialogs shows it).

import { createStore, type StoreApi } from "zustand/vanilla";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  clampRightSidebarWidth,
} from "@atlasdraw/common";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { AtlasdrawTool, UnitSystem } from "@atlasdraw/tools";

import { loadUnitSystem, saveUnitSystem } from "../state/measure";

import { focusOrigin } from "./focusReturn";

import type { ExportFormat } from "../components/ExportDialog";
import type maplibregl from "maplibre-gl";

/** A yes-or-no question, in the user's words. */
export interface Question {
  title: string;
  body: string;
  confirmLabel: string;
  /** The other answer; "Cancel" when unset. Escape gives it too. */
  cancelLabel?: string;
  /** "destructive": the confirm button is red. */
  tone?: "default" | "destructive";
}

/** A dialog that needs nothing but its name. */
export type SimpleDialog =
  | "palette"
  | "shortcuts"
  | "about"
  | "settings"
  | "share"
  | "my-maps"
  | "server-versions"
  | "asset-library"
  | "onboarding";

/**
 * The editor's dialogs. Only one is open at a time. A question that loses
 * the slot (another dialog opens, or the slot closes) is answered no, so the
 * code that asked it never waits forever.
 */
export type Dialog =
  | { kind: SimpleDialog }
  | { kind: "export"; format: ExportFormat }
  | ({ kind: "confirm"; answer(yes: boolean): void } & Question);

export const SHEET_PANEL_WIDTH_KEY = "atlasdraw:sheet-panel:width";

/**
 * The stored sheet-panel width, or the default. A stored value goes through
 * the same clamp as a drag: a value from an older MIN/MAX is as untrusted as
 * a pointer event.
 */
export function loadSheetPanelWidth(): number {
  try {
    const raw = localStorage.getItem(SHEET_PANEL_WIDTH_KEY);
    return raw === null
      ? RIGHT_SIDEBAR_DEFAULT_WIDTH
      : clampRightSidebarWidth(Number.parseInt(raw, 10));
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSheetPanelWidth(width: number): void {
  try {
    localStorage.setItem(SHEET_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable: the width applies for this session only.
  }
}

export interface ViewState {
  /** The MapLibre map; null until it loads. */
  map: maplibregl.Map | null;
  /** The Excalidraw API; null until the drawing mounts. */
  api: ExcalidrawImperativeAPI | null;
  /** The sheet panel's width in px, always within the editor's limits. */
  sheetPanelWidth: number;
  /** True while a click on the map starts a comment thread. */
  commentMode: boolean;
  /** True while the Measure tool is on. */
  measuring: boolean;
  /** The units every measurement is shown in. */
  units: UnitSystem;
  /**
   * The selected layers, as Excalidraw keeps selected elements. An
   * annotation id is an element id; a data, raster or tile layer id is not
   * (state/selectedLayer.ts#isOverlayId).
   */
  selection: Readonly<Record<string, true>>;
  /** The atlas tool that takes the next click on the map (the Pin), or null. */
  atlasTool: AtlasdrawTool | null;
  /** The open dialog, or null. */
  dialog: Dialog | null;
  /**
   * Where focus goes back to when the dialog closes: what had focus when it
   * opened (session/focusReturn.ts). Null when nothing had.
   */
  returnFocus: Element | null;
  /** The canvas colour chosen in the drawing's menu, shown behind the map. */
  mapBackground: string;
  /** True when this browser holds a server backup of the open map. */
  backupAvailable: boolean;
  /**
   * Import one data file into the open map. The editor's import pipeline
   * (useDataFileImport) sets it; null until the editor mounts.
   */
  importFile: ((file: File) => void) | null;
  setMap(map: maplibregl.Map | null): void;
  setApi(api: ExcalidrawImperativeAPI | null): void;
  /** Set the width (clamped) and keep it in this browser. */
  setSheetPanelWidth(width: number): void;
  resetSheetPanelWidth(): void;
  setCommentMode(on: boolean): void;
  toggleCommentMode(): void;
  setMeasuring(on: boolean): void;
  toggleMeasuring(): void;
  /** Switch metric and imperial, and keep the choice in this browser. */
  toggleUnits(): void;
  setSelection(ids: Readonly<Record<string, true>>): void;
  /** Select exactly this one layer. */
  select(id: string): void;
  clearSelection(): void;
  setAtlasTool(tool: AtlasdrawTool | null): void;
  /** Open `dialog` in the slot; an open question is answered no. */
  openDialog(dialog: Dialog): void;
  /** Open the dialog when another (or none) is open; close it when it is. */
  toggleDialog(kind: SimpleDialog): void;
  /** Close the slot; an open question is answered no. */
  closeDialog(): void;
  /**
   * Show `question` and resolve with the answer: false when the user cancels
   * or another dialog takes the slot.
   */
  ask(question: Question): Promise<boolean>;
}

export type ViewStore = StoreApi<ViewState>;

/** Answer an open question no, before it leaves the slot. */
function answerNo(dialog: Dialog | null): void {
  if (dialog?.kind === "confirm") {
    dialog.answer(false);
  }
}

export function createViewStore(
  initial: { map?: maplibregl.Map | null } = {},
): ViewStore {
  return createStore<ViewState>()((set, get) => ({
    map: initial.map ?? null,
    api: null,
    sheetPanelWidth: loadSheetPanelWidth(),
    commentMode: false,
    measuring: false,
    units: loadUnitSystem(),
    selection: {},
    atlasTool: null,
    dialog: null,
    returnFocus: null,
    mapBackground: "transparent",
    backupAvailable: false,
    importFile: null,
    setMap: (map) => set({ map }),
    setApi: (api) => set({ api }),
    setSheetPanelWidth: (width) => {
      const next = clampRightSidebarWidth(width);
      set({ sheetPanelWidth: next });
      saveSheetPanelWidth(next);
    },
    resetSheetPanelWidth: () => {
      set({ sheetPanelWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH });
      saveSheetPanelWidth(RIGHT_SIDEBAR_DEFAULT_WIDTH);
    },
    setCommentMode: (on) => {
      if (get().commentMode !== on) {
        set({ commentMode: on });
      }
    },
    toggleCommentMode: () => set({ commentMode: !get().commentMode }),
    setMeasuring: (on) => {
      if (get().measuring !== on) {
        set({ measuring: on });
      }
    },
    toggleMeasuring: () => set({ measuring: !get().measuring }),
    toggleUnits: () => {
      const units = get().units === "metric" ? "imperial" : "metric";
      set({ units });
      saveUnitSystem(units);
    },
    setSelection: (ids) => set({ selection: ids }),
    select: (id) => set({ selection: { [id]: true } }),
    clearSelection: () => set({ selection: {} }),
    setAtlasTool: (tool) => set({ atlasTool: tool }),
    openDialog: (dialog) => {
      const returnFocus = focusOrigin(get().returnFocus);
      answerNo(get().dialog);
      set({ dialog, returnFocus });
    },
    toggleDialog: (kind) =>
      get().dialog?.kind === kind
        ? get().closeDialog()
        : get().openDialog({ kind }),
    closeDialog: () => {
      answerNo(get().dialog);
      set({ dialog: null });
    },
    ask: (question) =>
      new Promise<boolean>((resolve) => {
        let answered = false;
        const dialog: Dialog = {
          kind: "confirm",
          ...question,
          answer: (yes) => {
            if (answered) {
              return;
            }
            answered = true;
            // A replaced question closes nothing: the slot holds another.
            if (get().dialog === dialog) {
              set({ dialog: null });
            }
            resolve(yes);
          },
        };
        get().openDialog(dialog);
      }),
  }));
}
