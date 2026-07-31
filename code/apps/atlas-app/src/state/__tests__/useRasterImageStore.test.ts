// SPDX-License-Identifier: AGPL-3.0-only
// FU-1 RA-3 — decoded raster images and, mostly, their object URLs.
//
// The map/set half of this store is trivial. The half worth testing is the
// lifetime: an object URL keeps its Blob alive until revoked, and nothing in
// the UI shows you a leak. A session that imports the same survey sheet twenty
// times holds twenty full-size PNGs, and the only symptom is the tab getting
// slower.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRasterImageStore } from "../useRasterImageStore";

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let n = 0;
  // jsdom has no object-URL implementation, so the store's own fallback would
  // otherwise be what runs — and a test of the revoke path that never revokes
  // is exactly the shape of check FU-10 is about.
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => {
      const url = `blob:test/${n++}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
  useRasterImageStore.setState({ images: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const blob = (size = 4) => new Blob([new Uint8Array(size)]);

describe("useRasterImageStore", () => {
  it("mints an object URL alongside the blob", () => {
    useRasterImageStore.getState().set("rl:a", blob());

    const image = useRasterImageStore.getState().get("rl:a");
    expect(image?.url).toBe(created[0]);
    // The blob is kept as well as the URL: the URL is what MapLibre draws
    // from, the blob is what gets written into a saved document.
    expect(image?.blob).toBeInstanceOf(Blob);
  });

  it("revokes the old URL when the same id is re-imported", () => {
    const store = useRasterImageStore.getState();
    store.set("rl:a", blob());
    store.set("rl:a", blob(8));

    expect(revoked).toEqual([created[0]]);
    expect(useRasterImageStore.getState().get("rl:a")?.url).toBe(created[1]);
  });

  it("revokes on delete", () => {
    const store = useRasterImageStore.getState();
    store.set("rl:a", blob());
    store.delete("rl:a");

    expect(revoked).toEqual([created[0]]);
    expect(useRasterImageStore.getState().get("rl:a")).toBeUndefined();
  });

  it("revokes every URL on clear, not just the last", () => {
    const store = useRasterImageStore.getState();
    store.set("rl:a", blob());
    store.set("rl:b", blob());
    store.set("rl:c", blob());

    useRasterImageStore.getState().clear();

    expect(revoked.sort()).toEqual([...created].sort());
    expect(useRasterImageStore.getState().getAll()).toEqual({});
  });

  it("is a no-op on an id it has never seen", () => {
    // `remove(id)` in the LayerRegistry deletes from here unconditionally so
    // the call site can stay kind-agnostic — annotation and data ids land here
    // constantly and must cost nothing.
    expect(() => useRasterImageStore.getState().delete("el-1")).not.toThrow();
    expect(revoked).toEqual([]);
  });
});
