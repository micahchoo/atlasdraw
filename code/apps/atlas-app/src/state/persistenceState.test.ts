// SPDX-License-Identifier: AGPL-3.0-only
// The autosave's state for the editor's views: one store per session.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPersistenceState } from "./persistenceState";

import type { PersistenceStore } from "./persistence";

const makeFakePersistenceStore = (): PersistenceStore =>
  ({
    save: vi.fn(() => Promise.resolve()),
    load: vi.fn(() => Promise.resolve(null)),
    saveToDisk: vi.fn(() => Promise.resolve()),
    openFromDisk: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(() => Promise.resolve()),
  } as unknown as PersistenceStore);

let persistence = createPersistenceState();

describe("persistence state", () => {
  beforeEach(() => {
    persistence = createPersistenceState();
  });

  it("two sessions never share their save state", () => {
    const other = createPersistenceState();
    persistence.getState().setLastSavedAt(1);
    persistence.getState().setReadOnly(true);
    expect(other.getState().lastSavedAt).toBe(null);
    expect(other.getState().readOnly).toBe(false);
  });

  it("setPersistenceStore stores the reference", () => {
    const fake = makeFakePersistenceStore();
    persistence.getState().setPersistenceStore(fake);
    expect(persistence.getState().persistenceStore).toBe(fake);
  });

  it("holds no dirty flag: the history is the one source", () => {
    expect("isDirty" in persistence.getState()).toBe(false);
    expect("markDirty" in persistence.getState()).toBe(false);
  });
});
