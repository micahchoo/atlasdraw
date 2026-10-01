// SPDX-License-Identifier: AGPL-3.0-only
//
// "Restore from server backup" is offered only when the build saves to a
// server and this browser holds a server map for the open document.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import * as appConfigModule from "../config/app-config";
import { createDocument, openDocument } from "../state/document";
import { buildRemoteSaveCallback } from "../state/remoteMapIdCache";

import { useServerBackup } from "./useServerBackup";

import type { AppConfig } from "../config/app-config";
import type { StorageClient } from "../services/createHttpStorageClient";

const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";

const config = (enableBackendPersistence: boolean): AppConfig => ({
  buildTarget: "hosted",
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence,
  showDemoBadge: false,
  storageBaseUrl: "http://storage.test",
  maputnikUrl: "https://maputnik.github.io/editor/",
  geocoder: undefined,
  allowRemoteBasemaps: false,
  embedEnabled: true,
  pmtilesPath: "/data/world-low-zoom.pmtiles",
  appVersion: "unknown",
  gitHash: "unknown",
});

const api = {} as ExcalidrawImperativeAPI;
const notify = { success: vi.fn(), error: vi.fn() };

async function pushServerMap(documentId: string) {
  const client = {
    createMap: async () => ({
      map: { id: "map000000000000000001" },
      writeKey: "key-1",
    }),
  } as unknown as StorageClient;
  await buildRemoteSaveCallback(client)(new Blob(["x"]), documentId);
}

beforeEach(async () => {
  const db = await openDB("atlasdraw-autosave", 1, {
    upgrade: (d) => {
      d.createObjectStore("state");
    },
  });
  await db.clear("state");
  db.close();
});

describe("useServerBackup", () => {
  it("is not offered when the build does not save to a server", async () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(config(false));
    await pushServerMap(A);
    openDocument(createDocument({ id: A }));

    const { result } = renderHook(() => useServerBackup(api, notify));
    await act(async () => {});

    expect(result.current.available).toBe(false);
  });

  it("is offered for a document with a server map, and not for one without", async () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(config(true));
    await pushServerMap(A);
    openDocument(createDocument({ id: A }));

    const { result } = renderHook(() => useServerBackup(api, notify));
    await waitFor(() => expect(result.current.available).toBe(true));

    act(() => openDocument(createDocument({ id: B })));
    await waitFor(() => expect(result.current.available).toBe(false));
  });
});
