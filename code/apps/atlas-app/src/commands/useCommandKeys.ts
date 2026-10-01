// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's keys: the commands, as the base of the session's key-scope
// stack (keyScopes.ts), and the two tools whose state is in the view.
//
// The stack listens on the window in the capture phase, so it hears a key
// before the drawing does. The drawing stops the keys it handles at its own
// root, and it binds ⌘K (link) and `?` (its own help); a listener below it
// would never hear them.
//
// The commands. A key that a command names runs that command, in order:
//   - While a dialog is open, no command runs, unless the dialog on top
//     names it (the palette names its own ⌘K). A mod key is stopped, so
//     Ctrl+O does not open the browser's file picker behind a dialog.
//   - A key without `whileTyping` does nothing while the user types in a
//     field.
//   - An auto-repeat runs nothing, unless the binding repeats (zoom). A held
//     toggle must toggle once, or the mode lands on repeat parity.
//   - An unavailable command lets its key through.
//
// The slot. While `view.dialog` is set, a dialog scope holds the stack, so
// a dialog that is still loading (a lazy chunk) already keeps the keys from
// the commands and the tools. The dialog's own Modal goes above it.
//
// The tools. Escape leaves comment mode, and Escape cancels the Pin. The
// Measure tool keeps its own scope (MeasureLayer). A tool hears no key typed
// into a field or pressed in a menu or a popup: there Escape closes the
// popup, not the tool.

import { useEffect } from "react";

import { COMMANDS, type Command } from "./commands";
import { isToolKey, isTypingTarget, matchesKey } from "./keys";

import type { KeyScope } from "./keyScopes";
import type { EditorSession } from "../session/EditorSession";

export function useCommandKeys(
  session: EditorSession,
  commands: readonly Command[] = COMMANDS,
): void {
  useEffect(() => {
    const { view, keys } = session;

    const base: KeyScope = {
      name: "commands",
      layer: "base",
      onKey: (e, { dialog }) => {
        for (const command of commands) {
          const binding = command.keys?.find((b) => matchesKey(e, b));
          if (!binding) {
            continue;
          }
          if (dialog && !dialog.commands?.includes(command.id)) {
            // Not the dialog's key. A bare key stays with the dialog (it
            // types, or presses a button); a mod key is stopped.
            return Boolean(binding.mod);
          }
          if (!binding.whileTyping && isTypingTarget(e.target)) {
            return false;
          }
          if ((e.repeat && !binding.repeat) || !command.available(session)) {
            return false;
          }
          command.run(session);
          return true;
        }
        return false;
      },
    };

    const slot: KeyScope = {
      name: "dialog slot",
      layer: "dialog",
      // The dialog's Modal takes its own Escape. This one hears it only
      // while that Modal is still loading.
      onKey: (e) => {
        if (e.key !== "Escape") {
          return false;
        }
        view.getState().closeDialog();
        return true;
      },
    };

    const tools: KeyScope = {
      name: "comment mode and the Pin",
      layer: "tool",
      onKey: (e) => {
        if (e.key !== "Escape" || !isToolKey(e)) {
          return false;
        }
        const state = view.getState();
        if (state.commentMode) {
          // Leaving comment mode restores the atlas tool it dropped
          // (useCommentModeTool). The drawing's tool is never touched.
          state.setCommentMode(false);
          return true;
        }
        if (state.atlasTool) {
          state.setAtlasTool(null);
          return true;
        }
        return false;
      },
    };

    const pops = [keys.push(base), keys.push(tools)];
    let popSlot: (() => void) | null = null;
    const followSlot = (open: boolean): void => {
      if (open && !popSlot) {
        popSlot = keys.push(slot);
      } else if (!open && popSlot) {
        popSlot();
        popSlot = null;
      }
    };
    followSlot(view.getState().dialog !== null);
    // A store subscription, not a render: the slot scope is on the stack
    // before the dialog's Modal mounts, so the Modal goes above it.
    const unsubscribe = view.subscribe((s) => followSlot(s.dialog !== null));

    return () => {
      unsubscribe();
      followSlot(false);
      pops.forEach((pop) => pop());
    };
  }, [session, commands]);
}
