// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task T9 — usePersistenceStore unit tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePersistenceStore } from "./usePersistenceStore";
import type { PersistenceStore } from "./persistence";

const makeFakePersistenceStore = (): PersistenceStore & {
  markDirtySpy: ReturnType<typeof vi.fn>;
} => {
  const markDirtySpy = vi.fn();
  return {
    save: vi.fn(() => Promise.resolve()),
    load: vi.fn(() => Promise.resolve(null)),
    saveToDisk: vi.fn(() => Promise.resolve()),
    openFromDisk: vi.fn(() => Promise.resolve(null)),
    onDirty: vi.fn(() => () => {}),
    markDirty: markDirtySpy,
    isDirty: vi.fn(() => false),
    close: vi.fn(() => Promise.resolve()),
    markDirtySpy,
  } as unknown as PersistenceStore & {
    markDirtySpy: ReturnType<typeof vi.fn>;
  };
};

describe("usePersistenceStore", () => {
  beforeEach(() => {
    // Reset state between tests — Zustand stores are module-singletons.
    usePersistenceStore.setState({
      persistenceStore: null,
      isDirty: false,
      isDraining: false,
      lastSavedAt: null,
      autosaveDispose: null,
      forceSave: () => Promise.resolve(),
    });
  });

  it("setPersistenceStore stores the reference", () => {
    const fake = makeFakePersistenceStore();
    usePersistenceStore.getState().setPersistenceStore(fake);
    expect(usePersistenceStore.getState().persistenceStore).toBe(fake);
  });

  it("markDirty flips isDirty true", () => {
    expect(usePersistenceStore.getState().isDirty).toBe(false);
    usePersistenceStore.getState().markDirty();
    expect(usePersistenceStore.getState().isDirty).toBe(true);
  });

  it("markDirty forwards to underlying PersistenceStore.markDirty when set", () => {
    const fake = makeFakePersistenceStore();
    usePersistenceStore.getState().setPersistenceStore(fake);
    usePersistenceStore.getState().markDirty();
    expect(fake.markDirtySpy).toHaveBeenCalledTimes(1);
  });

  it("markDirty is safe with no underlying store (no throw)", () => {
    expect(() => usePersistenceStore.getState().markDirty()).not.toThrow();
    expect(usePersistenceStore.getState().isDirty).toBe(true);
  });

  it("clearDirty flips isDirty false", () => {
    usePersistenceStore.getState().markDirty();
    usePersistenceStore.getState().clearDirty();
    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });

  it("setAutosaveDispose stores + replaces the disposer", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    usePersistenceStore.getState().setAutosaveDispose(fn1);
    expect(usePersistenceStore.getState().autosaveDispose).toBe(fn1);
    usePersistenceStore.getState().setAutosaveDispose(fn2);
    expect(usePersistenceStore.getState().autosaveDispose).toBe(fn2);
    usePersistenceStore.getState().setAutosaveDispose(null);
    expect(usePersistenceStore.getState().autosaveDispose).toBeNull();
  });
});
