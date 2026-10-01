// SPDX-License-Identifier: AGPL-3.0-only
//
// The key-scope stack: who hears a key. One stack per editor (the session's
// `keys`), with one keydown listener on the window in the capture phase, so
// a scope hears a key before the drawing or any element below does.
//
// A scope is in one of three layers:
//
//   dialog  An open dialog. Only the newest dialog hears keys. While one is
//           open, no tool hears a key, and the base hears it only to refuse
//           (or to run a command the dialog names in `commands`).
//   tool    A tool that is on: Measure, the Pin, comment mode. With no
//           dialog open, the tools hear a key from the newest down.
//   base    The commands (useCommandKeys). They hear every key that nothing
//           above took.
//
// A scope that takes a key returns true; the stack then stops the key, so
// the browser and the drawing do not act on it. A scope that returns false
// leaves the key to the browser: Enter on a focused button still presses it.
//
// The layer, not the push order, puts a dialog above a tool. A tool that
// starts while a dialog is open (a command picked in the palette) must not
// take the next dialog's Enter.

import { createContext, useContext, useEffect } from "react";

export type KeyLayer = "dialog" | "tool" | "base";

export interface KeyScope {
  /** A name for tests and for reading the stack. */
  readonly name: string;
  readonly layer: KeyLayer;
  /**
   * Take the key: return true when this scope used it. `dialog` is the
   * dialog on top, or null; the base scope reads it to refuse.
   */
  onKey(e: KeyboardEvent, on: { dialog: KeyScope | null }): boolean;
  /**
   * Dialogs only: the commands whose keys still run while this dialog is on
   * top. The palette names its own key, so ⌘K closes it.
   */
  readonly commands?: readonly string[];
}

export interface KeyScopes {
  /** Add a scope; the function removes it. */
  push(scope: KeyScope): () => void;
  /** The scopes in the order they hear a key, the first first. */
  stack(): readonly KeyScope[];
}

export function createKeyScopes(target: Window = window): KeyScopes {
  // In push order. An entry object per push, so one scope pushed twice is
  // removed once per pop.
  let entries: ReadonlyArray<{ scope: KeyScope }> = [];

  const inLayer = (layer: KeyLayer) =>
    entries
      .filter((e) => e.scope.layer === layer)
      .map((e) => e.scope)
      .reverse();

  const stack = (): KeyScope[] => [
    ...inLayer("dialog"),
    ...inLayer("tool"),
    ...inLayer("base"),
  ];

  const take = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // An input method is composing text: the key is part of a character.
    if (e.isComposing) {
      return;
    }
    const dialog = inLayer("dialog")[0] ?? null;
    if (dialog) {
      if (dialog.onKey(e, { dialog })) {
        take(e);
        return;
      }
    } else {
      for (const tool of inLayer("tool")) {
        if (tool.onKey(e, { dialog: null })) {
          take(e);
          return;
        }
      }
    }
    for (const base of inLayer("base")) {
      if (base.onKey(e, { dialog })) {
        take(e);
        return;
      }
    }
  };

  return {
    push(scope) {
      const entry = { scope };
      if (entries.length === 0) {
        target.addEventListener("keydown", onKeyDown, true);
      }
      entries = [...entries, entry];
      return () => {
        if (!entries.includes(entry)) {
          return;
        }
        entries = entries.filter((e) => e !== entry);
        if (entries.length === 0) {
          target.removeEventListener("keydown", onKeyDown, true);
        }
      };
    },
    stack,
  };
}

/**
 * The stack a component's scopes go on: the editor's, from SessionProvider.
 * Null outside an editor; a Modal there makes a stack of its own.
 */
export const KeyScopesContext = createContext<KeyScopes | null>(null);

export function useKeyScopes(): KeyScopes | null {
  return useContext(KeyScopesContext);
}

/**
 * Keep `scope` on `keys` while it is not null. Pass a scope made with
 * useMemo or useCallback: a new object each render pops and pushes again.
 */
export function useKeyScope(
  keys: KeyScopes | null,
  scope: KeyScope | null,
): void {
  useEffect(
    () => (keys && scope ? keys.push(scope) : undefined),
    [keys, scope],
  );
}
