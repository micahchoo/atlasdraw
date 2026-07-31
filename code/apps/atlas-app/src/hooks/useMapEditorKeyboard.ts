// SPDX-License-Identifier: AGPL-3.0-only
//
// MapEditor keyboard shortcuts: the space-held tracker (feeds the
// space+drag pan bridge in handleExcalidrawChange) and the main shortcut
// binding (Cmd+K quick actions, Cmd+S/Cmd+O document save/open, `?` for the
// shortcuts panel, Escape to dismiss it).
//
// Step 5 adds the comment-mode toggle on bare `c`, plus an Escape branch that
// leaves the mode. See the `c` handler for the keybinding audit that cleared
// the key.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 4).
// `spaceHeldRef` stays owned by MapEditor and is passed in — it's also read
// by handleExcalidrawChange (Cut 5 territory), so the ref can't move here
// without threading it back out. No test covered either binding directly
// before this extraction; new useMapEditorKeyboard.test.ts adds
// characterization coverage for both.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import {
  isCommentModeActive,
  setCommentMode,
  toggleCommentMode,
} from "../state/commentMode";

import type { Dispatch, RefObject, SetStateAction } from "react";

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
      // Escape dismisses open overlays.
      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        // Leaving comment mode restores the atlas tool it dropped — see
        // useCommentModeTool's cleanup. The Excalidraw tool is never touched.
        if (isCommentModeActive()) {
          setCommentMode(false);
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
