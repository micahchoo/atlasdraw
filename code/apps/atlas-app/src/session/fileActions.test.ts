// SPDX-License-Identifier: AGPL-3.0-only
//
// Save and Open: the .atlasdraw file is the one way in and out of the
// editor. Real document IO; the file picker is the one thing faked.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { read, write, type AtlasdrawDocument } from "@atlasdraw/data";

import {
  createDocument,
  currentDocument,
  openDocument,
  useDocumentStore,
} from "../state/document";
import { hasUnsavedWork, markSavedToFile } from "../state/documentIO";
import { admittedOf } from "../state/__tests__/fixtures/admitted";
import { editorScene } from "../state/scene";
import {
  FakeCameraMap,
  makeFakeExcalidraw,
  savedDocument,
} from "../state/__tests__/fixtures/documentWorld";

import { createSession, type EditorSession } from "./EditorSession";
import { openMap, openSceneFile, saveMap } from "./fileActions";

import type { PersistenceStore } from "../state/persistence";
import type maplibregl from "maplibre-gl";

/** The picker: what Save wrote, and what Open will hand back. */
function fakeDisk(session: EditorSession) {
  const disk = {
    written: [] as AtlasdrawDocument[],
    next: null as AtlasdrawDocument | null,
    fail: null as unknown,
    opened: 0,
  };
  const store = {
    saveToDisk: async (doc: AtlasdrawDocument) => {
      if (disk.fail) {
        throw disk.fail;
      }
      disk.written.push(doc);
    },
    openFromDisk: async () => {
      disk.opened += 1;
      if (disk.fail) {
        throw disk.fail;
      }
      return disk.next;
    },
  } as unknown as PersistenceStore;
  session.persistence.setState({ persistenceStore: store });
  return disk;
}

function editorSession(): {
  session: EditorSession;
  map: FakeCameraMap;
} {
  const session = createSession({
    store: useDocumentStore,
    scene: editorScene,
    transport: null,
    notify: { success: () => {}, error: () => {} },
  });
  const fx = makeFakeExcalidraw();
  const map = new FakeCameraMap({ center: [2.35, 48.85], zoom: 9 });
  session.view.getState().setApi(fx.api);
  session.view.getState().setMap(map as unknown as maplibregl.Map);
  return { session, map };
}

async function fileOnDisk(): Promise<AtlasdrawDocument> {
  return (await admittedOf(await write(savedDocument()))).doc;
}

const notify = () => ({ success: vi.fn(), error: vi.fn() });

beforeEach(() => {
  openDocument(createDocument({ title: "Field notes" }));
});

describe("saveMap", () => {
  it("writes the open map, at the camera the user sees, and marks it saved", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    const n = notify();

    await saveMap(session, n);

    expect(disk.written).toHaveLength(1);
    const [file] = disk.written;
    expect(file.manifest.title).toBe("Field notes");
    expect(file.manifest.camera.center).toEqual([2.35, 48.85]);
    expect(file.manifest.camera.zoom).toBe(9);
    expect(hasUnsavedWork(currentDocument())).toBe(false);
    expect(n.success).toHaveBeenCalledWith("Map saved as .atlasdraw");
  });

  it("a dismissed picker is a choice, not a failure: no message", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    disk.fail = new DOMException("dismissed", "AbortError");
    const n = notify();

    await saveMap(session, n);

    expect(n.error).not.toHaveBeenCalled();
    expect(n.success).not.toHaveBeenCalled();
  });

  it("a failed write says so", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    disk.fail = new Error("disk full");
    const n = notify();

    await saveMap(session, n);

    expect(n.error).toHaveBeenCalledWith("Couldn't save the map — disk full");
  });

  it("does nothing before the drawing mounts", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    session.view.getState().setApi(null);

    await saveMap(session, notify());

    expect(disk.written).toHaveLength(0);
  });
});

describe("openMap", () => {
  it("opens the file in place of the open map and moves the map to its camera", async () => {
    const { session, map } = editorSession();
    const disk = fakeDisk(session);
    disk.next = await fileOnDisk();
    const n = notify();

    await openMap(session, n, async () => true);

    expect(currentDocument().id).toBe(disk.next.manifest.id);
    expect(map.getCenter().lng).toBeCloseTo(
      disk.next.manifest.camera.center[0],
    );
    // A file just opened holds no work that is not in a file.
    expect(hasUnsavedWork(currentDocument())).toBe(false);
    expect(n.success).toHaveBeenCalledTimes(1);
  });

  it("asks before it replaces unsaved work, and opens nothing on No", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    disk.next = await fileOnDisk();
    const before = currentDocument();
    before.dispatch({ type: "rename-document", title: "Changed" });
    const confirm = vi.fn(async () => false);
    // The open map holds a layer, so it is not blank.
    before.dispatch({
      type: "add-tile-layer",
      id: "tl:a",
      label: "A",
      url: "https://tiles.example/{z}/{x}/{y}.png",
    });

    await openMap(session, notify(), confirm);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(disk.opened).toBe(0);
    expect(currentDocument()).toBe(before);
  });

  it("does not ask when the open map is in a file", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    disk.next = await fileOnDisk();
    markSavedToFile(currentDocument());
    const confirm = vi.fn(async () => false);

    await openMap(session, notify(), confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(disk.opened).toBe(1);
  });

  it("a file that does not read says so", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    disk.fail = new Error("not a zip");
    const n = notify();

    await openMap(session, n, async () => true);

    expect(n.error).toHaveBeenCalledTimes(1);
  });
});

describe("a saved map opens again as it was", () => {
  it("round trip through the file", async () => {
    const { session } = editorSession();
    const disk = fakeDisk(session);
    currentDocument().dispatch({ type: "set-basemap", id: "protomaps-dark" });
    await saveMap(session, notify());
    disk.next = await read(await write(disk.written[0]));
    openDocument(createDocument());

    await openMap(session, notify(), async () => true);

    expect(currentDocument().snapshot().title).toBe("Field notes");
    expect(currentDocument().snapshot().basemap).toBe("protomaps-dark");
  });
});

describe("openSceneFile: a scene file dropped on the canvas", () => {
  const excalidrawFile = () =>
    new File(
      [
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [
            {
              id: "dropped",
              type: "rectangle",
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              angle: 0,
              version: 1,
              versionNonce: 1,
              isDeleted: false,
            },
          ],
          appState: { zoom: { value: 1 }, viewBackgroundColor: "#ffffff" },
        }),
      ],
      "drawing.excalidraw",
      { type: "application/json" },
    );

  it("opens as a new map where the user looks, and leaves the open map alone", async () => {
    const { session, map } = editorSession();
    fakeDisk(session);
    const before = currentDocument();
    const n = notify();

    await openSceneFile(session, excalidrawFile(), n, async () => true);

    const opened = currentDocument();
    expect(opened).not.toBe(before);
    // A new id: the open map's saved copy is never written over.
    expect(opened.id).not.toBe(before.id);
    // The camera stays where it was: the new map starts at the user's view,
    // not at Excalidraw's zoom 1 (map zoom 22) in the mid-Atlantic.
    expect(opened.snapshot().camera.center).toEqual([2.35, 48.85]);
    expect(map.getZoom()).toBe(9);
    expect(n.success).toHaveBeenCalledTimes(1);
    expect(n.error).not.toHaveBeenCalled();
  });

  it("saves the open map's pending changes before the new map replaces it", async () => {
    const { session } = editorSession();
    fakeDisk(session);
    // An edit: the open map has changes the autosave has not written.
    session.history.record({ undo: () => {}, redo: () => {} });
    const kept: string[] = [];
    session.persistence.getState().setForceSave(async () => {
      kept.push(currentDocument().id);
    });
    const before = currentDocument();

    await openSceneFile(session, excalidrawFile(), notify(), async () => true);

    // First the open map; then the new map, saved at once.
    expect(kept[0]).toBe(before.id);
    expect(currentDocument()).not.toBe(before);
  });

  it("asks before it replaces unsaved work, and opens nothing on No", async () => {
    const { session } = editorSession();
    fakeDisk(session);
    const before = currentDocument();
    before.dispatch({
      type: "add-tile-layer",
      id: "tl:a",
      label: "A",
      url: "https://tiles.example/{z}/{x}/{y}.png",
    });
    const confirm = vi.fn(async () => false);

    await openSceneFile(session, excalidrawFile(), notify(), confirm);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(currentDocument()).toBe(before);
  });

  it("a file that does not read says so and changes nothing", async () => {
    const { session } = editorSession();
    fakeDisk(session);
    const before = currentDocument();
    const n = notify();

    await openSceneFile(
      session,
      new File(["{not json"], "bad.excalidraw"),
      n,
      async () => true,
    );

    expect(n.error).toHaveBeenCalledTimes(1);
    expect(currentDocument()).toBe(before);
  });
});
