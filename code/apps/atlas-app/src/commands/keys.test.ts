// SPDX-License-Identifier: AGPL-3.0-only
//
// Key bindings: which keydown a binding answers, and how it is shown.

import { describe, expect, it } from "vitest";

import {
  bindingId,
  keyLabels,
  keyText,
  matchesKey,
  type KeyBinding,
} from "./keys";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchesKey", () => {
  const save: KeyBinding = { key: "s", mod: true };
  const comment: KeyBinding = { key: "c" };
  const help: KeyBinding = { key: "?" };
  const zoomIn: KeyBinding = {
    key: "=",
    mod: true,
    codes: ["Equal", "NumpadAdd"],
  };

  it("Ctrl and Cmd both are the mod key", () => {
    expect(matchesKey(key({ key: "s", ctrlKey: true }), save)).toBe(true);
    expect(matchesKey(key({ key: "s", metaKey: true }), save)).toBe(true);
    expect(matchesKey(key({ key: "s" }), save)).toBe(false);
  });

  it("a bare letter answers neither a modifier nor Shift", () => {
    expect(matchesKey(key({ key: "c" }), comment)).toBe(true);
    expect(matchesKey(key({ key: "C", shiftKey: true }), comment)).toBe(false);
    expect(matchesKey(key({ key: "c", ctrlKey: true }), comment)).toBe(false);
    expect(matchesKey(key({ key: "c", altKey: true }), comment)).toBe(false);
  });

  it("a symbol that needs Shift on the keyboard matches with Shift", () => {
    expect(matchesKey(key({ key: "?", shiftKey: true }), help)).toBe(true);
    expect(matchesKey(key({ key: "/", shiftKey: false }), help)).toBe(false);
  });

  it("a binding with codes matches the physical key on any layout", () => {
    expect(matchesKey(key({ code: "NumpadAdd", ctrlKey: true }), zoomIn)).toBe(
      true,
    );
    expect(
      matchesKey(key({ key: "+", code: "Equal", ctrlKey: true }), zoomIn),
    ).toBe(true);
    expect(matchesKey(key({ code: "Equal" }), zoomIn)).toBe(false);
  });
});

describe("bindingId", () => {
  it("is the same for two spellings of one key", () => {
    expect(bindingId({ key: "S", mod: true })).toBe(
      bindingId({ key: "s", mod: true }),
    );
    expect(bindingId({ key: "s" })).not.toBe(
      bindingId({ key: "s", mod: true }),
    );
  });
});

describe("keyLabels", () => {
  it("names the mod key for the platform", () => {
    expect(keyLabels({ key: "s", mod: true }, false)).toEqual(["Ctrl", "S"]);
    expect(keyLabels({ key: "s", mod: true }, true)).toEqual(["⌘", "S"]);
    expect(keyLabels({ key: "?" }, false)).toEqual(["?"]);
    expect(keyLabels({ key: "z", mod: true, shift: true }, false)).toEqual([
      "Ctrl",
      "Shift",
      "Z",
    ]);
  });

  it("writes a binding as one short string", () => {
    expect(keyText({ key: "k", mod: true }, false)).toBe("Ctrl+K");
    expect(keyText({ key: "k", mod: true }, true)).toBe("⌘K");
    expect(keyText({ key: "c" }, false)).toBe("C");
  });
});
