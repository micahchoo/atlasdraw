// SPDX-License-Identifier: AGPL-3.0-only
//
// useRoom: what the editor does around a room. The relay is an in-memory
// Y.Doc here; the real transport is measured in collab.known-red.test.ts.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { newRoomLink, roomFragment } from "@atlasdraw/protocol";

import * as appConfig from "../config/app-config";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../state/document";
import * as roomModule from "../state/room";
import { isRoomDocument, type RoomTransport } from "../state/room";
import { seedRoom } from "../state/roomDocument";
import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";

import { useRoom } from "./useRoom";

import type { AppConfig } from "../config/app-config";

function rect(id: string) {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  };
}

/** A relay that is one Y.Doc in memory, synced both ways. */
function memoryRelay() {
  const server = new Y.Doc();
  const transport: RoomTransport = ({ doc, events }) => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), server);
    const up = (u: Uint8Array, origin: unknown) => {
      if (origin !== server) {
        Y.applyUpdate(server, u, doc);
      }
    };
    const down = (u: Uint8Array, origin: unknown) => {
      if (origin !== doc) {
        Y.applyUpdate(doc, u, server);
      }
    };
    doc.on("update", up);
    server.on("update", down);
    queueMicrotask(() => events.synced());
    return {
      close() {
        doc.off("update", up);
        server.off("update", down);
      },
    };
  };
  return { server, transport };
}

beforeEach(() => {
  vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
    realtime: { enabled: true, wsUrl: "ws://relay.invalid" },
  } as AppConfig);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  openDocument(createDocument());
});

describe("useRoom", () => {
  it("a room link shows the room; the user's own map is untouched and comes back on leaving", async () => {
    const relay = memoryRelay();
    vi.spyOn(roomModule, "relayTransport").mockReturnValue(relay.transport);
    const host = createDocument(
      { title: "Shared survey" },
      { elements: () => [rect("shared")] as never, files: () => ({}) },
    );
    await seedRoom(relay.server, host, "host");
    const link = newRoomLink();
    window.history.replaceState(null, "", `/${roomFragment(link)}`);

    const own = createDocument({ title: "Mine" });
    openDocument(own);
    const fake = makeFakeExcalidraw([rect("own")] as never);

    const { result, unmount } = renderHook(() => useRoom(fake.api, null));
    await waitFor(() => expect(result.current.status).toBe("joined"));

    expect(currentDocument().snapshot().title).toBe("Shared survey");
    expect(isRoomDocument(currentDocument())).toBe(true);
    expect(fake.all().map((e) => e.id)).toEqual(["shared"]);
    expect(own.snapshot().title).toBe("Mine");

    unmount();

    expect(currentDocument()).toBe(own);
    expect(fake.all().map((e) => e.id)).toEqual(["own"]);
  });

  it("start() makes a room from the open map and puts its link in the URL", async () => {
    const relay = memoryRelay();
    vi.spyOn(roomModule, "relayTransport").mockReturnValue(relay.transport);
    const fake = makeFakeExcalidraw([rect("own")] as never);
    openDocument(
      createDocument(
        { title: "Mine" },
        { elements: () => fake.all() as never, files: () => ({}) },
      ),
    );

    const { result } = renderHook(() => useRoom(fake.api, null));
    let url = "";
    await act(async () => {
      url = await result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe("joined"));

    expect(url).toContain("#room:");
    expect(window.location.hash).toBe(new URL(url).hash);
    expect(relay.server.getMap("meta").get("title")).toBe("Mine");
    expect(Array.from(relay.server.getMap("elements").keys())).toEqual(["own"]);
    expect(isRoomDocument(currentDocument())).toBe(true);

    // A second Collaborate keeps the room.
    let again = "";
    await act(async () => {
      again = await result.current.start();
    });
    expect(again).toBe(url);
  });

  it("opening another document leaves the room, and nothing of it reaches the room", async () => {
    const relay = memoryRelay();
    vi.spyOn(roomModule, "relayTransport").mockReturnValue(relay.transport);
    const host = createDocument(
      { title: "Shared survey" },
      { elements: () => [rect("shared")] as never, files: () => ({}) },
    );
    await seedRoom(relay.server, host, "host");
    const link = newRoomLink();
    window.history.replaceState(null, "", `/${roomFragment(link)}`);
    const fake = makeFakeExcalidraw();

    const { result } = renderHook(() => useRoom(fake.api, null));
    await waitFor(() => expect(result.current.status).toBe("joined"));

    // What opening a file does: a new document, then its drawing.
    act(() => {
      openDocument(createDocument({ title: "From a file" }));
      fake.setElements([rect("from-file")] as never);
    });

    expect(result.current.room).toBeNull();
    expect(window.location.hash).toBe("");
    expect(Array.from(relay.server.getMap("elements").keys())).toEqual([
      "shared",
    ]);
    expect(currentDocument().snapshot().title).toBe("From a file");
  });

  it("says why a link that is not a room link cannot be joined", () => {
    window.history.replaceState(null, "", "/#room:not-a-room");
    const fake = makeFakeExcalidraw();

    const { result } = renderHook(() => useRoom(fake.api, null));

    expect(result.current.error).toMatch(/not valid/);
    expect(result.current.room).toBeNull();
  });
});
