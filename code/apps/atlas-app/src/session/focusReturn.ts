// SPDX-License-Identifier: AGPL-3.0-only
//
// Where focus goes back to when a dialog closes: the element that opened it,
// read at the moment it opens. Read later, it is gone: a menu item unmounts
// with its menu before the dialog has mounted.

/** An element that still exists when the menu it is in has closed. */
function lasting(el: Element): Element {
  const menu = el.closest('[role="menu"]');
  const trigger = menu?.getAttribute("aria-labelledby");
  return (trigger && document.getElementById(trigger)) || el;
}

/**
 * The element focus goes back to for a dialog that opens now. `previous` is
 * the target the slot holds: a dialog opened from inside another dialog (a
 * command picked in the palette) goes back where the first one would have.
 */
export function focusOrigin(previous: Element | null): Element | null {
  const active = document.activeElement;
  if (!active || active === document.body) {
    return null;
  }
  if (active.closest('[aria-modal="true"]')) {
    return previous;
  }
  return lasting(active);
}

/** Focus `el` if it is still in the page. */
export function returnFocusTo(el: Element | null | undefined): void {
  if (el instanceof HTMLElement && el.isConnected) {
    el.focus();
  }
}
