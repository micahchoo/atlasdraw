// SPDX-License-Identifier: AGPL-3.0-only
//
// MapEditor keyboard shortcuts: Cmd+K quick actions, Cmd+S/Cmd+O document
// save/open, `?` for the shortcuts panel, bare `c` for comment mode, Escape
// to close the panel or leave comment mode, and the zoom keys when focus is
// outside the drawing. See the `c` handler for the audit that cleared the key.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ZoomAction } from "@atlasdraw/excalidraw/types";

import {
  isCommentModeActive,
  setCommentMode,
  toggleCommentMode,
} from "../state/commentMode";

import type { Dispatch, SetStateAction } from "react";

/**
 * True when the event came from somewhere the user is typing, so a bare-letter
 * shortcut must not fire. Covers Excalidraw's own text editor (a textarea),
 * the comment composers, and any contenteditable a future surface introduces.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) {
    return false;
  }
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

export interface MapEditorKeyboardParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  showShortcuts: boolean;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setShowQuickActions: Dispatch<SetStateAction<boolean>>;
  /** saveAtlasDocument, injected so this hook doesn't import MapEditor.tsx. */
  onSave: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
  /** openAtlasDocument, injected so this hook doesn't import MapEditor.tsx. */
  onOpen: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
  /** The map's zoom: the same handler Excalidraw's zoom actions call. */
  onZoomAction: (action: ZoomAction) => boolean;
  /** The element that holds Excalidraw; null until it mounts. */
  drawingLayer: HTMLElement | null;
}

/** Ctrl/Cmd + key → zoom action, by `KeyboardEvent.code`. */
const ZOOM_KEYS: Readonly<Record<string, ZoomAction>> = {
  Equal: { type: "zoomIn" },
  NumpadAdd: { type: "zoomIn" },
  Minus: { type: "zoomOut" },
  NumpadSubtract: { type: "zoomOut" },
  Digit0: { type: "resetZoom" },
  Numpad0: { type: "resetZoom" },
};

export function useMapEditorKeyboard({
  excalidrawAPI,
  showShortcuts,
  setShowShortcuts,
  setShowQuickActions,
  onSave,
  onOpen,
  onZoomAction,
  drawingLayer,
}: MapEditorKeyboardParams): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Zoom keys. With focus in the drawing, Excalidraw's zoom actions take
      // them (and call onZoomAction); this catches them with focus on the
      // map or the frame, where the browser would zoom the page instead.
      const zoom = ZOOM_KEYS[e.code];
      if (
        zoom &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.defaultPrevented &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        onZoomAction(zoom);
        return;
      }
      // Quick-actions: Cmd+K or Ctrl+K.
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setShowQuickActions((prev) => !prev);
        return;
      }
      // Atlas document save/open — Cmd+S / Cmd+O. Excalidraw's own
      // equivalents are disabled (EXCALIDRAW_UI_OPTIONS), so these don't
      // double-fire. preventDefault stops the browser save/open dialogs.
      if (
        e.key.toLowerCase() === "s" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        onSave(excalidrawAPI);
        return;
      }
      if (
        e.key.toLowerCase() === "o" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        onOpen(excalidrawAPI);
        return;
      }
      // Keyboard shortcuts: bare `?`.
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      // Step 5 — comment mode on bare `c`.
      //
      // KEYBINDING AUDIT (system.md:43 keeps the interaction model
      // Excalidraw's, so the key had to be shown free before taking it).
      // Everything Excalidraw binds involving C, exhaustively:
      //   packages/excalidraw/components/shapes.tsx  — the tool table binds
      //     h v r d o a l p x t e k and digits 0-9. No `c`, and no `image`
      //     key either. `findShapeByKey("c")` returns null.
      //   actions/actionStyles.ts:66                 — Ctrl/Cmd+Alt+C, copyStyles
      //   actions/actionClipboard.tsx:251            — Alt+Shift+C, copyAsPng
      //   actions/actionClipboard.tsx (copy)         — keyTest undefined; Ctrl+C
      //     rides the browser's native `copy` event, not a keyTest.
      // `KEYS.C` / `CODES.C` have no other consumer in packages/ or apps/.
      // So bare `c` AND `Shift+C` were both unbound. Taking the bare key, per
      // the Felt / Figma / FigJam precedent in the design doc; the modifier
      // combinations above are untouched, which is why every branch below
      // requires no ctrl/meta/alt/shift.
      //
      // `!e.repeat` for the same reason the Space tracker has it: auto-repeat
      // fires ~30×/s while the key is held, and this branch is a TOGGLE, so
      // every odd flip would tear down an open draft (the exit path calls
      // clearAnchorPicker) and the resting state would come down to repeat
      // parity. Held `c` must mean one entry, like every other toggle.
      if (
        e.key.toLowerCase() === "c" &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        toggleCommentMode();
        return;
      }
      if (e.key === "Escape") {
        closeAtlasState();
      }
    };
    // Excalidraw takes Escape at the React root when any tool but selection
    // is active (actionDeselect) and stops it there, so the window listener
    // never hears it with focus in the drawing. A capture listener on the
    // drawing's own element runs first. It runs after a dropdown's document
    // capture listener, so an open menu still closes before the mode does.
    const onDrawingEscape = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !isTypingTarget(e.target) &&
        closeAtlasState()
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const closeAtlasState = (): boolean => {
      if (showShortcuts) {
        setShowShortcuts(false);
        return true;
      }
      // Leaving comment mode restores the atlas tool it dropped (see
      // useCommentModeTool's cleanup). The Excalidraw tool is never touched.
      if (isCommentModeActive()) {
        setCommentMode(false);
        return true;
      }
      return false;
    };
    window.addEventListener("keydown", onKeyDown);
    drawingLayer?.addEventListener("keydown", onDrawingEscape, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      drawingLayer?.removeEventListener("keydown", onDrawingEscape, true);
    };
  }, [
    drawingLayer,
    showShortcuts,
    excalidrawAPI,
    setShowShortcuts,
    setShowQuickActions,
    onSave,
    onOpen,
    onZoomAction,
  ]);
}
