// SPDX-License-Identifier: AGPL-3.0-only
//
// MapEditor keyboard shortcuts: the space-held tracker (feeds the
// space+drag pan bridge in handleExcalidrawChange) and the main shortcut
// binding (Cmd+K quick actions, Cmd+S/Cmd+O document save/open, `?` for the
// shortcuts panel, Escape to dismiss it).
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 4).
// `spaceHeldRef` stays owned by MapEditor and is passed in — it's also read
// by handleExcalidrawChange (Cut 5 territory), so the ref can't move here
// without threading it back out. No test covered either binding directly
// before this extraction; new useMapEditorKeyboard.test.ts adds
// characterization coverage for both.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { Dispatch, RefObject, SetStateAction } from "react";

export interface MapEditorKeyboardParams {
  spaceHeldRef: RefObject<boolean>;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  showShortcuts: boolean;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setShowQuickActions: Dispatch<SetStateAction<boolean>>;
  /** saveAtlasDocument, injected so this hook doesn't import MapEditor.tsx. */
  onSave: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
  /** openAtlasDocument, injected so this hook doesn't import MapEditor.tsx. */
  onOpen: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
}

export function useMapEditorKeyboard({
  spaceHeldRef,
  excalidrawAPI,
  showShortcuts,
  setShowShortcuts,
  setShowQuickActions,
  onSave,
  onOpen,
}: MapEditorKeyboardParams): void {
  // Space+drag pan bridge: when space is held, Excalidraw's internal pan
  // mechanism mutates scrollX/Y. The scroll lock in handleExcalidrawChange
  // resets those to 0 every onChange (preserving geo-anchor identity).
  // Without this bridge, the delta is eaten and the map never moves. The
  // hand-tool button works because it sets pointer-events:none — events fall
  // through to MapLibre directly. Space+drag takes the scroll-mutation path
  // instead.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [spaceHeldRef]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
        (e.target as HTMLElement).tagName !== "INPUT" &&
        (e.target as HTMLElement).tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      // Escape dismisses open overlays.
      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    showShortcuts,
    excalidrawAPI,
    setShowShortcuts,
    setShowQuickActions,
    onSave,
    onOpen,
  ]);
}
