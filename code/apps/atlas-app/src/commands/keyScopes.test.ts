// SPDX-License-Identifier: AGPL-3.0-only
//
// The key-scope stack: a key goes to the top dialog, or, with no dialog
// open, to the tools from the newest down. The base scope (the commands)
// hears every key that nothing above took, and learns which dialog is on
// top so it can refuse.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createKeyScopes, type KeyScope } from "./keyScopes";

function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function scope(
  name: string,
  layer: KeyScope["layer"],
  takes: (e: KeyboardEvent) => boolean = () => true,
  commands?: readonly string[],
): KeyScope & { onKey: ReturnType<typeof vi.fn> } {
  return { name, layer, onKey: vi.fn(takes), commands };
}

const pops: Array<() => void> = [];
afterEach(() => {
  pops.splice(0).forEach((pop) => pop());
});

describe("a key goes only to the top scope", () => {
  it("a dialog above a tool takes the key, and the tool never hears it", () => {
    const keys = createKeyScopes();
    const measure = scope("measure", "tool");
    const dialog = scope("confirm", "dialog");
    pops.push(keys.push(measure), keys.push(dialog));

    const event = press("Enter");

    expect(dialog.onKey).toHaveBeenCalledTimes(1);
    expect(measure.onKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("a dialog that lets a key through still keeps it from the tools", () => {
    const keys = createKeyScopes();
    const measure = scope("measure", "tool");
    const dialog = scope("confirm", "dialog", () => false);
    pops.push(keys.push(measure), keys.push(dialog));

    const event = press("Enter");

    expect(measure.onKey).not.toHaveBeenCalled();
    // The browser keeps the key: Enter on a focused button presses it.
    expect(event.defaultPrevented).toBe(false);
  });

  it("a tool pushed while a dialog is open still sits below the dialog", () => {
    const keys = createKeyScopes();
    const dialog = scope("settings", "dialog");
    const pin = scope("pin", "tool");
    pops.push(keys.push(dialog), keys.push(pin));

    press("Escape");

    expect(dialog.onKey).toHaveBeenCalledTimes(1);
    expect(pin.onKey).not.toHaveBeenCalled();
  });

  it("of two dialogs, only the newer hears the key (a question inside a dialog)", () => {
    const keys = createKeyScopes();
    const outer = scope("my-maps", "dialog");
    const inner = scope("delete?", "dialog");
    pops.push(keys.push(outer), keys.push(inner));

    press("Escape");

    expect(inner.onKey).toHaveBeenCalledTimes(1);
    expect(outer.onKey).not.toHaveBeenCalled();
  });

  it("when the top dialog goes, the next one hears keys again", () => {
    const keys = createKeyScopes();
    const outer = scope("my-maps", "dialog");
    const inner = scope("delete?", "dialog");
    pops.push(keys.push(outer));
    const popInner = keys.push(inner);

    popInner();
    press("Escape");

    expect(outer.onKey).toHaveBeenCalledTimes(1);
    expect(inner.onKey).not.toHaveBeenCalled();
  });

  it("with no dialog, tools hear the key newest first, and the first taker ends it", () => {
    const keys = createKeyScopes();
    const older = scope("comment", "tool");
    const newer = scope("pin", "tool", () => false);
    pops.push(keys.push(older), keys.push(newer));

    press("Escape");

    expect(newer.onKey).toHaveBeenCalledTimes(1);
    expect(older.onKey).toHaveBeenCalledTimes(1);
  });
});

describe("the base scope (the commands)", () => {
  it("hears a key nothing above took, and is told the dialog on top", () => {
    const keys = createKeyScopes();
    const base = scope("commands", "base", () => false);
    const dialog = scope("palette", "dialog", () => false, ["app.palette"]);
    pops.push(keys.push(base), keys.push(dialog));

    press("k");

    expect(base.onKey).toHaveBeenCalledWith(expect.any(KeyboardEvent), {
      dialog,
    });
  });

  it("is told there is no dialog when none is open", () => {
    const keys = createKeyScopes();
    const base = scope("commands", "base", () => false);
    pops.push(keys.push(base));

    press("m");

    expect(base.onKey).toHaveBeenCalledWith(expect.any(KeyboardEvent), {
      dialog: null,
    });
  });

  it("does not hear a key a scope above took", () => {
    const keys = createKeyScopes();
    const base = scope("commands", "base");
    const measure = scope("measure", "tool");
    pops.push(keys.push(base), keys.push(measure));

    press("Escape");

    expect(base.onKey).not.toHaveBeenCalled();
  });
});

describe("the listener", () => {
  it("hears keys before an element below the window does", () => {
    const keys = createKeyScopes();
    pops.push(keys.push(scope("measure", "tool")));
    const drawing = document.createElement("div");
    document.body.appendChild(drawing);
    const editor = vi.fn();
    drawing.addEventListener("keydown", editor);

    press("Backspace", drawing);

    expect(editor).not.toHaveBeenCalled();
    drawing.remove();
  });

  it("stops listening when the last scope goes", () => {
    const keys = createKeyScopes();
    const measure = scope("measure", "tool");
    keys.push(measure)();
    const below = vi.fn();
    window.addEventListener("keydown", below);

    const event = press("Escape");

    expect(measure.onKey).not.toHaveBeenCalled();
    expect(below).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    window.removeEventListener("keydown", below);
  });

  it("ignores a key typed while an input method composes text", () => {
    const keys = createKeyScopes();
    const dialog = scope("palette", "dialog");
    pops.push(keys.push(dialog));

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        isComposing: true,
        bubbles: true,
      }),
    );

    expect(dialog.onKey).not.toHaveBeenCalled();
  });
});
