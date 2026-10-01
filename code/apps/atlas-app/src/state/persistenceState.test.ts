// SPDX-License-Identifier: AGPL-3.0-only
// The autosave's state for the editor's views: one store per session.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPersistenceState } from "./persistenceState";

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

let persistence = createPersistenceState();

describe("persistence state", () => {
  beforeEach(() => {
    persistence = createPersistenceState();
  });

  it("two sessions never share a dirty flag", () => {
    const other = createPersistenceState();
    persistence.getState().markDirty();
    expect(other.getState().isDirty).toBe(false);
  });

  it("setPersistenceStore stores the reference", () => {
    const fake = makeFakePersistenceStore();
    persistence.getState().setPersistenceStore(fake);
    expect(persistence.getState().persistenceStore).toBe(fake);
  });

  it("markDirty flips isDirty true", () => {
    expect(persistence.getState().isDirty).toBe(false);
    persistence.getState().markDirty();
    expect(persistence.getState().isDirty).toBe(true);
  });

  it("markDirty forwards to underlying PersistenceStore.markDirty when set", () => {
    const fake = makeFakePersistenceStore();
    persistence.getState().setPersistenceStore(fake);
    persistence.getState().markDirty();
    expect(fake.markDirtySpy).toHaveBeenCalledTimes(1);
  });

  it("markDirty is safe with no underlying store (no throw)", () => {
    expect(() => persistence.getState().markDirty()).not.toThrow();
    expect(persistence.getState().isDirty).toBe(true);
  });

  it("clearDirty flips isDirty false", () => {
    persistence.getState().markDirty();
    persistence.getState().clearDirty();
    expect(persistence.getState().isDirty).toBe(false);
  });
});
