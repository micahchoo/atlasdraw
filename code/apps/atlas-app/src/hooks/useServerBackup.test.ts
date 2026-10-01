// SPDX-License-Identifier: AGPL-3.0-only
//
// "Restore from server backup" is offered only when the build saves to a
// server and this browser holds a server map for the open document.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appConfigModule from "../config/app-config";
import { createDocument, openDocument } from "../state/document";
import { buildRemoteSaveCallback } from "../state/remoteMapIdCache";
import { testSession } from "../session/__tests__/sessionFixture";

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
  geocoder: undefined,
  allowRemoteBasemaps: false,
  embedEnabled: true,
  pmtilesPath: "/data/world-low-zoom.pmtiles",
  appVersion: "unknown",
  gitHash: "unknown",
});

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

    const session = testSession();
    const { view } = session;
    view.setState({ backupAvailable: true });
    renderHook(() => useServerBackup(session));
    await act(async () => {});

    expect(view.getState().backupAvailable).toBe(false);
  });

  it("is offered for a document with a server map, and not for one without", async () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(config(true));
    await pushServerMap(A);
    openDocument(createDocument({ id: A }));

    const session = testSession();
    const { view } = session;
    renderHook(() => useServerBackup(session));
    await waitFor(() => expect(view.getState().backupAvailable).toBe(true));

    act(() => openDocument(createDocument({ id: B })));
    await waitFor(() => expect(view.getState().backupAvailable).toBe(false));
  });
});
