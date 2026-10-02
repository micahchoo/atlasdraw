// SPDX-License-Identifier: AGPL-3.0-only
//
// The server versions dialog over the real PersistenceStore (fake-indexeddb),
// the real open Document and the real server-map cache. The storage server
// and Excalidraw are stand-ins.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { write, type AtlasdrawDocument } from "@atlasdraw/data";

import { ServerVersionsDialog } from "../ServerVersionsDialog";
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
import { buildRemoteSaveCallback } from "../../state/remoteMapIdCache";
import {
  createPersistenceState,
  type PersistenceStateStore,
} from "../../state/persistenceState";
import { createHistory } from "../../session/history";
import {
  makeFakeExcalidraw,
  type FakeExcalidraw,
} from "../../state/__tests__/fixtures/documentWorld";

import type { StorageClient } from "../../services/createHttpStorageClient";

const A = "01J0000000000000000000000A";
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

const savedFile = (title: string, elementId: string): AtlasdrawDocument => ({
  manifest: {
    id: A,
    version: 2,
    title,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    basemap: { type: "registry", id: "protomaps-light" },
    camera: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
    world: { z0: 22, origin: { x: 0, y: 0 } },
    layers: [],
    permissions: { publicView: false },
  },
  scene: [
    {
      id: elementId,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
    },
  ] as unknown as AtlasdrawDocument["scene"],
  layers: new Map(),
  styleRef: {},
  files: new Map(),
});

let n = 0;
let store: PersistenceStore;
let fx: FakeExcalidraw;
let persistence: PersistenceStateStore;
const notify = { success: vi.fn(), error: vi.fn() };

/** A Blob's bytes. jsdom's Blob has no arrayBuffer(). */
const blobBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** A server that holds the open map at revision 3, and revision 1 before it. */
async function server(): Promise<StorageClient> {
  const old = await blobBytes(await write(savedFile("Old title", "old-el")));
  const client = {
    createMap: vi.fn(async () => ({
      map: { id: "map000000000000000001", revision: 3 },
      writeKey: "key-1",
    })),
    updateMap: vi.fn(async () => ({ revision: 4 })),
    listVersions: vi.fn(async () => ({
      current: 3,
      versions: [
        { revision: 3, savedAt: "2026-10-01T11:55:00.000Z", byteSize: 2048 },
        { revision: 1, savedAt: "2026-09-30T12:00:00.000Z", byteSize: 1024 },
      ],
    })),
    readVersion: vi.fn(async (_id: string, _key: string, revision: number) => ({
      bytes: old.slice().buffer,
      revision,
    })),
  } as unknown as StorageClient;
  await buildRemoteSaveCallback(client)(new Blob(["x"]), A);
  return client;
}

function show(client: StorageClient, onClose = vi.fn()) {
  render(
    <ServerVersionsDialog
      excalidrawAPI={fx.api}
      persistence={persistence}
      history={createHistory()}
      notify={notify}
      client={client}
      onClose={onClose}
      now={() => NOW}
    />,
  );
  return onClose;
}

beforeEach(async () => {
  store = createPersistenceStore({ dbName: `versions-ui-${++n}` });
  persistence = createPersistenceState();
  persistence.getState().setPersistenceStore(store);
  persistence.getState().setForceSave(async () => {
    await store.save(toFile(currentDocument()));
  });
  notify.success.mockClear();
  notify.error.mockClear();
  const remote = await openDB("atlasdraw-autosave", 1, {
    upgrade: (d) => {
      d.createObjectStore("state");
    },
  });
  await remote.clear("state");
  remote.close();
  fx = makeFakeExcalidraw([{ id: "now-el", type: "ellipse" }]);
  openDocument(createDocument({ id: A, title: "Now" }, sceneOf(fx.api)));
});

afterEach(async () => {
  cleanup();
  persistence.getState().setPersistenceStore(null);
  await store.close();
});

describe("ServerVersionsDialog", () => {
  it("lists the server's versions, the current one first and marked", async () => {
    show(await server());

    const rows = await screen.findAllByTestId("server-versions-row");

    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Current")).toBeTruthy();
    expect(rows[0]!.textContent).toContain("5 minutes ago");
    expect(rows[1]!.textContent).toContain("yesterday");
    expect(rows[1]!.textContent).toContain("1 KB");
  });

  it("restores a version after the question, and closes", async () => {
    const client = await server();
    const onClose = show(client);
    const rows = await screen.findAllByTestId("server-versions-row");

    fireEvent.click(within(rows[1]!).getByTestId("server-versions-restore"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fx.all().map((e) => e.id)).toEqual(["old-el"]);
    expect(currentDocument().id).toBe(A);
  });

  it("restores nothing when the question is cancelled", async () => {
    const client = await server();
    show(client);
    const rows = await screen.findAllByTestId("server-versions-row");

    fireEvent.click(within(rows[1]!).getByTestId("server-versions-restore"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(client.readVersion).not.toHaveBeenCalled();
    expect(fx.all().map((e) => e.id)).toEqual(["now-el"]);
  });

  it("opens a version as a copy, and the open map keeps its id on the server", async () => {
    const client = await server();
    const onClose = show(client);
    const rows = await screen.findAllByTestId("server-versions-row");

    fireEvent.click(within(rows[1]!).getByTestId("server-versions-copy"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(currentDocument().id).not.toBe(A);
    expect(client.updateMap).not.toHaveBeenCalled();
  });

  it("says so when the server cannot list the versions", async () => {
    const client = await server();
    (client.listVersions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline"),
    );
    show(client);

    expect(
      (await screen.findByTestId("server-versions-error")).textContent,
    ).toMatch(/could not get/i);
  });
});
