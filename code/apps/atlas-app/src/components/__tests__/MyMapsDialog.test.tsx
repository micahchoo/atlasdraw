// SPDX-License-Identifier: AGPL-3.0-only
//
// The My maps dialog over the real PersistenceStore (fake-indexeddb) and the
// real open Document. Excalidraw is the only stand-in.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { MyMapsDialog } from "../MyMapsDialog";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";
import { toFile } from "../../state/documentIO";
import {
  createPersistenceStore,
  type PersistenceStore,
} from "../../state/persistence";
import { sceneOf } from "../../state/scene";
import { usePersistenceStore } from "../../state/usePersistenceStore";
import {
  makeFakeExcalidraw,
  type FakeExcalidraw,
} from "../../state/__tests__/fixtures/documentWorld";

const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

const savedFile = (
  id: string,
  title: string,
  updatedAt: string,
): AtlasdrawDocument => ({
  manifest: {
    id,
    version: 2,
    title,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt,
    basemap: { type: "registry", id: "protomaps-light" },
    camera: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
    layers: [],
    permissions: { publicView: false },
  },
  scene: [
    { id: `el-${id}`, type: "rectangle", x: 0, y: 0, width: 1, height: 1 },
  ] as unknown as AtlasdrawDocument["scene"],
  layers: new Map(),
  styleRef: {},
  files: new Map(),
});

let n = 0;
let store: PersistenceStore;
let fx: FakeExcalidraw;

beforeEach(() => {
  store = createPersistenceStore({ dbName: `my-maps-ui-${++n}` });
  usePersistenceStore.getState().setPersistenceStore(store);
  usePersistenceStore
    .getState()
    .setForceSave(() => store.save(toFile(currentDocument())));
  fx = makeFakeExcalidraw();
  openDocument(createDocument({ title: "Blank" }, sceneOf(fx.api)));
});

afterEach(async () => {
  cleanup();
  usePersistenceStore.getState().setPersistenceStore(null);
  await store.close();
});

function renderDialog() {
  const onClose = vi.fn();
  const notify = { success: vi.fn(), error: vi.fn() };
  render(
    <MyMapsDialog
      excalidrawAPI={fx.api}
      notify={notify}
      onClose={onClose}
      now={() => NOW}
    />,
  );
  return { onClose, notify };
}

async function seedTwoMaps() {
  await store.save(savedFile(A, "Harbour walk", "2026-10-01T11:55:00.000Z"));
  await store.save(savedFile(B, "Field sites", "2026-09-28T12:00:00.000Z"));
}

describe("MyMapsDialog", () => {
  it("is a labelled dialog that lists the maps, the last changed first", async () => {
    await seedTwoMaps();
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "My maps" });
    const list = await within(dialog).findByRole("list", { name: "My maps" });
    const rows = await within(list).findAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Harbour walk"),
      expect.stringContaining("Field sites"),
    ]);
    expect(rows[0].textContent).toContain("5 minutes ago");
    expect(rows[1].textContent).toContain("3 days ago");
  });

  it("says how to make a map when there are none", async () => {
    renderDialog();

    expect(
      await screen.findByText(
        "You have no saved maps. Draw on the map or import a file. Atlasdraw then saves your map here.",
      ),
    ).toBeTruthy();
  });

  it("opens a map and closes", async () => {
    await seedTwoMaps();
    const { onClose } = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Field sites" }),
    );

    await waitFor(() => expect(currentDocument().id).toBe(B));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows which map is open and does not offer to open it again", async () => {
    await seedTwoMaps();
    openDocument(
      createDocument({ id: A, title: "Harbour walk" }, sceneOf(fx.api)),
    );
    renderDialog();

    const open = await screen.findByRole("button", {
      name: "Open Harbour walk",
    });
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Open now")).toBeTruthy();
  });

  it("deletes a map after an in-page confirm", async () => {
    await seedTwoMaps();
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Field sites" }),
    );
    const confirm = screen.getByRole("alertdialog", { name: "Delete map?" });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete map" }),
    );

    await waitFor(() => expect(screen.queryByText("Field sites")).toBeNull());
    expect((await store.list()).map((m) => m.id)).toEqual([A]);
  });

  it("keeps the map when the confirm is cancelled", async () => {
    await seedTwoMaps();
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Field sites" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await store.list()).map((m) => m.id)).toEqual([A, B]);
  });

  it("starts a new map and closes", async () => {
    const before = currentDocument().id;
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "New map" }));

    await waitFor(() => expect(currentDocument().id).not.toBe(before));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lists the open map's latest changes", async () => {
    fx.setElements([{ id: "drawn", type: "ellipse" }]);
    openDocument(createDocument({ title: "Fresh work" }, sceneOf(fx.api)));
    usePersistenceStore.getState().markDirty();
    renderDialog();

    expect(await screen.findByText("Fresh work")).toBeTruthy();
  });
});
