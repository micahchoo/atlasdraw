// SPDX-License-Identifier: AGPL-3.0-only
//
// useRoom: what the editor does around a room. The relay is an in-memory
// Y.Doc here; the real transport is measured in collab.known-red.test.ts.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { newRoomLink, roomFragment } from "@atlasdraw/protocol";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import * as appConfig from "../config/app-config";
import { toFile } from "../state/documentIO";
import * as persistenceModule from "../state/persistence";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../state/document";
import {
  isRoomDocument,
  type RoomTransport,
  type TransportEvents,
} from "../state/room";
import { seedRoom } from "../state/roomDocument";
import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";

import { testSession } from "../session/__tests__/sessionFixture";

import { usePersistenceWiring } from "./usePersistenceWiring";
import { roomConnection, roomProblem, useRoom } from "./useRoom";

import type { AppConfig } from "../config/app-config";
import type { PersistenceStore } from "../state/persistence";

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

/** A memory relay whose connection the test can close, as a relay would. */
function closableRelay() {
  const relay = memoryRelay();
  let events: TransportEvents | null = null;
  const transport: RoomTransport = (args) => {
    events = args.events;
    return relay.transport(args);
  };
  return {
    ...relay,
    transport,
    close(code: number, reason = "") {
      events?.closed(code, reason);
    },
  };
}

/** The editor's session; a new one for every case. */
let session = testSession();

beforeEach(() => {
  session = testSession();
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

    const { result, unmount } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
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
    const fake = makeFakeExcalidraw([rect("own")] as never);
    openDocument(
      createDocument(
        { title: "Mine" },
        { elements: () => fake.all() as never, files: () => ({}) },
      ),
    );

    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
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
    const host = createDocument(
      { title: "Shared survey" },
      { elements: () => [rect("shared")] as never, files: () => ({}) },
    );
    await seedRoom(relay.server, host, "host");
    const link = newRoomLink();
    window.history.replaceState(null, "", `/${roomFragment(link)}`);
    const fake = makeFakeExcalidraw();

    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
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

  it("a room link opened before the autosaved map loaded: leaving returns the user's own map, and it is never overwritten", async () => {
    const relay = memoryRelay();
    const host = createDocument(
      { title: "Shared survey" },
      { elements: () => [rect("shared")] as never, files: () => ({}) },
    );
    await seedRoom(relay.server, host, "host");
    const link = newRoomLink();
    window.history.replaceState(null, "", `/${roomFragment(link)}`);

    // The autosave holds the user's own map; reading it is slow.
    const ownFile = toFile(
      createDocument(
        { title: "Mine" },
        { elements: () => [rect("own")] as never, files: () => ({}) },
      ),
    );
    let finishLoad: (doc: AtlasdrawDocument) => void = () => {};
    const saved: string[] = [];
    const store = {
      load: () =>
        new Promise<AtlasdrawDocument>((resolve) => {
          finishLoad = resolve;
        }),
      save: vi.fn(async (doc: AtlasdrawDocument) => {
        saved.push(doc.manifest.title);
        return { kind: "saved" as const, revision: 1 };
      }),
      // One tab per map (session/mapOwnership.ts): this tab holds every map.
      claim: async (id: string) => ({
        kind: "lease" as const,
        id,
        release: () => {},
        lost: new Promise<void>(() => {}),
      }),
      onDirty: () => () => {},
      markDirty: () => {},
      isDirty: () => false,
      remoteSaveFailed: () => false,
      close: async () => {},
    } as unknown as PersistenceStore;
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(() => {});

    // What MapEditor does: the autosave wiring and the room, one editor.
    const fake = makeFakeExcalidraw();
    const notify = { error: vi.fn() };
    const { result, unmount } = renderHook(() => {
      usePersistenceWiring(session, fake.api, notify);
      return useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      });
    });
    await waitFor(() => expect(result.current.room).not.toBeNull());
    // The room is ready before the autosave is.
    await new Promise((r) => setTimeout(r, 20));
    await act(async () => {
      finishLoad(ownFile);
    });
    await waitFor(() => expect(isRoomDocument(currentDocument())).toBe(true));
    expect(fake.all().map((e) => e.id)).toEqual(["shared"]);

    unmount();

    expect(currentDocument().snapshot().title).toBe("Mine");
    expect(fake.all().map((e) => e.id)).toEqual(["own"]);
    expect(saved.filter((t) => t !== "Mine")).toEqual([]);
  });

  it("start() on a map over the size cap says why, and makes no room", async () => {
    const relay = memoryRelay();
    const fake = makeFakeExcalidraw([rect("own")] as never);
    const own = createDocument(
      { title: "Mine" },
      { elements: () => fake.all() as never, files: () => ({}) },
    );
    own.dispatch({
      type: "add-data-layer",
      id: "dl:big",
      label: "Parcels",
      style: {},
      fc: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [13.4, 52.5] },
            properties: { note: "x".repeat(16 << 20) },
          },
        ],
      },
    });
    openDocument(own);

    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
    let refusal: unknown = null;
    await act(async () => {
      await result.current.start().catch((err: unknown) => {
        refusal = err;
      });
    });

    expect(String(refusal)).toMatch(/Parcels.*16\.0 MB.*15\.0 MB/);
    expect(result.current.room).toBeNull();
    expect(window.location.hash).toBe("");
    expect(relay.server.getMap("meta").size).toBe(0);
    expect(currentDocument()).toBe(own);
  });

  it("a refusal after joining says, with the sizes, that edits are no longer saved", async () => {
    const relay = closableRelay();
    await seedRoom(relay.server, createDocument({ title: "Shared" }), "host");
    window.history.replaceState(null, "", `/${roomFragment(newRoomLink())}`);
    const fake = makeFakeExcalidraw();
    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("joined"));
    expect(roomConnection(result.current)).toBeNull();

    act(() => relay.close(4413, "room too large: 70000 > 65536"));

    expect(result.current.status).toBe("too-large");
    const problem = roomProblem(result.current) ?? "";
    expect(problem).toMatch(/68\.4 KB.*64\.0 KB/);
    expect(problem).toMatch(/no longer saved/);
    expect(roomConnection(result.current)).toMatch(/not saved/i);
  });

  it("shows connecting, and offline after a drop, in the status line", async () => {
    const relay = closableRelay();
    await seedRoom(relay.server, createDocument({ title: "Shared" }), "host");
    window.history.replaceState(null, "", `/${roomFragment(newRoomLink())}`);
    const fake = makeFakeExcalidraw();
    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: relay.transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );
    expect(roomConnection(result.current)).toMatch(/connecting/i);
    await waitFor(() => expect(result.current.status).toBe("joined"));

    act(() => relay.close(1006));

    expect(result.current.status).toBe("offline");
    expect(roomConnection(result.current)).toMatch(/offline/i);
    expect(roomProblem(result.current)).toBeNull();
  });

  it("says why a link that is not a room link cannot be joined", () => {
    window.history.replaceState(null, "", "/#room:not-a-room");
    const fake = makeFakeExcalidraw();

    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: memoryRelay().transport,
        persistence: session.persistence,
        view: session.view,
      }),
    );

    expect(result.current.error).toMatch(/not valid/);
    expect(result.current.room).toBeNull();
  });

  it("an editor without a transport offers no rooms and says so for a room link", () => {
    window.history.replaceState(null, "", `/${roomFragment(newRoomLink())}`);
    const fake = makeFakeExcalidraw();

    const { result } = renderHook(() =>
      useRoom(fake.api, null, {
        transport: null,
        persistence: session.persistence,
        view: session.view,
      }),
    );

    expect(result.current.available).toBe(false);
    expect(result.current.error).toMatch(/not set up for shared maps/);
    expect(result.current.room).toBeNull();
  });

  describe("a room link that arrives in an open editor", () => {
    async function seeded(title: string) {
      const relay = memoryRelay();
      await seedRoom(relay.server, createDocument({ title }), "host");
      return relay;
    }

    /**
     * Put `hash` in the address bar, as a paste or a link click does. The
     * event is sent here, once: jsdom would send its own a task later.
     */
    function navigate(hash: string) {
      act(() => {
        window.history.replaceState(null, "", `/${hash}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    }

    it("joins that room", async () => {
      const relay = await seeded("Shared survey");
      const fake = makeFakeExcalidraw();
      const { result } = renderHook(() =>
        useRoom(fake.api, null, {
          transport: relay.transport,
          persistence: session.persistence,
          view: session.view,
        }),
      );
      expect(result.current.room).toBeNull();

      navigate(roomFragment(newRoomLink()));

      await waitFor(() => expect(result.current.status).toBe("joined"));
      expect(currentDocument().snapshot().title).toBe("Shared survey");
    });

    it("asks before it leaves one room for another; no keeps the room and its link", async () => {
      const relay = await seeded("First");
      const first = newRoomLink();
      window.history.replaceState(null, "", `/${roomFragment(first)}`);
      const fake = makeFakeExcalidraw();
      const { result } = renderHook(() =>
        useRoom(fake.api, null, {
          transport: relay.transport,
          persistence: session.persistence,
          view: session.view,
        }),
      );
      await waitFor(() => expect(result.current.status).toBe("joined"));
      const room = result.current.room;

      navigate(roomFragment(newRoomLink()));

      const question = session.view.getState().dialog;
      expect(question?.kind).toBe("confirm");
      await act(async () => {
        (question as { answer(yes: boolean): void }).answer(false);
      });
      expect(result.current.room).toBe(room);
      expect(window.location.hash).toBe(roomFragment(first));
    });

    it("yes leaves the room and joins the other", async () => {
      const relay = await seeded("Shared");
      window.history.replaceState(null, "", `/${roomFragment(newRoomLink())}`);
      const fake = makeFakeExcalidraw();
      const { result } = renderHook(() =>
        useRoom(fake.api, null, {
          transport: relay.transport,
          persistence: session.persistence,
          view: session.view,
        }),
      );
      await waitFor(() => expect(result.current.status).toBe("joined"));
      const room = result.current.room;
      const second = newRoomLink();

      navigate(roomFragment(second));
      await act(async () => {
        (
          session.view.getState().dialog as { answer(yes: boolean): void }
        ).answer(true);
      });

      await waitFor(() =>
        expect(result.current.room?.link.roomId).toBe(second.roomId),
      );
      expect(result.current.room).not.toBe(room);
    });

    it("the link of the room it is in changes nothing", async () => {
      const relay = await seeded("Shared");
      const link = newRoomLink();
      window.history.replaceState(null, "", `/${roomFragment(link)}`);
      const fake = makeFakeExcalidraw();
      const { result } = renderHook(() =>
        useRoom(fake.api, null, {
          transport: relay.transport,
          persistence: session.persistence,
          view: session.view,
        }),
      );
      await waitFor(() => expect(result.current.status).toBe("joined"));
      const room = result.current.room;

      navigate(roomFragment(link));

      expect(session.view.getState().dialog).toBeNull();
      expect(result.current.room).toBe(room);
    });

    it("a broken link says so", () => {
      const fake = makeFakeExcalidraw();
      const { result } = renderHook(() =>
        useRoom(fake.api, null, {
          transport: memoryRelay().transport,
          persistence: session.persistence,
          view: session.view,
        }),
      );

      navigate("#room:not-a-room");

      expect(result.current.error).toMatch(/not valid/);
      expect(result.current.room).toBeNull();
    });
  });
});
