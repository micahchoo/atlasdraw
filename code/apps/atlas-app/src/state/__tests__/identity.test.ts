// SPDX-License-Identifier: AGPL-3.0-only
//
// The display name a person sets: kept per browser, with the id and colour
// that came before it.

import { afterEach, describe, expect, it, vi } from "vitest";

import { localIdentity, setDisplayName } from "../identity";

const KEY = "atlasdraw:identity";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setDisplayName", () => {
  it("keeps the id and colour, tidies the name, and stores it", () => {
    const before = localIdentity();

    const after = setDisplayName("  Ana   from\tsurvey  ");

    expect(after).toEqual({ ...before, name: "Ana from survey" });
    expect(localIdentity()).toEqual(after);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(after);
  });

  it("caps the name at 64 characters and ignores an empty one", () => {
    setDisplayName("Bo");
    expect(setDisplayName("x".repeat(200)).name).toHaveLength(64);
    expect(setDisplayName("   ").name).toHaveLength(64);
  });

  it("keeps the name for this session when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(setDisplayName("Private mode").name).toBe("Private mode");
    expect(localIdentity().name).toBe("Private mode");
  });
});
