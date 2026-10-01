// SPDX-License-Identifier: AGPL-3.0-only
// Raster object URLs and their lifetime. An object URL keeps its Blob alive
// until it is revoked, and nothing in the UI shows a leak: a session that
// imports the same sheet twenty times holds twenty PNGs, and the only symptom
// is a slower tab.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRasterImageStore } from "../useRasterImageStore";
import { createDocument, currentDocument, openDocument } from "../document";

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
  openDocument(createDocument());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const blob = (size = 4) => new Blob([new Uint8Array(size)]);

function addRaster(id: string, image: Blob = blob()): void {
  currentDocument().dispatch({
    type: "add-raster-layer",
    id,
    label: id,
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    imageKey: `${id}.png`,
    image,
  });
}

describe("raster object URLs follow the open document's images", () => {
  it("mints an object URL alongside the blob", () => {
    const image = blob();
    addRaster("rl:a", image);

    const cached = useRasterImageStore.getState().get("rl:a");
    expect(cached?.url).toBe(created[0]);
    expect(cached?.blob).toBe(image);
  });

  it("keeps the URL while the image is unchanged", () => {
    addRaster("rl:a");
    currentDocument().dispatch({
      type: "rename-layer",
      id: "rl:a",
      label: "x",
    });

    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it("revokes when the layer is removed", () => {
    addRaster("rl:a");
    currentDocument().dispatch({ type: "remove-layer", id: "rl:a" });

    expect(revoked).toEqual([created[0]]);
    expect(useRasterImageStore.getState().get("rl:a")).toBeUndefined();
  });

  it("revokes every URL when another document opens, not just the last", () => {
    addRaster("rl:a");
    addRaster("rl:b");
    addRaster("rl:c");

    openDocument(createDocument());

    expect(revoked.sort()).toEqual([...created].sort());
    expect(useRasterImageStore.getState().getAll()).toEqual({});
  });
});
