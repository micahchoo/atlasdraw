// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T13 — useAutosave hook tests.
//
// Five cases per the T13 plan:
//   1. isDraining is false on init.
//   2. isDraining becomes true on first edit (markDirty).
//   3. isDraining reverts to false after save resolves.
//   4. Multiple rapid markDirty produces exactly one save (debounce window).
//   5. Rejected forceSave leaves isDraining=false (not stuck).
//
// We render the hook inside a tiny test component (@testing-library/react)
// rather than calling it directly — the Zustand selector subscription path
// only fires under a React render. The five cases are wired through the
// real `usePersistenceStore` + a faked `PersistenceStore` to keep the test
// hermetic from IDB/network.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";

import { useAutosave } from "../useAutosave";
import { usePersistenceStore } from "../../state/usePersistenceStore";
import { startAutoSave, type PersistenceStore } from "../../state/persistence";

import type { AtlasdrawDocument } from "@atlasdraw/data";

// ---------------------------------------------------------------------------
// Fixture: fake PersistenceStore — onDirty/markDirty subscription works,
// save() is a spy resolving/rejecting on demand.
// ---------------------------------------------------------------------------

interface FakeStore extends PersistenceStore {
  saveSpy: ReturnType<typeof vi.fn>;
  triggerSaveResolve: () => void;
}

function makeFakeStore(saveImpl?: () => Promise<void>): FakeStore {
  const dirtyListeners = new Set<() => void>();
  let resolveCurrent: (() => void) | null = null;
  const saveSpy = vi.fn(() => {
    if (saveImpl) {
      return saveImpl();
    }
    return new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
  });
  const store: FakeStore = {
    save: saveSpy,
    load: vi.fn(async () => null),
    saveToDisk: vi.fn(async () => {}),
    openFromDisk: vi.fn(async () => null),
    onDirty: (cb) => {
      dirtyListeners.add(cb);
      return () => dirtyListeners.delete(cb);
    },
    markDirty: () => {
      for (const cb of dirtyListeners) {
        cb();
      }
    },
    isDirty: () => false,
    close: vi.fn(async () => {}),
    saveSpy,
    triggerSaveResolve: () => {
      resolveCurrent?.();
      resolveCurrent = null;
    },
  };
  return store;
}

const DOC_STUB = {} as AtlasdrawDocument;

// Component that mounts the hook and writes outputs to data-* for inspection.
function Harness(): React.ReactElement {
  const { isDraining, lastSavedAt } = useAutosave();
  return (
    <div
      data-testid="harness"
      data-is-draining={String(isDraining)}
      data-last-saved-at={String(lastSavedAt)}
    />
  );
}

// Wire startAutoSave + Zustand against the fake store inside a sibling
// component so the wiring teardown follows React unmount semantics.
function Wiring({ store }: { store: PersistenceStore }): React.ReactElement {
  useEffect(() => {
    usePersistenceStore.getState().setPersistenceStore(store);
    const dispose = startAutoSave(
      store,
      () => DOC_STUB,
      5000,
      30000,
      () => {
        usePersistenceStore.getState().clearDirty();
        usePersistenceStore.getState().setDraining(false);
        usePersistenceStore.getState().setLastSavedAt(Date.now());
      },
    );
    usePersistenceStore.getState().setForceSave(async () => {
      try {
        await store.save(DOC_STUB);
        usePersistenceStore.getState().setLastSavedAt(Date.now());
        usePersistenceStore.getState().setDraining(false);
      } catch (err) {
        usePersistenceStore.getState().setDraining(false);
        throw err;
      }
    });
    return () => {
      dispose();
      usePersistenceStore.getState().setPersistenceStore(null);
    };
  }, [store]);
  return <></>;
}

beforeEach(() => {
  vi.useFakeTimers();
  usePersistenceStore.setState({
    persistenceStore: null,
    isDirty: false,
    isDraining: false,
    lastSavedAt: null,
    autosaveDispose: null,
    forceSave: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useAutosave", () => {
  it("isDraining is false on init", () => {
    const store = makeFakeStore(async () => {});
    render(
      <>
        <Wiring store={store} />
        <Harness />
      </>,
    );
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "false",
    );
  });

  it("isDraining becomes true on first edit (markDirty)", () => {
    const store = makeFakeStore(async () => {});
    render(
      <>
        <Wiring store={store} />
        <Harness />
      </>,
    );
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "true",
    );
  });

  it("isDraining reverts to false after save resolves", async () => {
    const store = makeFakeStore(async () => {
      /* resolves immediately */
    });
    render(
      <>
        <Wiring store={store} />
        <Harness />
      </>,
    );
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "true",
    );
    // Advance the debounce — startAutoSave flushes; onSaved callback fires
    // setDraining(false).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(store.saveSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "false",
    );
    expect(
      screen.getByTestId("harness").getAttribute("data-last-saved-at"),
    ).not.toBe("null");
  });

  it("multiple rapid markDirty produces exactly one save (debounce coalesces)", async () => {
    const store = makeFakeStore(async () => {});
    render(
      <>
        <Wiring store={store} />
        <Harness />
      </>,
    );
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    // Only after 5s of quiet from the last edit does the debounce flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(store.saveSpy).toHaveBeenCalledTimes(1);
  });

  it("rejected forceSave leaves isDraining=false (not stuck)", async () => {
    const boom = new Error("network down");
    const store = makeFakeStore(async () => {
      throw boom;
    });
    render(
      <>
        <Wiring store={store} />
        <Harness />
      </>,
    );
    act(() => {
      usePersistenceStore.getState().markDirty();
    });
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "true",
    );
    await act(async () => {
      try {
        await usePersistenceStore.getState().forceSave();
      } catch {
        /* swallow — we asserted the rejection-path side effect, not the throw */
      }
    });
    expect(screen.getByTestId("harness").getAttribute("data-is-draining")).toBe(
      "false",
    );
  });
});
