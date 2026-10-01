// SPDX-License-Identifier: AGPL-3.0-only
//
// A key binding: the keydown a command answers, and how it is shown.

import { isDarwin } from "@atlasdraw/common";

export interface KeyBinding {
  /** `KeyboardEvent.key`. Letters compare without case. */
  key: string;
  /** Ctrl, or Cmd on macOS. */
  mod?: boolean;
  shift?: boolean;
  /**
   * `KeyboardEvent.code` values that match whatever `key` the layout gives,
   * for keys like `=` whose character moves between layouts.
   */
  codes?: readonly string[];
  /** Also while the user types in a field. Off for keys that type text. */
  whileTyping?: boolean;
  /** Also on auto-repeat. Off for toggles: a held key must toggle once. */
  repeat?: boolean;
}

const isLetter = (k: string) => /^[a-z]$/i.test(k);

/** True when `e` is the keydown `b` names. Alt never matches. */
export function matchesKey(e: KeyboardEvent, b: KeyBinding): boolean {
  if (e.altKey || (e.metaKey || e.ctrlKey) !== Boolean(b.mod)) {
    return false;
  }
  if (b.codes) {
    return b.codes.includes(e.code);
  }
  if (isLetter(b.key)) {
    return (
      e.key.toLowerCase() === b.key.toLowerCase() &&
      e.shiftKey === Boolean(b.shift)
    );
  }
  // A symbol: Shift is part of how the keyboard types it.
  return e.key === b.key;
}

/** One string per distinct binding, to find two commands on one key. */
export function bindingId(b: KeyBinding): string {
  return [b.mod ? "mod" : "", b.shift ? "shift" : "", b.key.toLowerCase()]
    .filter(Boolean)
    .join("+");
}

/** The keys to show for `b`, one label per key. */
export function keyLabels(b: KeyBinding, mac: boolean = isDarwin): string[] {
  return [
    ...(b.mod ? [mac ? "⌘" : "Ctrl"] : []),
    ...(b.shift ? ["Shift"] : []),
    b.key.length === 1 ? b.key.toUpperCase() : b.key,
  ];
}

/**
 * True when the event came from somewhere the user is typing: a field, the
 * drawing's text editor, a comment composer, anything contenteditable.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
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

/** `b` as one short string: "Ctrl+S", or "⌘S" on macOS. */
export function keyText(b: KeyBinding, mac: boolean = isDarwin): string {
  return keyLabels(b, mac).join(mac ? "" : "+");
}

/**
 * True when the event came from inside a menu, a listbox or a dialog: a
 * popup that owns its own keys, Escape first of all.
 */
export function isPopupTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return Boolean(
    el?.closest?.(
      '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
    ),
  );
}

/**
 * True when a tool (Measure, the Pin, comment mode) may take this key: not
 * typed into a field, not pressed in a popup.
 */
export function isToolKey(e: KeyboardEvent): boolean {
  return !isTypingTarget(e.target) && !isPopupTarget(e.target);
}
