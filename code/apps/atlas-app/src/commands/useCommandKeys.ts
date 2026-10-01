// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's one keydown dispatcher: a key that a command names runs that
// command. The keys come from the command list (commands.ts), so a key that
// works is a key the shortcuts panel lists.
//
// The listener is on the window in the capture phase, so it hears a key
// before the drawing does. The drawing stops the keys it handles at its own
// root, and it binds ⌘K (link) and `?` (its own help); a listener below it
// would never hear them.
//
// Rules, in order:
//   - A key without a modifier does nothing while the user types in a field,
//     and nothing while a dialog is open: the dialog owns the keyboard.
//   - An auto-repeat runs nothing, unless the binding repeats (zoom). A held
//     toggle must toggle once, or the mode lands on repeat parity.
//   - An unavailable command lets its key through.
//
// Escape is not a command. With no dialog open, it leaves comment mode. The
// drawing takes Escape at its root while a drawing tool is active and stops
// it there, so a second listener, on the drawing's own element, hears it
// first.

import { useEffect } from "react";

import { COMMANDS, type Command } from "./commands";
import { isTypingTarget, matchesKey } from "./keys";

import type { EditorSession } from "../session/EditorSession";

export function useCommandKeys(
  session: EditorSession,
  /** The element that holds the drawing; null until it mounts. */
  drawingLayer: HTMLElement | null,
  commands: readonly Command[] = COMMANDS,
): void {
  useEffect(() => {
    const view = session.view;

    const onKeyDown = (e: KeyboardEvent) => {
      for (const command of commands) {
        const binding = command.keys?.find((b) => matchesKey(e, b));
        if (!binding) {
          continue;
        }
        if (!binding.whileTyping && isTypingTarget(e.target)) {
          return;
        }
        if (!binding.mod && view.getState().dialog) {
          return;
        }
        if ((e.repeat && !binding.repeat) || !command.available(session)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        command.run(session);
        return;
      }
    };

    /** True when Escape left a mode. */
    const leaveMode = (e: KeyboardEvent): boolean => {
      const state = view.getState();
      if (
        e.key !== "Escape" ||
        isTypingTarget(e.target) ||
        state.dialog ||
        !state.commentMode
      ) {
        return false;
      }
      // Leaving comment mode restores the atlas tool it dropped
      // (useCommentModeTool). The drawing's tool is never touched.
      state.setCommentMode(false);
      return true;
    };
    const onEscape = (e: KeyboardEvent) => {
      leaveMode(e);
    };
    const onDrawingEscape = (e: KeyboardEvent) => {
      if (leaveMode(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keydown", onEscape);
    drawingLayer?.addEventListener("keydown", onDrawingEscape, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", onEscape);
      drawingLayer?.removeEventListener("keydown", onDrawingEscape, true);
    };
  }, [session, drawingLayer, commands]);
}
