// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Collaboration, measured between real clients through a real relay.
//
// Every test opens rooms (state/room.ts) against the relay's own room server
// (apps/realtime/src/rooms.ts) on an ephemeral port, over real WebSockets
// with the y-websocket provider. Nothing is mocked.
//
// THE HARNESS DOES ONLY WHAT THE EDITOR DOES (hooks/useRoom.ts and
// MapEditor.tsx): join with the link, attach the editor once the room has
// joined, and from then on make every edit through the room's Document, its
// comments, and `presence`. The stand-in editor plays Excalidraw: it holds
// the elements, and it calls its change listeners after a local edit, as
// Excalidraw's onChange does.
//
// BroadcastChannel is off in every provider, so nothing syncs around the
// relay.

import http from "http";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  read as readAtlasdraw,
  write as writeAtlasdraw,
} from "@atlasdraw/data";
import { newRoomLink, type RoomLink } from "@atlasdraw/protocol";

import type { BinaryFileData } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { sqliteRoomStore } from "../../../../realtime/src/room-store";
import {
  registerRoomServer,
  type RoomServer,
} from "../../../../realtime/src/rooms";
import { toFile } from "../documentIO";
import { joinRoom, relayTransport, type Room } from "../room";

import type { BinaryFiles, RoomEditor } from "../roomScene";
import type { FeatureCollection } from "geojson";

let server: http.Server;
let rooms: RoomServer;
let relayUrl: string;
const store = sqliteRoomStore(":memory:");

beforeAll(async () => {
  server = http.createServer();
  rooms = registerRoomServer(server, { store, saveDelayMs: 50 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  relayUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 10_000);

afterEach(() => {
  // A failing test stops before its own leave().
  for (const c of open) {
    c.leave();
  }
});

afterAll(async () => {
  rooms.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  store.close();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Client {
  room: Room;
  /** The stand-in editor's scene — what Excalidraw would be showing. */
  scene: ExcalidrawElement[];
  /** The owner draws an element. */
  draw(element: ExcalidrawElement): void;
  /** The owner moves the pointer over the map, to this place. */
  movePointer(lng: number, lat: number): void;
  leave(): void;
}

const open = new Set<Client>();

function openClient(link: RoomLink): Client {
  const changeListeners = new Set<() => void>();
  let files: BinaryFiles = {};
  const editor: RoomEditor = {
    elements: () => client.scene,
    files: () => files,
    apply: (elements) => {
      client.scene = [...elements];
    },
    addFiles: (added: BinaryFileData[]) => {
      files = { ...files };
      for (const f of added) {
        files[f.id] = f;
      }
    },
    onChange: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };

  const room = joinRoom(link, relayTransport(relayUrl), {
    scene: { elements: () => client.scene, files: () => files },
  });
  let detach: (() => void) | null = null;
  room.status((status) => {
    if (status === "joined" && !detach) {
      detach = room.attach(editor);
    }
  });

  const client: Client = {
    room,
    scene: [],
    draw(element) {
      client.scene = [...client.scene, element];
      for (const l of changeListeners) {
        l();
      }
    },
    movePointer(lng, lat) {
      room.presence.setCursor({ lng, lat });
    },
    leave() {
      detach?.();
      room.leave();
      open.delete(client);
    },
  };
  open.add(client);
  return client;
}

async function joined(...clients: Client[]): Promise<void> {
  await until("every client has joined its room", () =>
    clients.every((c) => c.room.document !== null),
  );
}

async function until(
  what: string,
  cond: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start <= timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(cond(), `not within ${timeoutMs}ms: ${what}`).toBe(true);
}

function rectangle(id: string): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  } as unknown as ExcalidrawElement;
}

function documentOf(c: Client) {
  const d = c.room.document;
  if (!d) {
    throw new Error("client has not joined");
  }
  return d;
}

/** Comment texts this client can see. */
function commentTexts(c: Client): string[] {
  return (c.room.document?.comments.comments ?? []).map((x) => x.text);
}

function addComment(c: Client, text: string): void {
  documentOf(c).comments.addComment({
    text,
    anchor: { kind: "map", lng: 13.4, lat: 52.5 },
    authorId: "author-a",
    authorName: "A",
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

describe("controls: the harness and relay work", () => {
  it("a joiner receives the host's scene when it joins", async () => {
    const link = newRoomLink();
    const host = openClient(link);
    await joined(host);
    host.draw(rectangle("before-join"));

    const guest = openClient(link);
    await until("the guest's scene holds the host's shape", () =>
      guest.scene.some((e) => e.id === "before-join"),
    );

    host.leave();
    guest.leave();
  });

  it("a comment one client adds reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    addComment(a, "live comment");
    await until("B sees A's comment", () =>
      commentTexts(b).includes("live comment"),
    );

    a.leave();
    b.leave();
  });

  it("a client whose link has another key for the room is denied and sees nothing", async () => {
    const link = newRoomLink();
    const owner = openClient(link);
    await joined(owner);
    addComment(owner, "for the team only");

    const outsider = openClient({ ...link, secret: newRoomLink().secret });
    const seen: string[] = [];
    outsider.room.status((s) => seen.push(s));
    await until("the outsider is denied", () => seen.includes("denied"));
    expect(outsider.room.document).toBeNull();

    owner.leave();
    outsider.leave();
  });
});

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

describe("collaboration between two clients", () => {
  it("a shape one client draws reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    a.draw(rectangle("drawn-after-join"));

    await until("B's scene holds the shape A drew", () =>
      b.scene.some((e) => e.id === "drawn-after-join"),
    );
    a.leave();
    b.leave();
  });

  it("a data-layer feature one client adds reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // What the import path does: a command on the open document.
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "well-1",
          properties: { name: "Well" },
          geometry: { type: "Point", coordinates: [13.4, 52.5] },
        },
      ],
    };
    documentOf(a).dispatch({
      type: "add-data-layer",
      id: "dl:wells",
      fc,
      label: "Wells",
      style: {},
    });

    await until("B's data layer holds the feature A added", () =>
      (
        documentOf(b).snapshot().featureCollections["dl:wells"]?.features ?? []
      ).some((f) => f.id === "well-1"),
    );
    expect(
      documentOf(b)
        .snapshot()
        .overlays.map((e) => e.label),
    ).toEqual(["Wells"]);
    a.leave();
    b.leave();
  });

  it("each client sees the other, with a cursor after it moves", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // Presence: each sees exactly one peer, without anyone moving.
    await until(
      "each client lists the other as a peer",
      () =>
        a.room.presence.peers().length === 1 &&
        b.room.presence.peers().length === 1,
    );

    a.movePointer(13.4, 52.5);
    b.movePointer(2.35, 48.85);

    await until("each peer carries a cursor", () =>
      [...a.room.presence.peers(), ...b.room.presence.peers()].every(
        (p) => p.cursor !== null,
      ),
    );
    expect(b.room.presence.peers()[0]?.cursor).toEqual({
      lng: 13.4,
      lat: 52.5,
    });
    a.leave();
    b.leave();
  });

  it("the document title one client sets reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // What the title field does when the owner renames the sheet.
    documentOf(a).dispatch({
      type: "rename-document",
      title: "Survey of the Spree",
    });

    await until(
      "B's document title is the one A set",
      () => documentOf(b).snapshot().title === "Survey of the Spree",
    );
    a.leave();
    b.leave();
  });
});

describe("the relay's abuse limits reach the user", () => {
  it("a client over the relay's new-room limit is told so and stops trying", async () => {
    const limitedServer = http.createServer();
    const limitedStore = sqliteRoomStore(":memory:");
    const limited = registerRoomServer(limitedServer, {
      store: limitedStore,
      maxNewRoomsPerIp: 1,
    });
    await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
    const url = `ws://127.0.0.1:${
      (limitedServer.address() as { port: number }).port
    }`;
    try {
      const first = joinRoom(newRoomLink(), relayTransport(url));
      const second = joinRoom(newRoomLink(), relayTransport(url));
      const seen: string[] = [];
      second.status((s) => seen.push(s));
      await until("the first room is made", () => first.document !== null);
      await until("the second is refused as limited", () =>
        seen.includes("limited"),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(seen.at(-1), "no retry turned it into another status").toBe(
        "limited",
      );
      expect(limited.connections()).toBe(1);
      first.leave();
      second.leave();
    } finally {
      limited.close();
      await new Promise<void>((resolve) => {
        limitedServer.close(() => resolve());
        limitedServer.closeAllConnections();
      });
      limitedStore.close();
    }
  });
});

describe("comments outlive the room", () => {
  it("comments survive the room emptying and refilling", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    addComment(a, "check the culvert");
    // B seeing it proves the relay holds it.
    await until("B sees A's comment", () =>
      commentTexts(b).includes("check the culvert"),
    );

    a.leave();
    b.leave();
    await until("the relay let the room go", () => rooms.rooms() === 0);

    const later = openClient(link);
    try {
      await until("a client joining the refilled room sees the comment", () =>
        commentTexts(later).includes("check the culvert"),
      );
    } finally {
      later.leave();
    }
  });
});

describe("comments in the saved document", () => {
  /** Whether `text` appears anywhere in a read-back document. */
  async function mentions(value: unknown, text: string): Promise<boolean> {
    if (typeof value === "string") {
      return value.includes(text);
    }
    if (value instanceof Blob) {
      return (await value.text()).includes(text);
    }
    if (value instanceof Map) {
      for (const [k, v] of value) {
        if ((await mentions(k, text)) || (await mentions(v, text))) {
          return true;
        }
      }
      return false;
    }
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) {
        if (await mentions(v, text)) {
          return true;
        }
      }
    }
    return false;
  }

  it("a comment in the session is in the .atlasdraw file and comes back on read", async () => {
    const a = openClient(newRoomLink());
    try {
      await joined(a);
      addComment(a, "survey marker is 2 m east");
      expect(commentTexts(a)).toContain("survey marker is 2 m east");

      // What Save does: the file form of the open document.
      const saved = toFile(documentOf(a));
      const reopened = await readAtlasdraw(await writeAtlasdraw(saved));

      expect(
        await mentions(reopened, "survey marker is 2 m east"),
        "the reopened document mentions the comment",
      ).toBe(true);
    } finally {
      a.leave();
    }
  });
});
